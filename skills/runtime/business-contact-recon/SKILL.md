---
name: business-contact-recon
description: Free OSINT reconnaissance to discover, validate, and build outreach-ready contact lists for businesses by region/industry. Uses DuckDuckGo, LinkedIn (free tier), and public records only. Generates structured CSVs for manual CRM import.
---

# Business Contact Reconnaissance Skill

## When not to use this skill
- Do not use when another skill is a better direct match for the task.
- Do not use when the request is outside this skill's scope.

## When to Use

Build targeted outreach lists using free public data sources:
- Sales lead generation by region/industry
- Business validation before contact attempts
- Discovering key personnel (owners, managers, decision-makers)
- Regional/niche market research

## Prerequisites

```bash
# Core dependencies
pip install requests beautifulsoup4 lxml python-dateutil

# Optional (for advanced extraction)
pip install linkedin-api  # Free tier with limitations
```

**No paid APIs required.** All sources in this skill are free.

## Core Workflow

### Phase 1: Discovery
1. Define target parameters (region, keywords, industry)
2. Run web searches to discover businesses
3. Filter by location/relevance
4. Compile seed list

### Phase 2: Validation
Cross-reference each business:
- Social presence (LinkedIn, website, social links)
- Review activity (Google, Yelp)
- Recent mentions (news, blogs)
- Government records (state biz registries)
- Forum/community signals

### Phase 3: Contact Extraction
For validated businesses:
1. Scrape website contact pages (respect robots.txt)
2. Find LinkedIn company page → extract key personnel
3. Use pattern-based email guessing (first@business.com)

### Phase 4: Output
Generate CSV with standardized fields.

## Available Scripts

| Script | Purpose |
|--------|---------|
| `scripts/discover_businesses.py` | DuckDuckGo + web discovery |
| `scripts/validate_activity.py` | Multi-signal validation |
| `scripts/extract_contacts.py` | Contact extraction from websites |
| `scripts/linkedin_extract.py` | Free LinkedIn company/person data |
| `scripts/build_csv.py` | Generate CRM-ready CSV |

## Free Data Sources Priority

1. **Search engines**: DuckDuckGo (no tracking, no API limits)
2. **Business listings**: Google Maps, Yelp (public pages)
3. **Social**: LinkedIn (public profiles only, no scraping)
4. **Government**: State Secretary of State business databases
5. **Domains**: WHOIS lookup, website analysis
6. **News**: RSS feeds, Google News alerts

## Compliance & Safety

### ✅ Allowed (Free Tier)
- Public business listings and directories
- Website contact pages (respect rate limits)
- LinkedIn public profiles
- Government records (public domain)
- DuckDuckGo/Google search results

### ⚠️ Use Caution
- Website scraping: 1 req/sec max, respect robots.txt
- Email pattern guessing: verify before sending
- LinkedIn: no automation tools, manual data only

### ❌ Never Do
- Credential stuffing or account takeover
- Bypassing CAPTCHAs or rate limits
- Scraping behind login walls
- Harvesting personal phone numbers
- Using paid APIs you don't have keys for

## Output Format

```csv
business_name,website,phone,email,contact_name,title,linkedin_url,source,confidence,last_verified,notes
Joe's Plumbing,https://joesplumbing.com,555-0123,joe@joesplumbing.com,Joe Smith,Owner,,website+hunter,high,2026-02-06,"Local SEO present"
```

## Rate Limiting

- **Search engines**: 1 query per 3 seconds (DuckDuckGo is lenient)
- **Websites**: 1 request per second
- **LinkedIn**: Manual extraction only (no API/scripted access)
- **General**: Be respectful, don't impact target sites

## Reference Documentation

- [Free Data Sources](references/free_sources.md) - Detailed guide to all free APIs and databases
- [Industry Templates](references/industry_templates.md) - Pre-built search patterns by industry
- [Compliance Guidelines](references/compliance.md) - Do's and don'ts for ethical OSINT
- [CSV Schema](references/csv_schema.md) - Field definitions and validation rules
