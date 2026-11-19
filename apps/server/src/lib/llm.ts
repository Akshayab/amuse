import type OpenAI from "openai";
import { checkModelBudget, MODELS, openai } from "./ai";
import { retryable } from "../agent/robustness";
import { OWNER_ID } from "../middlewares/owner";

/**
 * Chat layer over the OpenAI Responses API, with streaming and tool calls. Callers keep using
 * Chat Completions-style messages and tools; they're converted here. Current OpenAI models only
 * support function tools with reasoning through the Responses API.
 */
type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

export interface ToolCall {
  id: string;
  name: string;
  args: string;
}
export interface LlmResult {
  text: string;
  toolCalls: ToolCall[];
  tokensIn: number;
  tokensOut: number;
  reasoning: OpenAI.Responses.ResponseReasoningItem[];
  truncated?: boolean;
}

export interface ReasoningTurn {
  messageIndex: number;
  items: OpenAI.Responses.ResponseReasoningItem[];
}

export const CHAT_MODELS = { agent: MODELS.agent, fast: MODELS.fast };
const REASONING_EFFORT = (process.env.AMUSE_REASONING_EFFORT ?? "low") as "low" | "medium" | "high";

function textOf(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p: any) => (typeof p === "string" ? p : (p?.text ?? ""))).join("");
  return "";
}

export function toInput(messages: Msg[], json = false, reasoning: ReasoningTurn[] = []) {
  let instructions = "";
  const input: any[] = [];
  for (const [index, m] of messages.entries()) {
    for (const turn of reasoning) if (turn.messageIndex === index) input.push(...turn.items);
    if (m.role === "system" || (m.role as string) === "developer") {
      instructions += (instructions ? "\n\n" : "") + textOf((m as any).content);
    } else if (m.role === "user") {
      input.push({ role: "user", content: textOf(m.content) || "(empty)" });
    } else if (m.role === "assistant") {
      const t = textOf(m.content);
      if (t) input.push({ role: "assistant", content: t });
      for (const tc of (m as any).tool_calls ?? [])
        input.push({ type: "function_call", call_id: tc.id, name: tc.function.name, arguments: tc.function.arguments || "{}" });
    } else if (m.role === "tool") {
      input.push({ type: "function_call_output", call_id: (m as any).tool_call_id, output: textOf(m.content) || "(empty)" });
    }
  }
  if (json) input.push({ role: "user", content: "Respond with a single valid JSON object only." });
  return { instructions: instructions || undefined, input };
}

const toTools = (tools?: Tool[]) =>
  tools?.length
    ? tools.map((t: any) => ({
        type: "function" as const,
        name: t.function.name,
        description: t.function.description ?? "",
        parameters: t.function.parameters ?? { type: "object", properties: {} },
        strict: false,
      }))
    : undefined;

export function fromResponse(r: any, streamedText?: string): LlmResult {
  if (r?.status === "failed") throw new Error(r.error?.message ?? "The model request failed");
  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const item of r?.output ?? []) {
    if (item.type === "message") for (const c of item.content ?? []) if (c.type === "output_text") text += c.text;
    if (item.type === "function_call") toolCalls.push({ id: item.call_id, name: item.name, args: item.arguments ?? "{}" });
  }
  const incomplete = r?.status === "incomplete";
  if (incomplete && (!text.trim() || toolCalls.length)) throw new Error("The model response was incomplete; no usable answer was returned.");
  return {
    text: (streamedText ?? text) + (incomplete ? "\n\n[Response truncated]" : ""),
    toolCalls,
    tokensIn: r?.usage?.input_tokens ?? 0,
    tokensOut: r?.usage?.output_tokens ?? 0,
    reasoning: (r?.output ?? []).filter((i: { type: string }) => i.type === "reasoning"),
    truncated: incomplete,
  };
}

async function finishResponse(r: OpenAI.Responses.Response, streamedText?: string) {
  try {
    return fromResponse(r, streamedText);
  } catch (error) {
    // Even an unusable completion consumed tokens; normal completions are metered by their callers.
    const { record } = await import("../agent/usage");
    await record(OWNER_ID, { tokensIn: r.usage?.input_tokens ?? 0, tokensOut: r.usage?.output_tokens ?? 0 });
    throw error;
  }
}

export interface ChatOpts {
  model: string;
  messages: Msg[];
  tools?: Tool[];
  toolChoice?: "auto" | "required";
  maxTokens?: number;
  json?: boolean;
  onText?: (delta: string) => void;
  signal?: { stopped: boolean };
  reasoning?: ReasoningTurn[];
}

export async function chat(o: ChatOpts): Promise<LlmResult> {
  for (let attempt = 0; ; attempt++) {
    await checkModelBudget();
    let emitted = false;
    try {
      return await chatOnce({
        ...o,
        onText: o.onText
          ? (d) => {
              emitted = true;
              o.onText!(d);
            }
          : undefined,
      });
    } catch (e) {
      if (emitted || o.signal?.stopped || attempt >= 2 || !retryable(e)) throw e;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
}

async function chatOnce(o: ChatOpts): Promise<LlmResult> {
  const { instructions, input } = toInput(o.messages, o.json, o.reasoning);
  const params: any = {
    model: o.model,
    instructions: o.json ? (instructions ? instructions + "\n\n" : "") + "Respond with a single valid JSON object only." : instructions,
    input,
    include: ["reasoning.encrypted_content"],
    tools: toTools(o.tools),
    reasoning: { effort: REASONING_EFFORT },
    store: false,
    ...(o.maxTokens ? { max_output_tokens: o.maxTokens } : {}),
    ...(o.tools?.length && o.toolChoice === "required" ? { tool_choice: "required" } : {}),
    ...(o.json ? { text: { format: { type: "json_object" } } } : {}),
  };
  if (!o.onText) return finishResponse(await openai.responses.create(params, { maxRetries: 0 }));

  const stream: any = await openai.responses.create({ ...params, stream: true }, { maxRetries: 0 });
  let text = "";
  let final: any = null;
  for await (const ev of stream) {
    if (o.signal?.stopped) {
      stream.controller?.abort();
      break;
    }
    if (ev.type === "response.output_text.delta") {
      text += ev.delta;
      o.onText(ev.delta);
    } else if (ev.type === "response.completed" || ev.type === "response.incomplete") {
      final = ev.response;
    } else if (ev.type === "response.failed") {
      return finishResponse(ev.response, text);
    } else if (ev.type === "error") {
      throw new Error(ev.message ?? "The model request failed");
    }
  }
  if (!final && !o.signal?.stopped) throw new Error("The model stream ended before completion.");
  return final ? finishResponse(final, text) : { text, toolCalls: [], tokensIn: 0, tokensOut: 0, reasoning: [] };
}

export function extractJson<T>(text: string): T {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  try {
    return JSON.parse(s >= 0 ? text.slice(s, e + 1) : text) as T;
  } catch {
    throw new Error("The model returned invalid JSON.");
  }
}
