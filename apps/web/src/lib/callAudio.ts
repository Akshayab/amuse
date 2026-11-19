let ctx: AudioContext | null = null;

export function callAudio(): AudioContext {
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
  ctx ??= new AC() as AudioContext;
  return ctx;
}

/**
 * Must run synchronously inside the tap that starts a call. Browsers (Safari especially, and
 * Chrome inside embedded previews) only let a page make sound from an audio context that was
 * started by a user gesture; the reply arrives seconds later, long after the gesture.
 */
export function unlockCallAudio() {
  const c = callAudio();
  void c.resume();
  const s = c.createBufferSource();
  s.buffer = c.createBuffer(1, 1, 22050);
  s.connect(c.destination);
  s.start(0);
}

/** Short tones so the person knows when the call is listening and when it heard them. */
export function chime(kind: "listen" | "heard" | "end") {
  const c = callAudio();
  if (c.state !== "running") return;
  const notes = kind === "listen" ? [660, 880] : kind === "heard" ? [880, 660] : [520, 390];
  notes.forEach((f, i) => {
    const o = c.createOscillator();
    const g = c.createGain();
    const t = c.currentTime + i * 0.09;
    o.frequency.value = f;
    o.type = "sine";
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 0.18);
  });
}

/** Split a reply so the first sentence can be voiced (and heard) while the rest is still being generated. */
export function splitForSpeech(text: string): string[] {
  const sentences = (
    text
      .replace(/\s+/g, " ")
      .trim()
      .match(/[^.!?…]+[.!?…]*["')\]]*\s*/g) ?? [text]
  )
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  let buf = "";
  for (const s of sentences) {
    const limit = out.length === 0 ? 0 : 180;
    if (buf && (buf + " " + s).length > limit) {
      out.push(buf);
      buf = s;
    } else buf = buf ? buf + " " + s : s;
  }
  if (buf) out.push(buf);
  return out;
}

export type VoiceStats = {
  ctxState: string;
  chunksPlayed: number;
  secondsPlayed: number;
  peakOut: number;
  firstAudioMs: number | null;
  blocked: boolean;
  engine?: string;
};

export function voiceStats(): VoiceStats {
  return ((window as any).__amuseVoiceStats ??= { ctxState: "", chunksPlayed: 0, secondsPlayed: 0, peakOut: 0, firstAudioMs: null, blocked: false });
}

/**
 * Speak text through the call's audio context, one chunk at a time: chunk n+1 is generated on the
 * server while chunk n plays. Resolves when done or when `stop.stopped` is set.
 */
export async function speakChunks(
  text: string,
  fetchChunk: (t: string) => Promise<ArrayBuffer>,
  opts: { stop: { stopped: boolean; current?: AudioBufferSourceNode }; onStart: () => void; onLevel: (l: number) => void },
) {
  const c = callAudio();
  await c.resume().catch(() => undefined);
  const stats = voiceStats();
  stats.ctxState = c.state;
  if (c.state !== "running") {
    stats.blocked = true;
    throw new Error("audio blocked");
  }
  const an = c.createAnalyser();
  an.fftSize = 512;
  an.connect(c.destination);
  const data = new Uint8Array(an.fftSize);
  const meter = setInterval(() => {
    an.getByteTimeDomainData(data);
    let max = 0;
    for (const v of data) max = Math.max(max, Math.abs(v - 128));
    stats.peakOut = Math.max(stats.peakOut, max);
    opts.onLevel(max / 128);
  }, 60);
  const t0 = performance.now();
  const decode = (t: string) => fetchChunk(t).then((b) => c.decodeAudioData(b));
  try {
    const chunks = splitForSpeech(text);
    let next: Promise<AudioBuffer> | null = chunks.length ? decode(chunks[0]!) : null;
    for (let i = 0; i < chunks.length && next; i++) {
      const buf = await next;
      next = i + 1 < chunks.length ? decode(chunks[i + 1]!) : null;
      next?.catch(() => undefined);
      if (opts.stop.stopped) return;
      if (stats.firstAudioMs == null) stats.firstAudioMs = Math.round(performance.now() - t0);
      if (i === 0) opts.onStart();
      const startedAt = c.currentTime;
      await new Promise<void>((resolve) => {
        const s = c.createBufferSource();
        s.buffer = buf;
        s.connect(an);
        s.onended = () => resolve();
        opts.stop.current = s;
        s.start();
      });
      opts.stop.current = undefined;
      stats.chunksPlayed++;
      stats.secondsPlayed += Math.min(buf.duration, c.currentTime - startedAt);
      if (opts.stop.stopped) return;
    }
  } finally {
    clearInterval(meter);
    opts.onLevel(0);
    an.disconnect();
  }
}
