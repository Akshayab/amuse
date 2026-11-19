import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, ne, or } from "drizzle-orm";
import {
  activityTable,
  approvalsTable,
  artifactsTable,
  chatsTable,
  db,
  goalsTable,
  messagesTable,
  notificationsTable,
  runsTable,
  spacesTable,
  workspaceFilesTable,
} from "@amuse/db";
import { requireAuth, uid } from "./helpers";

const router: IRouter = Router();
router.use(requireAuth);

/** Search across chats, artifacts, files, goals and spaces. */
router.get("/search", async (req, res) => {
  const userId = uid(req);
  const q = String(req.query.q ?? "")
    .trim()
    .slice(0, 100);
  if (!q) {
    res.json({ results: [] });
    return;
  }
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const [msgs, arts, files, goals, spaces] = await Promise.all([
    db
      .select({
        id: messagesTable.id,
        chatId: messagesTable.chatId,
        role: messagesTable.role,
        content: messagesTable.content,
        createdAt: messagesTable.createdAt,
        kind: chatsTable.kind,
        title: chatsTable.title,
      })
      .from(messagesTable)
      .innerJoin(chatsTable, eq(chatsTable.id, messagesTable.chatId))
      .where(and(eq(messagesTable.userId, userId), ne(chatsTable.kind, "background"), ilike(messagesTable.content, like)))
      .orderBy(desc(messagesTable.id))
      .limit(20),
    db
      .select({ id: artifactsTable.id, kind: artifactsTable.kind, title: artifactsTable.title, createdAt: artifactsTable.createdAt })
      .from(artifactsTable)
      .where(
        and(
          eq(artifactsTable.userId, userId),
          or(
            ilike(artifactsTable.title, like),
            and(ne(artifactsTable.kind, "image"), ne(artifactsTable.kind, "audio"), ne(artifactsTable.kind, "pdf"), ilike(artifactsTable.content, like)),
          ),
        ),
      )
      .orderBy(desc(artifactsTable.id))
      .limit(15),
    db
      .select({ path: workspaceFilesTable.path, content: workspaceFilesTable.content })
      .from(workspaceFilesTable)
      .where(and(eq(workspaceFilesTable.userId, userId), or(ilike(workspaceFilesTable.path, like), ilike(workspaceFilesTable.content, like))))
      .limit(10),
    db
      .select({ id: goalsTable.id, title: goalsTable.title })
      .from(goalsTable)
      .where(and(eq(goalsTable.userId, userId), ilike(goalsTable.title, like)))
      .limit(10),
    db
      .select({ id: spacesTable.id, title: spacesTable.title, emoji: spacesTable.emoji })
      .from(spacesTable)
      .where(and(eq(spacesTable.userId, userId), or(ilike(spacesTable.title, like), ilike(spacesTable.description, like))))
      .limit(10),
  ]);
  const snip = (t: string) => {
    const i = t.toLowerCase().indexOf(q.toLowerCase());
    return (i > 40 ? "…" : "") + t.slice(Math.max(0, i - 40), i + 120);
  };
  res.json({
    results: [
      ...msgs.map((m) => ({
        type: "message",
        id: m.id,
        chatId: m.chatId,
        chatKind: m.kind,
        title: m.kind === "main" ? "Main chat" : m.title,
        snippet: snip(m.content),
        role: m.role,
        at: m.createdAt,
      })),
      ...arts.map((a) => ({ type: "artifact", id: a.id, kind: a.kind, title: a.title, at: a.createdAt })),
      ...files.map((f) => ({ type: "file", path: f.path, snippet: snip(f.content) })),
      ...goals.map((g) => ({ type: "goal", id: g.id, title: g.title })),
      ...spaces.map((s) => ({ type: "space", id: s.id, title: s.title, emoji: s.emoji })),
    ],
  });
});

/** Feed: proactive check-ins, background results, things made and goal progress. */
router.get("/feed", async (req, res) => {
  const userId = uid(req);
  const [proactive, notifs, made, bg, goals] = await Promise.all([
    db
      .select()
      .from(messagesTable)
      .where(and(eq(messagesTable.userId, userId), eq(messagesTable.proactive, true)))
      .orderBy(desc(messagesTable.id))
      .limit(30),
    db.select().from(notificationsTable).where(eq(notificationsTable.userId, userId)).orderBy(desc(notificationsTable.id)).limit(30),
    db
      .select({ id: artifactsTable.id, kind: artifactsTable.kind, title: artifactsTable.title, createdAt: artifactsTable.createdAt })
      .from(artifactsTable)
      .where(eq(artifactsTable.userId, userId))
      .orderBy(desc(artifactsTable.id))
      .limit(20),
    db
      .select()
      .from(runsTable)
      .where(and(eq(runsTable.userId, userId), ne(runsTable.trigger, "user")))
      .orderBy(desc(runsTable.id))
      .limit(20),
    db.select().from(goalsTable).where(eq(goalsTable.userId, userId)).orderBy(desc(goalsTable.updatedAt)).limit(10),
  ]);
  const items = [
    ...proactive.map((m) => ({ type: "checkin", id: `m${m.id}`, at: m.createdAt, text: m.content })),
    ...made.map((a) => ({ type: "made", id: `a${a.id}`, at: a.createdAt, artifactId: a.id, kind: a.kind, text: a.title })),
    ...bg
      .filter((r) => r.status === "done")
      .map((r) => ({ type: "background", id: `r${r.id}`, at: r.endedAt ?? r.startedAt, text: r.title ?? "Background task" })),
    ...goals.map((g) => ({
      type: "goal",
      id: `g${g.id}`,
      at: g.updatedAt,
      goalId: g.id,
      text: g.title,
      done: g.plan.filter((s) => s.done).length,
      total: g.plan.length,
    })),
  ].sort((a, b) => new Date(b.at as any).getTime() - new Date(a.at as any).getTime());
  res.json({ items: items.slice(0, 60), unread: notifs.filter((n) => !n.read).length });
});

/** Library: everything the agent made, plus files. */
router.get("/library", async (req, res) => {
  const userId = uid(req);
  const kind = req.query.kind ? String(req.query.kind) : null;
  const where = kind ? and(eq(artifactsTable.userId, userId), eq(artifactsTable.kind, kind)) : eq(artifactsTable.userId, userId);
  const items = await db
    .select({ id: artifactsTable.id, kind: artifactsTable.kind, title: artifactsTable.title, createdAt: artifactsTable.createdAt })
    .from(artifactsTable)
    .where(where)
    .orderBy(desc(artifactsTable.id))
    .limit(200);
  res.json({ items });
});

router.get("/approvals/history", async (req, res) => {
  res.json({
    approvals: await db
      .select()
      .from(approvalsTable)
      .where(eq(approvalsTable.userId, uid(req)))
      .orderBy(desc(approvalsTable.id))
      .limit(100),
  });
});

export default router;
void activityTable;
