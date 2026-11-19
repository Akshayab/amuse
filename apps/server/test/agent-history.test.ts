import { describe, expect, it } from "vitest";
import { approximateTokens, compactionSplit, latestCheckpoint, replayParts, trimToolOutputs, type HistoryMessage } from "../src/agent/history";

describe("durable agent history", () => {
  const exchange: HistoryMessage[] = [
    { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"MEMORY.md"}' } }] },
    { role: "tool", tool_call_id: "call_1", content: "Saved trip plans" },
  ];
  it("replays paired tool calls and outputs from existing message parts", () => {
    expect(replayParts([{ type: "image" }, { type: "tool_history", messages: exchange }])).toEqual(exchange);
    expect(replayParts([null, {}, "text"])).toEqual([]);
  });
  it("restores the most recent durable compaction checkpoint", () => {
    expect(
      latestCheckpoint([
        { id: 1, parts: [{ type: "context_checkpoint", messages: [] }] },
        { id: 2, parts: [{ type: "context_checkpoint", messages: exchange }] },
      ]),
    ).toEqual({ id: 2, messages: exchange });
  });
  it("estimates tokens and trims old outputs before compacting recent work", () => {
    const messages: HistoryMessage[] = [...exchange, ...Array.from({ length: 10 }, () => ({ role: "user" as const, content: "next" }))];
    messages[1] = { role: "tool", tool_call_id: "call_1", content: "x".repeat(20000) };
    const trimmed = trimToolOutputs(messages);
    expect(approximateTokens(trimmed)).toBeLessThan(approximateTokens(messages));
    expect(trimmed[1].content).toContain("Older tool output trimmed");
    expect(trimmed.at(-1)).toEqual(messages.at(-1));
    expect(messages[1].content).toHaveLength(20000);
  });
  it("never cuts between function calls and their outputs", () => {
    const messages: HistoryMessage[] = [{ role: "system", content: "rules" }, ...exchange, { role: "user", content: "continue" }];
    expect(compactionSplit(messages)).toBe(3);
  });
});
