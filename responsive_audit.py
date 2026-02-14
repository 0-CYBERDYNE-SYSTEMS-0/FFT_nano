#!/usr/bin/env python3
"""
FFT Nano Responsive Web Design Q&A Audit
Tests responsive design across multiple viewport sizes and devices
"""

from playwright.sync_api import sync_playwright
import json
from datetime import datetime

def run_responsive_audit():
    """Comprehensive responsive design audit"""
    
    results = {
        "audit_date": datetime.now().isoformat(),
        "url": "file:///Users/scrimwiggins/clawd/fft-nano-work/index.html",
        "viewports_tested": [],
        "findings": {
            "critical": [],
            "major": [],
            "minor": [],
            "suggestions": []
        },
        "summary": {}
    }
    
    # Test viewport sizes representing different devices
    viewports = [
        {"name": "iPhone SE", "width": 375, "height": 667, "type": "mobile"},
        {"name": "iPhone 12", "width": 390, "height": 844, "type": "mobile"},
        {"name": "iPad", "width": 768, "height": 1024, "type": "tablet"},
        {"name": "Desktop", "width": 1024, "height": 768, "type": "desktop"},
        {"name": "Wide Desktop", "width": 1920, "height": 1080, "type": "desktop"}
    ]
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        for viewport in viewports:
            print(f"\nTesting {viewport['name']} ({viewport['width']}x{viewport['height']})...")
            page.set_viewport_size({"width": viewport["width"], "height": viewport["height"]})
            
            viewport_result = {
                "viewport": viewport,
                "checks": {},
                "screenshot": f"screenshot_{viewport['name'].lower().replace(' ', '_')}.png",
                "issues": []
            }
            
            # Navigate to page
            page.goto(results["url"])
            page.wait_for_load_state("networkidle")
            
            # 1. Viewport Meta Tag Check
            viewport_meta = page.locator('meta[name="viewport"]').count()
            viewport_result["checks"]["viewport_meta"] = {
                "passed": viewport_meta > 0,
                "description": "Viewport meta tag present"
            }
            if viewport_meta == 0:
                viewport_result["issues"].append({
                    "severity": "critical",
                    "issue": "Missing viewport meta tag"
                })
            
            # 2. Horizontal Scroll Check
            body_width = page.locator('body').evaluate("el => el.scrollWidth")
            window_width = page.evaluate("window.innerWidth")
            horizontal_scroll = body_width > window_width
            viewport_result["checks"]["horizontal_scroll"] = {
                "passed": not horizontal_scroll,
                "description": "No horizontal scrolling",
                "body_width": body_width,
                "window_width": window_width
            }
            if horizontal_scroll:
                viewport_result["issues"].append({
                    "severity": "critical",
                    "issue": f"Horizontal scrolling detected (body: {body_width}px, window: {window_width}px)"
                })
            
            # 3. Touch Target Check
            touch_targets = page.locator('a, button, input, textarea, select').count()
            small_touch_targets = page.locator('a, button, input, textarea, select').filter(
                lambda el: el.evaluate("""
                    (el) => {
                        const rect = el.getBoundingClientRect();
                        return (rect.width < 44 || rect.height < 44) && 
                               window.getComputedStyle(el).display !== 'none';
                    }
                """)
            ).count()
            
            viewport_result["checks"]["touch_targets"] = {
                "passed": small_touch_targets == 0,
                "description": f"All touch targets >= 44px ({small_touch_targets}/{touch_targets} too small)"
            }
            if small_touch_targets > 0 and viewport["type"] == "mobile":
                viewport_result["issues"].append({
                    "severity": "major",
                    "issue": f"{small_touch_targets} touch targets smaller than 44px"
                })
            
            # 4. Text Readability
            text_elements = page.locator('p, h1, h2, h3, h4, h5, h6, li, td, th, span')
            too_small_text = text_elements.filter(
                lambda el: el.evaluate("""
                    (el) => {
                        const style = window.getComputedStyle(el);
                        const fontSize = parseFloat(style.fontSize);
                        const color = style.color;
                        const backgroundColor = style.backgroundColor;
                        
                        // Check font size (minimum 16px for mobile, 14px for desktop)
                        const minFontSize = window.innerWidth < 768 ? 16 : 14;
                        if (fontSize < minFontSize && el.textContent.trim().length > 20) {
                            return true;
                        }
                        return false;
                    }
                """)
            ).count()
            
            viewport_result["checks"]["text_readability"] = {
                "passed": too_small_text == 0,
                "description": f"Text size appropriate ({too_small_text} elements too small)"
            }
            if too_small_text > 0:
                viewport_result["issues"].append({
                    "severity": "minor",
                    "issue": f"{too_small_text} text elements are too small"
                })
            
            # 5. Contrast Check (simplified)
            low_contrast_elements = page.locator('p, h1, h2, h3, h4, h5, h6, a, button').filter(
                lambda el: el.evaluate("""
                    (el) => {
                        const style = window.getComputedStyle(el);
                        const color = style.color;
                        const bgColor = style.backgroundColor;
                        
                        // Very simplified contrast check - looks for gray-on-gray patterns
                        if (color.includes('rgba(128') || color.includes('#808080')) {
                            return true;
                        }
                        return false;
                    }
                """)
            ).count()
            
            viewport_result["checks"]["contrast"] = {
                "passed": low_contrast_elements == 0,
                "description": f"Contrast appears adequate ({low_contrast_elements} potentially low)"
            }
            
            # 6. Navigation Check
            nav_visible = page.locator('.nav').is_visible()
            mobile_menu = page.locator('.mobile-menu').count()
            
            viewport_result["checks"]["navigation"] = {
                "passed": nav_visible,
                "description": f"Navigation visible, mobile menu {'present' if mobile_menu > 0 else 'absent'}"
            }
            
            # 7. Grid Layout Check
            grids = page.locator('[style*="grid"]').count()
            viewport_result["checks"]["grid_layouts"] = {
                "passed": grids > 0,
                "description": f"{grids} CSS Grid layouts detected"
            }
            
            # 8. Image Responsiveness
            responsive_images = page.locator('img').filter(
                lambda el: el.evaluate("""
                    (el) => {
                        const style = window.getComputedStyle(el);
                        return style.maxWidth === '100%' || 
                               style.width === '100%' ||
                               el.getAttribute('srcset') !== null;
                    }
                """)
            ).count()
            total_images = page.locator('img').count()
            
            viewport_result["checks"]["responsive_images"] = {
                "passed": responsive_images == total_images,
                "description": f"{responsive_images}/{total_images} images responsive"
            }
            if responsive_images < total_images:
                viewport_result["issues"].append({
                    "severity": "minor",
                    "issue": f"{total_images - responsive_images} images not responsive"
                })
            
            # 9. Typography Fluid Check
            fluid_elements = page.locator('[style*="clamp"]').count()
            viewport_result["checks"]["fluid_typography"] = {
                "passed": fluid_elements > 0,
                "description": f"{fluid_elements} fluid typography elements using clamp()"
            }
            
            # 10. Reduced Motion Support
            reduced_motion = page.locator('@media (prefers-reduced-motion: reduce)').count() > 0
            viewport_result["checks"]["reduced_motion"] = {
                "passed": reduced_motion,
                "description": "Reduced motion media query present"
            }
            
            # Take screenshot
            page.screenshot(path=viewport_result["screenshot"], full_page=False)
            
            results["viewports_tested"].append(viewport_result)
            
            # Aggregate issues by severity
            for issue in viewport_result["issues"]:
                if issue["severity"] == "critical":
                    results["findings"]["critical"].append(issue)
                elif issue["severity"] == "major":
                    results["findings"]["major"].append(issue)
                elif issue["severity"] == "minor":
                    results["findings"]["minor"].append(issue)
        
        browser.close()
    
    # Generate summary
    total_viewports = len(viewports)
    critical_count = len(results["findings"]["critical"])
    major_count = len(results["findings"]["major"])
    minor_count = len(results["findings"]["minor"])
    
    results["summary"] = {
        "total_viewports_tested": total_viewports,
        "critical_issues": critical_count,
        "major_issues": major_count,
        "minor_issues": minor_count,
        "overall_health": "EXCELLENT" if critical_count == 0 and major_count == 0 else "GOOD" if critical_count == 0 else "NEEDS_ATTENTION"
    }
    
    # Add suggestions based on findings
    if results["summary"]["overall_health"] == "EXCELLENT":
        results["findings"]["suggestions"].append({
            "title": "Excellent Implementation",
            "description": "The FFT Nano website demonstrates excellent responsive design practices across all tested viewports."
        })
    
    if fluid_elements == 0:
        results["findings"]["suggestions"].append({
            "title": "Implement Fluid Typography",
            "description": "Consider using clamp() for fluid typography to improve text scaling across devices."
        })
    
    return results

def main():
    print("🔍 FFT Nano Responsive Design Q&A Audit")
    print("=" * 50)
    
    results = run_responsive_audit()
    
    # Print results
    print("\n📊 AUDIT SUMMARY")
    print("=" * 50)
    print(f"Viewports Tested: {results['summary']['total_viewports_tested']}")
    print(f"Critical Issues: {results['summary']['critical_issues']}")
    print(f"Major Issues: {results['summary']['major_issues']}")
    print(f"Minor Issues: {results['summary']['minor_issues']}")
    print(f"Overall Health: {results['summary']['overall_health']}")
    
    if results["findings"]["critical"]:
        print("\n🚨 CRITICAL ISSUES")
        print("=" * 50)
        for i, issue in enumerate(results["findings"]["critical"], 1):
            print(f"{i}. {issue['issue']}")
    
    if results["findings"]["major"]:
        print("\n⚠️  MAJOR ISSUES")
        print("=" * 50)
        for i, issue in enumerate(results["findings"]["major"], 1):
            print(f"{i}. {issue['issue']}")
    
    if results["findings"]["minor"]:
        print("\n📝 MINOR ISSUES")
        print("=" * 50)
        for i, issue in enumerate(results["findings"]["minor"], 1):
            print(f"{i}. {issue['issue']}")
    
    if results["findings"]["suggestions"]:
        print("\n💡 SUGGESTIONS")
        print("=" * 50)
        for i, suggestion in enumerate(results["findings"]["suggestions"], 1):
            print(f"{i}. {suggestion['title']}: {suggestion['description']}")
    
    # Save detailed results
    with open('/Users/scrimwiggins/clawd/fft-nano-work/RESPONSIVE_AUDIT_RESULTS.json', 'w') as f:
        json.dump(results, f, indent=2)
    
    print(f"\n✅ Detailed results saved to: RESPONSIVE_AUDIT_RESULTS.json")
    print(f"📸 Screenshots saved for each viewport size")
    
    return results

if __name__ == "__main__":
    main()