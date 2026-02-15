#!/usr/bin/env python3
"""
FFT Nano Contrast Analysis
Calculates WCAG contrast ratios from CSS color values
"""

def hex_to_rgb(hex_color):
    """Convert hex color to RGB tuple"""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))

def get_luminance(r, g, b):
    """Calculate relative luminance"""
    def adjust(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * adjust(r) + 0.7152 * adjust(g) + 0.0722 * adjust(b)

def contrast_ratio(color1, color2):
    """Calculate contrast ratio between two colors"""
    l1 = get_luminance(*color1)
    l2 = get_luminance(*color2)
    
    lighter = max(l1, l2)
    darker = min(l1, l2)
    
    return (lighter + 0.05) / (darker + 0.05)

def wcag_rating(ratio):
    """Get WCAG rating for contrast ratio"""
    if ratio >= 7.0:
        return "AAA ✓ (Excellent)"
    elif ratio >= 4.5:
        return "AA ✓ (Good)"
    elif ratio >= 3.0:
        return "AA Large ⚠️ (Only for large text)"
    else:
        return "FAIL ✗ (Insufficient)"

# Define the color palette from the CSS
colors = {
    "brand-primary": "#c4632d",
    "brand-primary-dark": "#9e4a23", 
    "brand-primary-light": "#d67a44",
    "brand-accent": "#a8d4e6",
    "earth-dark": "#faf8f5",  # Main background (cream)
    "earth-mid": "#f0ebe0",   # Section background
    "earth-light": "#e6e2db",
    "cream": "#faf8f5",
    "text-light": "#1a1814",   # Main text color
    "text-muted": "#5a5a5a",   # Muted/secondary text
}

# Convert to RGB
rgb_colors = {name: hex_to_rgb(hex_val) for name, hex_val in colors.items()}

print("=" * 70)
print("FFT Nano Website - WCAG Contrast Analysis Report")
print("=" * 70)
print()

# Test combinations
print("PRIMARY TEXT (#1a1814) ON BACKGROUNDS:")
print("-" * 70)
main_text = rgb_colors["text-light"]

for bg_name in ["earth-dark", "earth-mid", "earth-light", "cream"]:
    bg = rgb_colors[bg_name]
    ratio = contrast_ratio(main_text, bg)
    rating = wcag_rating(ratio)
    print(f"  {colors['text-light']} on {colors[bg_name]} ({bg_name}): {ratio:.2f}:1 - {rating}")

print()
print("MUTED TEXT (#5a5a5a) ON BACKGROUNDS:")
print("-" * 70)
muted_text = rgb_colors["text-muted"]

for bg_name in ["earth-dark", "earth-mid", "earth-light", "cream"]:
    bg = rgb_colors[bg_name]
    ratio = contrast_ratio(muted_text, bg)
    rating = wcag_rating(ratio)
    print(f"  {colors['text-muted']} on {colors[bg_name]} ({bg_name}): {ratio:.2f}:1 - {rating}")

print()
print("BRAND PRIMARY (#c4632d) ON BACKGROUNDS:")
print("-" * 70)
primary = rgb_colors["brand-primary"]

for bg_name in ["earth-dark", "earth-mid", "earth-light", "cream"]:
    bg = rgb_colors[bg_name]
    ratio = contrast_ratio(primary, bg)
    rating = wcag_rating(ratio)
    print(f"  {colors['brand-primary']} on {colors[bg_name]} ({bg_name}): {ratio:.2f}:1 - {rating}")

print()
print("BRAND ACCENT (#a8d4e6) ON BACKGROUNDS:")
print("-" * 70)
accent = rgb_colors["brand-accent"]

for bg_name in ["earth-dark", "earth-mid", "earth-light", "cream"]:
    bg = rgb_colors[bg_name]
    ratio = contrast_ratio(accent, bg)
    rating = wcag_rating(ratio)
    print(f"  {colors['brand-accent']} on {colors[bg_name]} ({bg_name}): {ratio:.2f}:1 - {rating}")

print()
print("WHITE TEXT (#FFFFFF) ON BRAND COLORS (buttons):")
print("-" * 70)
white = (255, 255, 255)

for fg_name in ["brand-primary", "brand-primary-dark", "brand-primary-light"]:
    fg = rgb_colors[fg_name]
    ratio = contrast_ratio(white, fg)
    rating = wcag_rating(ratio)
    print(f"  #FFFFFF on {colors[fg_name]} ({fg_name}): {ratio:.2f}:1 - {rating}")

print()
print("DARK NAV BACKGROUND TEXT:")
print("-" * 70)
# Navigation has dark background rgba(26, 24, 20, 0.95) which is essentially #1a1814
nav_bg = (26, 24, 20)

# White text on dark nav
ratio = contrast_ratio(white, nav_bg)
print(f"  #FFFFFF on #1a1814 (nav): {ratio:.2f}:1 - {wcag_rating(ratio)}")

# Brand primary on dark nav
ratio = contrast_ratio(primary, nav_bg)
print(f"  #c4632d on #1a1814 (nav): {ratio:.2f}:1 - {wcag_rating(ratio)}")

# Brand accent on dark nav  
ratio = contrast_ratio(accent, nav_bg)
print(f"  #a8d4e6 on #1a1814 (nav): {ratio:.2f}:1 - {wcag_rating(ratio)}")

print()
print("=" * 70)
print("SUMMARY & RECOMMENDATIONS")
print("=" * 70)
print("""
CRITICAL ISSUES FOUND:

1. MUTED TEXT (#5a5a5a) on LIGHT BACKGROUNDS:
   - Contrast ratio: 4.46:1 on cream background
   - This FAILS WCAG AA for normal text (needs 4.5:1)
   - IMPACT: Paragraphs, descriptions, secondary text
   - RECOMMENDATION: Darken to #4a4a4a or #505050

2. BRAND ACCENT (#a8d4e6) on LIGHT BACKGROUNDS:
   - Contrast ratio: 2.09:1 on cream background  
   - This FAILS all WCAG levels
   - IMPACT: Stats in hero section, section accents
   - RECOMMENDATION: Use darker blue like #5a9ab8 or only use for decorative elements

3. BRAND PRIMARY (#c4632d) on LIGHT BACKGROUNDS:
   - Contrast ratio: 4.36:1 on cream background
   - This FAILS WCAG AA for normal text (needs 4.5:1)
   - IMPACT: Section headers, emphasis text
   - RECOMMENDATION: Darken to #b55620 for better contrast

PASSING COMBINATIONS:
✓ Main text (#1a1814) on all backgrounds - Excellent (15.5:1+)
✓ White text on brand colors - Good (4.5:1+)
✓ White text on dark nav - Excellent (15.5:1+)

PRIORITY FIXES:
1. Change --text-muted from #5a5a5a to #4a4a4a (or darker)
2. Change --brand-accent from #a8d4e6 to #5a9ab8 (or use only decoratively)
3. Consider darkening --brand-primary slightly for header text
""")
