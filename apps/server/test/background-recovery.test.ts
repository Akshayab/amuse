import { describe, expect, it } from "vitest";
import {
  backgroundPauseState,
  hasActionEvidence,
  nextLocalMidnight,
  recoveryDecision,
  scheduledRunMarker,
  scheduledRunState,
  usageDay,
} from "../src/agent/robustness";
import { hasUntrustedHistory, type HistoryMessage } from "../src/agent/history";

describe("background usage pause", () => {
  it("uses local midnight plus one minute without consuming a one-off job", () => {
    const now = new Date("2026-06-04T23:00:00Z");
    const midnight = nextLocalMidnight(now, "America/Los_Angeles");
    expect(midnight.toISOString()).toBe("2026-06-05T07:00:00.000Z");
    const state = backgroundPauseState(midnight.toISOString(), usageDay(now, "America/Los_Angeles"));
    expect(state.jobUpdate).toEqual({ nextRunAt: new Date("2026-06-05T07:01:00Z") });
    const job = { enabled: true, lastRunAt: null, intervalMinutes: null, ...state.jobUpdate };
    expect(job.enabled).toBe(true);
    expect(job.lastRunAt).toBeNull();
  });
  it("has the same durable notice identity throughout a day, even after restart", () => {
    const first = new Date("2026-06-04T10:00:00Z");
    const later = new Date("2026-06-05T05:00:00Z");
    const state = (now: Date) => backgroundPauseState(nextLocalMidnight(now, "America/Los_Angeles").toISOString(), usageDay(now, "America/Los_Angeles"));
    expect(state(first).noticeParts).toEqual(state(later).noticeParts);
    expect(state(new Date("2026-06-05T10:00:00Z")).noticeParts).not.toEqual(state(first).noticeParts);
  });
  it("handles both DST transitions and non-hour timezone offsets", () => {
    expect(nextLocalMidnight(new Date("2026-03-08T08:30:00Z"), "America/Los_Angeles").toISOString()).toBe("2026-03-09T07:00:00.000Z");
    expect(nextLocalMidnight(new Date("2026-11-01T07:30:00Z"), "America/Los_Angeles").toISOString()).toBe("2026-11-02T08:00:00.000Z");
    expect(nextLocalMidnight(new Date("2026-06-04T12:00:00Z"), "Asia/Kolkata").toISOString()).toBe("2026-06-04T18:30:00.000Z");
  });
});

describe("bounded restart recovery", () => {
  it("allows only two catch-up attempts per occurrence and supports legacy run markers", () => {
    const first = recoveryDecision("run:10", false)!;
    expect(first).toEqual({ retry: true, lastResult: "retry:10:retry:1" });
    expect(recoveryDecision(first.lastResult, false)).toBeNull();
    const secondRun = scheduledRunMarker(11, first.lastResult);
    const second = recoveryDecision(secondRun, false)!;
    expect(second).toEqual({ retry: true, lastResult: "retry:11:retry:2" });
    expect(recoveryDecision(scheduledRunMarker(12, second.lastResult), false)).toEqual({
      retry: false,
      lastResult: "Interrupted; catch-up attempt limit reached",
    });
    expect(scheduledRunState(scheduledRunMarker(13, "run:12:retry:2"))?.attempts).toBe(0);
    expect(recoveryDecision("Cancelled", false)).toBeNull();
  });
  it.each(["send", "submit", "purchase"])("refuses recovery after an allowed %s approval or action record", (actionClass) => {
    expect(hasActionEvidence([{ status: "allowed", actionClass }], [], [])).toBe(true);
    expect(hasActionEvidence([], [{ kind: "tool", details: { actionClass } }], [])).toBe(true);
    expect(hasActionEvidence([], [{ kind: actionClass, details: {} }], [])).toBe(true);
    expect(recoveryDecision("run:10", true)).toEqual({ retry: false, lastResult: "Interrupted after taking an action; not retried" });
  });
  it("conservatively blocks action tool attempts even without a result and ignores denied reads", () => {
    for (const name of ["email_send", "browser_task", "api_request", "submit", "purchase"]) {
      expect(hasActionEvidence([], [], [name])).toBe(true);
    }
    expect(hasActionEvidence([{ status: "denied", actionClass: "send" }], [], ["web_search", "read_file"])).toBe(false);
  });
});

describe("replayed outside-content taint", () => {
  const messages = (name: string): HistoryMessage[] => [
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name, arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c1", content: "Outside content" },
  ];
  it.each(["web_search", "web_fetch", "browser_task", "browser_click", "goto", "email_search", "calendar_events", "connectors_list", "api_request"])(
    "detects replayed %s output",
    (name) => {
      expect(hasUntrustedHistory([{ parts: [{ type: "tool_history", messages: messages(name) }] }])).toBe(true);
    },
  );
  it("retains taint through checkpoints and old summarized histories", () => {
    expect(
      hasUntrustedHistory([
        { parts: [{ type: "context_checkpoint", untrusted: true, messages: [{ role: "user", content: "A summary without tool names" }] }] },
      ]),
    ).toBe(true);
    expect(hasUntrustedHistory([{ parts: [{ type: "context_checkpoint", messages: messages("web_fetch") }] }])).toBe(true);
    expect(
      hasUntrustedHistory([
        { parts: [{ type: "tool_history", messages: messages("email_search") }] },
        { parts: [{ type: "context_checkpoint", messages: [{ role: "user", content: "Legacy summary" }] }] },
      ]),
    ).toBe(true);
  });
  it("does not taint workspace injection or ordinary local tool history", () => {
    expect(hasUntrustedHistory([{ parts: [{ type: "tool_history", messages: messages("read_file") }] }])).toBe(false);
    expect(
      hasUntrustedHistory([{ parts: [null, { type: "context_checkpoint", untrusted: false, messages: [{ role: "system", content: "MEMORY.md" }] }] }]),
    ).toBe(false);
  });
});
