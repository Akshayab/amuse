import { describe, expect, it, vi } from "vitest";
import { BrowserStepDenied, requireClickApproval, displayFieldState, plainNavigation, purchaseClick, type FieldState } from "../src/agent/tools/browser";
import {
  destinationIsTrusted,
  grantMatches,
  hasUntrustedRead,
  markUntrustedRead,
  userNamedHosts,
  userNamedUrls,
  type ProposedAction,
} from "../src/agent/sentinel";
import { persistenceNeedsApproval } from "../src/agent/tools/internal";

const field: FieldState = { tag: "input", type: "text", name: "customer", autocomplete: "", value: "Sam", checked: false, selected: "" };

describe("click approval denials", () => {
  it("stops after a denied navigation without evaluating payment approval or clicking", () => {
    const paymentApproval = vi.fn();
    const click = vi.fn();
    const step = () => {
      requireClickApproval("deny", "Pay", "checkout.example");
      paymentApproval();
      click();
    };
    expect(step).toThrow(BrowserStepDenied);
    expect(step).toThrow(/user denied.*click "Pay".*checkout.example/);
    expect(paymentApproval).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it("allows navigation to proceed but stops when the subsequent purchase is denied", () => {
    const click = vi.fn();
    expect(() => {
      requireClickApproval("allow", "Pay", "checkout.example");
      requireClickApproval("deny", "Pay", "checkout.example");
      click();
    }).toThrow(BrowserStepDenied);
    expect(click).not.toHaveBeenCalled();
    expect(() => requireClickApproval("allow", "Help", "example.com")).not.toThrow();
  });
});

describe("form observations and action feedback", () => {
  it("shows text and textarea values, so completed fields remain visible", () => {
    expect(displayFieldState(field)).toBe(' value="Sam"');
    expect(displayFieldState({ ...field, tag: "textarea", value: "Cheese only" })).toContain("Cheese only");
    expect(displayFieldState({ ...field, value: "" })).toBe(' value=""');
  });
  it("masks nonempty password and credential fields", () => {
    for (const state of [{ type: "password" }, { name: "api_key" }, { autocomplete: "current-password" }]) {
      const result = displayFieldState({ ...field, ...state });
      expect(result).toContain("••••");
      expect(result).not.toContain("Sam");
    }
    expect(displayFieldState({ ...field, type: "password", value: "" })).toBe(' value=""');
  });
  it("distinguishes pizza options and exposes changed radio/checkbox state and selection", () => {
    expect(displayFieldState({ ...field, type: "radio", value: "small", checked: true })).toBe(' value="small" checked=true');
    expect(displayFieldState({ ...field, type: "checkbox", value: "cheese" })).toBe(' value="cheese" checked=false');
    expect(displayFieldState({ ...field, tag: "select", selected: "Small" })).toBe(' selected="Small"');
  });
});

describe("payment checks independent of form submission", () => {
  it("requires purchase approval for any non-navigation click on a payment page", () => {
    for (const href of ["", "#confirm", "javascript:pay()", "https://shop.example/checkout#confirm"]) {
      expect(purchaseClick(true, "Continue", href, false)).toBe(true);
    }
    for (const label of ["Complete order", "Pay", "Purchase", "Donate", "Subscribe"]) expect(purchaseClick(false, label, "", false)).toBe(true);
    expect(purchaseClick(false, "Small", "", false)).toBe(false);
  });
  it("only exempts plain links to another page, not javascript or same-page actions", () => {
    const current = "https://shop.example/checkout";
    expect(plainNavigation("https://shop.example/help", current, "", "")).toBe(true);
    expect(plainNavigation(current + "#payment", current, "", "")).toBe(false);
    expect(plainNavigation("javascript:pay()", current, "", "")).toBe(false);
    expect(plainNavigation("https://shop.example/help", current, "pay()", "")).toBe(false);
    expect(plainNavigation("https://shop.example/help", current, "", "button")).toBe(false);
    expect(purchaseClick(true, "Help", "https://shop.example/help", true)).toBe(false);
    expect(purchaseClick(true, "Pay now", "https://shop.example/confirm", true)).toBe(true);
    expect(plainNavigation("https://shop.example/checkout?pay=1", current, "", "")).toBe(false);
  });
});

describe("agent-composed outbound destination trust", () => {
  it("uses all user messages, including bare domains, but never broadens to subdomains", () => {
    const messages = ["Please visit books.toscrape.com", "Now search for fiction"];
    expect(userNamedHosts(messages).has("books.toscrape.com")).toBe(true);
    for (const kind of ["visit", "type", "api"] as const) expect(destinationIsTrusted("https://books.toscrape.com/", kind, messages, [])).toBe(true);
    expect(destinationIsTrusted("https://other.books.toscrape.com/", "visit", messages, [])).toBe(false);
  });
  it("trusts only the exact cited URL, not a composed query on its host", () => {
    const citations = ["https://example.com/article"];
    expect(destinationIsTrusted(citations[0]!, "visit", [], citations)).toBe(true);
    expect(destinationIsTrusted("https://example.com/article?private=data", "visit", [], citations)).toBe(false);
    expect(destinationIsTrusted("https://example.com/other", "visit", [], citations)).toBe(false);
    expect(destinationIsTrusted("https://unknown.example/?q=x", "visit", [], [])).toBe(false);
  });
  it("extracts literal user URLs and restricts configured-host exceptions to API requests", () => {
    expect(userNamedUrls(["Open https://example.com/article."])).toContain("https://example.com/article");
    expect(destinationIsTrusted("https://api.example/data", "api", [], [], ["api.example"])).toBe(true);
    expect(destinationIsTrusted("https://api.example/data", "type", [], [], ["api.example"])).toBe(false);
    expect(destinationIsTrusted("https://sub.api.example/data", "api", [], [], ["api.example"])).toBe(false);
  });
  it("task host trust lasts only this run and never covers purchases", () => {
    const action: ProposedAction = {
      userId: "test",
      runId: 10,
      chatId: 1,
      toolName: "browser",
      actionClass: "web",
      target: "example.com",
      purpose: "Visit a page",
    };
    const grant = { runId: 10, target: "example.com", scope: "task", toolName: "outbound_destination", actionClass: "web" };
    expect(grantMatches(action, grant)).toBe(true);
    expect(grantMatches({ ...action, runId: 11 }, grant)).toBe(false);
    expect(grantMatches({ ...action, target: "other.example" }, grant)).toBe(false);
    expect(grantMatches({ ...action, actionClass: "purchase" }, grant)).toBe(false);
    expect(grantMatches({ ...action, actionClass: "purchase" }, { ...grant, actionClass: "purchase", scope: "site" })).toBe(false);
  });
});

describe("untrusted reads and persistent instructions", () => {
  it("tracks untrusted reads independently per run", () => {
    expect(hasUntrustedRead(980001)).toBe(false);
    markUntrustedRead(980001);
    expect(hasUntrustedRead(980001)).toBe(true);
    expect(hasUntrustedRead(980002)).toBe(false);
  });
  it("allows directly stated facts but asks after untrusted reads", () => {
    for (const tool of ["memory_save", "memory_forget", "ideas_add"]) {
      expect(persistenceNeedsApproval(false, tool)).toBe(false);
      expect(persistenceNeedsApproval(true, tool)).toBe(true);
    }
    for (const tool of ["write_file", "delete_file"])
      for (const path of ["USER.md", "MEMORY.md", "memory/today.md"]) {
        expect(persistenceNeedsApproval(true, tool, path)).toBe(true);
        expect(persistenceNeedsApproval(false, tool, path)).toBe(false);
      }
    expect(persistenceNeedsApproval(true, "write_file", "files/notes.md")).toBe(false);
  });
  it("keeps data-only space refreshes allowed, but asks before changing HTML after an untrusted read", () => {
    expect(persistenceNeedsApproval(true, "space_update", "", false)).toBe(false);
    expect(persistenceNeedsApproval(true, "space_update", "", true)).toBe(true);
    expect(persistenceNeedsApproval(false, "space_update", "", true)).toBe(false);
  });
});
