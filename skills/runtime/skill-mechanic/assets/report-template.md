# Skill library audit — {date} — {scope}

**{VERDICT LINE: "No action required." | "N items need attention (M must, K should)."}**

{One-paragraph plain-language summary. If healthy, say so and stop expanding.}

## Library vitals

- Skills: {n} across {roots}
- Always-loaded metadata cost: ~{tokens} tokens per session
- Drift since baseline {date|none recorded}: {none | list}
- Security candidates reviewed: {n} ({benign} benign, {plausible} plausible, {confirmed} confirmed)
- Previously accepted findings honored (not re-raised): {suppressed_count}

## MUST — act now
{Each: finding id, skill, evidence file:line, one-sentence consequence of
inaction, recommended action. Omit section entirely if empty — do not write
"none".}

## SHOULD — act soon
{Same shape. Omit if empty.}

## COULD — fine to ignore forever (max 5)
{id + one line each. Omit if empty.}

## Healthy
{count} skills: no action. {Optionally name 1-2 exemplary ones worth copying.}

---
Next: `accept <id>` to suppress a finding permanently · `fix` to apply items
above · update baseline after review: `skilltool.py diff --update`
