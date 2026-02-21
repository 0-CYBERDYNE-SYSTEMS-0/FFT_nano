# Canvas Spec (v1.0)

`CanvasSpec`:

```json
{
  "version": "1.0",
  "title": "Agent Canvas",
  "layout": {
    "columns": 2,
    "gap": 16,
    "rowHeight": 280
  },
  "cards": []
}
```

`CanvasCard`:

- `id` (string, required, unique)
- `type` (`line|bar|radial|comparison|kpi|markdown|iframe`)
- `title` (optional)
- `entities` (optional string[])
- `labels` (optional string[])
- `span` (optional integer >= 1)
- `options` (optional object)

Storage default:

- `/workspace/dashboard/www/agent-canvas-spec.json`

Compatibility:

- If spec file is missing/invalid, renderer falls back to `input_text.agent_canvas_config` + `input_text.agent_canvas_title`.
