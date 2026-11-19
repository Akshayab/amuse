import { and, eq, lte, notInArray, sql } from "drizzle-orm";
import { db, messagesTable, scheduledTasksTable, settingsTable, usageTable } from "@amuse/db";
import { getMainChatId } from "./workspace";
import { backgroundPauseState, dailyLimit, nextLocalMidnight, usageDay } from "./robustness";
import { publish } from "./bus";

async function usageTimezone(userId: string) {
  const [settings] = await db.select({ timezone: settingsTable.timezone }).from(settingsTable).where(eq(settingsTable.userId, userId));
  return settings?.timezone ?? "America/Los_Angeles";
}

/**
 * Usage metering. "Units" approximate cost: 1 unit ≈ 1k input tokens,
 * output tokens weigh 4x, images 40 units, audio 1 unit per 10s.
 * AMUSE_DAILY_LIMIT caps units per day (default 2000; 0 disables the cap).
 */
export const DAILY_LIMIT = dailyLimit(process.env.AMUSE_DAILY_LIMIT);

export function unitsFor(u: { tokensIn?: number; tokensOut?: number; images?: number; audioSeconds?: number }) {
  return Math.ceil((u.tokensIn ?? 0) / 1000 + ((u.tokensOut ?? 0) * 4) / 1000 + (u.images ?? 0) * 40 + (u.audioSeconds ?? 0) / 10);
}

export async function record(userId: string, u: { tokensIn?: number; tokensOut?: number; images?: number; audioSeconds?: number }) {
  const units = unitsFor(u);
  const day = usageDay(new Date(), await usageTimezone(userId));
  await db
    .insert(usageTable)
    .values({
      userId,
      day,
      units,
      tokensIn: u.tokensIn ?? 0,
      tokensOut: u.tokensOut ?? 0,
      images: u.images ?? 0,
      audioSeconds: Math.round(u.audioSeconds ?? 0),
    })
    .onConflictDoUpdate({
      target: [usageTable.userId, usageTable.day],
      set: {
        units: sql`${usageTable.units} + ${units}`,
        tokensIn: sql`${usageTable.tokensIn} + ${u.tokensIn ?? 0}`,
        tokensOut: sql`${usageTable.tokensOut} + ${u.tokensOut ?? 0}`,
        images: sql`${usageTable.images} + ${u.images ?? 0}`,
        audioSeconds: sql`${usageTable.audioSeconds} + ${Math.round(u.audioSeconds ?? 0)}`,
      },
    });
}

export async function getUsage(userId: string) {
  const timezone = await usageTimezone(userId);
  const now = new Date();
  const day = usageDay(now, timezone);
  const [row] = await db
    .select()
    .from(usageTable)
    .where(and(eq(usageTable.userId, userId), eq(usageTable.day, day)));
  const used = row?.units ?? 0;
  const reset = nextLocalMidnight(now, timezone);
  const limit = DAILY_LIMIT || null;
  return {
    used,
    limit,
    remaining: limit ? Math.max(0, limit - used) : null,
    percent: limit ? Math.min(100, Math.round((used / limit) * 100)) : 0,
    resetsAt: reset.toISOString(),
  };
}

export class UsageLimitError extends Error {
  constructor(public resetsAt: string) {
    super("You've reached today's usage limit.");
  }
}

export async function assertWithinLimit(userId: string) {
  if (!DAILY_LIMIT) return;
  const u = await getUsage(userId);
  if (u.remaining === 0) throw new UsageLimitError(u.resetsAt);
}

export async function pauseBackgroundJobs(userId: string, resetsAt: string) {
  const day = usageDay(new Date(), await usageTimezone(userId));
  const mainId = await getMainChatId(userId);
  const { jobUpdate, noticeParts: marker } = backgroundPauseState(resetsAt, day);
  const notice = await db.transaction(async (tx) => {
    // Persist deduplication and job postponement together, including across restarts.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`usage-notice:${userId}`}))`);
    await tx
      .update(scheduledTasksTable)
      .set(jobUpdate)
      .where(
        and(
          eq(scheduledTasksTable.userId, userId),
          eq(scheduledTasksTable.enabled, true),
          lte(scheduledTasksTable.nextRunAt, new Date()),
          notInArray(scheduledTasksTable.kind, ["reminder", "tip"]),
        ),
      );
    const [existing] = await tx
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(and(eq(messagesTable.userId, userId), eq(messagesTable.chatId, mainId), sql`${messagesTable.parts} @> ${JSON.stringify(marker)}::jsonb`))
      .limit(1);
    if (existing) return null;
    const [message] = await tx
      .insert(messagesTable)
      .values({
        userId,
        chatId: mainId,
        role: "assistant",
        proactive: true,
        parts: marker,
        content: "I've reached today's usage limit, so background jobs are paused until tomorrow.",
      })
      .returning();
    return message;
  });
  if (notice) publish(userId, { type: "message", chatId: mainId, message: notice });
  publish(userId, { type: "refresh", what: "upcoming" });
}
