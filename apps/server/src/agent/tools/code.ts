import { getQuickJS } from "quickjs-emscripten";
import { readFile, writeFile, listFiles } from "../workspace";
import { obj, str, type ToolDef } from "./types";
import { publish } from "../bus";

/** Run untrusted JS inside a QuickJS (wasm) sandbox: no network, no filesystem, time + memory capped. */
export async function runSandboxed(code: string, input: unknown, timeoutMs = 4000) {
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(64 * 1024 * 1024);
  const deadline = Date.now() + timeoutMs;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const vm = runtime.newContext();
  const logs: string[] = [];
  let logBytes = 0;
  try {
    // console.log output lives outside the sandbox's memory limit, so cap it.
    const logFn = vm.newFunction("log", (...args) => {
      if (logBytes > 20_000 || logs.length >= 200) return;
      const line = args
        .map((a) => JSON.stringify(vm.dump(a)) ?? "undefined")
        .join(" ")
        .slice(0, 2_000);
      logBytes += line.length + 16;
      logs.push(logBytes > 20_000 || logs.length === 199 ? "(more output truncated)" : line);
    });
    const consoleObj = vm.newObject();
    vm.setProp(consoleObj, "log", logFn);
    vm.setProp(vm.global, "console", consoleObj);
    logFn.dispose();
    consoleObj.dispose();
    const wrapped = `const input = ${JSON.stringify(input ?? null)};\n(function(){\n${code}\n})()`;
    const result = vm.evalCode(wrapped);
    if (result.error) {
      const err = vm.dump(result.error);
      result.error.dispose();
      return { ok: false, error: typeof err === "object" ? JSON.stringify(err) : String(err), logs };
    }
    const value = vm.dump(result.value);
    result.value.dispose();
    return { ok: true, result: value, logs };
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}

export const codeTools: ToolDef[] = [
  {
    name: "run_code",
    skill: "Coding",
    status: "Writing code",
    subagentSafe: true,
    description:
      "Run JavaScript in a sandbox to compute, transform data, parse text, do math or date logic. The code is a function body: read 'input', 'return' a JSON-serialisable value. No network or filesystem. console.log is captured.",
    parameters: obj({ code: str("Function body"), input: { type: "object", additionalProperties: true, description: "Input data" } }, ["code"]),
    async run({ code, input }, ctx) {
      await ctx.setStatus("Writing code");
      const r = await runSandboxed(code, input);
      await ctx.activity("tool", `Ran code (${r.ok ? "ok" : "error"})`, {}, "Coding");
      return r;
    },
  },
  {
    name: "save_tool",
    skill: "Building tools",
    status: "Building a tool",
    description:
      "Build a reusable tool for yourself when a task needs one that doesn't exist (e.g. a tip splitter, a unit converter for recipes, a budget calculator). Saved under skills/<name>/ and callable later with use_tool.",
    parameters: obj(
      { name: str("kebab-case name"), description: str("What it does and its input shape"), code: str("JS function body using 'input', returning a value") },
      ["name", "description", "code"],
    ),
    async run({ name, description, code }, ctx) {
      const slug = String(name)
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .slice(0, 40);
      const test = await runSandboxed(code, {}, 2000);
      await writeFile(
        ctx.userId,
        `skills/${slug}/SKILL.md`,
        `---\nname: ${slug}\ndescription: ${description}\n---\n\nCall with use_tool({ name: "${slug}", input }).\n`,
      );
      await writeFile(ctx.userId, `skills/${slug}/tool.js`, code, "text/javascript");
      await ctx.activity("skill", `Built a new tool: ${slug}`, {}, "Building tools");
      publish(ctx.userId, { type: "refresh", what: "files" });
      return { saved: slug, smoke_test: test.ok ? "ran" : test.error };
    },
  },
  {
    name: "use_tool",
    skill: "Building tools",
    status: "Using a tool",
    subagentSafe: true,
    description: "Run one of the tools you built earlier (see the Tools list in context).",
    parameters: obj({ name: str("Tool name"), input: { type: "object", additionalProperties: true } }, ["name"]),
    async run({ name, input }, ctx) {
      const code = await readFile(ctx.userId, `skills/${name}/tool.js`);
      if (!code) return { error: "No such tool", tools: (await listFiles(ctx.userId, "skills/")).map((f) => f.path) };
      return runSandboxed(code, input);
    },
  },
];
