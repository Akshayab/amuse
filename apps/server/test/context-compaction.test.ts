import { describe, expect, it, vi } from "vitest";
import { approximateTokens, compactHistory, CONTEXT_TOKENS, trimToolOutputs, type HistoryMessage } from "../src/agent/history";

const user = (content: string): HistoryMessage => ({ role: "user", content });
const tool = (id: string, content: string): HistoryMessage => ({ role: "tool", tool_call_id: id, content });

describe("bounded context compaction", () => {
  it("trims a ten-message history with two recent 60k outputs below threshold without summarizing", async () => {
    const messages: HistoryMessage[] = [
      { role: "system", content: "Instructions" },
      user("Research"),
      ...Array.from({ length: 6 }, () => user("Continue")),
      tool("first", "HEAD" + "x".repeat(59992) + "TAIL"),
      tool("last", "HEAD" + "y".repeat(59992) + "TAIL"),
    ];
    const summarize = vi.fn(async () => "Summary");
    const attempts = new Set<string>();
    expect(messages).toHaveLength(10);
    expect(approximateTokens(messages)).toBeGreaterThan(CONTEXT_TOKENS);
    const result = await compactHistory(messages, attempts, summarize);
    expect(approximateTokens(result.messages)).toBeLessThan(CONTEXT_TOKENS);
    expect(result.messages).toHaveLength(10);
    expect(result.summarized).toBe(false);
    expect(summarize).not.toHaveBeenCalled();
    const first = result.messages[8].content as string;
    const last = result.messages[9].content as string;
    expect(first).toContain("[truncated 58900 chars]");
    expect(last).toContain("[truncated 52100 chars]");
    expect(last.length).toBeGreaterThan(first.length);
    for (const content of [first, last]) {
      expect(content.startsWith("HEAD")).toBe(true);
      expect(content.endsWith("TAIL")).toBe(true);
    }
    expect(messages[8].content).toHaveLength(60000);
    expect(trimToolOutputs(result.messages)).toEqual(result.messages);
    const repeated = await compactHistory(result.messages, attempts, summarize);
    expect(repeated.messages).toBe(result.messages);
    expect(repeated.changed).toBe(false);
    expect(summarize).not.toHaveBeenCalled();
  });

  it.each([10, 13])("does not summarize an empty older window with %i messages, even when still over budget", async (length) => {
    const messages: HistoryMessage[] = [
      { role: "system", content: "Instructions" },
      user("x".repeat(100000)),
      ...Array.from({ length: length - 2 }, () => user("Recent")),
    ];
    const summarize = vi.fn(async () => "Summary");
    const attempts = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const result = await compactHistory(messages, attempts, summarize);
      expect(result.messages).toBe(messages);
      expect(result.changed).toBe(false);
    }
    expect(summarize).not.toHaveBeenCalled();
    expect(attempts.size).toBe(1);
  });

  it("rejects expanding summaries and never retries an unchanged attempted state", async () => {
    const messages: HistoryMessage[] = [
      { role: "system", content: "Instructions" },
      user("x".repeat(100000)),
      ...Array.from({ length: 12 }, () => user("Recent")),
    ];
    const summarize = vi.fn(async () => "y".repeat(110000));
    const attempts = new Set<string>();
    const result = await compactHistory(messages, attempts, summarize);
    expect(result.messages).toBe(messages);
    expect(result.changed).toBe(false);
    await compactHistory(
      messages.map((m) => ({ ...m })),
      attempts,
      summarize,
    );
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  it("accepts only shrinking summaries and does not recompact their unchanged output", async () => {
    const messages: HistoryMessage[] = [
      { role: "system", content: "Instructions" },
      user("x".repeat(20000)),
      user("y".repeat(100000)),
      ...Array.from({ length: 11 }, () => user("Recent")),
    ];
    const summarize = vi.fn(async (_older: HistoryMessage[]) => "Saved decisions");
    const attempts = new Set<string>();
    const result = await compactHistory(messages, attempts, summarize);
    expect(result.summarized).toBe(true);
    expect(summarize.mock.calls[0][0]).toEqual([messages[1]]);
    expect(approximateTokens(result.messages)).toBeLessThan(approximateTokens(messages));
    expect(approximateTokens(result.messages)).toBeGreaterThan(CONTEXT_TOKENS);
    const repeated = await compactHistory(result.messages, attempts, summarize);
    expect(repeated.messages).toBe(result.messages);
    expect(repeated.changed).toBe(false);
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  it("does not insert an empty summary", async () => {
    const messages: HistoryMessage[] = [
      { role: "system", content: "Instructions" },
      user("x".repeat(100000)),
      ...Array.from({ length: 12 }, () => user("Recent")),
    ];
    const result = await compactHistory(messages, new Set(), async () => " ");
    expect(result.messages).toBe(messages);
    expect(result.summarized).toBe(false);
  });
});
