import { defineConfig } from "drizzle-kit";
import path from "path";

// Only needed to generate new migrations after changing the schema: pnpm db:generate
export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  out: path.join(__dirname, "./migrations"),
  dialect: "postgresql",
});
