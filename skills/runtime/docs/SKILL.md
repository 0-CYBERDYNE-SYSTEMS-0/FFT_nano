---
name: docs
description: Generate professional software documentation with rigorous
  research, Kimi K2.5 structured thinking, and Gemini 3 Flash modern design
  generation. Creates stunning docs that elevate your projects.
metadata:
  clawdbot: '{"emoji":"📚","requires":{"bins":["uv"],"env":[]},"primaryEnv":"","install":[{"id":"uv-brew","kind":"brew","formula":"uv","bins":["uv"],"label":"Install
    uv (brew)"}]}'
  legacy_homepage: https://github.com/topics/documentation-generator
---

# Docs Skill - Professional Software Documentation Generator

## When to use this skill
- Use when the user request matches this skill's domain and capabilities.
- Use when this workflow or toolchain is explicitly requested.

## When not to use this skill
- Do not use when another skill is a better direct match for the task.
- Do not use when the request is outside this skill's scope.

Generate stunning, professional software documentation that elevates your projects above the competition. This skill implements a rigorous 4-phase process powered by AI models for maximum impact.

## Philosophy

This skill represents documentation excellence through:

1. **Rigorous Discovery** - Comprehensive project analysis leaving no detail unexplored
2. **Kimi K2.5 Thinking** - Advanced reasoning for optimal documentation architecture
3. **Gemini 3 Flash Design** - Modern, cutting-edge visual design generation
4. **Unique Positioning** - Documentation that differentiates your project

## Rigorous Research Routine

Before generating any documentation, the skill performs exhaustive investigation:

### Project Analysis
- Complete file tree traversal and categorization
- Language detection and version identification
- Dependency mapping and ecosystem analysis
- Architecture pattern recognition
- Code complexity and structure assessment

### Ecosystem Investigation
- Framework and library detection
- Database and service integrations
- API patterns and contract analysis
- Build tool and deployment configuration
- Testing infrastructure mapping

### Audience Research
- Target user persona analysis
- Use case pattern extraction
- Competitor documentation benchmarking
- Industry best practices integration
- SEO optimization for discoverability

### Competitive Analysis
- Feature comparison and differentiation
- Unique selling proposition extraction
- Documentation style benchmarking
- Visual design trend integration

## Kimi K2.5 Thinking Phase

The Kimi K2.5 model (via `kimi-code/kimi-for-coding`) powers deep reasoning for:

- **Documentation Architecture**: Optimal section structure and navigation
- **Content Strategy**: What to document, depth per section
- **Example Selection**: Best code snippets to showcase features
- **User Journey Mapping**: Logical flow from introduction to mastery
- **Gap Analysis**: Identifying undocumented areas

### Thinking Process Outputs
1. Documentation skeleton with prioritized sections
2. Key messages and value propositions
3. Recommended example scenarios
4. Audience-appropriate technical depth
5. SEO keywords and meta descriptions

## Gemini 3 Flash Design Phase

Gemini 3 Flash generates modern, production-ready documentation designs:

### Modern Design Features
- **Swiss/Brutalist** typography with strong grid alignment
- **Monospace metadata** blocks for AI agent parsing
- **Semantic structure** with clear hierarchy markers
- **Minimal color** - black, white, single accent
- **High contrast** - crisp edges, no blur effects
- **Structured data blocks** - JSON-LD ready, LLM-friendly

### Design Trends (2025)
- **Swiss precision** - grid systems, asymmetric balance
- **Brutalist clarity** - raw typography, high contrast
- **Monospace data** - machine-readable blocks
- **No gradients, no blur, no shadows**
- **One accent color** - maximum impact
- **Flowing prose** for humans, structured blocks for AI

## Usage

```bash
uv run {baseDir}/scripts/generate_docs.py --path "/path/to/project" --type "all"
```

## Output Types

| Type | Description | Best For |
|------|-------------|----------|
| `readme` | Comprehensive README with badges, setup, usage | GitHub repos |
| `api` | Complete API reference with examples | Libraries, SDKs |
| `guide` | User guides and tutorials | Onboarding, how-tos |
| `website` | Full static site (HTML/CSS/JS) | Documentation portals |
| `all` | Complete documentation suite | Full projects |

## Options

| Option | Description |
|--------|-------------|
| `--path, -p` | Project root path (required) |
| `--type, -t` | Documentation type: readme/api/guide/website/all |
| `--output, -o` | Output directory |
| `--theme` | Theme: brutalist/swiss/minimal/technical |
| `--title` | Project title (auto-detected if omitted) |
| `--tagline` | One-line description for hero section |
| `--audience` | Target: beginners/intermediate/experts |
| `--ai-think` | Enable Kimi K2.5 reasoning (default: auto) |
| `--ai-design` | Enable Gemini 3 Flash design (default: auto) |

## Examples

```bash
# Full documentation suite with AI enhancement
uv run {baseDir}/scripts/generate_docs.py -p ~/myproject -t all --ai-think --ai-design

# README only with brutalist theme
uv run {baseDir}/scripts/generate_docs.py -p ~/myproject -t readme --theme brutalist \
  --title "SuperTool" --tagline "The ultimate solution for modern workflows"

# Complete website documentation with swiss theme
uv run {baseDir}/scripts/generate_docs.py -p ~/project -t website \
  --audience experts --title "Enterprise SDK" --theme swiss

# API documentation with technical theme
uv run {baseDir}/scripts/generate_docs.py -p ~/library -t api --theme technical
```

## Model Configuration

Configure AI models for optimal performance:

```json
{
  "skills": {
    "docs": {
      "thinkModel": "kimi-code/kimi-for-coding",
      "designModel": "gemini-2.0-flash",
      "features": {
        "reasoning": true,
        "designGeneration": true,
        "seoOptimization": true,
        "interactiveExamples": true
      }
    }
  }
}
```

### Model Selection Guide

| Phase | Model | Purpose | When to Use |
|-------|-------|---------|-------------|
| Thinking | Kimi K2.5 | Architecture, structure, content strategy | Complex projects, unique requirements |
| Design | Gemini 3 Flash | Visual design, modern layouts | All projects (fast and capable) |
| Fallback | MiniMax-M2.1 | General generation | When specialized models unavailable |

## Best Practices Applied

Generated documentation includes:

### Content Excellence
- Compelling hero section with clear value proposition
- Quick start guide for immediate productivity
- Comprehensive examples with real-world scenarios
- API reference with parameter tables
- Troubleshooting and FAQ sections
- Contributing guidelines with workflow diagrams

### Visual Design
- Modern CSS with CSS custom properties
- Responsive grid layouts
- Accessible color schemes
- Print-friendly styles
- Syntax highlighting (via Prism.js ready structure)
- Copy-to-clipboard functionality

### SEO & Discovery
- Semantic HTML structure
- Meta description optimization
- Open Graph tags for social sharing
- Sitemap-ready structure
- Canonical URLs
- Structured data (JSON-LD ready)

### Performance
- Minimal CSS (under 10KB gzipped)
- No external dependencies (self-contained)
- Lazy loading for images
- Critical CSS inline
- Cache-friendly asset structure

## Integration Points

### GitHub Integration
- Shields.io badges ready
- Issue/PR templates auto-generated
- GitHub Pages deployment ready
- Actions workflow documentation

### CI/CD Integration
- Documentation build in pipelines
- Automated API doc generation
- Version-based doc branching
- Deploy preview support

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Missing dependencies | Install: `uv pip install -r requirements.txt` |
| AI models unavailable | Fallback to template-based generation |
| Large projects | Use `--type readme` first, then expand |
| Custom themes | Place CSS in `docs/theme.css` for override |

## Performance Tips

1. **For large monorepos**: Generate docs per package with `--output`
2. **For frequent updates**: Use `--type api` for incremental API docs
3. **For release notes**: Generate CHANGELOG.md alongside docs
4. **For multi-language**: Generate docs per language with separate runs
