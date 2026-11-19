// Records short takes for shareable GIFs and logs when the agent is working ("wait" spans), so the
// encoder can speed through waits without touching typing or results.
// Usage: BASE_URL=http://localhost:5173 GIFS=G1,G2,G3,G4 node tests/e2e/gifs.mjs <outdir>   (fresh database; G2-G4 reuse G1's agent)
import { chromium } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";

const BASE = (process.env.BASE_URL ?? "http://localhost:5173").replace(/\/$/, "");
const OUT = process.argv[2] ?? "e2e-gifs";
const ONLY = new Set((process.env.GIFS ?? "").split(",").filter(Boolean));
await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
const VIEW = { width: 1280, height: 760 };

function helpers(page, t0, marks) {
  const now = () => (Date.now() - t0) / 1000;
  const mark = (kind) => marks.push({ kind, t: now() });
  const caption = (text) =>
    page
      .evaluate((text) => {
        let el = document.getElementById("__wf_cap");
        if (!el) {
          el = document.createElement("div");
          el.id = "__wf_cap";
          el.style.cssText =
            "position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:99999;background:rgba(45,127,249,.96);color:#fff;font:600 17px Inter,system-ui,sans-serif;padding:9px 18px;border-radius:999px;box-shadow:0 6px 24px rgba(0,0,0,.45);pointer-events:none;max-width:80vw;text-align:center";
          document.body.appendChild(el);
        }
        el.textContent = text;
        el.style.display = text ? "block" : "none";
      }, text)
      .catch(() => {});
  const type = async (text) => {
    const box = page.getByTestId("composer-input");
    await box.click();
    await box.pressSequentially(text, { delay: 22 });
    await page.waitForTimeout(300);
  };
  const waitIdle = async (timeout = 280000) => {
    await page.waitForTimeout(1200);
    await page.waitForFunction(() => !document.querySelector('[data-testid="stop"]'), null, { timeout });
  };
  /** Agent working: everything between waitStart and waitEnd is sped up in the GIF. */
  const work = async (fn) => {
    mark("waitStart");
    await fn();
    mark("waitEnd");
  };
  /** Blank loading (e.g. a space's page booting): cut out of the GIF entirely. */
  const skip = async (fn) => {
    mark("skipStart");
    await fn();
    mark("skipEnd");
  };
  const pause = (ms) => page.waitForTimeout(ms);
  return { mark, caption, type, waitIdle, work, skip, pause };
}

const GIFS = {
  G1: {
    title: "Hatch your own agent",
    run: async (page, h) => {
      await page.getByTestId("onb-start").waitFor();
      h.mark("start");
      await h.caption("Hatch your own personal agent");
      await h.pause(900);
      await page.getByTestId("onb-start").click();
      await h.pause(500);
      await page.getByTestId("onb-name-input").pressSequentially("Juniper", { delay: 80 });
      await h.pause(500);
      await page.getByTestId("onb-next").click();
      await h.caption("Pick its look and vibe");
      await h.pause(600);
      await page.getByRole("button", { name: "Moss" }).click();
      await h.pause(700);
      await page.getByText("Witty and playful").click();
      await h.pause(600);
      await page.getByTestId("onb-next").click();
      await h.pause(500);
      await page.getByTestId("onb-owner-name").pressSequentially("Sam", { delay: 80 });
      await h.pause(300);
      await page.getByText("Saving money").click();
      await h.pause(500);
      await page.getByTestId("onb-hatch").click();
      await h.caption("It says hi and gets to work");
      await h.work(async () => {
        await page.getByTestId("agent-header").waitFor();
        await page.locator('[data-testid="msg-assistant"]').first().waitFor({ timeout: 120000 });
        await h.waitIdle();
      });
      await h.pause(2600);
      h.mark("end");
    },
  },
  G2: {
    title: "Ask for an app, get a working one",
    run: async (page, h) => {
      await page.getByTestId("composer-input").waitFor();
      await h.pause(600);
      h.mark("start");
      await h.caption("Ask for a little app…");
      await h.type("Build me a space to track gift ideas for friends and family, with a couple of examples.");
      await page.getByTestId("send").click();
      await h.work(() => h.waitIdle());
      await h.caption("…and it builds one you can use right away");
      await h.pause(1200);
      const sp = await page.evaluate(async () => (await (await fetch("/api/spaces", { credentials: "include" })).json()).spaces);
      const fr = page.frameLocator('[data-testid="space-frame"]');
      await h.skip(async () => {
        await page.goto(BASE + "/spaces/" + sp[sp.length - 1].id);
        await page.getByTestId("space-frame").waitFor();
        // The space's page stays blank while it boots; wait until it has drawn something.
        await fr.locator("body *:visible").first().waitFor({ timeout: 30000 });
        await h.pause(600);
      });
      await h.pause(600);
      // The agent designs each space itself, so follow whatever form it built: a person first if asked,
      // then a gift idea, using visible fields and the nearest "Add" button.
      const vis = (sel) =>
        fr
          .locator(
            sel
              .split(",")
              .map((x) => x.trim() + ":visible")
              .join(", "),
          )
          .first();
      // Find a field by placeholder first, then by its visible label (generated forms use either).
      const labelFor = { idea: /gift|idea/i, who: /recipient|person|who|for|name/i, budget: /budget|price|cost/i };
      const tryFill = async (sel, text, delay = 60) => {
        let el = vis(sel);
        if (!(await el.count())) {
          const key = /idea|gift/.test(sel) ? "idea" : /budget|price|\$/.test(sel) ? "budget" : "who";
          el = fr.getByLabel(labelFor[key]).first();
          if (!(await el.isVisible().catch(() => false))) return false;
        }
        await el.pressSequentially(text, { delay });
        return true;
      };
      const clickAdd = async (re) => {
        const btns = fr.locator("button:visible");
        const n = await btns.count();
        let fallback = null;
        for (let i = 0; i < n; i++) {
          const t = (await btns.nth(i).innerText()).trim();
          if (re.test(t)) return btns.nth(i).click();
          if (/add|save/i.test(t) && !fallback) fallback = btns.nth(i);
        }
        if (fallback) await fallback.click();
      };
      try {
        const ideaSel = 'input[placeholder*="idea" i], input[placeholder*="gift" i]';
        // Some designs hide the form behind a "+ Person" / "Add" button.
        if (!(await fr.locator("input[type=text]:visible, input:not([type]):visible").count())) {
          const btns = fr.locator("button:visible");
          for (let i = 0; i < (await btns.count()); i++) {
            const t = (await btns.nth(i).innerText()).trim();
            if (/person|^\+|add|new/i.test(t)) {
              await btns.nth(i).click();
              await h.pause(500);
              break;
            }
          }
        }
        const ideaByLabel = await fr
          .getByLabel(labelFor.idea)
          .first()
          .isVisible()
          .catch(() => false);
        if (!(await vis(ideaSel).count()) && !ideaByLabel) {
          await tryFill('input[placeholder*="person" i], input[placeholder*="who" i], input[placeholder*="name" i]', "Mom", 70);
          await tryFill('input[placeholder*="budget" i]', "60", 80);
          await h.pause(250);
          await clickAdd(/person|add/i);
          await h.pause(900);
        } else {
          if (!(await tryFill('input[placeholder*="who" i], input[placeholder*="person" i], input[placeholder*="for" i]', "Mom", 70))) {
            const sel = vis("select");
            if (await sel.count()) {
              const opts = await sel.locator("option").allTextContents();
              const pick = opts.find((o) => /mom/i.test(o)) ?? opts.find((o) => o.trim() && !/choose|select|who/i.test(o));
              if (pick) await sel.selectOption({ label: pick });
            }
          }
        }
        if (await tryFill(ideaSel, "Pottery class", 50)) {
          await tryFill('input[placeholder*="price" i], input[placeholder*="$" i]', "45", 80);
          await h.pause(250);
          await clickAdd(/idea|gift|^\+$/i);
        }
        await fr
          .getByText(/Pottery class/)
          .first()
          .waitFor({ timeout: 2500 });
        await fr
          .getByText(/Pottery class|Mom/)
          .last()
          .scrollIntoViewIfNeeded()
          .catch(() => {});
      } catch (err) {
        console.log("space interaction:", String(err?.message ?? err).slice(0, 160));
      }
      await h.pause(1800);
      await h.caption("Pin it as its own tab");
      await page.getByRole("button", { name: "Tab" }).click();
      await h.pause(2400);
      h.mark("end");
    },
  },
  G4: {
    title: "Talk to it, and it talks back",
    // Each listening turn gets its own recorded question (tests/e2e/fixtures/voice-turn-*.wav) as the microphone.
    voiceTurns: ["voice-turn-1.wav", "voice-turn-2.wav"],
    run: async (page, h) => {
      await page.getByTestId("composer-input").waitFor();
      await page.evaluate(() => localStorage.setItem("amuse.voiceEngine", "natural"));
      await h.pause(600);
      h.mark("start");
      await h.caption("Or just talk to it");
      await h.pause(1200);
      await page.getByTestId("call").click();
      const phase = (p, timeout = 120000) => page.locator(`[data-testid="voice-overlay"][data-phase="${p}"]`).waitFor({ timeout });
      for (const [i, line] of ["Ask out loud…", "…and keep the conversation going"].entries()) {
        await phase("listening", 30000);
        await h.caption(line);
        await phase("transcribing", 30000);
        await h.work(() => phase("speaking"));
        // The call starts listening again as soon as the reply ends, so pick the next question now.
        await page.evaluate((n) => (window.__voiceTurn = n), i + 1);
        await h.caption(i === 0 ? "It answers in its own voice" : "It remembers what you just talked about");
        // Show the reply for a moment, then speed through the rest of the spoken answer.
        await h.pause(2600);
        await h.work(() => phase("listening", 90000));
      }
      await h.pause(900);
      h.mark("end");
      await page
        .getByTestId("voice-end")
        .click()
        .catch(() => {});
    },
  },
  G3: {
    title: "It browses the web for you, live",
    run: async (page, h) => {
      await page.getByTestId("composer-input").waitFor();
      await page.getByTestId("new-side-chat").click();
      await page.getByText("A fresh side chat").waitFor();
      await h.pause(600);
      h.mark("start");
      await h.caption("It can use a real browser…");
      await h.type("Use the browser to open books.toscrape.com and tell me the first book and its price.");
      await page.getByTestId("send").click();
      await h.work(() => page.getByTestId("browser-part").last().waitFor({ timeout: 120000 }));
      await h.caption("…live in the chat. Watch, take control or stop it.");
      await page
        .getByTestId("browser-part")
        .last()
        .evaluate((el) => el.scrollIntoView({ block: "center" }));
      await h.pause(3400);
      await h.work(() => h.waitIdle());
      await h.caption("Then it reports back");
      await page
        .locator('[data-testid="msg-assistant"]')
        .last()
        .evaluate((el) => el.scrollIntoView({ block: "end" }))
        .catch(() => {});
      await h.pause(2800);
      h.mark("end");
    },
  },
};

for (const [id, g] of Object.entries(GIFS)) {
  if (ONLY.size && !ONLY.has(id)) continue;
  const ctx = await browser.newContext({ viewport: VIEW, recordVideo: { dir: path.join(OUT, "raw"), size: VIEW } });
  if (g.voiceTurns) {
    const turns = await Promise.all(g.voiceTurns.map((f) => fs.readFile(path.join(import.meta.dirname, "fixtures", f), "base64")));
    await ctx.addInitScript((turns) => {
      navigator.mediaDevices.getUserMedia = async () => {
        const ac = new AudioContext();
        await ac.resume();
        const dest = ac.createMediaStreamDestination();
        // The take sets window.__voiceTurn before each listening turn.
        const b64 = turns[window.__voiceTurn ?? 0];
        if (b64) {
          const src = ac.createBufferSource();
          src.buffer = await ac.decodeAudioData(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer);
          src.connect(dest);
          src.start();
        }
        return dest.stream;
      };
    }, turns);
  }
  const page = await ctx.newPage();
  const t0 = Date.now();
  page.setDefaultTimeout(60000);
  const marks = [];
  const h = helpers(page, t0, marks);
  let ok = true,
    err = null;
  try {
    await page.goto(BASE + "/");
    await g.run(page, h);
    await h.caption("");
  } catch (e) {
    ok = false;
    err = String(e?.message ?? e).slice(0, 300);
    await page.screenshot({ path: path.join(OUT, id + "-fail.png") }).catch(() => {});
  }
  const v = await page.video().path();
  await ctx.close();
  await fs.rename(v, path.join(OUT, id + ".webm"));
  await fs.writeFile(path.join(OUT, id + ".json"), JSON.stringify({ id, title: g.title, ok, err, marks }));
  console.log(ok ? "OK" : "FAIL", id, g.title, err ?? "", JSON.stringify(marks));
}
await browser.close();
