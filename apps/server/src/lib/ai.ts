import OpenAI from "openai";
import { AsyncLocalStorage } from "node:async_hooks";
import { MODELS, openaiApiKey, openaiBaseUrl } from "./config";
import { OWNER_ID } from "../middlewares/owner";

export { MODELS };

const audioOwner = new AsyncLocalStorage<string>();
export function withAudioUsage<T>(userId: string, work: () => Promise<T>) {
  return audioOwner.run(userId, work);
}

export async function checkModelBudget() {
  const { assertWithinLimit } = await import("../agent/usage");
  await assertWithinLimit(OWNER_ID);
  return OWNER_ID;
}

export const openai = new OpenAI({
  apiKey: openaiApiKey || "missing",
  baseURL: openaiBaseUrl,
  maxRetries: 2,
  fetch: async (input, init) => {
    await checkModelBudget();
    return fetch(input, init);
  },
});

/** One-shot JSON helper on the fast model. */
export async function jsonCompletion<T>(system: string, user: string): Promise<{ data: T; tokensIn: number; tokensOut: number }> {
  const { chat, extractJson } = await import("./llm");
  const r = await chat({
    model: MODELS.fast,
    json: true,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  try {
    if (r.truncated) throw new Error("The model returned truncated JSON.");
    return { data: extractJson<T>(r.text), tokensIn: r.tokensIn, tokensOut: r.tokensOut };
  } catch (error) {
    const { record } = await import("../agent/usage");
    await record(OWNER_ID, r);
    throw error;
  }
}

export async function textCompletion(system: string, user: string) {
  const { chat } = await import("./llm");
  const r = await chat({
    model: MODELS.fast,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return { text: r.text, tokensIn: r.tokensIn, tokensOut: r.tokensOut };
}

/** Text to speech. Returns MP3 audio. */
export async function synthesizeSpeech(text: string, voice = "alloy"): Promise<Buffer> {
  const res = await openai.audio.speech.create({ model: MODELS.speech, voice, input: text, response_format: "mp3" });
  // Agent podcasts may fail after some segments. Meter each completed call, not the whole podcast.
  // Voice HTTP routes already meter their single call.
  const userId = audioOwner.getStore();
  if (userId) {
    const { record } = await import("../agent/usage");
    await record(userId, { audioSeconds: speechSeconds(text) });
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Rough spoken duration of text, for usage metering (about 2.5 words per second). */
export const speechSeconds = (text: string) => Math.max(1, Math.round(text.split(/\s+/).filter(Boolean).length / 2.5));
