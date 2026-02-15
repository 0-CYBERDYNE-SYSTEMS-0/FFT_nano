# Support

Use this guide to route questions and issues.

## Where to ask for help

- Usage/setup questions: open a GitHub Issue using the templates.
- Bug reports: use the "Bug report" issue template.
- Feature requests: use the "Feature request" issue template.

## Security issues

Do not open public issues for vulnerabilities.

Use the private security reporting path in `.github/SECURITY.md`.

## Before opening an issue

1. Read `README.md` and relevant docs under `docs/`.
2. Run local checks:
   - `npm run validate:skills`
   - `npm run typecheck`
   - `npm test`
3. Include:
   - version/tag
   - platform/runtime (Apple Container or Docker)
   - minimal reproduction steps
