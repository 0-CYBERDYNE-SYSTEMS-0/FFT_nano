# Compliance Guidelines

Ethical and legal considerations for business contact reconnaissance.

## Core Principles

1. **Transparency**: Never misrepresent who you are
2. **Respect**: Honor rate limits and robots.txt
3. **Legitimacy**: Only use publicly available data
4. **Purpose**: Use data for legitimate business purposes

## Legal Framework

### What Data Is Public

- Business registrations (Secretary of State)
- Professional licenses (public registries)
- Website contact pages (published for contact)
- Business directory listings
- Press releases and news
- Social media public profiles
- Court records
- SEC filings (public companies)

### What May Be Restricted

- Email addresses harvested without consent
- Phone numbers from private databases
- Personal social media (non-public data)
- Behind-login content
- Data from TOS-protected sources

### Anti-Spam Laws

#### CAN-SPAM (US)
- No deceptive subject lines
- Must include physical address
- Must offer opt-out
- Honor opt-outs within 10 business days

#### GDPR (EU)
- Requires legitimate interest or consent
- Right to be forgotten
- Data portability requirements
- Affects anyone contacting EU residents

#### CCPA (California)
- Right to know what data is collected
- Right to delete
- Right to opt-out of sale

## Source-Specific Rules

### Google / Search Engines
- ✅ Public search results
- ❌ Automated scraping beyond acceptable limits
- ❌ Bypassing CAPTCHA/rate limits

### LinkedIn
- ⚠️ **Strict TOS** - automated scraping can result in account ban
- ✅ Viewing public profiles
- ❌ Using automation tools on personal accounts
- ⚠️ Consider Sales Navigator for business use

### Facebook / Instagram
- ⚠️ Public pages and business profiles only
- ❌ Scraping private groups
- ❌ Automated messaging

### Email Finders (Hunter, etc.)
- ✅ Finding publicly listed emails
- ⚠️ Verify before sending
- ❌ No guarantee of consent

### Government Databases
- ✅ Free and clear to use
- ✅ Designed as public records
- ❌ Redistribution for spam prohibited

## Best Practices by Activity

### Web Scraping
```python
# DO
- Check and respect robots.txt
- Rate limit: 1 req/sec minimum
- Identify yourself in User-Agent
- Cache results to avoid re-scraping

# DON'T
- Bypass rate limits
- Ignore robots.txt
- Use aggressive scraping tools
- Scraping behind login walls
```

### Email Outreach
```python
# DO
- Verify emails before sending
- Provide clear opt-out
- Include physical address
- Test deliverability

# DON'T
- Use purchased lists (high spam risk)
- Guess emails for sensitive industries
- Send without opt-in (B2B exception varies)
- Use deceptive subject lines
```

### Phone Contact
```python
# DO
- Verify business numbers (not personal)
- Respect business hours
- Leave voicemails with clear purpose

# DON'T
- Call cell phones (TCPA violation)
- Use automated dialers without consent
- Call numbers on do-not-call lists
```

## Risk Mitigation

### Before Contacting

1. **Verify data accuracy** - Outdated info wastes everyone's time
2. **Check consent status** - Some emails were collected differently
3. **Legitimacy check** - Is this a real business?
4. **Purpose alignment** - Does this contact make sense?

### During Contact

1. **Be clear** - State who you are and why
2. **Provide value** - What's in it for them?
3. **Easy opt-out** - Honor immediately
4. **Document consent** - Keep records

### After Contact

1. **Update records** - Mark contacted, response status
2. **Honor opt-outs** - Immediate removal
3. **Clean data** - Remove bounced/invalid
4. **Review compliance** - Periodic audit

## Industry-Specific Concerns

### Healthcare (HIPAA)
- ⚠️ Much more restrictive
- Business associate agreements may be needed
- Patient data = very protected

### Financial (SEC/FINRA)
- ⚠️ Strict regulations on contact
- Disclosures required
- Compliance review needed

### Legal
- ⚠️ Lawyer advertising rules by state
- Disclaimers may be required
- Jurisdiction matters

### B2B vs B2C
- B2B: Generally more permissive
- B2C: More restrictions, especially phone

## Compliance Checklist

Before building a contact list:

- [ ] Source is publicly available
- [ ] Data collection method is legal
- [ ] Rate limits respected
- [ ] robots.txt honored
- [ ] No TOS violations
- [ ] Data will be used legitimately
- [ ] Outreach will be compliant
- [ ] Opt-out process available

## Reporting Violations

If you encounter:
- **Your data being misused**: Contact CAN-SPAM reporting
- **Suspected illegal activity**: FBI IC3 or local authorities
- **Privacy violations**: FTC complaint (US)
- **GDPR violations**: Local data protection authority

## Summary

**When in doubt:**
- Use official APIs when available
- Get explicit consent when possible
- Document your compliance efforts
- Consult legal counsel for high-risk use cases

The goal is legitimate business development, not spam or harassment. Respect the data, respect the people.
