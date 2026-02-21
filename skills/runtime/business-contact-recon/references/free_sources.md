# Free Data Sources Guide

Comprehensive guide to free data sources for business contact reconnaissance.

## 1. Search Engines

### DuckDuckGo
- **URL**: https://duckduckgo.com/html/
- **API**: HTML scraping (no API key needed)
- **Rate Limit**: Very lenient, ~1 req/3s recommended
- **Use for**: Business discovery, website finding
- **Notes**: No tracking, good privacy

### Bing (Limited)
- **URL**: https://www.bing.com
- **API**: Requires API key for serious use
- **Free tier**: Limited queries per month
- **Use for**: Search backup

### Google
- **URL**: Google Custom Search JSON API
- **Free tier**: 100 queries/day
- **Use for**: When DuckDuckGo results are insufficient

## 2. Business Directories (Free Access)

### Google Maps
- **Access**: Public website (maps.google.com)
- **Data**: Business names, addresses, phone numbers, reviews
- **Limitation**: Scraping Google Maps violates TOS
- **Alternative**: Use DuckDuckGo to find Google Maps links

### Yelp
- **URL**: https://www.yelp.com
- **Access**: Public listings are viewable
- **Data**: Business info, reviews, photos
- **Rate Limit**: ~1 req/2s recommended

### Better Business Bureau
- **URL**: https://www.bbb.org
- **Access**: Public search
- **Data**: Business accreditation, complaints

### Yellow Pages / White Pages
- **URLs**: https://www.yellowpages.com, https://www.whitepages.com
- **Data**: Business and contact listings

## 3. Government Records (Public Domain)

### Secretary of State Business Databases
Most states provide free business entity searches:

| State | URL | Notes |
|-------|-----|-------|
| Texas | https://www.sos.state.tx.us/corp.shtml | Very complete |
| California | https://bizfileonline.sos.ca.gov/ | Free search |
| New York | https://appext20.dos.ny.gov | NYS entity search |
| Florida | https://sunbiz.org | Division of Corporations |

### SEC EDGAR
- **URL**: https://www.sec.gov/edgar
- **Data**: Public company filings, officer names
- **Access**: Completely free, no limits
- **Use for**: Public companies, executive contacts

### USPTO
- **URL**: https://www.uspto.gov/trademarks
- **Data**: Trademark owners, business names

### Federal Contracting
- **URL**: https://sam.gov
- **Data**: Government contractors, DUNS numbers

## 4. Domain & Website Data

### WHOIS Lookup
- **Tool**: https://whois.domaintools.com (limited free)
- **Alternative**: `whois` command line
- **Data**: Registration info, creation date

### BuiltWith
- **URL**: https://builtwith.com
- **Free tier**: Limited lookups per day
- **Data**: Technology stack, email patterns

### SimilarTech
- **URL**: https://www.similartech.com
- **Free tier**: Basic data

## 5. Professional Networks (Free Tier)

### LinkedIn
- **Public profiles**: Free to view
- **Limitations**: No automation, heavy TOS restrictions
- **Recommendation**: Use manual searches for production
- **Alternative**: LinkedIn Sales Navigator free trial

### Xing
- **URL**: https://www.xing.com
- **Data**: European-focused business network

## 6. Email Discovery (Free Tier)

### Hunter.io
- **Free tier**: 50 searches/month
- **Data**: Email patterns, verification status
- **URL**: https://hunter.io

### Clearbit (Free Tier)
- **URL**: https://clearbit.com
- **Data**: Company data, email patterns
- **Free tier**: Limited

### Email Finder (Free Tier)
- **URL**: https://emailfinder.io
- **Free tier**: Basic searches

## 7. Review & Reputation

### Google Business Profile
- **Access**: Via Google Maps
- **Data**: Reviews, ratings, business info

### Trustpilot
- **URL**: https://www.trustpilot.com
- **Data**: Business ratings, reviews

### Angie's List (Now Angi)
- **URL**: https://angi.com
- **Data**: Service business reviews

## 8. News & Media

### Google News
- **URL**: https://news.google.com
- **Free tier**: Public access
- **Data**: Recent coverage, press releases

### RSS Feeds
- **Use for**: Track new articles about target businesses
- **Tool**: https://feedly.com for aggregation

### NewsAPI (Free Tier)
- **URL**: https://newsapi.org
- **Free tier**: 100 requests/day
- **Data**: News articles by keyword

## 9. Industry-Specific Sources

### LinkedIn Groups
- Free to join and search within groups
- Good for B2B targeting

### Reddit
- **URL**: https://www.reddit.com
- **Data**: Community discussions, recommendations
- **Use**: Find active businesses via recommendations

### Industry Forums
- Trade-specific forums often have member directories
- Example: HVAC forums, contractor boards

## Source Priority Matrix

| Priority | Source Type | Use Case |
|----------|-------------|----------|
| 1 | Government records | Highest reliability |
| 2 | Business directories | Basic contact info |
| 3 | Search engines | Discovery |
| 4 | Review sites | Activity validation |
| 5 | Social/professional | Personnel discovery |
| 6 | News/press | Recent activity |

## Rate Limiting Best Practices

| Source | Max Requests | Recommended Delay |
|--------|--------------|-------------------|
| DuckDuckGo | None (be reasonable) | 3 seconds |
| Yelp | ~1 req/second | 2 seconds |
| Government sites | Varies | 5 seconds |
| LinkedIn | Very strict | Manual only |
| Email finders | Monthly limits | N/A - track usage |
