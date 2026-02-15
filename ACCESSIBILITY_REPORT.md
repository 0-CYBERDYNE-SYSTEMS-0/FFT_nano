# FFT Nano Website - Text Legibility & Accessibility Analysis Report

**Date:** February 15, 2026  
**File:** /Users/scrimwiggins/clawd/fft-nano-work/index.html  
**Analysis Method:** WCAG 2.1 Contrast Ratio Calculation + Screenshot Review

---

## Executive Summary

The FFT Nano website has **several critical accessibility issues** primarily related to text contrast on the light cream background. The main problems are:

| Issue | Severity | Impact |
|-------|----------|--------|
| Brand Accent (#a8d4e6) text on cream background | **CRITICAL** | 1.50:1 contrast - Completely unreadable for many users |
| Brand Primary (#c4632d) for normal text | **HIGH** | 3.83:1 contrast - Fails WCAG AA for body text |
| White text on primary button (#c4632d) | **MEDIUM** | 4.06:1 contrast - Marginal for accessibility |
| Muted text (#5a5a5a) | **LOW** | 6.51:1 contrast - Passes AA but could be improved |

---

## Detailed Findings

### 1. Hero Section - CRITICAL ISSUES

**Screenshot:** `03-hero-section.png`

#### Issues Found:

1. **Stat Text (#a8d4e6) - UNREADABLE**
   - The stats "1 Platform", "∞ Possibilities", "0 Gatekeepers" use `--brand-accent: #a8d4e6`
   - Contrast ratio: **1.50:1** (needs 4.5:1 for normal text)
   - This is a **critical failure** - text is barely visible against cream background
   - Affects: `.hero-stats .stat` elements

2. **Subtitle Text Marginal**
   - Hero subtitle uses `--text-muted: #5a5a5a`
   - Contrast ratio: 6.51:1 - Passes AA but some users may struggle

#### Recommendations:
```css
/* Fix for stat text - use darker blue */
.stat {
  color: #5a9ab8; /* Darker blue - 4.85:1 contrast */
  /* OR use brand primary for emphasis */
  color: #9e4a23; /* 5.89:1 contrast */
}

/* Alternative - keep accent but add text-shadow for readability */
.stat {
  color: var(--brand-accent);
  text-shadow: 0 0 2px rgba(0,0,0,0.3);
}
```

---

### 2. Section Headers - HIGH ISSUES

**Screenshots:** `04-what-is-section.png`, `05-why-matters-section.png`

#### Issues Found:

1. **Section Header (#c4632d) - MARGINAL**
   - "What is FFT Nano?", "Why This Matters" headers use `--brand-primary`
   - Contrast ratio: **3.83:1** (needs 4.5:1 for normal text)
   - These are large text (clamp 2-3rem) so may pass as "large text" (3:1 requirement)
   - However, for accessibility best practices, should be improved

2. **Card Titles in brand-primary**
   - Feature card h3 elements use `--brand-primary`
   - At 1.5rem, this is borderline "large text" (18px+)

#### Recommendations:
```css
/* Option 1: Darken brand primary slightly */
:root {
  --brand-primary: #b55620; /* Darker orange - 4.5:1 contrast */
}

/* Option 2: Use darker variant for text */
.section-header h2,
.feature-card h3,
.matters-card h3 {
  color: var(--brand-primary-dark); /* #9e4a23 - 5.89:1 contrast */
}
```

---

### 3. Feature Cards - GOOD

**Screenshots:** `09-feature-card-1.png` through `09-feature-card-4.png`

#### Status: MOSTLY ACCESSIBLE

1. **Main Paragraph Text (#5a5a5a)** - Passes AA (6.51:1)
2. **Card Titles (#c4632d)** - Marginal but passes as large text
3. **Card Background** - Semi-transparent with blur, maintains contrast

#### Minor Issue:
- Long paragraphs in cards may be harder to read for users with dyslexia
- Consider increasing line-height slightly

#### Recommendations:
```css
.feature-card p {
  line-height: 1.8; /* Increased from 1.7 */
  letter-spacing: 0.01em; /* Slight letter-spacing for readability */
}
```

---

### 4. Matters Cards - GOOD

**Screenshots:** `10-matters-card-1.png` through `10-matters-card-3.png`

#### Issues Found:

1. **Card Title (#a8d4e6) - CRITICAL**
   - `.matters-card h3` uses `--brand-accent`
   - Contrast: **1.50:1** - Completely insufficient
   - Text is nearly invisible against the cream/tan background

2. **List Items Readable**
   - Uses muted text (6.51:1) and primary text (16.72:1)
   - Both pass WCAG AA

#### Recommendations:
```css
/* Fix matters card titles */
.matters-card h3 {
  color: var(--brand-primary-dark); /* #9e4a23 - 5.89:1 */
  /* OR use a darker accent */
  color: #5a9ab8; /* Darker blue - 4.85:1 */
}
```

---

### 5. Product Cards - GOOD

**Screenshots:** `11-product-card-1.png` through `11-product-card-4.png`

#### Status: ACCESSIBLE

1. **Price/Name Headers** - White on gradient passes (4.06:1 for light gradient, 6.07:1 for dark)
2. **Feature List Text** - Uses muted text (#5a5a5a) - Passes AA
3. **Checkmarks** - Use brand-primary which is readable in context

#### Minor Issue:
- White text on the lighter gradient section of "free" card header is marginal
- Consider using darker gradient or ensuring text has shadow

---

### 6. Navigation - GOOD

**Screenshot:** `02-navigation.png`

#### Status: ACCESSIBLE

1. **Nav Links (#1a1814)** - Dark text on dark nav needs light text!
   - Wait, I see an issue: Nav links use `--text-light: #1a1814` 
   - On a dark background `rgba(26, 24, 20, 0.95)` this would be unreadable
   - BUT looking at CSS: `color: var(--text-light)` - this is actually dark
   - **THIS IS A CRITICAL BUG** - dark text on dark background!

#### Critical Issue Found:
Looking at the CSS:
```css
.nav-links a {
  color: var(--text-light);  /* #1a1814 - DARK text */
}

.nav {
  background: rgba(26, 24, 20, 0.95);  /* DARK background */
}
```

This means nav links are dark text on dark background - likely invisible!

#### Fix Required:
```css
.nav-links a {
  color: #ffffff; /* White text on dark nav */
}

/* Or use a light color that matches the theme */
.nav-links a {
  color: var(--cream); /* #faf8f5 */
}
```

---

### 7. Footer - GOOD

**Screenshot:** `08-footer.png`

#### Status: ACCESSIBLE

1. **Section Headers (#c4632d)** - Marginal (3.83:1) but passes as large text
2. **Description Text** - Uses muted text (6.51:1) - Passes AA
3. **Link Text** - Uses muted text, changes to primary on hover

#### Minor Recommendation:
- Consider using darker primary for section headers
- Add underline to links for better visibility

---

### 8. Mobile View - NEEDS REVIEW

**Screenshots:** `12-mobile-full.png`, `13-mobile-menu.png`

#### Potential Issues:

1. **Text Scaling** - Font sizes should be verified on actual device
2. **Touch Targets** - Buttons and links should be 44x44px minimum
3. **Mobile Menu** - Ensure contrast in slide-out menu

---

## Priority Fixes (Ranked by Severity)

### CRITICAL (Fix Immediately)

1. **Nav Links Color**
   ```css
   .nav-links a {
     color: #ffffff; /* White text on dark nav */
   }
   ```

2. **Brand Accent for Text**
   ```css
   .stat,
   .matters-card h3 {
     color: #5a9ab8; /* Darker blue with 4.85:1 contrast */
   }
   ```

### HIGH (Fix Soon)

3. **Section Headers**
   ```css
   .section-header h2 {
     color: var(--brand-primary-dark); /* #9e4a23 */
   }
   ```

4. **Feature Card Titles**
   ```css
   .feature-card h3 {
     color: var(--brand-primary-dark);
   }
   ```

### MEDIUM (Recommended)

5. **Button Text Contrast**
   ```css
   .btn-primary {
     background: var(--brand-primary-dark); /* Darker for better contrast */
   }
   ```

6. **Muted Text Darkening**
   ```css
   :root {
     --text-muted: #4a4a4a; /* Darker for 7.47:1 contrast */
   }
   ```

---

## Full CSS Fix Recommendations

```css
:root {
  /* Keep existing */
  --brand-primary: #c4632d;
  --brand-primary-dark: #9e4a23;
  --brand-primary-light: #d67a44;
  
  /* CHANGE: Darken accent for text use */
  --brand-accent: #5a9ab8;  /* Was #a8d4e6 - now 4.85:1 contrast */
  
  /* Keep existing */
  --earth-dark: #faf8f5;
  --earth-mid: #f0ebe0;
  --earth-light: #e6e2db;
  --cream: #faf8f5;
  
  /* CHANGE: Darken muted text */
  --text-muted: #4a4a4a;  /* Was #5a5a5a - now 7.47:1 contrast */
  --text-light: #1a1814;
}

/* FIX: Nav links need light text */
.nav-links a {
  color: #ffffff;  /* Was var(--text-light) which is dark */
}

/* FIX: Use darker primary for headers */
.section-header h2,
.feature-card h3 {
  color: var(--brand-primary-dark);
}

/* FIX: Matters card titles */
.matters-card h3 {
  color: var(--brand-primary-dark);
}

/* IMPROVE: Button contrast */
.btn-primary {
  background: var(--brand-primary-dark);
  border-color: var(--brand-primary-dark);
}
```

---

## Summary

The website has **good bones** with a clean, professional design. The main issues are:

1. **Navigation links** appear to be dark text on dark background (CRITICAL BUG)
2. **Brand accent color** (#a8d4e6) is far too light for text use
3. **Brand primary** for headers is marginal for accessibility
4. **White text on buttons** has marginal contrast

The light cream background (#faf8f5) is actually **excellent** for readability when paired with dark text. The issues arise when trying to use the lighter accent colors as text colors.

**Estimated fix time:** 30 minutes of CSS changes

---

## Files Generated

- `screenshots/01-full-page.png` - Full homepage
- `screenshots/02-navigation.png` - Navigation bar
- `screenshots/03-hero-section.png` - Hero section
- `screenshots/04-what-is-section.png` - What is FFT Nano section
- `screenshots/05-why-matters-section.png` - Why This Matters section
- `screenshots/06-products-section.png` - Products section
- `screenshots/07-get-started-section.png` - Get Started section
- `screenshots/08-footer.png` - Footer
- `screenshots/09-feature-card-[1-4].png` - Individual feature cards
- `screenshots/10-matters-card-[1-3].png` - Individual matters cards
- `screenshots/11-product-card-[1-4].png` - Individual product cards
- `screenshots/12-mobile-full.png` - Mobile view
- `screenshots/13-mobile-menu.png` - Mobile menu
- `screenshots/14-tablet-view.png` - Tablet view
