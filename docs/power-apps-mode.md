# Power App prompt mode

When **Power App** is selected on the prompt step, `buildPrompt` routes to `lib/prompt-powerapps.ts`, which emits a canvas-app brief (`*.pa.yaml`, Power Fx, delegation, naming).

## Updating control mappings

1. Edit **`lib/powerapps-mapping.json`** only — do not hardcode control or property names elsewhere.
2. Keep `checkedOn` in ISO date form when you refresh against Microsoft Learn. After a human review, set `reviewedBy` (e.g. `Maker (Power Platform), YYYY-MM-DD`).
3. Each `components[]` entry needs `m3Component` (a `Kind` from `lib/tokens.ts`), `paControl`, `status`, `keyProperties`, and `docUrl`. Set `composite: true` when the M3 part is built from multiple controls; put build guidance in `notes`. Prefer omitting `@version` unless Studio or `describe_control` supplies one.
4. Section rules (`sections.powerFx`, `canvasYaml`, `modernTheming`, `containersAndResponsive`, `delegation`, `naming`) are folded into the generated prompt; add or change rules there with a `docUrl` each. Themes are pasted via **Themes > Paste theme**, not in `App.pa.yaml` (v3.0 has no `Theme` root key).
5. YAML formulas with `:` or `#` must use `|-` blocks (PA1001); `ValidationState` uses enum members, not strings.
6. Run `npm test -- lib/prompt.powerapps.test.ts` — it checks every `KIND_ORDER` kind has a mapping row, validates the JSON shape, and asserts form controls are described by kind (not as a button group).

After mapping changes, spot-check a sketch in the editor (toggle **Power App**, copy prompt) and confirm control names match Learn / `describe_control`.
