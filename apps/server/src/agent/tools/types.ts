import type OpenAI from "openai";

export interface ToolContext {
  userId: string;
  runId: number;
  chatId: number;
  tz: string;
  trigger: string;
  depth: number; // subagent depth
  background?: boolean;
  setStatus: (s: string) => Promise<void>;
  activity: (kind: string, summary: string, details?: Record<string, unknown>, skill?: string) => Promise<void>;
  addParts: (parts: unknown[]) => void; // attach rich parts to the assistant message
  usage: (u: { tokensIn?: number; tokensOut?: number; images?: number; audioSeconds?: number }) => Promise<void>;
  signal: { stopped: boolean };
}

export interface ToolDef {
  name: string;
  skill: string; // user-facing skill label for the activity log
  status: string; // avatar status while running
  description: string;
  parameters: Record<string, unknown>;
  run: (args: any, ctx: ToolContext) => Promise<unknown>;
  subagentSafe?: boolean;
}

export function toOpenAITool(t: ToolDef): OpenAI.Chat.Completions.ChatCompletionTool {
  return { type: "function", function: { name: t.name, description: t.description, parameters: t.parameters as any } };
}

export const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
export const str = (description: string) => ({ type: "string", description });
export const num = (description: string) => ({ type: "number", description });
