---
name: rapid-research
description: Lightweight research playbook optimized for the FF-Terminal agent.
  Keeps citation tracking, evidence grading, and summary drafting predictable
  even when multiple investigations run in parallel.
allowed-tools: read_file web_search tavily_search
metadata:
  legacy_slug: rapid_research
  legacy_summary: Fast-turn desk research with cite-first synthesis.
  legacy_version: 0.1.0
  legacy_author: ff-terminal-core
  legacy_priority: default
  legacy_tags: '["research","analysis","writing"]'
  legacy_triggers: '["research","investigate","summarize","comparison","briefing"]'
  legacy_assets: '["templates/research_brief_template.md","templates/source_log_template.md"]'
  legacy_recommended_tools: '["read_file","web_search","tavily_search"]'
---

# Rapid Research Loop

## When not to use this skill
- Do not use when another skill is a better direct match for the task.
- Do not use when the request is outside this skill's scope.

## When to use it
- The user needs a structured briefing, comparison table, FAQ, or short memo derived from multiple sources.
- The task explicitly says "research", "investigate", "summarize", or requests citations/links.
- Another agent already gathered raw notes and you must distill them.

## Guardrails
1. Always collect at least three independent sources unless the user provided authoritative material.
2. Keep a running source log (see `templates/source_log_template.md`) before drafting a summary.
3. Mark uncertainty or missing data instead of fabricating details.
4. Prefer deterministic helper scripts for parsing (CSV/JSON) before reasoning about them.

## Step-by-step workflow
1. **Clarify the question** – restate the core decision or comparison criteria in one paragraph.
2. **Plan the evidence sprint** – list the minimum facts you must confirm; group them by sub-question.
3. **Collect evidence** – for each fact, gather a citation with date, outlet, and a one-sentence pull quote.
4. **Grade sources** – label each entry with `primary`, `secondary`, or `speculative`.
5. **Synthesize** – transform the evidence table into:
   - a 3-bullet executive summary,
   - a risk/unknowns list,
   - and next-step recommendations.
6. **Package output** – use `templates/research_brief_template.md` as the outline and include the source log verbatim at the end.

## Output template
```
## TL;DR (3 bullets)
- ...

## Key Findings
1. Finding + cite
2. ...

## Risks / Unknowns
- ...

## Next Best Actions
- ...

## Source Log
| Source | Date | Key Fact | Link | Confidence |
| --- | --- | --- | --- | --- |
```

## Deterministic helpers to pair with
- `read_file` / `search_code` for mining local notes or logs.
- `analyze_data` for CSV-to-table workflows.
- `tavily_search` or `web_page_reader` for live web lookups.
