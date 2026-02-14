#!/usr/bin/env python3
"""
FFT Nano Static Responsive Design Audit
Analyzes CSS and HTML for responsive design patterns without browser automation
"""

import re
import json
from pathlib import Path
from datetime import datetime

class ResponsiveAudit:
    def __init__(self, html_file):
        self.html_file = html_file
        self.content = Path(html_file).read_text()
        self.results = {
            "audit_date": datetime.now().isoformat(),
            "file": html_file,
            "viewport_meta": {},
            "media_queries": [],
            "responsive_units": [],
            "grid_layouts": [],
            "flexbox": [],
            "fluid_typography": [],
            "touch_optimizations": [],
            "images": [],
            "findings": {
                "critical": [],
                "major": [],
                "minor": [],
                "suggestions": [],
                "best_practices": []
            },
            "summary": {}
        }

    def check_viewport_meta(self):
        """Check for viewport meta tag"""
        viewport_pattern = r'<meta\s+name="viewport"[^>]*content="([^"]*)"'
        match = re.search(viewport_pattern, self.content)

        if match:
            content = match.group(1)
            self.results["viewport_meta"] = {
                "present": True,
                "content": content,
                "has_initial_scale": "initial-scale=1.0" in content,
                "has_width_device": "width=device-width" in content
            }
            if not self.results["viewport_meta"]["has_width_device"]:
                self.results["findings"]["critical"].append({
                    "issue": "Viewport meta missing 'width=device-width'",
                    "recommendation": "Add 'width=device-width' to viewport meta tag"
                })
            if not self.results["viewport_meta"]["has_initial_scale"]:
                self.results["findings"]["major"].append({
                    "issue": "Viewport meta missing 'initial-scale=1.0'",
                    "recommendation": "Add 'initial-scale=1.0' to viewport meta tag"
                })
        else:
            self.results["viewport_meta"]["present"] = False
            self.results["findings"]["critical"].append({
                "issue": "Viewport meta tag not found",
                "recommendation": "Add <meta name='viewport' content='width=device-width, initial-scale=1.0'>"
            })

    def analyze_media_queries(self):
        """Extract and analyze media queries"""
        media_query_pattern = r'@media[^{]+\{([^}]*(?:\{[^}]*\}[^}]*)*)\}'
        matches = re.findall(media_query_pattern, self.content, re.DOTALL)

        breakpoints = {}
        for i, match in enumerate(matches):
            # Extract the condition
            condition_match = re.search(r'@media([^{]+)', self.content)
            if condition_match:
                condition = condition_match.group(1).strip()

                # Extract breakpoints
                min_widths = re.findall(r'min-width:\s*(\d+px)', condition)
                max_widths = re.findall(r'max-width:\s*(\d+px)', condition)

                for w in min_widths:
                    if w not in breakpoints:
                        breakpoints[w] = []
                    breakpoints[w].append(f"Media query {i+1}")

                for w in max_widths:
                    if w not in breakpoints:
                        breakpoints[w] = []
                    breakpoints[w].append(f"Media query {i+1}")

                self.results["media_queries"].append({
                    "index": i + 1,
                    "condition": condition,
                    "breakpoints": {
                        "min_width": min_widths,
                        "max_width": max_widths
                    }
                })

        # Check for common breakpoints
        common_breakpoints = ['320px', '375px', '480px', '768px', '1024px', '1280px', '1440px']
        missing_breakpoints = [bp for bp in common_breakpoints if bp not in breakpoints]

        if not breakpoints:
            self.results["findings"]["critical"].append({
                "issue": "No media queries found",
                "recommendation": "Add media queries for responsive design"
            })
        else:
            self.results["findings"]["best_practices"].append({
                "practice": f"Found {len(breakpoints)} unique breakpoints",
                "breakpoints": list(breakpoints.keys())
            })

    def check_responsive_units(self):
        """Check for use of responsive CSS units"""
        responsive_units = {
            "viewport": r'vw|vh|vmin|vmax',
            "percentage": r'\d+(?:\.\d+)?%',
            "relative": r'\d+(?:\.\d+)?(?:rem|em)',
            "fixed": r'\d+px(?![a-z])'
        }

        unit_stats = {}
        for unit_type, pattern in responsive_units.items():
            matches = re.findall(pattern, self.content)
            unit_stats[unit_type] = len(matches)
            if matches:
                self.results["responsive_units"].append({
                    "type": unit_type,
                    "count": len(matches),
                    "examples": list(set(matches[:5]))  # Unique examples
                })

        # Calculate ratio of responsive to fixed units
        total_responsive = unit_stats.get("viewport", 0) + unit_stats.get("percentage", 0)
        total_fixed = unit_stats.get("fixed", 0)

        if total_fixed > 0 and total_responsive == 0:
            self.results["findings"]["major"].append({
                "issue": f"Found {total_fixed} fixed px units but no responsive units",
                "recommendation": "Consider using percentage, rem, or viewport units for responsive design"
            })

    def check_grid_layouts(self):
        """Check for CSS Grid usage"""
        grid_patterns = [
            r'display:\s*grid',
            r'grid-template-columns:\s*[^;]+',
            r'grid-template-rows:\s*[^;]+',
            r'grid-template-areas:\s*[^;]+',
            r'gap:\s*[^;]+',
            r'grid-auto-fit:\s*minmax'
        ]

        grid_findings = {}
        for pattern in grid_patterns:
            matches = re.findall(pattern, self.content)
            if matches:
                feature = pattern.replace(r'\\s*', ' ').replace(':', '')
                grid_findings[feature] = len(matches)

        if grid_findings:
            self.results["grid_layouts"].append({
                "features": grid_findings,
                "total_features": len(grid_findings)
            })
            self.results["findings"]["best_practices"].append({
                "practice": "CSS Grid detected for layout",
                "features": list(grid_findings.keys())
            })

        # Check for auto-fit with minmax (best practice for responsive grids)
        auto_fit_pattern = r'grid-template-columns:\s*repeat\(auto-fit,\s*minmax\([^)]+\)\)'
        if re.search(auto_fit_pattern, self.content):
            self.results["findings"]["best_practices"].append({
                "practice": "Responsive grid with auto-fit + minmax detected",
                "description": "Uses modern CSS Grid pattern for automatic column adjustment"
            })

    def check_flexbox(self):
        """Check for Flexbox usage"""
        flex_patterns = [
            r'display:\s*flex',
            r'display:\s*inline-flex',
            r'flex-direction:\s*[^;]+',
            r'justify-content:\s*[^;]+',
            r'align-items:\s*[^;]+',
            r'flex-wrap:\s*[^;]+',
            r'flex:\s*\d+\s*\d+\s*auto'
        ]

        flex_findings = {}
        for pattern in flex_patterns:
            matches = re.findall(pattern, self.content)
            if matches:
                feature = pattern.replace(r'\\s*', ' ').replace(':', '')
                flex_findings[feature] = len(matches)

        if flex_findings:
            self.results["flexbox"].append({
                "features": flex_findings,
                "total_features": len(flex_findings)
            })

    def check_fluid_typography(self):
        """Check for fluid typography using clamp()"""
        clamp_pattern = r'clamp\([^)]+\)'
        matches = re.findall(clamp_pattern, self.content)

        if matches:
            self.results["fluid_typography"].append({
                "count": len(matches),
                "examples": list(set(matches[:3]))
            })
            self.results["findings"]["best_practices"].append({
                "practice": f"Fluid typography with clamp() found ({len(matches)} instances)",
                "description": "Uses modern CSS function for smooth text scaling"
            })

    def check_touch_optimizations(self):
        """Check for touch-friendly optimizations"""
        touch_patterns = {
            "touch_target_sizes": r'(min-width|min-height):\s*[4-9][0-9]px',
            "user_select_none": r'user-select:\s*none',
            "touch_action": r'touch-action:\s*[^;]+',
            "cursor_pointer": r'cursor:\s*pointer'
        }

        for feature, pattern in touch_patterns.items():
            matches = re.findall(pattern, self.content)
            if matches:
                self.results["touch_optimizations"].append({
                    "feature": feature,
                    "count": len(matches)
                })

        # Check for touch-target minimums (44px recommended)
        if any(t["feature"] == "touch_target_sizes" for t in self.results["touch_optimizations"]):
            self.results["findings"]["best_practices"].append({
                "practice": "Touch target size optimizations detected",
                "description": "Minimum touch targets for mobile usability"
            })

    def check_images(self):
        """Check for image responsiveness"""
        img_tags = re.findall(r'<img[^>]+>', self.content, re.IGNORECASE)
        total_images = len(img_tags)

        responsive_images = 0
        srcset_images = 0
        has_general_img_rule = False

        for img in img_tags:
            if 'max-width' in img.lower() or 'width="100%"' in img.lower():
                responsive_images += 1
            if 'srcset' in img.lower():
                srcset_images += 1

        # Check for general img CSS rule
        general_img_pattern = r'img\s*\{[^}]*max-width:\s*100%'
        if re.search(general_img_pattern, self.content, re.IGNORECASE):
            has_general_img_rule = True
            responsive_images = total_images  # All images are responsive via CSS rule

        self.results["images"] = {
            "total": total_images,
            "responsive": responsive_images,
            "srcset": srcset_images,
            "has_general_css_rule": has_general_img_rule
        }

        if total_images > 0:
            responsive_ratio = (responsive_images / total_images) * 100
            if responsive_ratio < 50 and not has_general_img_rule:
                self.results["findings"]["minor"].append({
                    "issue": f"Only {responsive_ratio:.0f}% of images are responsive",
                    "recommendation": "Add max-width: 100% to more images for responsive scaling"
                })
            elif responsive_ratio == 100 or has_general_img_rule:
                note = "via general CSS rule" if has_general_img_rule else "(max-width: 100%)"
                self.results["findings"]["best_practices"].append({
                    "practice": f"All images are responsive {note}"
                })

        if srcset_images > 0:
            self.results["findings"]["best_practices"].append({
                "practice": f"{srcset_images} images use srcset for adaptive loading",
                "description": "Optimizes image loading for different screen sizes"
            })

    def check_reduced_motion(self):
        """Check for reduced motion support"""
        reduced_motion_pattern = r'@media\s*\(prefers-reduced-motion:\s*reduce\)'
        if re.search(reduced_motion_pattern, self.content):
            self.results["findings"]["best_practices"].append({
                "practice": "Reduced motion media query detected",
                "description": "Respects user preference for reduced animations"
            })
        else:
            self.results["findings"]["suggestions"].append({
                "suggestion": "Add prefers-reduced-motion media query",
                "description": "Support users who prefer reduced motion for accessibility"
            })

    def check_mobile_navigation(self):
        """Check for mobile navigation patterns"""
        mobile_nav_patterns = [
            r'class="[^"]*mobile-menu[^"]*"',
            r'class="[^"]*hamburger[^"]*"',
            r'class="[^"]*menu-toggle[^"]*"'
        ]

        found_mobile_nav = False
        for pattern in mobile_nav_patterns:
            if re.search(pattern, self.content):
                found_mobile_nav = True
                break

        if found_mobile_nav:
            self.results["findings"]["best_practices"].append({
                "practice": "Mobile navigation pattern detected",
                "description": "Mobile-specific navigation (hamburger menu, drawer, etc.)"
            })

    def generate_summary(self):
        """Generate audit summary"""
        critical = len(self.results["findings"]["critical"])
        major = len(self.results["findings"]["major"])
        minor = len(self.results["findings"]["minor"])
        best_practices = len(self.results["findings"]["best_practices"])

        if critical == 0 and major == 0:
            health = "EXCELLENT"
        elif critical == 0:
            health = "GOOD"
        elif critical == 1:
            health = "NEEDS_ATTENTION"
        else:
            health = "POOR"

        self.results["summary"] = {
            "health_score": health,
            "critical_issues": critical,
            "major_issues": major,
            "minor_issues": minor,
            "best_practices_followed": best_practices,
            "total_media_queries": len(self.results["media_queries"]),
            "uses_grid": len(self.results["grid_layouts"]) > 0,
            "uses_flexbox": len(self.results["flexbox"]) > 0,
            "has_fluid_typography": len(self.results["fluid_typography"]) > 0,
            "images_responsive": self.results["images"]["responsive"] > 0
        }

    def run_audit(self):
        """Run all audit checks"""
        print("🔍 Running FFT Nano Static Responsive Design Audit...")
        print("=" * 60)

        self.check_viewport_meta()
        print("✓ Viewport meta tag checked")

        self.analyze_media_queries()
        print(f"✓ Media queries analyzed ({len(self.results['media_queries'])} found)")

        self.check_responsive_units()
        print(f"✓ Responsive units analyzed")

        self.check_grid_layouts()
        print(f"✓ CSS Grid layouts checked ({len(self.results['grid_layouts'])} found)")

        self.check_flexbox()
        print(f"✓ Flexbox layouts checked ({len(self.results['flexbox'])} found)")

        self.check_fluid_typography()
        print(f"✓ Fluid typography checked ({len(self.results['fluid_typography'])} found)")

        self.check_touch_optimizations()
        print(f"✓ Touch optimizations checked ({len(self.results['touch_optimizations'])} found)")

        self.check_images()
        print(f"✓ Images checked ({self.results['images']['total']} total, {self.results['images']['responsive']} responsive)")

        self.check_reduced_motion()
        print("✓ Reduced motion support checked")

        self.check_mobile_navigation()
        print("✓ Mobile navigation patterns checked")

        self.generate_summary()
        print("✓ Summary generated")

        print("\n" + "=" * 60)

        return self.results

def main():
    html_file = '/Users/scrimwiggins/clawd/fft-nano-work/index.html'
    audit = ResponsiveAudit(html_file)
    results = audit.run_audit()

    # Print summary
    print("\n📊 AUDIT SUMMARY")
    print("=" * 60)
    print(f"Health Score: {results['summary']['health_score']}")
    print(f"Critical Issues: {results['summary']['critical_issues']}")
    print(f"Major Issues: {results['summary']['major_issues']}")
    print(f"Minor Issues: {results['summary']['minor_issues']}")
    print(f"Best Practices: {results['summary']['best_practices_followed']}")
    print(f"Media Queries: {results['summary']['total_media_queries']}")
    print(f"CSS Grid: {'✓' if results['summary']['uses_grid'] else '✗'}")
    print(f"Flexbox: {'✓' if results['summary']['uses_flexbox'] else '✗'}")
    print(f"Fluid Typography: {'✓' if results['summary']['has_fluid_typography'] else '✗'}")

    if results["findings"]["critical"]:
        print("\n🚨 CRITICAL ISSUES")
        print("=" * 60)
        for i, issue in enumerate(results["findings"]["critical"], 1):
            print(f"{i}. {issue['issue']}")
            print(f"   → {issue['recommendation']}")

    if results["findings"]["major"]:
        print("\n⚠️  MAJOR ISSUES")
        print("=" * 60)
        for i, issue in enumerate(results["findings"]["major"], 1):
            print(f"{i}. {issue['issue']}")
            print(f"   → {issue['recommendation']}")

    if results["findings"]["minor"]:
        print("\n📝 MINOR ISSUES")
        print("=" * 60)
        for i, issue in enumerate(results["findings"]["minor"], 1):
            print(f"{i}. {issue['issue']}")
            print(f"   → {issue['recommendation']}")

    if results["findings"]["best_practices"]:
        print("\n✅ BEST PRACTICES FOLLOWED")
        print("=" * 60)
        for i, practice in enumerate(results["findings"]["best_practices"], 1):
            print(f"{i}. {practice['practice']}")
            if 'description' in practice:
                print(f"   → {practice['description']}")

    if results["findings"]["suggestions"]:
        print("\n💡 SUGGESTIONS")
        print("=" * 60)
        for i, suggestion in enumerate(results["findings"]["suggestions"], 1):
            print(f"{i}. {suggestion['suggestion']}")
            print(f"   → {suggestion['description']}")

    # Save detailed results
    output_file = '/Users/scrimwiggins/clawd/fft-nano-work/RESPONSIVE_AUDIT_REPORT.json'
    with open(output_file, 'w') as f:
        json.dump(results, f, indent=2)

    print(f"\n✅ Detailed results saved to: {output_file}")

    return results

if __name__ == "__main__":
    main()