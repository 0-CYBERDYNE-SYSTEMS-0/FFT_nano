---
name: fft-canvas-dynamic-ops
description: Compose and edit dynamic multi-card Agent Canvas specs and staged dashboard patches through allowlisted farm actions.
---

# FFT Canvas Dynamic Ops

Use this skill for runtime multi-card canvas composition and deterministic staged dashboard patch operations.

## When to use this skill

- Use when the user asks for dynamic Agent Canvas card creation/editing.
- Use when the user asks to patch dashboard views/cards without replacing the whole file.
- Use when updating card layout order, card content, or canvas spec metadata.

## When not to use this skill

- Do not use for direct live dashboard edits outside the staging/apply flow.
- Do not use for non-dashboard farm control requests.
- Do not use outside main/admin chat for write operations.

## Guardrails

- Never run destructive git commands unless explicitly requested.
- Preserve unrelated worktree changes.
- Main/admin chat only for privileged write actions.
- Keep all writes inside `/workspace/dashboard/`.
- Validate before apply; do not auto-apply to live dashboards.

## Action Surface

Use these actions for dynamic dashboard/canvas work:

- `ha_dashboard_get`
- `ha_dashboard_validate`
- `ha_dashboard_patch`
- `ha_apply_dashboard`
- `ha_capture_screenshot`
- `ha_canvas_get_spec`
- `ha_canvas_set_spec`
- `ha_canvas_patch_spec`

## Workflow

1. Read current state with `ha_dashboard_get` or `ha_canvas_get_spec`.
2. Build minimal patch operations.
3. Run validation (`ha_dashboard_validate`) before apply.
4. Apply staged dashboard only when requested (`ha_apply_dashboard`).
5. Verify with screenshot (`ha_capture_screenshot`).

## References

- Spec: `references/canvas-spec.md`
- Patch patterns: `references/operation-recipes.md`
- Safety checklist: `references/safety.md`
