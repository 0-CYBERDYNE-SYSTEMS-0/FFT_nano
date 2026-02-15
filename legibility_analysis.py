#!/usr/bin/env python3
"""
FFT Nano Legibility Analysis
Uses LM Studio vision model to analyze screenshots for text legibility issues
"""

import sys
import os

# Add LM Studio skill to path
sys.path.insert(0, '/Users/scrimwiggins/clawdbot/skills/lm-studio-private')

from tools.vision import lm_studio_vision

SCREENSHOTS_DIR = "/Users/scrimwiggins/clawd/fft-nano-work/screenshots"

ANALYSIS_PROMPTS = {
    "02-navigation.png": """Analyze this navigation bar screenshot for text legibility issues. Focus on:
1. Text contrast against the dark background
2. Font readability  
3. Any text that's hard to read
4. Color accessibility (WCAG compliance)
5. Spacing and visual hierarchy

The background is dark (rgba(26, 24, 20, 0.95)) and the text should be light. 
Rate the overall legibility from 1-10 and list specific issues found.""",

    "03-hero-section.png": """Analyze this hero section screenshot for text legibility issues on a light cream background (#faf8f5). Focus on:
1. Text contrast ratio - is text readable against the light background?
2. The headline text legibility
3. The subtitle/paragraph text legibility  
4. Button text readability
5. Any areas where text is hard to read
6. Color accessibility issues (WCAG compliance)

The background is a light cream color. Check if all text is clearly legible.
Rate the overall legibility from 1-10 and list specific issues found.""",

    "04-what-is-section.png": """Analyze this "What is FFT Nano?" section for text legibility. Focus on:
1. Section header text readability
2. Feature card text legibility
3. Contrast between text and light cream background
4. Any text that's hard to read
5. Color accessibility issues
6. Paragraph text readability in the cards

The background is light cream (#faf8f5). Check all text elements for readability.
Rate the overall legibility from 1-10 and list specific issues found.""",

    "05-why-matters-section.png": """Analyze this "Why This Matters" section for text legibility. Focus on:
1. Section header readability
2. Card text legibility - especially the long paragraphs
3. List item text readability
4. Contrast issues
5. Any text that appears washed out or hard to read

The background is a slightly darker cream (#f0ebe0). 
Rate the overall legibility from 1-10 and list specific issues found.""",

    "06-products-section.png": """Analyze this products section for text legibility. Focus on:
1. Product card header text (price and name)
2. Feature list text readability
3. Contrast between text and backgrounds
4. Any text that's hard to read

Rate the overall legibility from 1-10 and list specific issues found.""",

    "07-get-started-section.png": """Analyze this "Get Started" section for text legibility. Focus on:
1. Step card text readability
2. Code block text legibility
3. Instruction text readability
4. Any contrast issues

Rate the overall legibility from 1-10 and list specific issues found.""",

    "08-footer.png": """Analyze this footer section for text legibility. Focus on:
1. Section header text readability
2. Link text legibility
3. Description text readability
4. Any contrast issues with muted text

Rate the overall legibility from 1-10 and list specific issues found.""",

    "09-feature-card-1.png": """Analyze this feature card for detailed text legibility. Focus on:
1. Icon visibility
2. Title text readability
3. Paragraph text legibility
4. Contrast against the card background

Rate the overall legibility from 1-10 and list specific issues found.""",

    "10-matters-card-1.png": """Analyze this "Why This Matters" card for detailed text legibility. Focus on:
1. Title text readability  
2. Paragraph text legibility (this card has long text)
3. List item text readability
4. Contrast issues

Rate the overall legibility from 1-10 and list specific issues found.""",

    "11-product-card-1.png": """Analyze this product card for text legibility. Focus on:
1. Price text visibility
2. Product name readability
3. Feature list text legibility
4. Contrast between header and body text

Rate the overall legibility from 1-10 and list specific issues found.""",

    "12-mobile-full.png": """Analyze this mobile view for text legibility issues. Focus on:
1. Text size and readability on small screen
2. Any text that's too small
3. Contrast issues
4. Touch target sizes for links/buttons

Rate the overall mobile legibility from 1-10 and list specific issues found.""",

    "14-tablet-view.png": """Analyze this tablet view for text legibility issues. Focus on:
1. Text scaling and readability
2. Any layout issues affecting legibility
3. Contrast issues

Rate the overall tablet legibility from 1-10 and list specific issues found."""
}

def main():
    results = []
    
    print("=" * 60)
    print("FFT Nano Website Legibility Analysis")
    print("=" * 60)
    print()
    
    for filename, prompt in ANALYSIS_PROMPTS.items():
        filepath = os.path.join(SCREENSHOTS_DIR, filename)
        
        if not os.path.exists(filepath):
            print(f"⚠️  Skipping {filename} - file not found")
            continue
        
        print(f"\n📸 Analyzing: {filename}")
        print("-" * 40)
        
        try:
            # Use jan-v2-vl-high for vision (it's the vision model)
            result = lm_studio_vision(
                image_path=filepath,
                prompt=prompt,
                model="jan-v2-vl-high",
                max_tokens=1500
            )
            
            print(result)
            results.append({"file": filename, "result": result})
            
        except Exception as e:
            print(f"❌ Error analyzing {filename}: {e}")
            results.append({"file": filename, "error": str(e)})
    
    # Save full report
    report_path = os.path.join(SCREENSHOTS_DIR, "legibility-report.txt")
    with open(report_path, "w") as f:
        f.write("FFT Nano Website Legibility Analysis Report\n")
        f.write("=" * 60 + "\n\n")
        
        for r in results:
            f.write(f"\n{'=' * 60}\n")
            f.write(f"File: {r['file']}\n")
            f.write("-" * 60 + "\n")
            if "error" in r:
                f.write(f"Error: {r['error']}\n")
            else:
                f.write(r["result"] + "\n")
    
    print(f"\n\n{'=' * 60}")
    print(f"✅ Report saved to: {report_path}")
    print("=" * 60)

if __name__ == "__main__":
    main()
