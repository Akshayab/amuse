import { describe, expect, it } from "vitest";
import { extractJson, fromResponse, toInput } from "../src/lib/llm";

describe("Responses API protocol", () => {
  it("reports malformed JSON instead of silently replacing it with an empty object", () => {
    expect(extractJson('{"title":"Done"}')).toEqual({ title: "Done" });
    expect(() => extractJson('{"title":')).toThrow("invalid JSON");
  });
  it("puts the required JSON word in input, not only instructions", () => {
    const result = toInput(
      [
        { role: "system", content: "JSON labels" },
        { role: "user", content: "Hi" },
      ],
      true,
    );
    expect(JSON.stringify(result.input)).toContain("JSON");
    expect(toInput([{ role: "user", content: "Hi" }]).input).toEqual([{ role: "user", content: "Hi" }]);
  });
  it("replays calls with the same call id", () => {
    expect(
      toInput([
        { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "search", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call_1", content: "found" },
      ]).input,
    ).toEqual([
      { type: "function_call", call_id: "call_1", name: "search", arguments: "{}" },
      { type: "function_call_output", call_id: "call_1", output: "found" },
    ]);
  });
  it("retains encrypted reasoning for the next step", () => {
    const reasoning = { type: "reasoning" as const, id: "rs_1", encrypted_content: "opaque", summary: [] };
    expect(fromResponse({ output: [reasoning] }).reasoning).toEqual([reasoning]);
    expect(
      toInput(
        [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello" },
        ],
        false,
        [{ messageIndex: 1, items: [reasoning] }],
      ).input,
    ).toEqual([{ role: "user", content: "Hi" }, reasoning, { role: "assistant", content: "Hello" }]);
  });
  it("rejects unusable incomplete responses and marks usable partial text", () => {
    expect(() => fromResponse({ status: "incomplete", output: [] })).toThrow("incomplete");
    expect(() => fromResponse({ status: "failed", error: { message: "failed" } })).toThrow("failed");
    const partial = fromResponse({ status: "incomplete", output: [{ type: "message", content: [{ type: "output_text", text: "Partial answer" }] }] });
    expect(partial.text).toContain("[Response truncated]");
    expect(partial.truncated).toBe(true);
    expect(() => fromResponse({ status: "incomplete", output: [{ type: "function_call", call_id: "c", name: "search", arguments: "{" }] })).toThrow(
      "incomplete",
    );
  });
});
