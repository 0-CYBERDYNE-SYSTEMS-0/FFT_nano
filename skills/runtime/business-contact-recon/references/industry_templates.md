# Industry Templates

Pre-built search patterns and configurations for specific industries.

## Restaurant Industry

### Search Queries
```
# Discovery patterns
"{industry} {region}"
"best {industry} {region}"
"{industry} near me {region}"
"top rated {industry} {region}"

# Specific queries
"restaurant {city} reviews"
"restaurant {city} menu"
"restaurant {city} catering"
```

### Target Business Types
- Independent restaurants
- Restaurant chains (corporate contacts)
- Catering services
- Food trucks
- Restaurant suppliers

### Key Personnel
- Owner / Operator
- General Manager
- Catering Manager
- Event Coordinator
- Executive Chef

### Data Priorities
1. Phone number (for reservations/catering inquiries)
2. Email (for proposals/partnerships)
3. Social media (Instagram very common)
4. Address (for direct mail)

---

## Plumbing / HVAC / Home Services

### Search Queries
```
"{industry} {region}"
"emergency {industry} {region}"
"{industry} near {region}"
"{industry} {city} reviews"
"24 hour {industry} {region}"
"commercial {industry} {region}"
```

### Target Business Types
- Independent contractors
- Service companies (5-50 employees)
- Franchise locations
- Emergency services
- Commercial contractors

### Key Personnel
- Owner
- Operations Manager
- Service Manager
- Dispatch
- Account Manager (for B2B)

### Data Priorities
1. Phone (immediate need = quick response)
2. Service area (radius from business)
3. License/insurance info
4. Reviews (trust signals)

---

## Real Estate (Agents & Brokerages)

### Search Queries
```
"real estate agent {region}"
"real estate brokerage {region}"
"realtor {city}"
"{property_type} for sale {region}"
"real estate investor {region}"
```

### Target Business Types
- Individual agents
- Brokerages
- Property management companies
- Real estate investors
- Wholesalers

### Key Personnel
- Agent name
- Team lead
- Broker owner
- Property manager
- Investor

### Data Priorities
1. Email (primary contact)
2. License number (verification)
3. Social media (Instagram for listings)
4. Transaction history (public records)

---

## Medical / Healthcare

### Search Queries
```
"{specialty} {region}"
"doctor {region} accepting new patients"
"medical clinic {region}"
"dental practice {region}"
"chiropractor {region}"
```

### Target Business Types
- Private practices
- Medical groups
- Dental offices
- Specialty clinics
- Urgent care centers

### Key Personnel
- Practice Manager
- Office Administrator
- Physician Owner
- Billing Manager
- IT/Operations

### Data Priorities
1. Practice email (general inquiries)
2. Billing contacts (for services)
3. NPI numbers (verification)
4. Specialty focus

---

## Legal (Law Firms)

### Search Queries
```
"lawyer {region}"
"attorney {region}"
"{practice_area} lawyer {region}"
"law firm {region}"
"legal services {region}"
```

### Target Business Types
- Solo practitioners
- Law firms (small to large)
- Legal clinics
- Document services
- Paralegal services

### Key Personnel
- Managing Partner
- Practice Area Lead
- Office Manager
- Marketing Director
- Legal Administrator

### Data Priorities
1. Practice area (for relevance)
2. Bar membership (verification)
3. Email (preferred contact)
4. Website (case types)

---

## Construction / Contractors

### Search Queries
```
"general contractor {region}"
"construction company {region}"
"home builder {region}"
"renovation contractor {region}"
"commercial construction {region}"
```

### Target Business Types
- General contractors
- Specialty trades
- Construction companies
- Design-build firms
- Subcontractors

### Key Personnel
- Owner
- Project Manager
- Estimator
- Superintendent
- Business Development

### Data Priorities
1. Project types (residential/commercial)
2. Licensing/insurance
3. Geographic coverage
4. Email (for quotes)

---

## Automotive (Dealers & Services)

### Search Queries
```
"car dealer {region}"
"auto repair {region}"
"dealership {region}"
"mechanic {region}"
"auto service {region}"
```

### Target Business Types
- Dealerships
- Independent repair shops
- Service centers
- Parts suppliers
- Fleet services

### Key Personnel
- General Manager
- Service Manager
- Parts Manager
- Sales Manager
- Owner

### Data Priorities
1. Service department (maintenance contracts)
2. Parts department (B2B supply)
3. Fleet services (B2B)
4. Certification (ASE, etc.)

---

## Technology / SaaS

### Search Queries
```
"software company {region}"
"SaaS {region}"
"tech company {region}"
"web development {region}"
"IT services {region}"
```

### Target Business Types
- SaaS companies
- Agencies
- IT consultancies
- Development shops
- Technology services

### Key Personnel
- CEO / Founder
- CTO
- VP Engineering
- Product Manager
- Sales/Partnerships

### Data Priorities
1. Company stage (for service fit)
2. Tech stack (for integration pitches)
3. Funding stage (if applicable)
4. LinkedIn for org structure

---

## Fitness / Wellness

### Search Queries
```
"gym {region}"
"fitness center {region}"
"yoga studio {region}"
"personal trainer {region}"
"wellness center {region}"
```

### Target Business Types
- Gyms / Fitness centers
- Studios (yoga, pilates, spin)
- Personal training
- Wellness centers
- Sports facilities

### Key Personnel
- Owner
- General Manager
- Head Trainer
- Membership Manager
- Operations

### Data Priorities
1. Membership model (for B2B partnerships)
2. Class schedule (content relevance)
3. Location/coverage
4. Social media presence

---

## Template Usage

```python
# Example: Using templates in discovery

TEMPLATES = {
    'restaurant': {
        'search_queries': [
            "{industry} {region}",
            "best {industry} {region}",
            "{industry} near {region}",
        ],
        'key_personnel': ['Owner', 'General Manager', 'Catering Manager'],
        'data_priorities': ['phone', 'email', 'instagram']
    },
    # ... add more industries
}

def apply_template(industry: str, region: str) -> dict:
    template = TEMPLATES.get(industry, TEMPLATES['restaurant'])
    
    queries = []
    for q in template['search_queries']:
        queries.append(q.format(industry=industry, region=region))
    
    return {
        'queries': queries,
        'key_personnel': template['key_personnel'],
        'priorities': template['data_priorities']
    }
```
