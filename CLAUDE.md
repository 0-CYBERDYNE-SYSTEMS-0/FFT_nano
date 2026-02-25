# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FFT Nano is a single-page marketing/e-commerce site for FarmFriend's edge-native agricultural AI hardware and services. The entire site lives in **`index.html`** — one large file (~3500 lines) containing all HTML, CSS, and JavaScript inline.

## Architecture

### Single-File Structure (`index.html`)
All code is in one file. Key sections by line range (approximate):
- **CSS** — lines 1–2420 (all styles inline in `<style>`)
- **HTML** — lines 2420–3400 (nav, hero, sections, footer)
- **JavaScript** — lines 3300–3559 (scroll reveal, mobile menu, slide viewer, Calendly integration)

### Page Sections (in order)
1. `nav` — fixed top navigation with desktop links + hamburger mobile menu
2. `#demo-video` — embedded video section
3. `#what-is` — product explainer with feature cards grid
4. `#why-matters` — value proposition cards
5. `#products` — product catalog cards
6. `#get-started` — onboarding steps
7. `.presentation-section` — slide viewer (loads PNGs from `slides/terminal-pitchdeck/`)
8. `#support` — support plans + sponsors
9. `#skills-ecosystem` — skills marketplace section
10. `#contact` — contact/demo form (Calendly integration)
11. `footer` — links and legal

### Assets
- `assets/backgrounds/hero-bg.jpg` — hero background image
- `assets/fft_nano-hero.mp4` / `assets/fft_nano-hero-voice.mp4` — demo videos
- `assets/images/` — product and section images
- `slides/terminal-pitchdeck/slide-01.png` through `slide-17.png` — pitch deck slides loaded by JS slide viewer

### Design Tokens (CSS variables)
```
--brand-primary: #b55620        (burnt orange)
--brand-accent: #5a9ab8         (steel blue)
--earth-dark: #0a0908
--earth-mid: #1a1814
--earth-light: #2a2824
--cream: #faf8f5
--font-display: 'Cormorant Garamond', serif
--font-body: 'Space Grotesk', sans-serif
--font-mono: 'JetBrains Mono', monospace
```

### Key JS Behaviors
- **Scroll reveal** — `IntersectionObserver` adds `.visible` class to `<section>` elements
- **Mobile menu** — `#mobileMenu` overlay toggled by hamburger; `body.menu-open` disables scroll
- **Slide viewer** — manually navigates through `slides/terminal-pitchdeck/slide-XX.png`
- **Calendly** — embedded via external widget script for demo booking

## Development Workflow

This is a static site with no build step. To preview:
```bash
# Open in browser directly
open index.html

# Or serve locally
python3 -m http.server 8080
```

### Background/asset generation scripts (Python, Pillow required)
```bash
pip install Pillow numpy
python3 gen_v6.py          # Regenerate terrain background images
python3 generate_backgrounds.py
python3 screenshot_analysis.py  # Analyze screenshots for legibility
```

## Important Conventions

- **No framework, no bundler** — pure HTML/CSS/JS, keep it that way unless explicitly requested
- **Responsive** — use `clamp()` for fluid sizing; breakpoints at 768px (tablet) and 480px (mobile)
- **Scroll reveal pattern** — new sections should follow the existing `IntersectionObserver` pattern; add `opacity: 0` initial state and `section.visible` styles
- **Section dividers** — industrial-style horizontal rules (`.industrial-divider`) separate major sections
- **Color discipline** — stick to CSS variables; do not hard-code colors directly
- The many `*.md` report files in root are audit artifacts — do not delete, but do not add more unless producing a meaningful deliverable
