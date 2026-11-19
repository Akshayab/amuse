import type { NextFunction, Request, Response } from "express";
import { ensureUserSetup } from "../agent/workspace";

const setupDone = new Set<string>();

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Not allowed" });
    return;
  }
  const uid = req.user.id;
  if (!setupDone.has(uid)) {
    await ensureUserSetup(uid);
    setupDone.add(uid);
  }
  next();
}

export const uid = (req: Request) => req.user!.id;
export const idParam = (req: Request, name = "id") => Number(req.params[name]);
export function forgetSetup(userId: string) {
  setupDone.delete(userId);
}
