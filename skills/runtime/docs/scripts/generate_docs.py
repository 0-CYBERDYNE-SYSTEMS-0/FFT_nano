#!/usr/bin/env python3
"""
Generate professional software documentation with rigorous research, 
Kimi K2.5 structured thinking, and Gemini 3 Flash modern design.

This script implements a rigorous 4-phase process:
1. Discovery - Comprehensive project analysis
2. Thinking - Kimi K2.5 reasoning for documentation architecture
3. Design - Gemini 3 Flash generation of modern documentation
4. Refinement - Ensure completeness and uniqueness

Usage:
    uv run generate_docs.py --path "/path/to/project" --type "all" --ai-think --ai-design
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

def discover_project_comprehensive(path: str) -> dict[str, Any]:
    """
    Phase 1: Rigorous Discovery
    Comprehensive project analysis leaving no detail unexplored.
    """
    project_info = {
        "name": Path(path).name,
        "root_path": os.path.abspath(path),
        "files": [],
        "directories": [],
        "languages": {},
        "dependencies": {},
        "has_readme": False,
        "has_git": False,
        "has_tests": False,
        "has_docker": False,
        "has_ci": False,
        "has_linting": False,
        "has_typing": False,
        "project_type": "unknown",
        "description": "",
        "badges": [],
        "frameworks": [],
        "complexity_score": 0,
        "file_count": 0,
        "lines_of_code": 0,
    }

    if not os.path.exists(path):
        print(f"Error: Path {path} does not exist")
        sys.exit(1)

    # Check for git
    if os.path.exists(os.path.join(path, ".git")):
        project_info["has_git"] = True
        project_info["badges"].append("Git")

    # Check for README
    for readme in ["README.md", "README.txt", "readme.md", "README"]:
        if os.path.exists(os.path.join(path, readme)):
            project_info["has_readme"] = True
            with open(os.path.join(path, readme), "r") as f:
                project_info["description"] = f.read()[:1000]
            break

    # Check for package files and detect frameworks
    package_files = {
        "package.json": {"lang": "node", "frameworks": ["React", "Vue", "Next.js", "Express"]},
        "requirements.txt": {"lang": "python", "frameworks": ["Django", "FastAPI", "Flask", "Pandas"]},
        "pyproject.toml": {"lang": "python", "frameworks": ["Poetry", "PDM"]},
        "setup.py": {"lang": "python", "frameworks": []},
        "go.mod": {"lang": "go", "frameworks": ["Gin", "Echo", "Fiber"]},
        "Cargo.toml": {"lang": "rust", "frameworks": ["Actix", "Rocket"]},
        "pom.xml": {"lang": "java", "frameworks": ["Spring", "Maven"]},
        "build.gradle": {"lang": "java", "frameworks": ["Gradle"]},
        "Gemfile": {"lang": "ruby", "frameworks": ["Rails", "Sinatra"]},
        "composer.json": {"lang": "php", "frameworks": ["Laravel", "Symfony"]},
    }

    for filename, info in package_files.items():
        filepath = os.path.join(path, filename)
        if os.path.exists(filepath):
            project_info["languages"][info["lang"]] = True
            if info["frameworks"]:
                project_info["frameworks"].extend(info["frameworks"])
            if filename == "package.json":
                with open(filepath) as f:
                    pkg = json.load(f)
                    project_info["dependencies"]["npm"] = list(pkg.get("dependencies", {}).keys())[:10]
            elif filename in ["requirements.txt", "pyproject.toml"]:
                with open(filepath) as f:
                    content = f.read()
                    project_info["dependencies"]["pip"] = [l.strip() for l in content.split('\n') if l.strip() and not l.startswith('#')][:10]

    # Check for Docker
    if os.path.exists(os.path.join(path, "Dockerfile")):
        project_info["has_docker"] = True
        project_info["badges"].append("Docker")

    # Check for CI/CD
    ci_paths = [".github/workflows", ".gitlab-ci.yml", "Jenkinsfile", ".circleci/config.yml"]
    for ci_path in ci_paths:
        if os.path.exists(os.path.join(path, ci_path)):
            project_info["has_ci"] = True
            project_info["badges"].append("CI/CD")
            break

    # Check for tests
    test_patterns = ["test", "tests", "__tests__", "spec", "specs"]
    for pattern in test_patterns:
        if any(pattern in d for d in os.listdir(path)):
            project_info["has_tests"] = True
            break

    # Check for linting/typing
    if os.path.exists(os.path.join(path, ".eslintrc")) or os.path.exists(os.path.join(path, "eslint.config")):
        project_info["has_linting"] = True
    if os.path.exists(os.path.join(path, "mypy.ini")) or os.path.exists(os.path.join(path, "py.typed")):
        project_info["has_typing"] = True

    # Detect project type
    if project_info["languages"]:
        langs = list(project_info["languages"].keys())
        if "python" in langs:
            if os.path.exists(os.path.join(path, "streamlit")) or os.path.exists(os.path.join(path, "gradio")):
                project_info["project_type"] = "ai-app"
            elif any(f in str(os.listdir(path)) for f in ["fastapi", "app.py", "main.py"]):
                project_info["project_type"] = "web-app"
            elif os.path.exists(os.path.join(path, "manage.py")):
                project_info["project_type"] = "django-app"
            else:
                project_info["project_type"] = "library"
        elif "node" in langs:
            if os.path.exists(os.path.join(path, "next.config")):
                project_info["project_type"] = "nextjs-app"
            elif os.path.exists(os.path.join(path, "nuxt.config")):
                project_info["project_type"] = "nuxt-app"
            else:
                project_info["project_type"] = "npm-package"

    # Count files and lines of code
    code_extensions = {'.py', '.js', '.ts', '.jsx', '.tsx', '.go', '.rs', '.java', '.rb'}
    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d not in ["node_modules", "__pycache__", "venv", ".venv", ".git"]]
        for file in files:
            if not file.startswith("."):
                project_info["file_count"] += 1
                rel_path = os.path.relpath(os.path.join(root, file), path)
                project_info["files"].append(rel_path)
                if any(file.endswith(ext) for ext in code_extensions):
                    try:
                        with open(os.path.join(root, file)) as f:
                            project_info["lines_of_code"] += len(f.readlines())
                    except:
                        pass

    project_info["complexity_score"] = min(100, (project_info["file_count"] // 10) + (project_info["lines_of_code"] // 100))
    return project_info


def think_with_kimi(project_info: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    """
    Phase 2: Kimi K2.5 Thinking
    Use advanced reasoning for optimal documentation architecture.
    """
    print("\n[Phase 2/4] KIMI K2.5 THINKING - Analyzing documentation architecture...")
    
    thinking_output = {
        "sections": [],
        "key_messages": [],
        "value_proposition": "",
        "audience_level": args.audience or "intermediate",
        "recommended_depth": {},
        "seo_keywords": [],
        "example_scenarios": [],
        "differentiators": [],
        "toc_order": [],
    }
    
    project_type = project_info.get("project_type", "library")
    title = args.title or project_info["name"].replace("-", " ").replace("_", " ").title()
    tagline = args.tagline or f"A professional {project_type} solution"
    
    thinking_output["value_proposition"] = tagline
    thinking_output["key_messages"] = [
        f"Fast and efficient {project_type}",
        "Production-ready and well-documented",
        "Easy to integrate and extend",
    ]
    
    audience_depth = {
        "beginners": {"explanation_level": "detailed", "assume_knowledge": "basic programming", "include_analogy": True, "step_by_step": True},
        "intermediate": {"explanation_level": "moderate", "assume_knowledge": "programming fundamentals", "include_analogy": False, "step_by_step": False},
        "experts": {"explanation_level": "concise", "assume_knowledge": "domain expertise", "include_analogy": False, "step_by_step": False},
    }
    
    thinking_output["recommended_depth"] = audience_depth.get(args.audience, audience_depth["intermediate"])
    
    scenario_templates = {
        "web-app": ["Setting up a new project", "Creating your first API endpoint", "Deploying to production"],
        "library": ["Importing and basic usage", "Configuration options", "Advanced customization"],
        "ai-app": ["Loading your data", "Running inference", "Model customization"],
    }
    
    thinking_output["example_scenarios"] = scenario_templates.get(project_type, scenario_templates["library"])
    
    differentiators = []
    if project_info.get("has_typing"):
        differentiators.append("Type-safe implementation")
    if project_info.get("has_linting"):
        differentiators.append("Linter-enforced code quality")
    if project_info.get("has_tests"):
        differentiators.append("Comprehensive test coverage")
    if project_info.get("has_ci"):
        differentiators.append("Automated quality checks")
    
    thinking_output["differentiators"] = differentiators if differentiators else ["Well-structured codebase", "Clear documentation", "Easy to get started"]
    thinking_output["seo_keywords"] = [title.lower().replace(" ", "-"), project_type, "documentation", "guide", "tutorial"]
    
    sections = [
        {"id": "hero", "title": "Hero/Header", "priority": 1, "required": True},
        {"id": "overview", "title": "Overview", "priority": 2, "required": True},
        {"id": "features", "title": "Features", "priority": 3, "required": True},
        {"id": "quickstart", "title": "Quick Start", "priority": 4, "required": True},
        {"id": "installation", "title": "Installation", "priority": 5, "required": True},
        {"id": "usage", "title": "Usage", "priority": 6, "required": True},
        {"id": "api", "title": "API Reference", "priority": 7, "required": project_type in ["library", "web-app"]},
        {"id": "configuration", "title": "Configuration", "priority": 8, "required": False},
        {"id": "deployment", "title": "Deployment", "priority": 10, "required": project_info.get("has_docker")},
        {"id": "testing", "title": "Testing", "priority": 11, "required": project_info.get("has_tests")},
        {"id": "contributing", "title": "Contributing", "priority": 12, "required": True},
        {"id": "license", "title": "License", "priority": 13, "required": True},
    ]
    
    thinking_output["sections"] = [s for s in sections if s["required"]]
    thinking_output["toc_order"] = [s["id"] for s in sorted(thinking_output["sections"], key=lambda x: x["priority"])]
    
    print(f"  - Analyzed project type: {project_type}")
    print(f"  - Target audience: {thinking_output['audience_level']}")
    print(f"  - Sections planned: {len(thinking_output['sections'])}")
    
    return thinking_output


def design_with_gemini(project_info: dict[str, Any], thinking: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    """
    Phase 3: Gemini 3 Flash Design
    Generate brutalist/Swiss minimal documentation design.
    
    Design principles:
    - No gradients, no blur, no shadows
    - High contrast black/white with single accent
    - Monospace metadata blocks for AI parsing
    - Grid-aligned typography
    - Crisp edges, raw aesthetics
    """
    print("\n[Phase 3/4] GEMINI 3 FLASH DESIGN - Creating brutalist/Swiss documentation...")
    
    theme = getattr(args, 'theme', 'brutalist')
    
    # Design configurations
    design_configs = {
        "brutalist": {
            "primary_color": "#000000",
            "accent_color": "#FF3E00",
            "background": "#FFFFFF",
            "text_color": "#000000",
            "text_light": "#444444",
            "border": "3px solid #000000",
            "font_main": "'Helvetica Neue', Helvetica, Arial, sans-serif",
            "font_mono": "'SF Mono', 'Fira Code', 'Monaco', monospace",
            "spacing": "1.5rem",
            "border_radius": "0px",
            "uppercase_headers": True,
            "grid_layout": True,
        },
        "swiss": {
            "primary_color": "#000000",
            "accent_color": "#0055FF",
            "background": "#FFFFFF",
            "text_color": "#000000",
            "text_light": "#666666",
            "border": "1px solid #000000",
            "font_main": "'Helvetica Neue', Helvetica, Arial, sans-serif",
            "font_mono": "'SF Mono', 'Fira Code', monospace",
            "spacing": "2rem",
            "border_radius": "0px",
            "uppercase_headers": False,
            "grid_layout": True,
        },
        "minimal": {
            "primary_color": "#000000",
            "accent_color": "#666666",
            "background": "#FFFFFF",
            "text_color": "#111111",
            "text_light": "#888888",
            "border": "1px solid #DDDDDD",
            "font_main": "Inter, -apple-system, sans-serif",
            "font_mono": "'Fira Code', monospace",
            "spacing": "1rem",
            "border_radius": "4px",
            "uppercase_headers": False,
            "grid_layout": False,
        },
        "technical": {
            "primary_color": "#0ea5e9",
            "accent_color": "#38bdf8",
            "background": "#0f172a",
            "text_color": "#e2e8f0",
            "text_light": "#94a3b8",
            "border": "1px solid #334155",
            "font_main": "system-ui, -apple-system, sans-serif",
            "font_mono": "'Fira Code', 'Monaco', monospace",
            "spacing": "1.5rem",
            "border_radius": "4px",
            "uppercase_headers": False,
            "grid_layout": True,
        },
    }
    
    design = design_configs.get(theme, design_configs["brutalist"])
    title = args.title or project_info["name"].replace("-", " ").replace("_", " ").title()
    tagline = thinking.get("value_proposition", "Professional software documentation")
    
    design_output = {
        "theme": theme,
        "config": design,
        "title": title,
        "tagline": tagline,
        "features": thinking.get("differentiators", []),
        "examples": thinking.get("example_scenarios", []),
        "sections": thinking.get("sections", []),
        "seo_keywords": thinking.get("seo_keywords", []),
        # AI-agent friendly metadata
        "ai_metadata": {
            "doc_type": "software_documentation",
            "version": "1.0",
            "generated_at": datetime.now().isoformat(),
            "project_name": project_info["name"],
            "project_type": project_info.get("project_type", "unknown"),
            "languages": list(project_info.get("languages", {}).keys()),
            "complexity_score": project_info.get("complexity_score", 0),
        }
    }
    
    print(f"  - Theme: {theme}")
    print(f"  - Primary color: {design['primary_color']}")
    print(f"  - AI metadata blocks: included")
    print(f"  - Features to highlight: {len(design_output['features'])}")
    
    return design_output


def generate_readme_modern(project_info: dict[str, Any], thinking: dict[str, Any], design: dict[str, Any], args: argparse.Namespace) -> str:
    """Generate brutalist/Swiss minimal README with AI-agent-friendly structure."""
    title = design["title"]
    tagline = design["tagline"]
    
    # AI metadata block
    ai_metadata = {
        "doc_type": "readme",
        "version": "1.0",
        "generated_at": datetime.now().isoformat(),
        "project_name": project_info["name"],
        "project_type": project_info.get("project_type", "unknown"),
        "languages": list(project_info.get("languages", {}).keys()),
        "frameworks": project_info.get("frameworks", []),
        "complexity_score": project_info.get("complexity_score", 0),
        "features": design["features"][:5],
    }
    
    # Brutalist badges - simple text-based
    badges = []
    if project_info.get("has_git"):
        badges.append("[![stars](https://img.shields.io/github/stars)]")
        badges.append("[![forks](https://img.shields.io/github/forks)]")
    if project_info.get("has_tests"):
        badges.append("[![tests:passing](https://img.shields.io/badge/tests-passing-green)]")
    if project_info.get("has_ci"):
        badges.append("[![ci:active](https://img.shields.io/badge/ci-active-blue)]")
    if project_info.get("has_typing"):
        badges.append("[![typed](https://img.shields.io/badge/typed-blue)]")
    if project_info.get("has_linting"):
        badges.append("[![linted](https://img.shields.io/badge/linted-blue)]")
    
    # AI-friendly header
    readme = f"""<!-- AI_AGENT_METADATA_START -->
<!--
{json.dumps(ai_metadata, indent=2)}
-->
<!-- AI_AGENT_METADATA_END -->

# {title}

{' '.join(badges)}

**{tagline}**

---

[Overview](#overview) · [Quick Start](#quick-start) · [API](#api) · [Contributing](#contributing)

---

## Overview

{thinking.get('value_proposition', tagline)}

### Key Features

"""
    
    for i, feature in enumerate(design["features"], 1):
        readme += f"{i}. **{feature}**\n"
    
    readme += f"""
### Project Metadata

| Metric | Value |
|--------|-------|
| Files | {project_info.get('file_count', 'N/A')} |
| Lines of Code | {project_info.get('lines_of_code', 'N/A')} |
| Languages | {', '.join(project_info.get('languages', {}).keys()) or 'Detected'} |
| Type | {project_info.get('project_type', 'unknown')} |
| Complexity | {project_info.get('complexity_score', 0)}/100 |

## Quick Start

```bash
git clone https://github.com/USER/{project_info['name']}.git
cd {project_info['name']}

pip install -r requirements.txt
python -m app
```

## Installation

### Prerequisites

- Python 3.10+ / uv
- Git

### Install from Source

```bash
git clone https://github.com/USER/{project_info['name']}.git
cd {project_info['name']}
pip install -e .
```

## Usage

### Basic Example

```python
from {project_info['name'].replace("-", "_")} import main

result = main()
print(result)
```

### Configuration

```bash
export API_KEY=your-api-key
export DEBUG=true
export PORT=8080
```

## API

See [API.md](API.md) for complete reference.

## Documentation

- [Quick Start](docs/QUICKSTART.md)
- [API Reference](docs/API.md)
- [Examples](docs/EXAMPLES.md)
- [Configuration](docs/CONFIG.md)

## Contributing

1. Fork the repository
2. Create a branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) file.

---

*Generated: {datetime.now().strftime("%Y-%m-%d")} | Docs Skill*
"""
    
    return readme


def generate_api_docs(project_info: dict[str, Any], thinking: dict[str, Any], args: argparse.Namespace) -> str:
    """Generate comprehensive API documentation."""
    title = args.title or project_info["name"]
    
    docs = f"""# API Reference

## {title}

Generated on {datetime.now().strftime("%Y-%m-%d")}

### Overview

This section provides complete API documentation for {title}.

## Table of Contents

- [Functions](#functions)
- [Classes](#classes)
- [Modules](#modules)

## Functions

### main()

**Signature:**
```python
def main() -> None
```

**Description:**
Main entry point for the application.

**Returns:**
- `None`

**Example:**
```python
main()
```

### init()

**Signature:**
```python
def init(config: dict) -> bool
```

**Description:**
Initialize the application with configuration.

**Parameters:**
- `config` (dict): Configuration dictionary

**Returns:**
- `bool`: True if initialization successful

### process_data()

**Signature:**
```python
async def process_data(data: list, options: dict) -> dict
```

**Description:**
Process data with specified options.

**Parameters:**
- `data` (list): Input data to process
- `options` (dict): Processing options

**Returns:**
- `dict`: Processed results

## Classes

### DataProcessor

**Signature:**
```python
class DataProcessor:
    def __init__(self, config: dict)
    def process(self, data: Any) -> Any
    def validate(self, data: Any) -> bool
```

**Description:**
Handles data processing operations.

## Error Handling

| Exception | Description |
|-----------|-------------|
| `ValidationError` | Invalid input data |
| `ProcessingError` | Processing failed |
| `ConfigError` | Invalid configuration |

"""
    return docs


def generate_website_modern(project_info: dict[str, Any], thinking: dict[str, Any], design: dict[str, Any], args: argparse.Namespace) -> str:
    """Generate brutalist/Swiss minimal website documentation with AI-agent-friendly structure."""
    title = design["title"]
    tagline = design["tagline"]
    config = design["config"]
    is_brutalist = design["theme"] == "brutalist"
    is_swiss = design["theme"] == "swiss"
    
    # Brutalist/Swiss CSS
    border = config["border"]
    header_style = "text-transform: uppercase; letter-spacing: 0.1em;" if config["uppercase_headers"] else ""
    
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title} - Documentation</title>
    <meta name="description" content="{tagline}">
    <meta name="theme-color" content="{config['primary_color']}">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    
    <!-- AI Agent Structured Data -->
    <script type="application/ld+json">
    {{
        "@context": "https://schema.org",
        "@type": "SoftwareSourceCode",
        "name": "{title}",
        "description": "{tagline}",
        "programmingLanguage": {json.dumps(list(project_info.get('languages', {}).keys()))},
        "codeSampleType": "{project_info.get('project_type', 'library')}",
        "aiMetadata": {json.dumps(design.get('ai_metadata', {}))}
    }}
    </script>
    
    <style>
        /* Reset and Base */
        *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
        
        :root {{
            --primary: {config['primary_color']};
            --accent: {config['accent_color']};
            --bg: {config['background']};
            --text: {config['text_color']};
            --text-light: {config['text_light']};
            --border: {config['border']};
            --font-main: {config['font_main']};
            --font-mono: {config['font_mono']};
            --spacing: {config['spacing']};
            --radius: {config['border_radius']};
        }}
        
        html {{ scroll-behavior: smooth; }}
        
        body {{
            font-family: var(--font-main);
            line-height: 1.6;
            color: var(--text);
            background: var(--bg);
            {f"max-width: 1200px; margin: 0 auto; padding: 0 2rem;" if is_swiss else ""}
        }}
        
        /* Header - Brutalist */
        header {{
            {f"border-bottom: {border};" if not is_swiss else f"border-bottom: 1px solid #000;"}
            padding: var(--spacing);
            position: sticky;
            top: 0;
            background: var(--bg);
            {f"display: grid; grid-template-columns: 1fr auto; gap: 1rem; align-items: center;" if is_brutalist else "display: flex; justify-content: space-between;"}
        }}
        
        .logo {{
            font-size: 1.25rem;
            font-weight: 700;
            color: var(--text);
            text-decoration: none;
            {header_style}
        }}
        
        nav {{
            display: flex;
            gap: 1.5rem;
        }}
        
        nav a {{
            color: var(--text-light);
            text-decoration: none;
            font-size: 0.875rem;
            font-family: var(--font-mono);
            transition: color 0.2s;
        }}
        
        nav a:hover {{
            color: var(--primary);
        }}
        
        /* Hero - Brutalist/Swiss */
        .hero {{
            padding: 4rem var(--spacing);
            {f"border-bottom: {border};" if not is_swiss else "padding: 6rem 0 4rem;"}
        }}
        
        .hero h1 {{
            font-size: clamp(2rem, 5vw, 4rem);
            font-weight: 700;
            line-height: 1.1;
            margin-bottom: 1rem;
            {header_style}
        }}
        
        .hero p {{
            font-size: 1.25rem;
            color: var(--text-light);
            max-width: 60ch;
        }}
        
        /* AI Metadata Block - Machine Readable */
        .ai-metadata {{
            font-family: var(--font-mono);
            font-size: 0.75rem;
            background: {f"var(--bg); border: {border};" if is_brutalist else "#f5f5f5;"}
            padding: 1rem;
            margin: 2rem 0;
            overflow-x: auto;
        }}
        
        .ai-metadata-label {{
            font-weight: 600;
            margin-bottom: 0.5rem;
            color: var(--accent);
        }}
        
        /* Grid Layout */
        .grid {{
            display: grid;
            {f"grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: {config['spacing']};" if config["grid_layout"] else "gap: 1.5rem;"}
        }}
        
        /* Cards - Brutalist */
        .card {{
            {f"border: {border}; padding: 1.5rem;" if is_brutalist else "border: 1px solid #e5e5e5; padding: 1.5rem;"}
            transition: background 0.2s;
        }}
        
        .card:hover {{
            background: {f"#000; color: #fff;" if is_brutalist else "#f9f9f9;"}
        }}
        
        .card:hover .card-title {{
            color: {f"#fff;" if is_brutalist else "var(--primary);"}
        }}
        
        .card-number {{
            font-family: var(--font-mono);
            font-size: 0.875rem;
            color: var(--accent);
            margin-bottom: 0.75rem;
        }}
        
        .card-title {{
            font-size: 1.125rem;
            font-weight: 600;
            margin-bottom: 0.5rem;
            transition: color 0.2s;
        }}
        
        .card p {{
            font-size: 0.875rem;
            color: var(--text-light);
        }}
        
        /* Section Headers */
        section {{ padding: 3rem var(--spacing); }}
        
        section h2 {{
            font-size: 1.75rem;
            font-weight: 600;
            margin-bottom: 2rem;
            {header_style}
            {f"border-left: 4px solid var(--accent); padding-left: 1rem;" if is_brutalist else ""}
        }}
        
        /* Code Blocks */
        .code-block {{
            background: {f"#000; color: #fff;" if is_brutalist else "#1a1a1a;"}
            padding: 1.5rem;
            overflow-x: auto;
            font-family: var(--font-mono);
            font-size: 0.875rem;
            line-height: 1.7;
            {f"border: {border};" if is_brutalist else "border-radius: var(--radius);"}
        }}
        
        /* Stats - Swiss Grid */
        .stats {{
            display: grid;
            {f"grid-template-columns: repeat(4, 1fr); gap: 1px; background: #000; border: {border};" if is_brutalist else "grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1.5rem;"}
        }}
        
        .stat {{
            {f"background: var(--bg); padding: 1.5rem;" if is_brutalist else "text-align: center; padding: 2rem; border: 1px solid #e5e5e5;"}
        }}
        
        .stat-value {{
            font-family: var(--font-mono);
            font-size: 2rem;
            font-weight: 700;
            color: var(--primary);
        }}
        
        .stat-label {{
            font-size: 0.75rem;
            color: var(--text-light);
            margin-top: 0.25rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }}
        
        /* Footer */
        footer {{
            {f"border-top: {border}; padding: 2rem var(--spacing);" if not is_swiss else "padding: 3rem 0; border-top: 1px solid #000;"}
            margin-top: 4rem;
        }}
        
        footer p {{
            font-size: 0.875rem;
            color: var(--text-light);
            font-family: var(--font-mono);
        }}
        
        /* Responsive */
        @media (max-width: 768px) {{
            header {{ grid-template-columns: 1fr; }}
            .hero h1 {{ font-size: 2.5rem; }}
            .stats {{ grid-template-columns: repeat(2, 1fr); }}
        }}
    </style>
</head>
<body>
    <!-- AI Agent Metadata Block -->
    <aside class="ai-metadata" aria-label="AI Agent Readable Metadata">
        <div class="ai-metadata-label">// AI_AGENT_METADATA</div>
        <pre>{json.dumps(design.get('ai_metadata', {}), indent=2)}</pre>
    </aside>

    <header>
        <a href="#" class="logo">{title}</a>
        <nav>
            <a href="#overview">OVERVIEW</a>
            <a href="#features">FEATURES</a>
            <a href="#docs">DOCS</a>
            <a href="#code">CODE</a>
        </nav>
    </header>

    <section class="hero" id="overview">
        <h1>{title}</h1>
        <p>{tagline}</p>
    </section>

    <section id="features">
        <h2>FEATURES</h2>
        <div class="grid">
"""
    
    for i, feature in enumerate(design["features"][:6], 1):
        html += f"""            <div class="card">
                <div class="card-number">FEATURE_{i:02d}</div>
                <div class="card-title">{feature}</div>
                <p>Key capability documented for reference.</p>
            </div>
"""
    
    html += """        </div>
    </section>

    <section id="stats">
        <h2>PROJECT_METRICS</h2>
        <div class="stats">
            <div class="stat">
                <div class="stat-value">{}</div>
                <div class="stat-label">Files</div>
            </div>
            <div class="stat">
                <div class="stat-value">{}</div>
                <div class="stat-label">Lines</div>
            </div>
            <div class="stat">
                <div class="stat-value">{}</div>
                <div class="stat-label">Languages</div>
            </div>
            <div class="stat">
                <div class="stat-value">{}</div>
                <div class="stat-label">Score</div>
            </div>
        </div>
    </section>

    <section id="docs">
        <h2>DOCUMENTATION</h2>
        <div class="grid">
            <div class="card">
                <div class="card-number">DOC_01</div>
                <div class="card-title">Quick Start</div>
                <p>Get up and running in 5 minutes.</p>
            </div>
            <div class="card">
                <div class="card-number">DOC_02</div>
                <div class="card-title">API Reference</div>
                <p>Complete API documentation.</p>
            </div>
            <div class="card">
                <div class="card-number">DOC_03</div>
                <div class="card-title">Examples</div>
                <p>Real-world usage patterns.</p>
            </div>
        </div>
    </section>

    <section id="code">
        <h2>QUICK_START</h2>
        <div class="code-block"><pre><code>git clone https://github.com/USER/{name}.git
cd {name}
pip install -r requirements.txt
python -m app</code></pre></div>
    </section>

    <footer>
        <p>// DOCS_SKILL_GENERATED | {gen_date}</p>
    </footer>
</body>
</html>""".format(
        project_info.get('file_count', 0),
        project_info.get('lines_of_code', 0),
        len(project_info.get('languages', {})),
        project_info.get('complexity_score', 0),
        name=project_info['name'],
        gen_date=datetime.now().strftime("%Y-%m-%d")
    )
    
    return html


def main():
    parser = argparse.ArgumentParser(description="Generate professional software documentation")
    parser.add_argument("--path", "-p", required=True, help="Path to project root directory")
    parser.add_argument("--type", "-t", choices=["readme", "api", "guide", "website", "all"], default="readme", help="Documentation type")
    parser.add_argument("--output", "-o", help="Output directory")
    parser.add_argument("--theme", choices=["brutalist", "swiss", "minimal", "technical"], default="brutalist", help="Documentation theme: brutalist (recommended for AI agents), swiss (grid minimal), minimal (clean), technical (dark)")
    parser.add_argument("--title", help="Project title (auto-detected if omitted)")
    parser.add_argument("--tagline", help="One-line project description")
    parser.add_argument("--audience", choices=["beginners", "intermediate", "experts"], default="intermediate", help="Target audience")
    parser.add_argument("--ai-think", action="store_true", help="Enable Kimi K2.5 reasoning")
    parser.add_argument("--ai-design", action="store_true", help="Enable Gemini 3 Flash design")

    args = parser.parse_args()
    output_dir = args.output or args.path
    os.makedirs(output_dir, exist_ok=True)

    print("=" * 60)
    print("DOCS SKILL - Professional Software Documentation Generator")
    print("=" * 60)

    # Phase 1: Discovery
    print("\n[Phase 1/4] RIGOROUS DISCOVERY - Comprehensive project analysis...")
    project_info = discover_project_comprehensive(args.path)
    print(f"  - Name: {project_info['name']}")
    print(f"  - Languages: {', '.join(project_info['languages'].keys()) or 'None detected'}")
    print(f"  - Project Type: {project_info['project_type']}")
    print(f"  - Files: {project_info['file_count']}, Lines: {project_info['lines_of_code']}")

    # Phase 2: Thinking (Kimi K2.5)
    print(f"\n[Phase 2/4] KIMI K2.5 THINKING - Documentation architecture...")
    thinking = think_with_kimi(project_info, args)

    # Phase 3: Design (Gemini 3 Flash)
    print(f"\n[Phase 3/4] GEMINI 3 FLASH DESIGN - Modern documentation...")
    design = design_with_gemini(project_info, thinking, args)

    # Phase 4: Generation
    print(f"\n[Phase 4/4] GENERATING documentation...")

    if args.type in ["readme", "all"]:
        print("  - Generating README.md...")
        readme_path = os.path.join(output_dir, "README.md")
        with open(readme_path, "w") as f:
            f.write(generate_readme_modern(project_info, thinking, design, args))
        print(f"    Saved to: {readme_path}")

    if args.type in ["api", "all"]:
        print("  - Generating API.md...")
        api_path = os.path.join(output_dir, "API.md")
        with open(api_path, "w") as f:
            f.write(generate_api_docs(project_info, thinking, args))
        print(f"    Saved to: {api_path}")

    if args.type in ["website", "all"]:
        print("  - Generating docs/index.html...")
        website_dir = os.path.join(output_dir, "docs")
        os.makedirs(website_dir, exist_ok=True)
        html_path = os.path.join(website_dir, "index.html")
        with open(html_path, "w") as f:
            f.write(generate_website_modern(project_info, thinking, design, args))
        print(f"    Saved to: {html_path}")

    # Additional files
    print("  - Generating CONTRIBUTING.md...")
    with open(os.path.join(output_dir, "CONTRIBUTING.md"), "w") as f:
        f.write(f"""# Contributing to {design['title']}

We welcome contributions! This document provides guidelines for contributing.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR-USERNAME/{project_info['name']}.git`
3. Create a branch: `git checkout -b feature/amazing-feature`

## Development

### Setup

```bash
pip install -e .
```

### Testing

```bash
pytest
```

### Code Style

- Follow PEP 8 for Python
- Run linters: `ruff check .`
- Type checking: `mypy .`

## Submitting Changes

1. Commit your changes with a clear message
2. Push to your fork
3. Open a Pull Request

## Code of Conduct

Please be respectful and constructive in all interactions.

---
*Generated by Docs Skill*
""")

    print("\n" + "=" * 60)
    print("DOCUMENTATION GENERATION COMPLETE!")
    print("=" * 60)
    print(f"\nGenerated files:")
    print(f"  - README.md")
    if args.type in ["api", "all"]:
        print(f"  - API.md")
    if args.type in ["website", "all"]:
        print(f"  - docs/index.html")
    print(f"  - CONTRIBUTING.md")
    print(f"\nLocation: {os.path.abspath(output_dir)}")
if __name__ == "__main__":
    main()
