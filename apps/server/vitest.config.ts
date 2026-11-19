import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    env: { DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused", OPENAI_API_KEY: "test-key" },
  },
});
