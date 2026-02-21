---
name: nano-pdf
description: Edit PDFs with natural-language instructions using the nano-pdf CLI.
metadata:
  openclaw: '{"emoji":"📄","requires":{"bins":["nano-pdf"]},"install":[{"id":"uv","kind":"uv","package":"nano-pdf","bins":["nano-pdf"],"label":"Install
    nano-pdf (uv)"}]}'
  legacy_homepage: https://pypi.org/project/nano-pdf/
---

# nano-pdf

## When to use this skill
- Use when the user request matches this skill's domain and capabilities.
- Use when this workflow or toolchain is explicitly requested.

## When not to use this skill
- Do not use when another skill is a better direct match for the task.
- Do not use when the request is outside this skill's scope.

Use `nano-pdf` to apply edits to a specific page in a PDF using a natural-language instruction.

## Quick start

```bash
nano-pdf edit deck.pdf 1 "Change the title to 'Q3 Results' and fix the typo in the subtitle"
```

Notes:

- Page numbers are 0-based or 1-based depending on the tool’s version/config; if the result looks off by one, retry with the other.
- Always sanity-check the output PDF before sending it out.
