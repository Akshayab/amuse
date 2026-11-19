/**
 * Amuse's built-in companion creatures.
 * avatarUrl formats: "preset:<id>" | "sheet:<dataUrl>#<quadrant 0-3>" | data/http URL.
 */
export const PRESETS = [
  { id: "pip", name: "Pip", body: "#F4B183", belly: "#FCE3CF", ear: "round", accent: "#C2410C" },
  { id: "moss", name: "Moss", body: "#A3C4A8", belly: "#E3F0E5", ear: "leaf", accent: "#3F6B4B" },
  { id: "plum", name: "Plum", body: "#C7A6E0", belly: "#F1E6FA", ear: "tuft", accent: "#6B3FA0" },
  { id: "sky", name: "Sky", body: "#9DC7EC", belly: "#E4F1FB", ear: "round", accent: "#2563A8" },
  { id: "honey", name: "Honey", body: "#F2D16B", belly: "#FBF1C9", ear: "tuft", accent: "#A16207" },
  { id: "coral", name: "Coral", body: "#F29B9B", belly: "#FDE2E2", ear: "leaf", accent: "#B4373C" },
];

export function CreatureSvg({ id, mood = "happy", size = 64 }: { id: string; mood?: "happy" | "busy" | "sleepy"; size?: number }) {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0]!;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
      {p.ear === "round" && (
        <>
          <circle cx="28" cy="24" r="11" fill={p.body} />
          <circle cx="72" cy="24" r="11" fill={p.body} />
          <circle cx="28" cy="24" r="5" fill={p.belly} />
          <circle cx="72" cy="24" r="5" fill={p.belly} />
        </>
      )}
      {p.ear === "leaf" && (
        <>
          <path d="M30 30 Q18 8 38 14 Z" fill={p.accent} />
          <path d="M70 30 Q82 8 62 14 Z" fill={p.accent} />
        </>
      )}
      {p.ear === "tuft" && <path d="M44 16 Q50 2 56 16 Q50 11 44 16 Z" fill={p.accent} />}
      <ellipse cx="50" cy="56" rx="38" ry="36" fill={p.body} />
      <ellipse cx="50" cy="68" rx="24" ry="20" fill={p.belly} />
      {mood === "sleepy" ? (
        <>
          <path d="M33 50 q5 4 10 0" stroke="#2B2420" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M57 50 q5 4 10 0" stroke="#2B2420" strokeWidth="3" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <ellipse cx="38" cy="49" rx="5" ry={mood === "busy" ? 4 : 6} fill="#2B2420" />
          <ellipse cx="62" cy="49" rx="5" ry={mood === "busy" ? 4 : 6} fill="#2B2420" />
          <circle cx="39.5" cy="47" r="1.6" fill="#fff" />
          <circle cx="63.5" cy="47" r="1.6" fill="#fff" />
        </>
      )}
      <circle cx="30" cy="60" r="4" fill={p.accent} opacity="0.25" />
      <circle cx="70" cy="60" r="4" fill={p.accent} opacity="0.25" />
      <path d={mood === "busy" ? "M45 62 h10" : "M44 60 q6 6 12 0"} stroke="#2B2420" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M47 57 l3 3 l3 -3 z" fill={p.accent} />
    </svg>
  );
}

const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
export function presetImage(id: string, busy = false) {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0]!;
  return `${BASE}/avatars/${p.id}${busy ? "_busy" : ""}.jpg`;
}

/** Plush companion portrait; swaps to a "working" pose (headphones + laptop) while busy. */
export function PlushAvatar({ id, size = 64, busy = false, className = "" }: { id: string; size?: number; busy?: boolean; className?: string }) {
  return (
    <div className={`relative shrink-0 overflow-hidden rounded-full bg-[var(--card)] ${className}`} style={{ width: size, height: size }}>
      <img
        src={presetImage(id, false)}
        alt=""
        draggable={false}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${busy ? "opacity-0" : "opacity-100"}`}
      />
      <img
        src={presetImage(id, true)}
        alt=""
        draggable={false}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${busy ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}

export function AgentAvatar({
  avatarUrl,
  size = 40,
  busy = false,
  className = "",
}: {
  avatarUrl?: string | null;
  size?: number;
  busy?: boolean;
  className?: string;
}) {
  const url = avatarUrl ?? "preset:pip";
  const ring = "";
  if (url.startsWith("preset:")) return <PlushAvatar id={url.slice(7)} size={size} busy={busy} className={className} />;
  if (url.startsWith("sheet:")) {
    const [src, q] = url.slice(6).split("#");
    const qi = Number(q ?? 0);
    const x = qi % 2 === 0 ? "0%" : "100%";
    const y = qi < 2 ? "0%" : "100%";
    return (
      <div
        className={`rounded-full shrink-0 ${ring} ${className}`}
        style={{ width: size, height: size, backgroundImage: `url(${src})`, backgroundSize: "200% 200%", backgroundPosition: `${x} ${y}` }}
      />
    );
  }
  return <img src={url} alt="" className={`rounded-full object-cover shrink-0 ${ring} ${className}`} style={{ width: size, height: size }} />;
}
