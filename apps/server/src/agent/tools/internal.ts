import { and, eq, sql } from "drizzle-orm";
import { agentsTable, artifactsTable, db, goalsTable, ideasTable, scheduledTasksTable, spacesTable, type PlanStep } from "@amuse/db";
import { publish } from "../bus";
import { check, hasUntrustedRead } from "../sentinel";
import { appendFile, deleteFile, listFiles, readFile, today, writeFile } from "../workspace";
import { obj, str, num, type ToolDef } from "./types";

export const isSensitiveFile = (path: string) => /^(SOUL|HEARTBEAT|BOOTSTRAP|AGENTS|IDENTITY)\.md$/i.test(path.replace(/^\.\//, ""));
export const isPrivateFile = (path: string) => /^(MEMORY\.md|USER\.md|memory\/)/i.test(path.replace(/^\.\//, ""));
export function persistenceNeedsApproval(untrusted: boolean, tool: string, path = "", htmlChanged = false): boolean {
  return (
    untrusted &&
    (["memory_save", "memory_forget", "ideas_add"].includes(tool) ||
      (["write_file", "delete_file"].includes(tool) && isPrivateFile(path)) ||
      (tool === "space_update" && htmlChanged))
  );
}
export function forgetExactLine(content: string, line: string) {
  const lines = content.split("\n");
  const removed = line.trim() ? lines.filter((l) => l === line) : [];
  return { content: lines.filter((l) => !removed.includes(l)).join("\n"), removed };
}
export function schedulePolicy(trigger: string, active: number, interval?: number | null): string | null {
  if (["schedule", "space"].includes(trigger)) return "Background runs cannot create schedules.";
  if (active >= 20) return "At most 20 active schedules are allowed. Cancel an existing schedule first.";
  if (interval != null && (!Number.isFinite(interval) || interval < 15)) return "Repeat intervals must be at least 15 minutes.";
  return null;
}
async function insertSchedule(trigger: string, values: typeof scheduledTasksTable.$inferInsert) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${values.userId}))`);
    const active = await tx
      .select({ id: scheduledTasksTable.id })
      .from(scheduledTasksTable)
      .where(and(eq(scheduledTasksTable.userId, values.userId), eq(scheduledTasksTable.enabled, true)));
    const error = schedulePolicy(trigger, active.length, values.intervalMinutes);
    if (error) throw new Error(error);
    const [row] = await tx.insert(scheduledTasksTable).values(values).returning();
    return row!;
  });
}
const rid = () => Math.random().toString(36).slice(2, 9);

export const memoryTools: ToolDef[] = [
  {
    name: "memory_save",
    skill: "Memory",
    status: "Is updating memory",
    description:
      "Save something durable you learned. target 'user' = stable fact/preference about the person (USER.md); 'memory' = long-term note or decision (MEMORY.md); 'daily' = today's log.",
    parameters: obj({ target: { type: "string", enum: ["user", "memory", "daily"] }, note: str("One concise line") }, ["target", "note"]),
    async run({ target, note }, ctx) {
      await ctx.setStatus("Is updating memory");
      const path = target === "user" ? "USER.md" : target === "memory" ? "MEMORY.md" : `memory/${today(ctx.tz)}.md`;
      if (
        persistenceNeedsApproval(hasUntrustedRead(ctx.runId), "memory_save") &&
        (await check({
          ...ctx,
          toolName: "memory_save",
          actionClass: "write",
          target: path,
          purpose: `Save memory after reading untrusted content: ${note}`,
          details: { note },
          forceAsk: true,
        })) === "deny"
      )
        return { error: "The person denied saving this memory." };
      if (path === "USER.md") {
        const cur = (await readFile(ctx.userId, path)) ?? "";
        if (cur.includes("(Nothing yet.")) await writeFile(ctx.userId, path, "# About my person\n\n");
      }
      await appendFile(ctx.userId, path, `- ${note}`);
      await ctx.activity("memory", `Remembered: ${note}`, { path }, "Memory");
      publish(ctx.userId, { type: "refresh", what: "files" });
      return { saved: true, path };
    },
  },
  {
    name: "memory_forget",
    skill: "Memory",
    status: "Is updating memory",
    description:
      "Forget an exact full line the person asked to remove from USER.md, MEMORY.md and daily memory files. Read the file first and pass the line verbatim; tell the person which lines were removed.",
    parameters: obj({ about: str("Exact full line to remove, including any bullet prefix") }, ["about"]),
    async run({ about }, ctx) {
      await ctx.setStatus("Is updating memory");
      if (
        persistenceNeedsApproval(hasUntrustedRead(ctx.runId), "memory_forget") &&
        (await check({
          ...ctx,
          toolName: "memory_forget",
          actionClass: "write",
          purpose: `Forget memory after reading untrusted content: ${about}`,
          details: { line: about },
          forceAsk: true,
        })) === "deny"
      )
        return { error: "The person denied forgetting this memory." };
      const files = (await listFiles(ctx.userId)).filter((f) => f.path === "USER.md" || f.path === "MEMORY.md" || f.path.startsWith("memory/"));
      const removed: { path: string; line: string }[] = [];
      for (const f of files) {
        const c = (await readFile(ctx.userId, f.path)) ?? "";
        const result = forgetExactLine(c, String(about));
        if (result.removed.length) {
          removed.push(...result.removed.map((line) => ({ path: f.path, line })));
          await writeFile(ctx.userId, f.path, result.content);
        }
      }
      await ctx.activity("memory", `Forgot exact line (${removed.length} notes removed)`, {}, "Memory");
      publish(ctx.userId, { type: "refresh", what: "files" });
      return { removed };
    },
  },
  {
    name: "read_file",
    skill: "Files",
    status: "Reading files",
    subagentSafe: true,
    description: "Read a file from your workspace (e.g. SOUL.md, USER.md, files/notes.md, skills/x/tool.js).",
    parameters: obj({ path: str("Workspace path") }, ["path"]),
    async run({ path }, ctx) {
      const c = await readFile(ctx.userId, path);
      return c === null ? { error: "No such file", files: (await listFiles(ctx.userId)).map((f) => f.path) } : { path, content: c.slice(0, 20000) };
    },
  },
  {
    name: "write_file",
    skill: "Files",
    status: "Writing files",
    description: "Create or overwrite a workspace file. Changes to core instruction files require explicit approval.",
    parameters: obj({ path: str("Workspace path"), content: str("Full file content") }, ["path", "content"]),
    async run({ path, content }, ctx) {
      const asks =
        (isSensitiveFile(path) && !(path === "BOOTSTRAP.md" && !content.trim())) || persistenceNeedsApproval(hasUntrustedRead(ctx.runId), "write_file", path);
      if (
        (await check({
          ...ctx,
          toolName: "write_file",
          actionClass: asks ? "write" : "internal",
          target: path,
          purpose: `Write ${path}`,
          details: { content },
          forceAsk: asks,
        })) === "deny"
      )
        return { error: "The person denied writing this file." };
      await writeFile(ctx.userId, path, content);
      if (path === "BOOTSTRAP.md" && !content.trim()) await deleteFile(ctx.userId, path);
      await ctx.activity("tool", `Updated ${path}`, {}, "Files");
      publish(ctx.userId, { type: "refresh", what: "files" });
      return { ok: true };
    },
  },
  {
    name: "delete_file",
    skill: "Files",
    status: "Tidying files",
    description: "Delete a workspace file (e.g. BOOTSTRAP.md after first-run).",
    parameters: obj({ path: str("Workspace path") }, ["path"]),
    async run({ path }, ctx) {
      if (
        persistenceNeedsApproval(hasUntrustedRead(ctx.runId), "delete_file", path) &&
        (await check({ ...ctx, toolName: "delete_file", actionClass: "write", target: path, purpose: `Delete private memory ${path}`, forceAsk: true })) ===
          "deny"
      )
        return { error: "The person denied deleting this memory." };
      if (["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "MEMORY.md"].includes(path)) return { error: "Core files can't be deleted." };
      // Removing the first-run script is the normal end of onboarding and can't add instructions.
      if (
        isSensitiveFile(path) &&
        path !== "BOOTSTRAP.md" &&
        (await check({ ...ctx, toolName: "delete_file", actionClass: "write", target: path, purpose: `Delete ${path}`, forceAsk: true })) === "deny"
      )
        return { error: "The person denied deleting this file." };
      await deleteFile(ctx.userId, path);
      publish(ctx.userId, { type: "refresh", what: "files" });
      return { ok: true };
    },
  },
  {
    name: "set_identity",
    skill: "Personality",
    status: "Is updating memory",
    description: "Change your own name, vibe or emoji when the person asks.",
    parameters: obj({ name: str("New name"), vibe: str("One-line vibe"), emoji: str("Single emoji") }),
    async run({ name, vibe, emoji }, ctx) {
      if (
        (await check({
          ...ctx,
          toolName: "set_identity",
          actionClass: "write",
          target: "IDENTITY.md",
          purpose: "Change identity",
          details: { name, vibe, emoji },
          forceAsk: true,
        })) === "deny"
      )
        return { error: "The person denied changing identity." };
      const [a] = await db.select().from(agentsTable).where(eq(agentsTable.userId, ctx.userId));
      const next = { name: name ?? a?.name ?? "Amuse", vibe: vibe ?? a?.vibe ?? "", emoji: emoji ?? a?.emoji ?? "🪺" };
      await db.update(agentsTable).set(next).where(eq(agentsTable.userId, ctx.userId));
      await writeFile(ctx.userId, "IDENTITY.md", `# Identity\n\n- Name: ${next.name}\n- Vibe: ${next.vibe}\n- Emoji: ${next.emoji}\n`);
      publish(ctx.userId, { type: "refresh", what: "agent" });
      await ctx.activity("tool", `Changed identity to ${next.name}`, next, "Personality");
      return { ok: true, ...next };
    },
  },
];

export const planningTools: ToolDef[] = [
  {
    name: "goal_create",
    skill: "Goals",
    status: "Making a plan",
    description: "Create a goal with a concrete action plan (4-8 steps). Use when the person states an ambition or multi-week project.",
    parameters: obj(
      {
        title: str("Short goal title"),
        description: str("Why it matters / target"),
        emoji: str("Emoji"),
        steps: { type: "array", items: { type: "string" }, description: "Ordered plan steps" },
      },
      ["title", "steps"],
    ),
    async run({ title, description, emoji, steps }, ctx) {
      await ctx.setStatus("Making a plan");
      const plan: PlanStep[] = (steps as string[]).map((s) => ({ id: rid(), title: s, done: false }));
      const [g] = await db
        .insert(goalsTable)
        .values({ userId: ctx.userId, title, description: description ?? "", emoji: emoji ?? "🎯", plan })
        .returning();
      await ctx.activity("skill", `Created goal "${title}" with ${plan.length} steps`, { goalId: g!.id }, "Goals");
      ctx.addParts([{ type: "goal", goalId: g!.id, title }]);
      publish(ctx.userId, { type: "refresh", what: "goals" });
      return { goal_id: g!.id, plan };
    },
  },
  {
    name: "goal_update",
    skill: "Goals",
    status: "Updating your goals",
    description: "Update a goal: mark steps done, add steps, set status (active|done|paused) or a progress note.",
    parameters: obj(
      {
        goal_id: num("Goal id"),
        complete_step_ids: { type: "array", items: { type: "string" } },
        add_steps: { type: "array", items: { type: "string" } },
        status: { type: "string", enum: ["active", "done", "paused"] },
        progress_note: str("Short progress note"),
      },
      ["goal_id"],
    ),
    async run(a, ctx) {
      const [g] = await db
        .select()
        .from(goalsTable)
        .where(and(eq(goalsTable.id, a.goal_id), eq(goalsTable.userId, ctx.userId)));
      if (!g) return { error: "No such goal" };
      let plan = g.plan.map((s) => (a.complete_step_ids?.includes(s.id) ? { ...s, done: true } : s));
      if (a.add_steps?.length) plan = plan.concat(a.add_steps.map((t: string) => ({ id: rid(), title: t, done: false })));
      await db
        .update(goalsTable)
        .set({ plan, status: a.status ?? g.status, progressNote: a.progress_note ?? g.progressNote, updatedAt: new Date() })
        .where(eq(goalsTable.id, g.id));
      await ctx.activity("skill", `Updated goal "${g.title}"`, {}, "Goals");
      publish(ctx.userId, { type: "refresh", what: "goals" });
      return { ok: true, plan };
    },
  },
  {
    name: "goals_list",
    skill: "Goals",
    status: "Checking your goals",
    subagentSafe: true,
    description: "List the person's goals and plans.",
    parameters: obj({}),
    async run(_a, ctx) {
      return { goals: await db.select().from(goalsTable).where(eq(goalsTable.userId, ctx.userId)) };
    },
  },
  {
    name: "ideas_add",
    skill: "Ideas",
    status: "Thinking of ideas",
    description: "Add personalised ideas to the Ideas tab: concrete things you could do for the person, each with a ready-to-run prompt.",
    parameters: obj(
      {
        ideas: {
          type: "array",
          items: obj(
            {
              title: str("Short title"),
              body: str("One sentence why"),
              prompt: str("The exact request to run if they tap it"),
              category: str("e.g. money, health, home, work, fun"),
              emoji: str("Emoji"),
            },
            ["title", "body", "prompt"],
          ),
        },
      },
      ["ideas"],
    ),
    async run({ ideas }, ctx) {
      const asks = persistenceNeedsApproval(hasUntrustedRead(ctx.runId), "ideas_add");
      if (
        (await check({ ...ctx, toolName: "ideas_add", actionClass: asks ? "write" : "internal", forceAsk: asks, purpose: "Add ideas", details: { ideas } })) ===
        "deny"
      )
        return { error: "Denied" };
      const rows = await db
        .insert(ideasTable)
        .values(
          (ideas as any[]).slice(0, 8).map((i) => ({
            userId: ctx.userId,
            title: i.title,
            body: i.body ?? "",
            prompt: i.prompt,
            category: i.category ?? "general",
            emoji: i.emoji ?? "💡",
            source: "agent",
          })),
        )
        .returning();
      await ctx.activity("skill", `Added ${rows.length} ideas`, {}, "Ideas");
      publish(ctx.userId, { type: "refresh", what: "ideas" });
      return { added: rows.length };
    },
  },
  {
    name: "schedule_task",
    skill: "Scheduling",
    status: "Scheduling a task",
    description:
      "Schedule work that runs later in the background: a reminder, a recurring check/monitor, or a follow-up. Give either in_minutes or at_iso for the first run, and every_minutes for repeats. The prompt is what you will be asked to do at that time.",
    parameters: obj(
      {
        title: str("Short title shown in Upcoming"),
        kind: { type: "string", enum: ["reminder", "monitor", "task"] },
        prompt: str("Instruction for your future self"),
        in_minutes: num("Minutes from now for the first run"),
        at_iso: str("ISO datetime for the first run"),
        every_minutes: num("Repeat interval in minutes (omit for one-off)"),
        goal_id: num("Related goal id"),
      },
      ["title", "kind", "prompt"],
    ),
    async run(a, ctx) {
      const first = a.at_iso ? new Date(a.at_iso) : new Date(Date.now() + (a.in_minutes ?? 1) * 60000);
      if (isNaN(first.getTime())) return { error: "Bad time" };
      const every = a.every_minutes == null ? null : Math.round(a.every_minutes);
      const error = schedulePolicy(ctx.trigger, 0, every);
      if (error) return { error };
      // A one-off reminder only posts a message; anything that later runs the agent asks first.
      const runsAgent = a.kind !== "reminder" || every != null;
      if (
        runsAgent &&
        (await check({
          ...ctx,
          toolName: "schedule_task",
          actionClass: "write",
          purpose: `Schedule "${a.title}"`,
          details: { prompt: a.prompt, first: first.toISOString(), every },
          forceAsk: true,
        })) === "deny"
      )
        return { error: "The person denied this schedule." };
      const t = await insertSchedule(ctx.trigger, {
        userId: ctx.userId,
        kind: a.kind,
        title: a.title,
        prompt: a.prompt,
        nextRunAt: first,
        intervalMinutes: every,
        goalId: a.goal_id ?? null,
      });
      await ctx.activity(
        "schedule",
        `Scheduled "${a.title}" for ${first.toLocaleString("en-US", { timeZone: ctx.tz })}${every ? ` (every ${every} min)` : ""}`,
        { taskId: t!.id },
        "Scheduling",
      );
      ctx.addParts([{ type: "scheduled", taskId: t!.id, title: a.title, nextRunAt: first.toISOString(), every }]);
      publish(ctx.userId, { type: "refresh", what: "upcoming" });
      return { task_id: t!.id, next_run: first.toISOString() };
    },
  },
  {
    name: "schedule_cancel",
    skill: "Scheduling",
    status: "Updating your schedule",
    description: "Cancel a scheduled task by id.",
    parameters: obj({ task_id: num("Task id") }, ["task_id"]),
    async run({ task_id }, ctx) {
      await db
        .update(scheduledTasksTable)
        .set({ enabled: false, lastResult: "Cancelled" })
        .where(and(eq(scheduledTasksTable.id, task_id), eq(scheduledTasksTable.userId, ctx.userId)));
      publish(ctx.userId, { type: "refresh", what: "upcoming" });
      await ctx.activity("schedule", `Cancelled scheduled task #${task_id}`, {}, "Scheduling");
      return { ok: true };
    },
  },
  {
    name: "schedule_list",
    skill: "Scheduling",
    status: "Checking your schedule",
    subagentSafe: true,
    description: "List upcoming scheduled tasks and reminders.",
    parameters: obj({}),
    async run(_a, ctx) {
      return {
        tasks: await db
          .select()
          .from(scheduledTasksTable)
          .where(and(eq(scheduledTasksTable.userId, ctx.userId), eq(scheduledTasksTable.enabled, true))),
      };
    },
  },
];

const ARTIFACT_GUIDE =
  "Self-contained HTML only: inline CSS/JS, no CDN scripts, external fonts, images or media. Embed assets as data: URLs. Mobile-first, clean, readable. Use window.amuse.getData()/setData(obj) to persist interactive state.";

export const makerTools: ToolDef[] = [
  {
    name: "create_artifact",
    skill: "Artifacts",
    status: "Making something",
    description:
      "Create a rich artifact the person can open: an itinerary, tracker, dashboard, study guide, comparison table, web page (kind=html) or a formatted document (kind=markdown). " +
      ARTIFACT_GUIDE,
    parameters: obj({ kind: { type: "string", enum: ["html", "markdown"] }, title: str("Title"), content: str("Full HTML or Markdown") }, [
      "kind",
      "title",
      "content",
    ]),
    async run({ kind, title, content }, ctx) {
      await ctx.setStatus("Making something");
      const [a] = await db.insert(artifactsTable).values({ userId: ctx.userId, chatId: ctx.chatId, kind, title, content }).returning();
      await ctx.activity("skill", `Created ${kind === "html" ? "an interactive page" : "a document"}: ${title}`, { artifactId: a!.id }, "Artifacts");
      ctx.addParts([{ type: "artifact", artifactId: a!.id, kind, title }]);
      return { artifact_id: a!.id, shown_to_person: true };
    },
  },
  {
    name: "update_artifact",
    skill: "Artifacts",
    status: "Making something",
    description: "Replace the content of an existing artifact (e.g. after the person asks for changes).",
    parameters: obj({ artifact_id: num("Artifact id"), title: str("New title"), content: str("Full new content") }, ["artifact_id", "content"]),
    async run({ artifact_id, title, content }, ctx) {
      const [a] = await db
        .select()
        .from(artifactsTable)
        .where(and(eq(artifactsTable.id, artifact_id), eq(artifactsTable.userId, ctx.userId)));
      if (!a) return { error: "No such artifact" };
      await db
        .update(artifactsTable)
        .set({ content, title: title ?? a.title, updatedAt: new Date() })
        .where(eq(artifactsTable.id, a.id));
      ctx.addParts([{ type: "artifact", artifactId: a.id, kind: a.kind, title: title ?? a.title }]);
      await ctx.activity("skill", `Updated "${title ?? a.title}"`, {}, "Artifacts");
      return { ok: true };
    },
  },
];

export const spaceTools: ToolDef[] = [
  {
    name: "space_create",
    skill: "Spaces",
    status: "Building a space",
    description:
      "Build a Space: a personal mini-app that lives in the person's sidebar (gift tracker, school dashboard, trip planner, word game...). Provide complete HTML. " +
      ARTIFACT_GUIDE +
      " Seed initial data in 'data'. If it should stay up to date, set refresh_prompt (what to fetch/update) and refresh_every_minutes; on refresh you'll be asked to call space_update with new data.",
    parameters: obj(
      {
        title: str("Space name"),
        emoji: str("Emoji icon"),
        description: str("One line"),
        html: str("Full HTML app"),
        data: { type: "object", description: "Initial JSON data", additionalProperties: true },
        refresh_prompt: str("How to refresh the data in the background"),
        refresh_every_minutes: num("Refresh interval minutes (>=60)"),
      },
      ["title", "html"],
    ),
    async run(a, ctx) {
      await ctx.setStatus("Building a space");
      if (a.refresh_prompt && a.refresh_every_minutes) {
        const error = schedulePolicy(ctx.trigger, 0, a.refresh_every_minutes);
        if (error) return { error };
        if (
          (await check({
            ...ctx,
            toolName: "schedule_task",
            actionClass: "write",
            purpose: `Schedule refresh for "${a.title}"`,
            details: { prompt: a.refresh_prompt, every: a.refresh_every_minutes },
            forceAsk: true,
          })) === "deny"
        )
          return { error: "The person denied this refresh schedule." };
      }
      const [s] = await db
        .insert(spacesTable)
        .values({
          userId: ctx.userId,
          title: a.title,
          emoji: a.emoji ?? "✨",
          description: a.description ?? "",
          html: a.html,
          data: a.data ?? {},
          refreshPrompt: a.refresh_prompt ?? null,
        })
        .returning();
      if (a.refresh_prompt && a.refresh_every_minutes) {
        await insertSchedule(ctx.trigger, {
          userId: ctx.userId,
          kind: "space_refresh",
          title: `Refresh ${a.title}`,
          prompt: a.refresh_prompt,
          spaceId: s!.id,
          intervalMinutes: Math.max(60, Math.round(a.refresh_every_minutes)),
          nextRunAt: new Date(Date.now() + Math.max(60, a.refresh_every_minutes) * 60000),
        });
      }
      await ctx.activity("skill", `Built the space "${a.title}"`, { spaceId: s!.id }, "Spaces");
      ctx.addParts([{ type: "space", spaceId: s!.id, title: a.title, emoji: a.emoji ?? "✨" }]);
      publish(ctx.userId, { type: "refresh", what: "spaces" });
      return { space_id: s!.id };
    },
  },
  {
    name: "space_update",
    skill: "Spaces",
    status: "Updating a space",
    description: "Update a Space's HTML (to change how it looks/works), its data (merge or replace), or title.",
    parameters: obj(
      {
        space_id: num("Space id"),
        html: str("Full new HTML"),
        data: { type: "object", additionalProperties: true },
        replace_data: { type: "boolean" },
        title: str("New title"),
      },
      ["space_id"],
    ),
    async run(a, ctx) {
      const [s] = await db
        .select()
        .from(spacesTable)
        .where(and(eq(spacesTable.id, a.space_id), eq(spacesTable.userId, ctx.userId)));
      if (!s) return { error: "No such space" };
      const asks = persistenceNeedsApproval(hasUntrustedRead(ctx.runId), "space_update", "", a.html != null && a.html !== s.html);
      if (
        (await check({
          ...ctx,
          toolName: "space_update",
          actionClass: asks ? "write" : "internal",
          forceAsk: asks,
          target: String(s.id),
          purpose: `Update space "${s.title}"`,
          details: { html: a.html, data: a.data },
        })) === "deny"
      )
        return { error: "Denied" };
      const data = a.data ? (a.replace_data ? a.data : { ...s.data, ...a.data }) : s.data;
      await db
        .update(spacesTable)
        .set({ html: a.html ?? s.html, data, title: a.title ?? s.title, updatedAt: new Date(), lastRefreshedAt: a.data ? new Date() : s.lastRefreshedAt })
        .where(eq(spacesTable.id, s.id));
      await ctx.activity("skill", `Updated the space "${a.title ?? s.title}"`, {}, "Spaces");
      publish(ctx.userId, { type: "refresh", what: "spaces" });
      return { ok: true };
    },
  },
  {
    name: "space_get",
    skill: "Spaces",
    status: "Opening a space",
    subagentSafe: true,
    description: "Read a Space's current data and HTML (to modify it), or list spaces when space_id is omitted.",
    parameters: obj({ space_id: num("Space id") }),
    async run({ space_id }, ctx) {
      if (!space_id)
        return {
          spaces: (await db.select().from(spacesTable).where(eq(spacesTable.userId, ctx.userId))).map((s) => ({
            id: s.id,
            title: s.title,
            description: s.description,
          })),
        };
      const [s] = await db
        .select()
        .from(spacesTable)
        .where(and(eq(spacesTable.id, space_id), eq(spacesTable.userId, ctx.userId)));
      return s ? { id: s.id, title: s.title, data: s.data, html: s.html.slice(0, 30000) } : { error: "No such space" };
    },
  },
];
