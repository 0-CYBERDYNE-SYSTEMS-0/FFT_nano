---
name: responsive-web-design
description: Mobile-first responsive design with modern CSS Grid, Flexbox, and accessibility
metadata:
  legacy_slug: responsive_web_design
  legacy_summary: Mobile-first responsive design with modern CSS Grid, Flexbox,
    and accessibility
  legacy_version: "1.0"
  legacy_author: FF-Terminal
  legacy_priority: medium
  legacy_triggers: '["responsive","mobile","mobile-first","cross-device","tablet","phone","desktop","layout","grid","flexbox","web_design","layout_design","mobile_optimization","responsive.*design","mobile.*friendly","cross.*device","adapt.*layout"]'
  legacy_category: design
  legacy_dependencies: '["frontend_design"]'
  legacy_config: '{"breakpoints":{"mobile":640,"tablet":768,"desktop":1024,"wide":1280},"layout_strategies":["mobile_first","desktop_first","progressive_enhancement","graceful_degradation"],"responsive_units":["viewport","percentage","em","rem","vw/vh"]}'
---

# Responsive Web Design Skill Instructions

## When to use this skill
- Use when the user request matches this skill's domain and capabilities.
- Use when this workflow or toolchain is explicitly requested.

## When not to use this skill
- Do not use when another skill is a better direct match for the task.
- Do not use when the request is outside this skill's scope.

You are an expert responsive web designer who creates mobile-first, cross-device compatible interfaces. When this skill is triggered, apply modern responsive design patterns:

## Mobile-First Philosophy

### 1. Progressive Enhancement
- Start with mobile design (320px+)
- Enhance for tablet (768px+)
- Optimize for desktop (1024px+)
- Add extras for wide screens (1280px+)

### 2. Breakpoint Strategy
```css
/* Mobile-first breakpoints */
:root {
    --break-mobile: 320px;
    --break-tablet: 768px;
    --break-desktop: 1024px;
    --break-wide: 1280px;
}

/* Base styles (mobile) */
.container {
    padding: var(--space-3);
    max-width: 100%;
}

/* Tablet enhancements */
@media (min-width: 768px) {
    .container {
        padding: var(--space-4);
        max-width: 720px;
        margin: 0 auto;
    }
}

/* Desktop enhancements */
@media (min-width: 1024px) {
    .container {
        padding: var(--space-6);
        max-width: 960px;
    }
}

/* Wide screen enhancements */
@media (min-width: 1280px) {
    .container {
        padding: var(--space-8);
        max-width: 1200px;
    }
}
```

## Responsive Layout Systems

### 1. CSS Grid for Complex Layouts
```css
/* Responsive grid system */
.responsive-grid {
    display: grid;
    gap: var(--space-4);
    /* Mobile: 1 column */
    grid-template-columns: 1fr;
}

@media (min-width: 768px) {
    /* Tablet: 2 columns */
    .responsive-grid {
        grid-template-columns: repeat(2, 1fr);
    }
}

@media (min-width: 1024px) {
    /* Desktop: 3 columns */
    .responsive-grid {
        grid-template-columns: repeat(3, 1fr);
    }
}

@media (min-width: 1280px) {
    /* Wide: 4 columns */
    .responsive-grid {
        grid-template-columns: repeat(4, 1fr);
    }
}

/* Auto-fit responsive grid */
.auto-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: var(--space-4);
}

/* Auto-fill with minimum size */
.feature-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: var(--space-4);
}
```

### 2. Flexbox for Component Layouts
```css
/* Responsive flexbox layout */
.flex-container {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

@media (min-width: 768px) {
    .flex-container {
        flex-direction: row;
        flex-wrap: wrap;
    }
}

/* Responsive flexbox cards */
.flex-cards {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.flex-card {
    flex: 1;
}

@media (min-width: 768px) {
    .flex-cards {
        flex-direction: row;
    }
    
    .flex-card {
        flex: 1 1 45%;
    }
}

@media (min-width: 1024px) {
    .flex-card {
        flex: 1 1 30%;
    }
}
```

### 3. Container Queries (Modern)
```css
/* Component-level responsiveness */
.component-container {
    container-type: inline-size;
}

/* Card adapts to available space */
.adaptive-card {
    padding: var(--space-3);
}

@container (min-width: 400px) {
    .adaptive-card {
        padding: var(--space-4);
        display: grid;
        grid-template-columns: 1fr 2fr;
        gap: var(--space-3);
    }
}

@container (min-width: 600px) {
    .adaptive-card {
        padding: var(--space-6);
        grid-template-columns: 1fr 3fr 1fr;
    }
}
```

## Responsive Typography

### 1. Fluid Typography Scale
```css
/* Fluid typography using clamp() */
:root {
    --font-fluid-sm: clamp(0.875rem, 0.875rem + 0.25vw, 1rem);
    --font-fluid-base: clamp(1rem, 1rem + 0.25vw, 1.125rem);
    --font-fluid-lg: clamp(1.125rem, 1.125rem + 0.5vw, 1.5rem);
    --font-fluid-xl: clamp(1.5rem, 1.5rem + 1vw, 2.25rem);
    --font-fluid-2xl: clamp(2.25rem, 2.25rem + 1.5vw, 3rem);
    --font-fluid-3xl: clamp(3rem, 3rem + 2vw, 4rem);
}

h1 { font-size: var(--font-fluid-3xl); line-height: 1.2; }
h2 { font-size: var(--font-fluid-2xl); line-height: 1.3; }
h3 { font-size: var(--font-fluid-xl); line-height: 1.4; }
h4 { font-size: var(--font-fluid-lg); line-height: 1.5; }
p { font-size: var(--font-fluid-base); line-height: 1.6; }
small { font-size: var(--font-fluid-sm); line-height: 1.6; }
```

### 2. Responsive Spacing
```css
/* Responsive spacing using custom properties */
.responsive-section {
    padding: var(--space-4);
    margin-bottom: var(--space-6);
}

@media (min-width: 768px) {
    .responsive-section {
        padding: var(--space-6);
        margin-bottom: var(--space-8);
    }
}

@media (min-width: 1024px) {
    .responsive-section {
        padding: var(--space-8);
        margin-bottom: var(--space-12);
    }
}

/* Container padding for breakpoints */
.responsive-container {
    padding: var(--space-3);
}

@media (min-width: 768px) {
    .responsive-container {
        padding: var(--space-4) var(--space-6);
    }
}

@media (min-width: 1024px) {
    .responsive-container {
        padding: var(--space-6) var(--space-8);
    }
}
```

## Touch and Mobile Optimization

### 1. Touch-Friendly Targets
```css
/* Minimum touch target 44px */
.touch-target {
    min-height: 44px;
    min-width: 44px;
    padding: var(--space-2) var(--space-3);
}

/* Large tap areas for mobile */
.mobile-button {
    padding: var(--space-3) var(--space-4);
    font-size: var(--font-lg);
    min-height: 48px;
}

/* Spacing for touch accuracy */
.mobile-link {
    display: block;
    padding: var(--space-3);
    margin: var(--space-2) 0;
}

/* Touch-optimized form inputs */
.mobile-input {
    font-size: 16px; /* Prevents zoom on iOS */
    padding: var(--space-3);
    min-height: 48px;
    border-radius: var(--space-2);
}
```

### 2. Mobile Navigation Patterns
```css
/* Hamburger menu for mobile */
.mobile-nav {
    display: block;
}

.desktop-nav {
    display: none;
}

@media (min-width: 768px) {
    .mobile-nav { display: none; }
    .desktop-nav { display: flex; }
}

/* Mobile navigation drawer */
.nav-drawer {
    position: fixed;
    top: 0;
    left: -100%;
    width: 280px;
    height: 100vh;
    background: white;
    z-index: 1000;
    transition: left 0.3s ease;
}

.nav-drawer.open {
    left: 0;
}

.nav-drawer-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 999;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.3s ease, visibility 0.3s ease;
}

.nav-drawer-overlay.open {
    opacity: 1;
    visibility: visible;
}
```

### 3. Mobile-Specific Optimizations
```css
/* Viewport meta for mobile */
<meta name="viewport" content="width=device-width, initial-scale=1.0">

/* Prevent horizontal scrolling on mobile */
body {
    overflow-x: hidden;
    -webkit-text-size-adjust: 100%;
}

/* Mobile-first image sizing */
.responsive-image {
    max-width: 100%;
    height: auto;
}

/* Mobile table patterns */
.mobile-table {
    display: block;
    width: 100%;
    overflow-x: auto;
}

@media (min-width: 768px) {
    .mobile-table {
        display: table;
    }
}
```

## Performance and Optimization

### 1. Responsive Images
```html
<!-- Art direction for responsive images -->
<picture>
    <source media="(min-width: 1024px)" srcset="hero-large.webp">
    <source media="(min-width: 768px)" srcset="hero-medium.webp">
    <img src="hero-small.webp" alt="Hero image" loading="lazy">
</picture>

<!-- Density switching for high-DPI displays -->
<img src="image-1x.webp" 
     srcset="image-1x.webp 1x, image-2x.webp 2x"
     alt="Responsive image" loading="lazy">

<!-- Responsive embedded images -->
<style>
.hero-image {
    background-image: url('hero-small.webp');
}

@media (min-width: 768px) {
    .hero-image {
        background-image: url('hero-medium.webp');
    }
}

@media (min-width: 1024px) {
    .hero-image {
        background-image: url('hero-large.webp');
    }
}
</style>
```

### 2. CSS Optimization for Responsive Design
```css
/* Efficient media queries */
@media (min-width: 768px) and (max-width: 1023px) {
    /* Tablet-specific styles */
}

/* Container queries for component adaptation */
@container (min-width: 300px) and (max-width: 600px) {
    /* Component-specific responsive styles */
}

/* Reduce motion on mobile */
@media (prefers-reduced-motion: reduce), (max-width: 768px) {
    .animated {
        animation: none;
        transition: none;
    }
}

/* Dark mode support */
@media (prefers-color-scheme: dark) {
    .responsive-component {
        background: var(--color-neutral-dark);
        color: var(--color-text-dark);
    }
}
```

## Responsive Component Patterns

### 1. Responsive Card Grid
```html
<div class="responsive-cards">
    <article class="card">
        <img src="image.jpg" alt="Card image" loading="lazy">
        <h3>Card Title</h3>
        <p>Card content...</p>
    </article>
    <!-- More cards -->
</div>

<style>
.responsive-cards {
    display: grid;
    gap: var(--space-4);
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}

.card {
    background: white;
    border-radius: var(--space-2);
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    overflow: hidden;
    transition: transform 0.2s ease;
}

.card:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 25px rgba(0,0,0,0.15);
}

.card img {
    width: 100%;
    height: 200px;
    object-fit: cover;
}

.card h3 {
    padding: var(--space-3);
    margin: 0;
    font-size: var(--font-lg);
}

.card p {
    padding: 0 var(--space-3) var(--space-3);
    margin: 0;
    color: var(--color-secondary);
}
</style>
```

### 2. Responsive Sidebar Layout
```html
<div class="responsive-layout">
    <aside class="sidebar">
        <nav class="sidebar-nav">
            <!-- Navigation items -->
        </nav>
    </aside>
    
    <main class="main-content">
        <!-- Main content -->
    </main>
</div>

<style>
.responsive-layout {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
}

.sidebar {
    order: 2;
    width: 100%;
    background: var(--color-neutral);
    padding: var(--space-4);
}

.main-content {
    order: 1;
    flex: 1;
    padding: var(--space-4);
}

@media (min-width: 768px) {
    .responsive-layout {
        flex-direction: row;
    }
    
    .sidebar {
        order: 1;
        width: 250px;
        min-height: 100vh;
    }
    
    .main-content {
        order: 2;
    }
}

@media (min-width: 1024px) {
    .sidebar {
        width: 300px;
    }
}
</style>
```

### 3. Responsive Header
```html
<header class="responsive-header">
    <div class="header-brand">
        <img src="logo.svg" alt="Logo" class="logo">
        <span class="brand-name">Brand</span>
    </div>
    
    <button class="mobile-menu-toggle" aria-label="Toggle menu">
        <span></span>
        <span></span>
        <span></span>
    </button>
    
    <nav class="header-nav" aria-label="Main navigation">
        <ul>
            <li><a href="#home">Home</a></li>
            <li><a href="#about">About</a></li>
            <li><a href="#services">Services</a></li>
            <li><a href="#contact">Contact</a></li>
        </ul>
    </nav>
</header>

<style>
.responsive-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-3);
    background: white;
    border-bottom: 1px solid var(--color-border);
}

.header-brand {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.logo {
    width: 32px;
    height: 32px;
}

.brand-name {
    font-size: var(--font-lg);
    font-weight: 700;
    color: var(--color-primary);
}

.mobile-menu-toggle {
    display: flex;
    flex-direction: column;
    justify-content: space-around;
    width: 32px;
    height: 32px;
    background: transparent;
    border: none;
    cursor: pointer;
}

.mobile-menu-toggle span {
    width: 24px;
    height: 2px;
    background: var(--color-primary);
    transition: all 0.3s ease;
}

.header-nav {
    display: none;
}

@media (min-width: 768px) {
    .mobile-menu-toggle { display: none; }
    .header-nav { 
        display: flex; 
        align-items: center;
    }
    
    .header-nav ul {
        display: flex;
        list-style: none;
        margin: 0;
        padding: 0;
        gap: var(--space-4);
    }
    
    .header-nav a {
        padding: var(--space-2) var(--space-3);
        color: var(--color-primary);
        text-decoration: none;
        border-radius: var(--space-1);
        transition: background 0.2s ease;
    }
    
    .header-nav a:hover {
        background: var(--color-primary);
        color: white;
    }
}
</style>
```

## Testing and Debugging

### 1. Responsive Testing Approach
```javascript
// Add viewport indicator for development
function addViewportIndicator() {
    if (window.location.hostname === 'localhost') {
        const indicator = document.createElement('div');
        indicator.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: rgba(0,0,0,0.8);
            color: white;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            z-index: 9999;
            font-family: monospace;
        `;
        
        const updateIndicator = () => {
            indicator.textContent = `${window.innerWidth}x${window.innerHeight}`;
        };
        
        updateIndicator();
        window.addEventListener('resize', updateIndicator);
        
        document.body.appendChild(indicator);
    }
}

// Detect device type
function getDeviceType() {
    const width = window.innerWidth;
    if (width < 768) return 'mobile';
    if (width < 1024) return 'tablet';
    return 'desktop';
}
```

### 2. Common Responsive Issues and Solutions
```css
/* Prevent horizontal scrolling */
.responsive-container {
    max-width: 100%;
    overflow-x: hidden;
    box-sizing: border-box;
}

/* Fix iOS viewport bug */
.ios-fix {
    padding-bottom: env(safe-area-inset-bottom);
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
}

/* Handle cut off text */
.text-truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* Responsive text wrapping */
.text-responsive {
    word-wrap: break-word;
    overflow-wrap: break-word;
    hyphens: auto;
}
```

## Implementation Strategy

When creating responsive designs:

1. **Mobile-First**: Start with mobile design and progressively enhance
2. **Touch-Optimized**: Ensure minimum 44px touch targets
3. **Performance**: Optimize images and CSS for each breakpoint
4. **Accessibility**: Maintain accessibility across all device sizes
5. **Testing**: Test on actual devices, not just browser resizing
6. **Progressive Enhancement**: Core functionality works everywhere
7. **Flexible Units**: Use rem, em, %, vw, vh for scalability
8. **Modern CSS**: Leverage Grid, Flexbox, and Container Queries

Create responsive interfaces that provide optimal user experience across all devices and screen sizes.
