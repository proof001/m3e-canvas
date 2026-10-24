# Power App prompt mode

When **Power App** is selected on the prompt step, `buildPrompt` routes to `lib/prompt-powerapps.ts`, which emits a canvas-app brief (`*.pa.yaml`, Power Fx, delegation, naming).

## Updating control mappings

1. Edit **`lib/powerapps-mapping.json`** only — do not hardcode control or property names elsewhere.
2. Keep `checkedOn` in ISO date form when you refresh against Microsoft Learn.
3. Each `components[]` entry needs `m3Component` (a `Kind` from `lib/tokens.ts`), `paControl`, `status`, `keyProperties`, and `docUrl`. Set `composite: true` when the M3 part is built from multiple controls; put build guidance in `notes`.
4. Section rules (`sections.powerFx`, `canvasYaml`, `modernTheming`, `containersAndResponsive`, `delegation`, `naming`) are folded into the generated prompt; add or change rules there with a `docUrl` each.
5. Run `npm test -- lib/prompt.powerapps.test.ts` — it checks every `KIND_ORDER` kind has a mapping row and validates the JSON shape.

After mapping changes, spot-check a sketch in the editor (toggle **Power App**, copy prompt) and confirm control names match Learn / `describe_control`.
