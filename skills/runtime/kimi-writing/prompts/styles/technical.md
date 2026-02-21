# Technical Documentation Style Guide

## Domain Context

Technical documentation exists to get users from "I don't know" to "I can do this" with minimal friction. Clarity and accuracy are paramount.

## Tone

- **Precise:** No ambiguity, no room for interpretation
- **Accessible:** Technical depth matched to audience
- **Helpful:** Guide, don't just describe

## Voice

- Expert but approachable
- Structured and predictable
- Consistent in terminology
- Respectful of the reader's time

## Key Principles

1. **One thing per document:** Clear scope, no mission creep
2. **Task-oriented:** Readers want to do something, not learn everything
3. **Progressive complexity:** Start simple, add depth
4. **Example-driven:** Code snippets, screenshots, scenarios

## Document Types

### Quick Start

Goal: First success in 5 minutes.

- Prerequisites only
- Minimal steps
- Success confirmation
- "Next steps" link to detailed docs

### Tutorial

Goal: Learn by doing.

- Clear learning outcome
- Step-by-step, numbered
- Code samples that work
- Screenshots where helpful
- "What you'll learn" section

### API Reference

Goal: Look up quickly.

- Complete function/method documentation
- Parameters, returns, exceptions
- Code examples for common use cases
- See also links
- Version-specific notes

### Concept Guide

Goal: Understand the "why."

- Architecture overview
- Key concepts and terminology
- Diagrams where helpful
- Use cases and patterns
- Links to related concepts

### Troubleshooting

Goal: Get unstuck.

- Error messages
- Common causes
- Solutions in order of likelihood
- Workarounds
- "If this doesn't work" escalation

## Formatting Rules

### Code Blocks

Always specify language:

```python
def calculate_yield(acres, bushels_per_acre):
    return acres * bushels_per_acre
```

### Headings

- H1: Document title (one per doc)
- H2: Major sections
- H3: Subsections (nested under H2)
- Never skip levels

### Lists

- **Bullet lists:** For items where order doesn't matter
- **Numbered lists:** For sequences/steps
- Mixed nesting: Use bullet for sub-steps within numbered

### Emphasis

- **Bold:** Key terms, first use of terminology
- _Italic:_ UI elements, variable names
- `Code`: Inline code, parameter names

## Code Examples

### What Works

- Complete, runnable code
- Comments explaining non-obvious parts
- Error handling where relevant
- Output shown
- Realistic examples, not "hello world"

### What to Avoid

- Incomplete snippets (must work when copied)
- Overly simplified examples
- No context for what code does
- Assuming environment setup

## Writing Style

### Imperative Mood

"Click the button" not "You should click the button"
"Run this command" not "This command can be run"

### Active Voice

"The API returns user data" not "User data is returned by the API"
"Use the method to..." not "The method is used to..."

### Specific Over General

"Enter your API key in the field" not "Input your credentials"
"The function accepts three parameters" not "The function takes some parameters"

### Progressive Disclosure

Don't explain everything upfront. Build understanding:

1. What to do (the task)
2. How it works (concept)
3. Why it matters (context)

## Common Sections

### Prerequisites

What users need before starting:

- Software versions
- Required permissions
- Account setup
- Dependencies

### Step-by-Step Guide

Numbered steps, each with:

- Clear action verb
- What to do
- Expected result
- Screenshot (if visual)
- Warning note (if gotcha)

### Code Organization

- Import statements at top
- Comment key sections
- Separate setup from core logic
- Handle errors
- Provide example output

### Warnings and Notes

⚠️ **Warning:** Things that can break, data loss, security issues

> 💡 **Note:** Helpful tips, best practices, additional info
> ℹ️ **Info:** Background, context, optional reading

## API Documentation Structure

### Method Signature

```python
def calculate_irrigation(
    field_id: str,
    duration_hours: float,
    flow_rate_gpm: float
) -> dict:
```

### Parameters

- **field_id** (str): Unique identifier for the field
- **duration_hours** (float): Irrigation duration in hours
- **flow_rate_gpm** (float): Water flow rate in gallons per minute

### Returns

```python
{
    "total_gallons": 36000.0,
    "cost_estimate": 27.50,
    "efficiency_score": 0.85
}
```

### Raises

- `ValueError`: If field_id not found
- `RuntimeError`: If irrigation system offline

### Examples

```python
result = calculate_irrigation("field-123", 6, 15)
print(result["total_gallons"])  # 5400.0
```

## Troubleshooting Format

### Error Message

```
Error: Field "field-123" not found
```

### Possible Causes

1. Typo in field_id
2. Field deleted from system
3. Wrong environment (dev vs prod)

### Solutions

1. Verify field_id spelling
2. Check field list: `list_fields()`
3. Confirm environment variable `ENV=production`

## Versioning

- Document version number
- List breaking changes
- Migration guides between versions
- Deprecation warnings with timelines

## Accessibility

- Alt text for screenshots
- Descriptive link text (not "click here")
- Sufficient color contrast
- Screen reader compatible

## Common Pitfalls

### Assumptions

Don't assume:

- User knows your tool/environment
- User has admin rights
- User is on your OS
- User has the same setup as you

### Incomplete Steps

Every step must work standalone. If step 3 depends on step 2, reference step 2 explicitly.

### Missing Context

Explain why before how. Readers need to know what they're achieving.

## Metrics for Quality

- Can a new user complete the task?
- Are there unanswered questions?
- Is the example code copy-pasteable?
- Can they find information quickly?

## Final Checklist

- Is every step actionable?
- Are examples complete and tested?
- Is terminology consistent?
- Are warnings clear?
- Can it be read in 5 minutes (for quick starts)?
