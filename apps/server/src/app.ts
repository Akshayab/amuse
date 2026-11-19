import fs from "node:fs";
import path from "node:path";
import express, { type Express } from "express";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { localOnlyGuard, ownerMiddleware, securityHeaders } from "./middlewares/owner";
import { assertWithinLimit, UsageLimitError } from "./agent/usage";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(securityHeaders);
app.use(localOnlyGuard);
app.use(express.json({ limit: "25mb" }));
app.use(ownerMiddleware);

app.use(["/api/agent/avatar-options", "/api/voice", "/api/ideas/refresh"], async (req, res, next) => {
  if (req.method !== "POST") return next();
  try {
    await assertWithinLimit(req.user!.id);
    next();
  } catch (error) {
    if (error instanceof UsageLimitError) res.status(429).json({ error: error.message, resetsAt: error.resetsAt });
    else next(error);
  }
});

app.use("/api", router);

// In production the server also serves the built web app (apps/web/dist/public).
const webDir = process.env.AMUSE_WEB_DIR ?? path.resolve(import.meta.dirname, "../../web/dist/public");
if (fs.existsSync(path.join(webDir, "index.html"))) {
  app.use(express.static(webDir, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webDir, "index.html")));
}

export default app;
