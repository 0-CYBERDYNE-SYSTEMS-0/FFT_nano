# Security Policy

FFT_nano prioritizes secure-by-default operation (container isolation, minimal mount exposure, and explicit credential handling).

## Reporting a Vulnerability

Please do **not** open public issues for security vulnerabilities.

Use one of these private channels:

1. GitHub Security Advisories for this repo ("Report a vulnerability")
2. Direct contact to maintainers listed in `CODEOWNERS`

When reporting, include:

- affected version/tag
- reproduction steps
- impact and exploitability
- any suggested mitigation

## Response Targets

- Initial triage acknowledgment: within 72 hours
- Severity classification and next steps: within 7 days
- Coordinated disclosure after fix availability

## Scope

In-scope examples:

- container escape / mount boundary bypass
- credential leakage / secret handling flaws
- privilege escalation across groups/chats
- IPC injection or unauthorized command execution

For deployment hardening guidance, see `docs/SECURITY.md`.
