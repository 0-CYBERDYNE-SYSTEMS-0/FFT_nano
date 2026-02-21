# Safety Checklist

- Use explicit `id` values for cards; never patch anonymous cards.
- Keep writes in staging files or canvas spec file paths under `/workspace/dashboard/`.
- Validate dashboard YAML before apply.
- Do not auto-apply after patching unless requested.
- Use screenshot verification for UI-facing changes.
- Surface exact action errors and stop on parse/validation failures.
