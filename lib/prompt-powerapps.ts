import mapping from "./powerapps-mapping.json";
import { Lang, getLang } from "./i18n";
import { constrainModalRails } from "./rail";
import {
  notes,
  paletteLines,
  promptGroupsForScroll,
  promptItemText,
  promptOptionsOf,
  PROMPT_OPTION_TEXT,
  PROMPT_OPTIONS,
  swipeNotes,
} from "./prompt";
import {
  Doc,
  FONTS,
  Frame,
  Group,
  Item,
  Kind,
  KIND_ORDER,
  Platform,
  explodeGroup,
  frameOfGroup,
  frameSizeOf,
  isPhoneFrame,
  normalizeTheme,
  paletteOf,
  scrollsOf,
} from "./tokens";

const hasText = (s?: string | null) => !!s && s.trim().length > 0;
const trimEnd = (s: string) => s.trim().replace(/[。.\s]+$/, "");

type MappingComponent = {
  m3Component: string;
  paControl: string;
  status: string;
  statusConfirmed?: boolean;
  yamlNameConfirmed?: boolean;
  composite?: boolean;
  keyProperties: Record<string, string>;
  notes?: string;
  docUrl?: string;
  extraDocUrls?: string[];
};

type MappingFile = {
  checkedOn: string;
  reviewedBy?: string;
  sections: Record<string, { rules: { rule: string; docUrl: string }[] }>;
  components: MappingComponent[];
};

const MAP = mapping as unknown as MappingFile;
const BY_KIND = new Map<string, MappingComponent>(MAP.components.map((c) => [c.m3Component, c]));

const SYNTAX_RULES = `## Syntax rules (pa.yaml + Power Fx)
- Control instance: \`- ctlName:\` → \`Control: TypeId\` with optional \`@version\`, optional \`Variant:\`, \`Properties:\`, \`Children:\`. Children order = layout order. Omit \`@version\` unless copied from Studio or describe_control; when present, all instances of that type must match.
- Every property value is a formula that starts with \`=\`: \`Text: ="Save"\`, \`Width: =Parent.Width\`, \`Visible: =true\`.
- \`:\` or \`#\` anywhere in a single-line formula breaks YAML (PA1001). Use a \`|-\` block scalar with \`=\` on the first content line — single-quote wrapping is not the supported fix. Record defaults use blocks, e.g.:
  DefaultSelectedItems: |-
    ={Value: "All"}
- ValidationState is an enum: \`If(condition, ValidationState.Error, ValidationState.None)\` — never the strings "Error" or "None".`;

const DELIVERABLE = `## Deliverable
Write Power Apps source code as \`*.pa.yaml\` (the current source-code format; fx.yaml is retired):
- \`App.pa.yaml\` (App: Properties: StartScreen, Formulas — pa.yaml v3.0 has no Theme key at the app root)
- one \`<ScreenName>.pa.yaml\` per screen, each with top-level \`Screens:\`. In a new blank app, write the first screen into the existing \`Screen1.pa.yaml\`
- \`_EditorState.pa.yaml\` with ScreensOrder
- Reusable components under the \\\`Component\\\` source folder when needed
- A separate **Themes YAML** block (Font, BasePaletteColor, HueTorsion and Vibrancy required; ColorOverrides optional), applied in Studio via **Themes > Paste theme**
In Studio code view, paste **one control subtree at a time**, not an entire Screens file.
If you have the Power Apps canvas authoring MCP server (canvas-apps plugin), run \`list_controls\`/\`describe_control\` for every control type you use, copy its \`Control:\`, \`Variant\` and enum names exactly, and validate with it before you finish. Never guess a property or enum name.`;

function screenKey(name: string): string {
  const words = name
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const base = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
  return `${base || "Screen"}Screen`;
}

function viewportDims(frames: Frame[], phone: boolean): { w: number; h: number; label: string } {
  if (!phone || frames.length === 0) return { w: 1280, h: 800, label: "desktop" };
  const f = frames[0];
  const { w, h } = frameSizeOf(f);
  return { w, h, label: isPhoneFrame(f) ? "phone" : "desktop" };
}

function statusTag(c: MappingComponent): string {
  const tag = c.status === "preview" ? "preview" : c.status;
  const parts = [tag];
  if (c.composite) parts.push("composite");
  if (c.yamlNameConfirmed === false) parts.push("YAML name unconfirmed");
  if (c.statusConfirmed === false) parts.push("status inferred");
  return parts.join(", ");
}

function keyPropsLine(c: MappingComponent): string {
  return Object.entries(c.keyProperties)
    .map(([m3, pa]) => `${m3} → ${pa}`)
    .join("; ");
}

function mappingLine(kind: Kind): string {
  const c = BY_KIND.get(kind);
  if (!c) return `- ${kind} → (no mapping entry; check describe_control)`;
  const note = c.notes ? ` ${c.notes}` : "";
  return `- ${c.m3Component} → ${c.paControl} [${statusTag(c)}]: ${keyPropsLine(c)}.${note}`;
}

function itemLinePa(it: Item, lang: Lang): string {
  const c = BY_KIND.get(it.kind);
  return `${promptItemText(it, lang)}${c ? ` → ${c.paControl}` : ""}`;
}

/** Power Apps prompts list each control by kind; avoid Android-style "connected button group" for vertical form stacks. */
function describePowerAppsScreen(lines: string[], groups: Group[], lang: Lang) {
  if (!groups.length) return;
  const rails = groups.filter((g) => g.items.length === 1 && g.items[0].kind === "navRail");
  for (const g of rails) lines.push(`- ${itemLinePa(g.items[0], lang)}`);
  const rest = rails.length ? groups.filter((g) => !rails.includes(g)) : groups;
  const ordered = [...rest].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const g of ordered) {
    if (g.items.length === 1) {
      lines.push(`- ${itemLinePa(g.items[0], lang)}`);
      continue;
    }
    const kinds = new Set(g.items.map((it) => it.kind));
    const dir = g.axis === "y" ? "Vertical stack" : "Row";
    lines.push(`- ${dir} (${g.items.length} controls${kinds.size > 1 ? ", mixed kinds" : ""}):`);
    for (const it of g.items) lines.push(`  - ${itemLinePa(it, lang)}`);
  }
}

function collectKinds(groups: Group[]): Kind[] {
  const kinds: Kind[] = [];
  for (const g of groups)
    for (const it of g.items) if (!kinds.includes(it.kind)) kinds.push(it.kind);
  return kinds;
}

function sectionRules(keys: (keyof MappingFile["sections"])[]): string[] {
  const out: string[] = [];
  for (const key of keys) {
    const block = MAP.sections[key];
    if (!block) continue;
    for (const { rule } of block.rules) out.push(`- ${rule}`);
  }
  return out;
}

function sourceUrls(kinds: Kind[]): string[] {
  const urls = new Set<string>();
  for (const key of Object.keys(MAP.sections) as (keyof MappingFile["sections"])[]) {
    for (const { docUrl } of MAP.sections[key].rules) urls.add(docUrl);
  }
  for (const kind of kinds) {
    const c = BY_KIND.get(kind);
    if (!c) continue;
    if (c.docUrl) urls.add(c.docUrl);
    for (const u of c.extraDocUrls ?? []) urls.add(u);
  }
  return [...urls].sort();
}

const PA_TESTS_LINE =
  "Finish with a manual test checklist (each control, each navigation, delegation check, phone and desktop widths).";

export function buildPowerAppsPrompt(doc: Doc, widths: Record<string, number>, onlyFrameId?: string, lang: Lang = getLang()): string {
  doc = { ...doc, groups: constrainModalRails(doc.groups) };
  const th = normalizeTheme(doc.theme);
  const pal = paletteOf(doc.paletteKey, doc.customPalette, th);
  const phone = doc.frame === "phone";
  const allFrames = phone ? doc.frames : [];
  const only = onlyFrameId ? allFrames.find((f) => f.id === onlyFrameId) : undefined;
  const frames = only ? [only] : allFrames;
  const viewport = viewportDims(frames.length ? frames : allFrames, phone);

  const groups = doc.groups
    .filter((g) => !only || frameOfGroup(g, allFrames, widths)?.id === only.id)
    .flatMap((g) => explodeGroup(g, widths));

  const kindsUsed = collectKinds(groups);
  const title = doc.title.trim() || (only ? only.name || "Screen" : frames.length > 1 ? "App" : frames[0]?.name || "App");
  const brief = doc.brief.trim();
  const fontEntry = FONTS.find((f) => f.key === th.font) ?? FONTS[0];

  const lines: string[] = [];
  lines.push(`Build a Microsoft Power Apps **canvas app** called "${title}".`);
  if (brief) lines.push(brief);
  lines.push("");
  lines.push(DELIVERABLE);
  lines.push("");
  lines.push(SYNTAX_RULES);
  lines.push("");
  lines.push("## Theme");
  lines.push(
    "Turn on modern controls and themes. Paste a Themes YAML block in Studio (Themes > Paste theme) — not inside App.pa.yaml:",
    `  Font: ${fontEntry.family}`,
    `  BasePaletteColor: '${pal.primary}'`,
    "  HueTorsion: 0",
    "  Vibrancy: 0",
    "  (ColorOverrides optional)",
    "Use `App.Theme.Colors.<slot>` and `App.Theme.Font` on controls. Don't hard-code RGBA or hex on controls.",
    "Approximate the sketch palette (M3 roles) with the theme: primary → BasePaletteColor; surface → screen Fill; error → ValidationState.Error / NotificationType.Error.",
  );
  lines.push("Sketch palette (M3 roles for approximation):");
  lines.push(...paletteLines(pal));
  lines.push("");
  lines.push("## Layout (responsive)");
  lines.push(...sectionRules(["containersAndResponsive", "modernTheming"]));
  lines.push(`- Design viewport from the sketch: ${viewport.w}×${viewport.h} (${viewport.label}). It must also work on phone and desktop.`);
  lines.push("");
  lines.push("## Screens (from the sketch)");

  const byFrame = new Map<string, Group[]>();
  const loose: Group[] = [];
  for (const g of groups) {
    const f = frameOfGroup(g, allFrames, widths);
    if (f && frames.some((x) => x.id === f.id)) byFrame.set(f.id, [...(byFrame.get(f.id) ?? []), g]);
    else if (!f) loose.push(g);
  }

  if (frames.length === 0 && groups.length > 0) {
    const screenLines: string[] = [];
    describePowerAppsScreen(screenLines, promptGroupsForScroll(groups, false), lang);
    lines.push("### Freeform layout");
    lines.push(...screenLines);
  } else {
    for (const f of frames) {
      const gs = byFrame.get(f.id) ?? [];
      const key = screenKey(f.name || "Screen");
      lines.push("");
      lines.push(`### ${f.name || "Screen"}  (YAML key \`${key}\`)`);
      if (hasText(f.note)) lines.push(trimEnd(f.note!) + ".");
      const screenLines: string[] = [];
      if (gs.length > 0) describePowerAppsScreen(screenLines, promptGroupsForScroll(gs, scrollsOf(f)), lang);
      if (screenLines.length) lines.push(...screenLines);
      else lines.push("- (empty screen — add a root GroupContainer and controls)");
      const nav = [...gs.flatMap((g) => notes(g, allFrames, lang)), ...swipeNotes(f, allFrames, lang)];
      if (nav.length) {
        lines.push("Navigation:");
        for (const n of nav) lines.push(`- ${n}`);
      }
    }
    if (loose.length && !only) {
      lines.push("");
      lines.push("### Components outside a frame");
      const screenLines: string[] = [];
      describePowerAppsScreen(screenLines, promptGroupsForScroll(loose, false), lang);
      lines.push(...screenLines);
    }
  }

  lines.push("");
  lines.push("## Control mapping for this sketch");
  for (const kind of kindsUsed) lines.push(mappingLine(kind));
  lines.push(
    "Prefer modern (Fluent) controls. Use a classic control (Gallery, Image, Camera, Rectangle) only where no modern one exists. Build M3 patterns with no equivalent (FAB, chips, bottom nav, sheets, split button, top app bar) from GroupContainer + ModernButton as described. Use Notify() for snackbars. Confirm() is preview — requires modern controls/themes and returns blank when dismissed.",
  );

  lines.push("");
  lines.push("## Data and formulas");
  lines.push(...sectionRules(["powerFx", "delegation"]));

  lines.push("");
  lines.push("## Naming");
  lines.push(...sectionRules(["naming"]));
  lines.push("- Set `AccessibleLabel` on icon-only buttons and images.");

  const chosen = promptOptionsOf(doc);
  for (const key of PROMPT_OPTIONS) {
    if (!chosen.includes(key)) continue;
    if (key === "darkMode" || key === "offline") continue;
    if (key === "tests") {
      lines.push("");
      lines.push(PA_TESTS_LINE);
      continue;
    }
    if (key === "deliverable") {
      lines.push("");
      lines.push("- Output the complete `*.pa.yaml` files as the deliverable (no emulator or device build required).");
      continue;
    }
    const line = PROMPT_OPTION_TEXT[lang][key].line;
    lines.push("");
    lines.push(`- ${typeof line === "function" ? line("web" as Platform) : line}`);
  }

  lines.push("");
  lines.push("Output: the YAML files in full, then a short list of assumptions and any control whose `describe_control` result differed from this brief.");
  lines.push("");
  lines.push(`## Sources (checked ${MAP.checkedOn}${MAP.reviewedBy ? `; ${MAP.reviewedBy}` : ""})`);
  for (const url of sourceUrls(kindsUsed)) lines.push(`- ${url}`);

  return lines.join("\n");
}

/** every editor Kind should have a row in the mapping file */
export function assertMappingCoversKinds(): void {
  for (const kind of KIND_ORDER) {
    if (!BY_KIND.has(kind)) throw new Error(`powerapps-mapping.json missing kind: ${kind}`);
  }
}
