#!/usr/bin/env python3
"""
FFT Nano Website Screenshot Analysis
Captures comprehensive screenshots for legibility analysis
"""

from playwright.sync_api import sync_playwright
import os

OUTPUT_DIR = "/Users/scrimwiggins/clawd/fft-nano-work/screenshots"
HTML_FILE = "file:///Users/scrimwiggins/clawd/fft-nano-work/index.html"

# Ensure output directory exists
os.makedirs(OUTPUT_DIR, exist_ok=True)

def take_screenshots():
    with sync_playwright() as p:
        # Launch browser
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1920, 'height': 1080})
        
        # Navigate to page
        page.goto(HTML_FILE)
        page.wait_for_load_state('networkidle')
        
        print("Taking screenshots...")
        
        # 1. Full page screenshot
        print("1. Full page screenshot...")
        page.screenshot(path=f"{OUTPUT_DIR}/01-full-page.png", full_page=True)
        
        # 2. Navigation bar
        print("2. Navigation bar...")
        nav = page.locator('.nav')
        if nav.count() > 0:
            nav.screenshot(path=f"{OUTPUT_DIR}/02-navigation.png")
        
        # 3. Hero section
        print("3. Hero section...")
        hero = page.locator('.hero')
        if hero.count() > 0:
            hero.screenshot(path=f"{OUTPUT_DIR}/03-hero-section.png")
        
        # 4. What is FFT Nano section
        print("4. What is FFT Nano section...")
        what_is = page.locator('#what-is')
        if what_is.count() > 0:
            what_is.screenshot(path=f"{OUTPUT_DIR}/04-what-is-section.png")
        
        # 5. Why This Matters section
        print("5. Why This Matters section...")
        why_matters = page.locator('#why-matters')
        if why_matters.count() > 0:
            why_matters.screenshot(path=f"{OUTPUT_DIR}/05-why-matters-section.png")
        
        # 6. Products section
        print("6. Products section...")
        products = page.locator('#products')
        if products.count() > 0:
            products.screenshot(path=f"{OUTPUT_DIR}/06-products-section.png")
        
        # 7. Get Started section
        print("7. Get Started section...")
        get_started = page.locator('#get-started')
        if get_started.count() > 0:
            get_started.screenshot(path=f"{OUTPUT_DIR}/07-get-started-section.png")
        
        # 8. Footer
        print("8. Footer...")
        footer = page.locator('footer')
        if footer.count() > 0:
            footer.screenshot(path=f"{OUTPUT_DIR}/08-footer.png")
        
        # 9. Individual feature cards (text-heavy)
        print("9. Feature cards...")
        feature_cards = page.locator('.feature-card')
        for i in range(min(feature_cards.count(), 4)):
            feature_cards.nth(i).screenshot(path=f"{OUTPUT_DIR}/09-feature-card-{i+1}.png")
        
        # 10. Matters cards (text-heavy)
        print("10. Matters cards...")
        matters_cards = page.locator('.matters-card')
        for i in range(min(matters_cards.count(), 3)):
            matters_cards.nth(i).screenshot(path=f"{OUTPUT_DIR}/10-matters-card-{i+1}.png")
        
        # 11. Product cards
        print("11. Product cards...")
        product_cards = page.locator('.product-card')
        for i in range(min(product_cards.count(), 4)):
            product_cards.nth(i).screenshot(path=f"{OUTPUT_DIR}/11-product-card-{i+1}.png")
        
        # 12. Mobile view (375px width)
        print("12. Mobile view...")
        page.set_viewport_size({'width': 375, 'height': 812})
        page.wait_for_timeout(500)
        page.screenshot(path=f"{OUTPUT_DIR}/12-mobile-full.png", full_page=True)
        
        # 13. Mobile navigation
        print("13. Mobile navigation...")
        # Click mobile menu button
        mobile_btn = page.locator('.mobile-menu-btn')
        if mobile_btn.count() > 0:
            mobile_btn.click()
            page.wait_for_timeout(300)
            page.screenshot(path=f"{OUTPUT_DIR}/13-mobile-menu.png")
        
        # 14. Tablet view (768px width)
        print("14. Tablet view...")
        page.set_viewport_size({'width': 768, 'height': 1024})
        page.wait_for_timeout(500)
        page.screenshot(path=f"{OUTPUT_DIR}/14-tablet-view.png", full_page=True)
        
        browser.close()
        
        print(f"\nAll screenshots saved to: {OUTPUT_DIR}")
        print("Screenshots taken successfully!")

if __name__ == "__main__":
    take_screenshots()
