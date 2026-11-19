import { describe, expect, it } from "vitest";
import { recoveryDecision, scheduledRunMarker, scheduledRunState, skippedOccurrence } from "../src/agent/robustness";

describe("skipping interrupted occurrences", () => {
  const now = new Date("2026-07-10T18:00:00Z");

  it.each([true, false])("preserves recurring jobs and resets attempts (action evidence: %s)", (acted) => {
    const result = skippedOccurrence({ title: "Daily check", intervalMinutes: 30 }, acted, "America/Los_Angeles", now);
    expect(result.update).toEqual({
      enabled: true,
      nextRunAt: new Date("2026-07-10T18:30:00Z"),
      lastResult: "Skipped one run after a restart",
    });
    expect(scheduledRunState(scheduledRunMarker(42, result.update.lastResult))?.attempts).toBe(0);
    expect(result.message).toContain("“Daily check”");
    expect(result.message).toContain("It will run again at Jul 10, 2026, 11:30 AM (America/Los_Angeles).");
    expect(result.message).toContain(acted ? "may have taken an action" : "catch-up attempt limit");
  });

  it.each([true, false])("disables only one-off jobs and invites an explicit retry (action evidence: %s)", (acted) => {
    const result = skippedOccurrence({ title: "Send a note", intervalMinutes: null }, acted, "UTC", now);
    expect(result.update).toEqual({ enabled: false, lastResult: "Not retried after a restart" });
    expect(result.message).toContain("Ask me if you want it done again.");
    expect(result.message).not.toContain("It will run again");
  });

  it("makes skipped occurrences ineligible for repeated startup reconciliation and notices", () => {
    for (const intervalMinutes of [null, 60]) {
      const result = skippedOccurrence({ title: "Job", intervalMinutes }, true, "UTC", now);
      expect(scheduledRunState(result.update.lastResult)).toBeNull();
      expect(recoveryDecision(result.update.lastResult, true)).toBeNull();
    }
  });
});
