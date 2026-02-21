# CSV Schema Reference

Field definitions and validation rules for contact list output.

## Field Reference

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| `business_name` | string | Yes | Legal or common business name | "Joe's Plumbing LLC" |
| `website` | string | Yes | Full URL with protocol | "https://joesplumbing.com" |
| `phone` | string | No | Phone number format | "555-0123" |
| `email` | string | No | Primary email address | "joe@joesplumbing.com" |
| `contact_name` | string | No | Key contact person | "Joe Smith" |
| `title` | string | No | Contact's job title | "Owner" |
| `linkedin_url` | string | No | LinkedIn profile URL | "https://linkedin.com/in/joesmith" |
| `source` | string | Yes | Where data was found | "website+hunter" |
| `confidence` | number | Yes | 0-100 score | 85 |
| `last_verified` | date | Yes | ISO format date | "2026-02-06" |
| `notes` | string | No | Additional context | "Emergency service available" |
| `region` | string | No | Geographic targeting | "Austin, TX" |
| `industry` | string | No | Business category | "plumber" |

## Confidence Score Calculation

Confidence is based on data completeness and validation:

| Score | Meaning | Criteria |
|-------|---------|----------|
| 90-100 | Excellent | Website + email + phone + validated + LinkedIn |
| 70-89 | Good | Website + 2+ contact methods |
| 50-69 | Medium | Website + 1 contact method |
| 30-49 | Low | Website only, no contacts |
| 0-29 | Minimal | Name/URL only |

## Source Values

Use descriptive source strings:

```
# Common sources
"website"
"website+hunter"
"google_maps"
"yelp"
"linkedin"
"government"
"directory"

# Combined sources
"website+linkedin"
"yelp+phone_lookup"
"duckduckgo+validation"
```

## Validation Rules

### Phone Numbers
```python
# Accept formats
"555-0123"
"(555) 012-3456"
"555 012 3456"
"+1 555 012 3456"

# Reject
"123"  # Too short
"555-0123-456"  # Too long
```

### Email Addresses
```python
# Valid patterns
"user@domain.com"
"user.name@domain.com"
"user+tag@domain.com"

# Invalid
"@domain.com"  # No user
"user@"  # No domain
"user@.com"  # Invalid domain
```

### URLs
```python
# Valid
"https://example.com"
"http://example.com"
"https://www.example.com"

# Invalid
"example.com"  # Missing protocol
"https://"  # Incomplete
```

### Dates
```python
# ISO 8601 format
"2026-02-06"
"2026-02-06T14:30:00Z"
```

## Sample CSV Output

```csv
business_name,website,phone,email,contact_name,title,linkedin_url,source,confidence,last_verified,notes,region,industry
Joe's Plumbing,https://joesplumbing.com,555-0123,joe@joesplumbing.com,Joe Smith,Owner,,website+hunter,high,2026-02-06,Emergency service available,Austin,TX,plumber
ABC Restaurant,https://abcrestaurant.com,512-555-9999,,John Doe,General Manager,https://linkedin.com/in/johndoe,yelp+linkedin,85,2026-02-05,Open for catering,Chicago,IL,restaurant
Tech Solutions LLC,https://techsolutions.io,888-555-1234,info@techsolutions.io,,,,website,60,2026-02-04,No contact page found,Seattle,WA,technology
```

## Import Instructions

### HubSpot
1. Export CSV
2. Import via HubSpot → Contacts → Import
3. Map fields to HubSpot properties

### Salesforce
1. Export CSV
2. Data Loader or Import Wizard
3. Map to Lead/Contact object fields

### Google Sheets
1. Open Google Sheets
2. File → Import → Upload CSV
3. Review and clean data

### Mailchimp
1. Export CSV
2. Mailchimp → Audience → Import Contacts
3. Map fields to merge tags

## Quality Thresholds

| Use Case | Min Confidence | Required Fields |
|----------|---------------|------------------|
| Cold email | 50 | email, confidence > 50 |
| Cold call | 70 | phone, confidence > 70 |
| Direct mail | 40 | address (not in this schema) |
| LinkedIn outreach | 60 | linkedin_url, confidence > 60 |
| Research only | 30 | website, confidence > 30 |
