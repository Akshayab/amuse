import { afterEach, describe, expect, it, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());
const budget = vi.hoisted(() => vi.fn().mockResolvedValue("owner"));
vi.mock("../src/lib/ai", () => ({ checkModelBudget: budget, MODELS: { agent: "test", fast: "test" }, openai: { responses: { create } } }));
import { chat } from "../src/lib/llm";

afterEach(() => {
  create.mockReset();
  budget.mockReset().mockResolvedValue("owner");
  vi.useRealTimers();
});

describe("bounded model retries", () => {
  it("retries transient failures with backoff, disables nested SDK retries, and requests encrypted reasoning", async () => {
    vi.useFakeTimers();
    create.mockRejectedValueOnce({ status: 429 }).mockRejectedValueOnce({ status: 503 }).mockResolvedValueOnce({ status: "completed", output: [] });
    const pending = chat({ model: "test", messages: [{ role: "user", content: "Hello" }] });
    await vi.advanceTimersByTimeAsync(499);
    expect(create).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(create).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
    expect(create).toHaveBeenCalledTimes(3);
    expect(budget).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[0][0]).toMatchObject({ include: ["reasoning.encrypted_content"], store: false });
    expect(create.mock.calls[0][1]).toEqual({ maxRetries: 0 });
  });
  it("stops after three attempts", async () => {
    vi.useFakeTimers();
    create.mockRejectedValue({ status: 500 });
    const pending = expect(chat({ model: "test", messages: [] })).rejects.toEqual({ status: 500 });
    await vi.runAllTimersAsync();
    await pending;
    expect(create).toHaveBeenCalledTimes(3);
  });
  it("does not retry non-transient errors", async () => {
    create.mockRejectedValue({ status: 400 });
    await expect(chat({ model: "test", messages: [] })).rejects.toEqual({ status: 400 });
    expect(create).toHaveBeenCalledTimes(1);
  });
  it("checks the daily cap before making any model attempt", async () => {
    budget.mockRejectedValue(new Error("You've reached today's usage limit."));
    await expect(chat({ model: "test", messages: [] })).rejects.toThrow("usage limit");
    expect(create).not.toHaveBeenCalled();
  });
  it("never repeats already streamed text", async () => {
    create.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { type: "response.output_text.delta", delta: "Partial" };
        throw { status: 503 };
      },
    });
    const onText = vi.fn();
    await expect(chat({ model: "test", messages: [], onText })).rejects.toEqual({ status: 503 });
    expect(onText).toHaveBeenCalledWith("Partial");
    expect(create).toHaveBeenCalledTimes(1);
  });
});
