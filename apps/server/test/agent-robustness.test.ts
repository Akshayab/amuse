import { describe, expect, it } from "vitest";
import {
  dailyLimit,
  interruptedRun,
  isLoopback,
  memoryTail,
  nextSchedule,
  reminderText,
  retryable,
  STEP_LIMITS,
  tipEligible,
  validateArgs,
} from "../src/agent/robustness";
import { unitsFor } from "../src/agent/usage";
import { searchPattern } from "../src/agent/tools/memory";

describe("spending controls", () => {
  it("defaults to a finite limit and requires explicit zero to disable", () => {
    expect(dailyLimit(undefined)).toBe(2000);
    expect(dailyLimit("0")).toBe(0);
    expect(dailyLimit("100")).toBe(100);
    for (const bad of ["NaN", "-1", "Infinity"]) expect(dailyLimit(bad)).toBe(2000);
  });
  it("meters each kind of model work", () => {
    expect(unitsFor({ tokensIn: 1000, tokensOut: 1000, images: 1, audioSeconds: 10 })).toBe(46);
    expect(unitsFor({})).toBe(0);
    expect(unitsFor({ tokensIn: 1 })).toBe(1);
  });
  it("bounds expensive parallel calls (one spawn call has at most four helpers)", () => {
    expect(STEP_LIMITS).toEqual({ generate_image: 2, spawn_subagents: 1, browser_task: 1 });
  });
});

describe("tool argument validation", () => {
  const schema = {
    type: "object",
    required: ["tasks"],
    additionalProperties: false,
    properties: { tasks: { type: "array", maxItems: 4, items: { type: "string" } } },
  };
  it("accepts valid arguments and rejects missing or unexpected fields", () => {
    expect(() => validateArgs({ tasks: ["research"] }, schema)).not.toThrow();
    expect(() => validateArgs({}, schema)).toThrow("args.tasks is required");
    expect(() => validateArgs({ tasks: [], extra: true }, schema)).toThrow("not allowed");
    expect(() => validateArgs(null, schema)).toThrow("object");
  });
  it("checks nested values, maximum items, finite numbers and enums", () => {
    expect(() => validateArgs({ tasks: [1] }, schema)).toThrow("string");
    expect(() => validateArgs({ tasks: ["1", "2", "3", "4", "5"] }, schema)).toThrow("too many");
    expect(() => validateArgs(NaN, { type: "number" })).toThrow();
    expect(() => validateArgs("x", { type: "string", enum: ["a"] })).toThrow();
  });
});

describe("memory retention and search", () => {
  it("keeps newest facts and asks for consolidation", () => {
    expect(memoryTail("old".repeat(5000) + "new fact")).toContain("new fact");
    expect(memoryTail("old".repeat(5000) + "new fact")).toContain("Consolidate");
    expect(memoryTail("short")).toBe("short");
  });
  it("treats ILIKE wildcards as literal text and rejects empty searches", () => {
    expect(searchPattern("  50%_\\  ")).toBe("%50\\%\\_\\\\%");
    expect(() => searchPattern(" ")).toThrow("non-empty");
    expect(searchPattern("x".repeat(500)).length).toBe(202);
  });
});

describe("background robustness", () => {
  it("never allows first-day or active-chat tips", () => {
    const now = 200000000;
    expect(tipEligible(null, false, now)).toBe(false);
    expect(tipEligible(new Date(now - 1000), false, now)).toBe(false);
    expect(tipEligible(new Date(0), true, now)).toBe(false);
    expect(tipEligible(new Date(0), false, now)).toBe(true);
  });
  it("catches up once rather than replaying every missed interval", () => {
    const now = new Date("2026-11-18T12:00:00Z");
    const old = new Date("2026-11-10T12:00:00Z");
    expect(nextSchedule(30, old, now)).toEqual({ lastRunAt: now, nextRunAt: new Date("2026-11-18T12:30:00Z"), enabled: true });
    expect(nextSchedule(null, old, now).enabled).toBe(false);
  });
  it("uses friendly reminder text, not the schedule's hidden prompt", () => {
    expect(reminderText("Stretch")).toBe("⏰ Time to Stretch!");
    expect(reminderText("Remind me to stretch.")).toBe("⏰ Time to stretch!");
  });
  it("marks interrupted runs failed and warns for non-loopback bindings", () => {
    expect(interruptedRun()).toMatchObject({ status: "failed", error: "Interrupted by server restart" });
    for (const host of ["127.0.0.1", "::1", "localhost"]) expect(isLoopback(host)).toBe(true);
    for (const host of ["0.0.0.0", "::", "192.168.1.2"]) expect(isLoopback(host)).toBe(false);
  });
  it("retries only transient failures", () => {
    for (const error of [{ status: 429 }, { status: 500 }, { status: 503 }, { name: "APIConnectionError" }]) expect(retryable(error)).toBe(true);
    for (const error of [{ status: 400 }, { status: 401 }, new Error("invalid arguments")]) expect(retryable(error)).toBe(false);
  });
});
