---
name: hugging-face-paper-publisher
description: This skill enables publishing and managing research papers on the
  Hugging Face Hub. It supports creating paper pages, linking papers to models
  and datasets, claiming authorship, and managing paper metadata. The skill
  helps researchers share their work with the ML community and integrate papers
  with reproducible code and models.
allowed-tools: run_command write_file read_file tavily_search search_code
metadata:
  legacy_slug: hugging_face_paper_publisher
  legacy_summary: Publish and manage research papers on Hugging Face Hub with
    model and dataset linking
  legacy_version: 0.1.0
  legacy_tags: '["research","publishing","Hugging
    Face","academic","papers","models","datasets"]'
  legacy_triggers: '["publish paper","research paper","hugging face hub","academic
    publishing","paper management","authorship","citation"]'
  legacy_priority: default
  legacy_assets: "[]"
  legacy_recommended_tools: '["run_command","write_file","read_file","tavily_search","search_code"]'
---

# Hugging Face Paper Publisher Skill

## When to use this skill
- Use when the user request matches this skill's domain and capabilities.
- Use when this workflow or toolchain is explicitly requested.

## When not to use this skill
- Do not use when another skill is a better direct match for the task.
- Do not use when the request is outside this skill's scope.

## Overview
This skill helps you publish and manage research papers on the Hugging Face Hub, enabling seamless integration with models, datasets, and reproducible research.

## Core Capabilities

### 1. Paper Creation and Publishing
- Create new paper pages on Hugging Face Hub
- Format paper content with proper markdown structure
- Add paper metadata (title, authors, abstract, keywords)
- Upload PDF versions and supplementary materials
- Set paper visibility (public/private)

### 2. Model and Dataset Integration
- Link papers to associated models on the Hub
- Connect papers with relevant datasets
- Create reproducible research workflows
- Add code snippets and implementation details
- Set up automatic model card generation

### 3. Authorship and Attribution
- Claim and verify authorship
- Manage contributor lists and affiliations
- Add ORCID integration for author identification
- Handle citation and reference management
- Update author information over time

### 4. Paper Management
- Update existing papers with new versions
- Add errata and corrections
- Manage paper discussions and community feedback
- Track paper metrics and usage statistics
- Handle paper withdrawal or retraction

## Usage Instructions

### Publishing a New Paper
1. Prepare your paper content in markdown format
2. Gather paper metadata (title, authors, abstract, etc.)
3. Create a new paper repository on Hugging Face Hub
4. Upload PDF and supplementary materials
5. Link associated models and datasets
6. Set appropriate visibility and licensing

### Linking Models and Datasets
1. Identify relevant models and datasets on the Hub
2. Create proper linking in paper metadata
3. Add reproducible code snippets
4. Set up automatic model card references
5. Ensure version compatibility

### Managing Authorship
1. Add all contributors with proper attribution
2. Include institutional affiliations
3. Add ORCID IDs for author verification
4. Update author information as needed
5. Handle author order and contributions

## Dependencies
- huggingface_hub
- datasets (for dataset integration)
- transformers (for model integration)
- PyPDF2 or pdfplumber (for PDF processing)
- python-markdown (for markdown processing)
- requests (for API interactions)

## Best Practices
- Use clear, descriptive titles and abstracts
- Include proper citations and references
- Provide reproducible code when possible
- Link to all relevant models and datasets
- Use appropriate open-source licenses
- Keep paper information up to date
- Engage with community feedback and discussions

## Integration Notes
- Works seamlessly with Hugging Face Hub API
- Supports integration with GitHub for code linking
- Compatible with various citation formats (APA, MLA, IEEE)
- Can be used with manuscript preparation tools
- Supports automated paper updates from version control

## Paper Structure Template
```markdown
# Paper Title

## Abstract
[Brief summary of the paper]

## Authors
- [Author Name](https://huggingface.co/author-username) - Institution

## Paper Content
[Full paper content in markdown format]

## Models Used
- [Model Name](https://huggingface.co/model-repo) - Description

## Datasets
- [Dataset Name](https://huggingface.co/dataset-repo) - Description

## Code Repository
[Link to GitHub or other code repository]

## Citation
```bibtex
@paper{citation-key,
  title={Paper Title},
  author={Author Names},
  year={Year},
  journal={Journal/Conference}
}
```
```
