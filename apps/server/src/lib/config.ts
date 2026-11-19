import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Your OpenAI key runs everything: the agent, image generation, transcription and spoken replies. */
export const openaiApiKey = process.env.OPENAI_API_KEY ?? "";
/** Optional: an OpenAI-compatible endpoint or proxy. */
export const openaiBaseUrl = process.env.OPENAI_BASE_URL || undefined;

export const MODELS = {
  agent: process.env.AMUSE_AGENT_MODEL ?? "gpt-6.2-sol",
  fast: process.env.AMUSE_FAST_MODEL ?? "gpt-6-luna",
  image: process.env.AMUSE_IMAGE_MODEL ?? "gpt-image-2",
  transcribe: process.env.AMUSE_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe",
  speech: process.env.AMUSE_SPEECH_MODEL ?? "gpt-4o-mini-tts",
};

/** Where Amuse keeps local state that isn't in Postgres (the vault key). */
export const dataDir = path.resolve(process.env.AMUSE_DATA_DIR ?? path.join(import.meta.dirname, "../../../.data"));

/** Key that encrypts saved credentials. Created on first run; back it up with your database. */
function loadSecretKey(): string {
  const file = path.join(dataDir, "secret.key");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const key = crypto.randomBytes(32).toString("base64");
  fs.writeFileSync(file, key + "\n", { mode: 0o600, flag: "wx" });
  return key;
}
export const secretKey = loadSecretKey();

/** Problems that stop the server from starting, with the fix for each. */
export function configErrors(): string[] {
  const errors: string[] = [];
  if (!process.env.DATABASE_URL) errors.push("DATABASE_URL is not set. Point it at a Postgres database (docker compose sets this for you).");
  if (!openaiApiKey) errors.push("OPENAI_API_KEY is not set. Add your OpenAI API key to .env.");
  return errors;
}
