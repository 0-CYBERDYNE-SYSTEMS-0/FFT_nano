#!/usr/bin/env python3
"""
FFT Nano Elite Background Generator
Generates 4 distinct, professional backgrounds at 4K resolution
"""

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import os

# Technical specs
WIDTH = 3840
HEIGHT = 2160

# Color palette (RGB)
CREAM_LIGHT = (250, 248, 245)    # #faf8f5
CREAM_MID = (240, 235, 224)      # #f0ebe0
CREAM_DARK = (230, 226, 219)     # #e6e2db
BURNT_ORANGE = (181, 86, 32)     # #b55620
POWDER_BLUE = (90, 154, 184)     # #5a9ab8
DARK_TEXT = (26, 24, 20)         # #1a1814

# Warm tan for gradients
WARM_TAN = (235, 225, 210)
WARM_CREAM = (245, 240, 232)

OUTPUT_DIR = "/Users/scrimwiggins/clawd/fft-nano-work/assets/backgrounds"

def add_noise_texture(img, intensity=3):
    """Add very fine noise/grain for depth"""
    arr = np.array(img, dtype=np.float32)
    noise = np.random.normal(0, intensity, arr.shape)
    arr = np.clip(arr + noise, 0, 255).astype(np.uint8)
    return Image.fromarray(arr)


def create_warm_ambient_gradient():
    """
    Background 1: Warm Ambient Gradient
    Ultra-subtle warm gradient from cream to warm tan
    Very fine noise/grain texture for depth
    """
    print("Generating Warm Ambient Gradient...")
    
    # Create base gradient
    img = Image.new('RGB', (WIDTH, HEIGHT))
    draw = ImageDraw.Draw(img)
    
    # Ultra-subtle radial gradient from center
    for y in range(HEIGHT):
        for x in range(WIDTH):
            # Distance from center (normalized)
            cx, cy = WIDTH / 2, HEIGHT / 2
            dist = np.sqrt((x - cx)**2 + (y - cy)**2)
            max_dist = np.sqrt(cx**2 + cy**2)
            factor = dist / max_dist
            
            # Interpolate from cream light to warm tan
            r = int(CREAM_LIGHT[0] + (WARM_TAN[0] - CREAM_LIGHT[0]) * factor * 0.3)
            g = int(CREAM_LIGHT[1] + (WARM_TAN[1] - CREAM_LIGHT[1]) * factor * 0.3)
            b = int(CREAM_LIGHT[2] + (WARM_TAN[2] - CREAM_LIGHT[2]) * factor * 0.3)
            
            img.putpixel((x, y), (r, g, b))
    
    # Add subtle noise for depth
    img = add_noise_texture(img, intensity=2)
    
    # Very slight blur for smoothness
    img = img.filter(ImageFilter.GaussianBlur(radius=0.5))
    
    return img


def create_precision_agriculture_mesh():
    """
    Background 2: Precision Agriculture Mesh
    Ultra-fine grid pattern suggesting precision farming
    Cream base with very faint burnt orange grid lines
    """
    print("Generating Precision Agriculture Mesh...")
    
    # Create cream base with subtle gradient
    img = Image.new('RGB', (WIDTH, HEIGHT), CREAM_MID)
    draw = ImageDraw.Draw(img)
    
    # Add ultra-subtle vertical gradient
    for y in range(HEIGHT):
        factor = y / HEIGHT
        r = int(CREAM_LIGHT[0] + (CREAM_DARK[0] - CREAM_LIGHT[0]) * factor * 0.15)
        g = int(CREAM_LIGHT[1] + (CREAM_DARK[1] - CREAM_LIGHT[1]) * factor * 0.15)
        b = int(CREAM_LIGHT[2] + (CREAM_DARK[2] - CREAM_LIGHT[2]) * factor * 0.15)
        draw.line([(0, y), (WIDTH, y)], fill=(r, g, b))
    
    # Draw ultra-fine grid (very subtle)
    grid_spacing = 80  # pixels between lines
    line_color = (
        CREAM_MID[0] - 8,  # Just barely darker
        CREAM_MID[1] - 6,
        CREAM_MID[2] - 4
    )
    
    # Vertical lines with burnt orange tint (extremely subtle)
    for x in range(0, WIDTH, grid_spacing):
        # Vary opacity across image for organic feel
        opacity_factor = 0.3 + 0.7 * (np.sin(x / 500) * 0.5 + 0.5)
        line_r = int(CREAM_MID[0] - 12 * opacity_factor + (BURNT_ORANGE[0] - CREAM_MID[0]) * 0.03)
        line_g = int(CREAM_MID[1] - 10 * opacity_factor + (BURNT_ORANGE[1] - CREAM_MID[1]) * 0.03)
        line_b = int(CREAM_MID[2] - 8 * opacity_factor + (BURNT_ORANGE[2] - CREAM_MID[2]) * 0.03)
        draw.line([(x, 0), (x, HEIGHT)], fill=(line_r, line_g, line_b), width=1)
    
    # Horizontal lines
    for y in range(0, HEIGHT, grid_spacing):
        opacity_factor = 0.3 + 0.7 * (np.cos(y / 400) * 0.5 + 0.5)
        line_r = int(CREAM_MID[0] - 12 * opacity_factor + (BURNT_ORANGE[0] - CREAM_MID[0]) * 0.03)
        line_g = int(CREAM_MID[1] - 10 * opacity_factor + (BURNT_ORANGE[1] - CREAM_MID[1]) * 0.03)
        line_b = int(CREAM_MID[2] - 8 * opacity_factor + (BURNT_ORANGE[2] - CREAM_MID[2]) * 0.03)
        draw.line([(0, y), (WIDTH, y)], fill=(line_r, line_g, line_b), width=1)
    
    # Add noise
    img = add_noise_texture(img, intensity=2)
    
    return img


def create_organic_flow_abstract():
    """
    Background 3: Organic Flow Abstract
    Ultra-subtle flowing curves suggesting furrows in fields
    Cream-to-tan gradient with very faint powder blue wave accents
    """
    print("Generating Organic Flow Abstract...")
    
    img = Image.new('RGB', (WIDTH, HEIGHT))
    draw = ImageDraw.Draw(img)
    
    # Create flowing wave pattern
    for y in range(HEIGHT):
        for x in range(WIDTH):
            # Base gradient (vertical)
            base_factor = y / HEIGHT
            base_r = int(CREAM_LIGHT[0] + (WARM_TAN[0] - CREAM_LIGHT[0]) * base_factor * 0.2)
            base_g = int(CREAM_LIGHT[1] + (WARM_TAN[1] - CREAM_LIGHT[1]) * base_factor * 0.2)
            base_b = int(CREAM_LIGHT[2] + (WARM_TAN[2] - CREAM_LIGHT[2]) * base_factor * 0.2)
            
            # Wave distortion (subtle)
            wave = np.sin(x / 150 + y / 300) * 3
            wave2 = np.sin(x / 200 - y / 200) * 2
            
            # Very faint powder blue accent on wave peaks
            wave_factor = (np.sin(x / 120 + y / 180) + 1) / 2
            
            r = int(base_r + wave + wave2)
            g = int(base_g + wave * 0.8 + wave2 * 0.8)
            b = int(base_b + wave * 0.5 + wave2 * 0.5 + (POWDER_BLUE[2] - base_b) * wave_factor * 0.02)
            
            # Clamp values
            r = max(0, min(255, r))
            g = max(0, min(255, g))
            b = max(0, min(255, b))
            
            img.putpixel((x, y), (r, g, b))
    
    # Add noise
    img = add_noise_texture(img, intensity=2)
    
    # Smooth slightly
    img = img.filter(ImageFilter.GaussianBlur(radius=0.3))
    
    return img


def create_geometric_harmony():
    """
    Background 4: Geometric Harmony
    Ultra-fine diamond pattern with cream background
    Barely-visible burnt orange and powder blue accents at intersections
    """
    print("Generating Geometric Harmony...")
    
    img = Image.new('RGB', (WIDTH, HEIGHT), CREAM_MID)
    draw = ImageDraw.Draw(img)
    
    # Subtle gradient base
    for y in range(HEIGHT):
        factor = y / HEIGHT
        r = int(CREAM_LIGHT[0] + (CREAM_DARK[0] - CREAM_LIGHT[0]) * factor * 0.1)
        g = int(CREAM_LIGHT[1] + (CREAM_DARK[1] - CREAM_LIGHT[1]) * factor * 0.1)
        b = int(CREAM_LIGHT[2] + (CREAM_DARK[2] - CREAM_LIGHT[2]) * factor * 0.1)
        draw.line([(0, y), (WIDTH, y)], fill=(r, g, b))
    
    # Diamond pattern parameters
    spacing = 100
    line_alpha = 0.04  # Ultra-subtle
    
    def lerp_color(c1, c2, t):
        return (
            int(c1[0] + (c2[0] - c1[0]) * t),
            int(c1[1] + (c2[1] - c1[1]) * t),
            int(c1[2] + (c2[2] - c1[2]) * t)
        )
    
    # Draw diagonal lines (creating diamonds)
    # Direction: top-left to bottom-right
    for i in range(-HEIGHT, WIDTH + HEIGHT, spacing):
        points = []
        if i <= 0:
            start = (0, -i)
        else:
            start = (i, 0)
        
        if i <= WIDTH - HEIGHT:
            end = (i + HEIGHT, HEIGHT)
        else:
            end = (WIDTH, i + HEIGHT - WIDTH)
        
        if 0 <= start[0] < WIDTH and 0 <= start[1] < HEIGHT:
            if 0 <= end[0] <= WIDTH and 0 <= end[1] <= HEIGHT:
                line_color = lerp_color(CREAM_MID, CREAM_DARK, 0.08)
                draw.line([start, end], fill=line_color, width=1)
    
    # Direction: top-right to bottom-left
    for i in range(0, WIDTH + HEIGHT, spacing):
        if i <= WIDTH:
            start = (i, 0)
        else:
            start = (WIDTH, i - WIDTH)
        
        if i <= HEIGHT:
            end = (0, i)
        else:
            end = (i - HEIGHT, HEIGHT)
        
        if 0 <= start[0] <= WIDTH and 0 <= start[1] < HEIGHT:
            if 0 <= end[0] < WIDTH and 0 <= end[1] <= HEIGHT:
                line_color = lerp_color(CREAM_MID, CREAM_DARK, 0.08)
                draw.line([start, end], fill=line_color, width=1)
    
    # Add subtle accent dots at intersections
    for i in range(0, WIDTH, spacing * 2):
        for j in range(0, HEIGHT, spacing * 2):
            # Very faint burnt orange accent
            accent_r = int(CREAM_MID[0] + (BURNT_ORANGE[0] - CREAM_MID[0]) * 0.02)
            accent_g = int(CREAM_MID[1] + (BURNT_ORANGE[1] - CREAM_MID[1]) * 0.02)
            accent_b = int(CREAM_MID[2] + (BURNT_ORANGE[2] - CREAM_MID[2]) * 0.02)
            draw.ellipse([i-2, j-2, i+2, j+2], fill=(accent_r, accent_g, accent_b))
    
    # Add noise
    img = add_noise_texture(img, intensity=2)
    
    return img


def main():
    print("=" * 60)
    print("FFT Nano Elite Background Generator")
    print(f"Resolution: {WIDTH}x{HEIGHT} (4K)")
    print("=" * 60)
    
    # Generate all backgrounds
    backgrounds = [
        ("bg-warm-ambient-cream.png", create_warm_ambient_gradient),
        ("bg-precision-grid-cream.png", create_precision_agriculture_mesh),
        ("bg-organic-flow-cream.png", create_organic_flow_abstract),
        ("bg-geometric-harmony-cream.png", create_geometric_harmony),
    ]
    
    for filename, generator in backgrounds:
        print(f"\nGenerating: {filename}")
        img = generator()
        output_path = os.path.join(OUTPUT_DIR, filename)
        img.save(output_path, "PNG", optimize=True)
        print(f"  Saved: {output_path}")
        print(f"  Size: {os.path.getsize(output_path) / 1024:.1f} KB")
    
    print("\n" + "=" * 60)
    print("All backgrounds generated successfully!")
    print("=" * 60)


if __name__ == "__main__":
    main()
