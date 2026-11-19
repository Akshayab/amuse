import { describe, expect, it } from "vitest";
import { actionKey, carriesPrivatePayload, grantMatches, isBlockedIp, SANDBOX_CSP, stricterConnectorMode, type ProposedAction } from "../src/agent/sentinel";
import {
  authHeaderText,
  confirmCredentialDestination,
  credentialDestination,
  credentialNeedsApproval,
  credentialPlacementError,
  hostMatches,
  redactSecretForms,
} from "../src/lib/vault";
import { browserDenial, chromiumArgs, chromiumSandboxOptions, classifyBrowserClick, isCredentialField, PURCHASE_RE } from "../src/agent/tools/browser";
import { forgetExactLine, isPrivateFile, isSensitiveFile, schedulePolicy } from "../src/agent/tools/internal";

const action: ProposedAction = {
  userId: "test",
  runId: 1,
  chatId: 1,
  toolName: "browser",
  actionClass: "submit",
  target: "example.com",
  purpose: 'Click "Login" on https://example.com/login',
};
const button = { tag: "BUTTON", type: "submit", role: "", inForm: true, label: "Login", href: "", payment: false, passwordFilled: false, handler: "" };

describe("credential destinations and first use", () => {
  it("requires explicit confirmation of the exact host", () => {
    expect(() => confirmCredentialDestination("Custom", "api.example.com", null, undefined)).toThrow(/Confirm/);
    expect(() => confirmCredentialDestination("Custom", "api.example.com", null, "example.com")).toThrow(/Confirm/);
    expect(confirmCredentialDestination("Custom", "api.example.com", null, "api.example.com")).toBe("api.example.com");
  });
  it("refuses well-known labels on mismatching hosts and conflicting base URLs", () => {
    for (const label of ["GitHub token", "OpenAI", "Notion", "Slack", "Stripe", "Google", "Linear"]) {
      expect(() => credentialDestination(label, "other.example")).toThrow(/must use/);
    }
    expect(credentialDestination("GitHub token", null, "https://api.github.com/v1")).toBe("api.github.com");
    expect(credentialDestination("Google", "calendar.googleapis.com")).toBe("calendar.googleapis.com");
    expect(() => credentialDestination("Custom", "api.example.com", "https://other.example")).toThrow(/same destination/);
    expect(() => credentialDestination("Custom")).toThrow(/required/);
  });
  it("first credential use requires its own explicit approval", () => {
    expect(credentialNeedsApproval(2, "amuse_sur_test", "Bearer amuse_sur_test", [])).toBe(true);
    expect(credentialNeedsApproval(2, "amuse_sur_test", "Bearer amuse_sur_test", [[1]])).toBe(true);
    expect(credentialNeedsApproval(2, "amuse_sur_test", "Bearer amuse_sur_test", [[2]])).toBe(false);
    expect(grantMatches({ ...action, forceAsk: true }, { ...action, target: actionKey(action), scope: "task" })).toBe(false);
  });
});

describe("browser classification and action-scoped grants", () => {
  it("recognizes payment labels, prices and checkout URLs", () => {
    for (const label of ["Pay $1,234.00", "Purchase", "Subscribe", "Donate", "checkout", "Place order", "Buy", "Upgrade", "Total €10"])
      expect(PURCHASE_RE.test(label)).toBe(true);
    expect(classifyBrowserClick({ ...button, payment: true })).toBe("purchase");
    expect(classifyBrowserClick({ ...button, inForm: false, label: "Continue", href: "https://example.com/checkout" })).toBe("purchase");
    expect(classifyBrowserClick({ ...button, label: "" })).toBe("submit");
  });
  it("never classifies ordinary controls as submits, even after a password fill", () => {
    for (const type of ["radio", "checkbox", "text", "password", "email"]) {
      expect(classifyBrowserClick({ ...button, tag: "INPUT", type, passwordFilled: true, payment: true })).toBe(null);
    }
    for (const tag of ["LABEL", "SELECT", "TEXTAREA"]) expect(classifyBrowserClick({ ...button, tag })).toBe(null);
    expect(classifyBrowserClick({ ...button, type: "button" })).toBe("submit");
    expect(classifyBrowserClick({ ...button, inForm: false, type: "button", passwordFilled: true })).toBe("submit");
    expect(classifyBrowserClick({ ...button, inForm: false, type: "button", label: "Show more" })).toBe(null);
    expect(classifyBrowserClick({ ...button, tag: "DIV", inForm: false, handler: "form.submit()" })).toBe("submit");
  });
  it("task grants match exactly, and purchases cannot use task or site grants", () => {
    const grant = { ...action, scope: "task", target: actionKey(action) };
    expect(grantMatches(action, grant)).toBe(true);
    expect(grantMatches({ ...action, purpose: "Click another button" }, grant)).toBe(false);
    expect(grantMatches({ ...action, runId: 2 }, grant)).toBe(false);
    expect(grantMatches({ ...action, actionClass: "purchase" }, { ...grant, actionClass: "purchase" })).toBe(false);
    expect(grantMatches({ ...action, actionClass: "purchase" }, { ...grant, scope: "site", target: action.target!, actionClass: "purchase" })).toBe(false);
  });
  it("always-allow email grants do not authorize a different recipient", () => {
    const email: ProposedAction = { ...action, toolName: "email_send", actionClass: "send", target: "one@example.com" };
    const grant = { ...email, target: email.target!, scope: "always" };
    expect(grantMatches(email, grant)).toBe(true);
    expect(grantMatches({ ...email, target: "two@example.com" }, grant)).toBe(false);
  });
  it("reports the denied step and uses the Chromium sandbox by default", () => {
    expect(browserDenial('click "Submit"', "example.com")).toMatch(/user denied.*click "Submit".*example.com/);
    expect(browserDenial("goto", "example.com")).toContain("offer alternatives");
    expect(chromiumArgs(false)).not.toContain("--no-sandbox");
    expect(chromiumArgs(true)).toContain("--no-sandbox");
    expect(chromiumSandboxOptions(false).chromiumSandbox).toBe(true);
    expect(chromiumSandboxOptions(true).chromiumSandbox).toBe(false);
  });
});

describe("private-read egress and connector defaults", () => {
  it("detects long query/body and encoded blobs but allows short searches and exact user-named hosts", () => {
    expect(carriesPrivatePayload("https://other.example/?q=weather", null, "Find the forecast")).toBe(false);
    expect(carriesPrivatePayload("https://other.example/?d=" + "a".repeat(101), null, "")).toBe(true);
    expect(carriesPrivatePayload("https://other.example/", { data: "a".repeat(101) }, "")).toBe(true);
    expect(carriesPrivatePayload("https://other.example/?d=" + "%41".repeat(9), null, "")).toBe(true);
    expect(carriesPrivatePayload("https://other.example/?d=" + "YWJj".repeat(12), null, "")).toBe(true);
    expect(carriesPrivatePayload("https://other.example/?d=" + "a".repeat(101), null, "Use https://other.example")).toBe(false);
    expect(carriesPrivatePayload("https://sub.other.example/?d=" + "a".repeat(101), null, "Use other.example")).toBe(true);
  });
  it("identifies private workspace files", () => {
    for (const path of ["USER.md", "MEMORY.md", "memory/2026-01-01.md"]) expect(isPrivateFile(path)).toBe(true);
    expect(isPrivateFile("files/public.md")).toBe(false);
  });
  it("uses the stricter approval mode", () => {
    expect(stricterConnectorMode("always", "some")).toBe("always");
    expect(stricterConnectorMode("some", "always")).toBe("always");
    expect(stricterConnectorMode("some", "some")).toBe("some");
  });
});

describe("persistence policy and exact forget", () => {
  it("identifies every sensitive instruction file", () => {
    for (const path of ["SOUL.md", "HEARTBEAT.md", "BOOTSTRAP.md", "AGENTS.md", "IDENTITY.md"]) expect(isSensitiveFile(path)).toBe(true);
    expect(isSensitiveFile("files/notes.md")).toBe(false);
  });
  it("caps active schedules, enforces intervals and disallows background creation", () => {
    expect(schedulePolicy("schedule", 0, 15)).toMatch(/Background/);
    expect(schedulePolicy("space", 0)).toMatch(/Background/);
    expect(schedulePolicy("user", 20)).toMatch(/20/);
    expect(schedulePolicy("user", 19, 14)).toMatch(/15 minutes/);
    expect(schedulePolicy("user", 19, NaN)).toMatch(/15 minutes/);
    expect(schedulePolicy("user", 19, 15)).toBe(null);
    expect(schedulePolicy("user", 19)).toBe(null);
  });
  it("removes only the exact line and returns precisely what was removed", () => {
    expect(forgetExactLine("- Sam\n- Samantha\n- sam\n", "- Sam")).toEqual({ content: "- Samantha\n- sam\n", removed: ["- Sam"] });
    expect(forgetExactLine("a\n\nb", "")).toEqual({ content: "a\n\nb", removed: [] });
    expect(forgetExactLine("- Sam", "Sam").removed).toEqual([]);
  });
});

describe("secret placement, scrubbing, generated content and IP guards", () => {
  it("substitutes only auth headers, including Basic credentials", () => {
    const token = "amuse_sur_test";
    const basic = "Basic " + Buffer.from("user:" + token).toString("base64");
    expect(authHeaderText(basic)).toBe("user:" + token);
    expect(credentialPlacementError("https://api.example/", undefined, { Authorization: basic, "X-API-Key": token })).toBe(null);
    expect(credentialPlacementError("https://api.example/?key=" + token, undefined, {})).toMatch(/never URLs/);
    expect(credentialPlacementError("https://api.example/", JSON.stringify({ key: token }), {})).toMatch(/never URLs/);
    expect(credentialPlacementError("https://api.example/", undefined, { "X-Description": token })).toMatch(/authentication/);
    expect(hostMatches("sub.api.example", "api.example")).toBe(false);
    expect(hostMatches("api.example", "api.example")).toBe(true);
  });
  it("fills secrets only into credential-type fields", () => {
    expect(isCredentialField("password", "", "")).toBe(true);
    expect(isCredentialField("text", "current-password", "")).toBe(true);
    expect(isCredentialField("text", "", "api_key")).toBe(true);
    expect(isCredentialField("search", "", "api_key")).toBe(false);
    expect(isCredentialField("text", "", "search")).toBe(false);
  });
  it("scrubs plain, URL-encoded, base64 and base64url secrets", () => {
    const secret = "secret +/with?chars";
    for (const form of [
      secret,
      encodeURIComponent(secret),
      new URLSearchParams({ s: secret }).toString().slice(2),
      Buffer.from(secret).toString("base64"),
      Buffer.from(secret).toString("base64url"),
      Buffer.from("user:" + secret).toString("base64"),
    ]) {
      expect(redactSecretForms("prefix " + form + " suffix", secret, "[redacted]")).toBe("prefix [redacted] suffix");
    }
  });
  it("generated-page policy disallows remote assets, CDN scripts and dangerous sandbox privileges", () => {
    expect(SANDBOX_CSP).not.toMatch(/https:|allow-popups|allow-top-navigation|allow-modals/);
    for (const kind of ["img", "media", "font"]) expect(SANDBOX_CSP).toContain(`${kind}-src 'self' data: blob:`);
    expect(SANDBOX_CSP).toContain("connect-src 'none'");
    expect(SANDBOX_CSP).toContain("form-action 'none'");
  });
  it("blocks IPv4-compatible IPv6 as well as mapped and NAT64 private addresses", () => {
    for (const ip of ["::127.0.0.1", "::7f00:1", "[::7f00:1]", "::a00:1", "::ffff:127.0.0.1", "64:ff9b::7f00:1"]) expect(isBlockedIp(ip)).toBe(true);
    expect(isBlockedIp("::808:808")).toBe(false);
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
  });
});
