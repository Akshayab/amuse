import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, notificationsTable, runsTable, scheduledTasksTable, usageTable } from "@amuse/db";
import { forceHeartbeat } from "../agent/scheduler";
import { getUsage } from "../agent/usage";
import { today } from "../agent/workspace";
import { requireAuth, uid } from "./helpers";

/**
 * Test-only hooks for the end-to-end suite (tests/e2e). Mounted only when AMUSE_E2E=1 and
 * NODE_ENV isn't production (see routes/index.ts).
 */
const router: IRouter = Router();
router.use("/test", requireAuth);

/** Runs the Heartbeat now (bypassing the cost gate) and waits for the background run to finish. */
router.post("/test/heartbeat", async (req, res) => {
  const userId = uid(req);
  const started = new Date();
  await forceHeartbeat(userId);
  let run: typeof runsTable.$inferSelect | undefined;
  for (let i = 0; i < 90; i++) {
    [run] = await db
      .select()
      .from(runsTable)
      .where(and(eq(runsTable.userId, userId), eq(runsTable.title, "Heartbeat")))
      .orderBy(desc(runsTable.id))
      .limit(1);
    if (run && run.startedAt >= started && run.status !== "running") break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  const [task] = await db
    .select()
    .from(scheduledTasksTable)
    .where(and(eq(scheduledTasksTable.userId, userId), eq(scheduledTasksTable.kind, "heartbeat")));
  const notes = await db.select().from(notificationsTable).where(eq(notificationsTable.userId, userId)).orderBy(desc(notificationsTable.id)).limit(3);
  res.json({
    run: run && run.startedAt >= started ? { id: run.id, status: run.status, tokensIn: run.tokensIn, tokensOut: run.tokensOut } : null,
    lastResult: task?.lastResult ?? null,
    nextRunAt: task?.nextRunAt ?? null,
    recentNotifications: notes.map((n) => n.title + ": " + n.body),
  });
});

/** Sets today's usage (fill = at the daily limit, or restore a given number of units). */
router.post("/test/usage", async (req, res) => {
  const userId = uid(req);
  const u = await getUsage(userId);
  const units = req.body?.fill ? (u.limit ?? 0) : Math.max(0, Number(req.body?.units ?? 0));
  await db
    .insert(usageTable)
    .values({ userId, day: today(), units })
    .onConflictDoUpdate({ target: [usageTable.userId, usageTable.day], set: { units } });
  res.json({ before: u, after: await getUsage(userId) });
});

/** Makes every pending first-week tip due now and delivers them. */
router.post("/test/tips", async (req, res) => {
  const userId = uid(req);
  await db
    .update(scheduledTasksTable)
    .set({ nextRunAt: new Date(Date.now() - 1000) })
    .where(and(eq(scheduledTasksTable.userId, userId), eq(scheduledTasksTable.kind, "tip"), eq(scheduledTasksTable.enabled, true)));
  const { tick } = await import("../agent/scheduler");
  for (let i = 0; i < 3; i++) await tick();
  res.json({ ok: true });
});

export default router;
