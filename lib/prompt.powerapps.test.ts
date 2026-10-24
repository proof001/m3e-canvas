import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import mapping from "./powerapps-mapping.json";
import { buildPrompt } from "./prompt";
import { assertMappingCoversKinds, buildPowerAppsPrompt } from "./prompt-powerapps";
import { setGlobalLang } from "./i18n";
import { KIND_ORDER, makeItem, type Doc } from "./tokens";

const GOLDEN_SHA = "9655fb322113ea66885e9f0324bc0c83f5f9410a2f0eeb4ed27935291948279a";

function goldenDoc(): Doc {
  return {
    groups: [{ id: "g", x: 16, y: 100, axis: "x", items: [{ ...makeItem("button"), id: "b", label: "Go" }] }],
    frames: [{ id: "f", name: "Home", x: 0, y: 0 }],
    paletteKey: "purple",
    frame: "phone",
    title: "T",
    brief: "",
  };
}

function contactFormDoc(): Doc {
  return {
    title: "Contact form",
    brief: "A one-screen contact form that sends a message and confirms it.",
    paletteKey: "purple",
    frame: "phone",
    promptMode: "powerapps",
    frames: [
      { id: "contact", name: "Contact", x: 0, y: 0 },
      { id: "thanks", name: "Thanks", x: 500, y: 0 },
    ],
    groups: [
      { id: "bar", x: 16, y: 24, axis: "x", items: [{ ...makeItem("topAppBar"), id: "tb", label: "Contact us", icon: "arrow_back", action: { to: "home", transition: "fade" } }] },
      {
        id: "form",
        x: 16,
        y: 120,
        axis: "y",
        items: [
          { ...makeItem("textField"), id: "name", label: "Full name", variant: "filled" },
          { ...makeItem("textField"), id: "email", label: "Email", variant: "outlined", supporting: "We'll reply within 2 days" },
          { ...makeItem("select"), id: "topic", label: "Topic" },
          { ...makeItem("checkbox"), id: "agree", label: "I agree to be contacted", checked: false },
          { ...makeItem("button"), id: "send", label: "Send", variant: "filled", action: { to: "thanks", transition: "fade" } },
          { ...makeItem("snackbar"), id: "snack", label: "Message sent" },
        ],
      },
    ],
  };
}

describe("buildPrompt normal mode unchanged", () => {
  it("matches the pre–Power App mode hash for a fixed fixture", () => {
    setGlobalLang("en");
    const doc = goldenDoc();
    const out = buildPrompt(doc, {}, undefined, "en");
    expect(createHash("sha256").update(out).digest("hex")).toBe(GOLDEN_SHA);
  });

  it("treats undefined and explicit normal the same", () => {
    setGlobalLang("en");
    const base = goldenDoc();
    const a = buildPrompt(base, {}, undefined, "en");
    const b = buildPrompt({ ...base, promptMode: "normal" }, {}, undefined, "en");
    expect(b).toBe(a);
  });

  it("does not change output when promptMode is omitted vs normal", () => {
    setGlobalLang("en");
    const doc = goldenDoc();
    expect(buildPrompt({ ...doc, promptMode: undefined }, {}, undefined, "en")).toBe(buildPrompt(doc, {}, undefined, "en"));
  });
});

describe("powerapps-mapping.json", () => {
  it("validates against the expected schema", () => {
    expect(typeof mapping.checkedOn).toBe("string");
    expect(mapping.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(mapping.components)).toBe(true);
    for (const c of mapping.components) {
      expect(typeof c.m3Component).toBe("string");
      expect(typeof c.paControl).toBe("string");
      expect(typeof c.status).toBe("string");
      expect(c.keyProperties).toBeTruthy();
      expect(typeof c.keyProperties).toBe("object");
      for (const v of Object.values(c.keyProperties)) expect(typeof v).toBe("string");
    }
    for (const key of ["powerFx", "canvasYaml", "delegation", "naming"] as const) {
      expect(Array.isArray(mapping.sections[key]?.rules)).toBe(true);
      for (const r of mapping.sections[key].rules) {
        expect(typeof r.rule).toBe("string");
        expect(r.docUrl).toMatch(/^https:\/\//);
      }
    }
  });

  it("covers every Kind in KIND_ORDER", () => {
    assertMappingCoversKinds();
    const mapped = new Set(mapping.components.map((c) => c.m3Component));
    for (const kind of KIND_ORDER) expect(mapped.has(kind)).toBe(true);
  });
});

describe("buildPowerAppsPrompt", () => {
  it("includes mapped control names for a sample form sketch", () => {
    setGlobalLang("en");
    const out = buildPowerAppsPrompt(contactFormDoc(), {}, undefined, "en");
    expect(out).toContain("ModernTextInput");
    expect(out).toContain("ModernButton");
    expect(out).toContain("ModernDropdown");
    expect(out).toContain("Checkbox (modern)");
    expect(out).toContain("Notify()");
    expect(out).toContain("ContactScreen");
    expect(out).toContain("## Sources (checked 2026-10-24)");
  });

  it("describes form controls by kind, not as a connected button group", () => {
    setGlobalLang("en");
    const out = buildPowerAppsPrompt(contactFormDoc(), {}, undefined, "en");
    expect(out).toContain("text field");
    expect(out).toContain("checkbox");
    expect(out).not.toContain("connected button group");
    expect(out).toMatch(/dropdown|Topic/i);
  });

  it("does not emit escaped backticks in the deliverable section", () => {
    setGlobalLang("en");
    const out = buildPowerAppsPrompt(contactFormDoc(), {}, undefined, "en");
    expect(out).not.toMatch(/\\`/);
    expect(out).toContain("under the `Component` source folder");
  });

  it("routes through buildPrompt when promptMode is powerapps", () => {
    setGlobalLang("en");
    const doc = contactFormDoc();
    expect(buildPrompt(doc, {}, undefined, "en")).toBe(buildPowerAppsPrompt(doc, {}, undefined, "en"));
  });
});
