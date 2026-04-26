---
name: web-search
description: Fast, free web search using DuckDuckGo. No API key needed, no signup, no rate limits on moderate use. Ideal for quick factual lookups and single-query searches.
allowed-tools: bash
metadata:
  version: "1.0.0"
  priority: high
  triggers: '["search", "look up", "find online", "web lookup", "quick search", "fact check"]'
---

# Web Search

Fast, free, always-available web search using DuckDuckGo via `ddgs`.

## Guardrails
- Never run destructive git commands unless explicitly requested.
- Preserve unrelated worktree changes.
- This skill is available in main/admin chat and all group chats.

## When to use this skill

- Quick factual lookups (single queries)
- When you need fast answers without setup
- Ad-hoc research that doesn't need multi-source synthesis
- For deep research loops, use `rapid-research` instead

## When NOT to use this skill

- Deep multi-source investigation (use `rapid-research` with Tavily)
- Anything requiring high-volume searching
- Needs that are better served by browsing specific sites directly

## Tool

Use `ddgs` via bash:

```bash
ddgs text -q "search query" -m 5        # text search, 5 results
ddgs news -q "search query" -m 5         # news search
ddgs images -q "search query" -m 5       # image search
ddgs extract -u <url>                    # fetch page content
```

## Examples

```bash
# Quick fact lookup
ddgs text -q "Python 3.14 release date" -m 3

# News search
ddgs news -q "Apple WWDC 2026" -m 3

# Specific site search
ddgs text -q "site:github.com FFT nano" -m 5

# Fetch page content
ddgs extract -u https://example.com/article
```

## Notes

- `ddgs` is pre-installed in the container runtime
- Results include: title, href (URL), body (snippet)
- Rate limit: reasonable use (~10 queries/min) works fine
- For heavy research loops, consider `rapid-research` with Tavily
