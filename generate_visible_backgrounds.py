#!/usr/bin/env python3
"""
FFT Nano VISIBLE Background Generator
Generates 4 distinct, VISIBLE backgrounds at 4K resolution
Patterns are clearly perceptible while remaining professional
"""

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance
import os
import math

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

OUTPUT_DIR = "/Users/scrimwiggins/clawd/fft-nano-work/assets/backgrounds"

def lerp_color(c1, c2, t):
    """Linear interpolation between two colors"""
    t = max(0, min(1, t))
    return (
        int(c1[0] + (c2[0] - c1[0]) * t),
        int(c1[1] + (c2[1] - c1[1]) * t),
        int(c1[2] + (c2[2] - c1[2]) * t)
    )

def blend_color(base, overlay, alpha):
    """Blend overlay color onto base with alpha transparency"""
    return (
        int(base[0] * (1 - alpha) + overlay[0] * alpha),
        int(base[1] * (1 - alpha) + overlay[1] * alpha),
        int(base[2] * (1 - alpha) + overlay[2] * alpha)
    )

def add_subtle_noise(img, intensity=2):
    """Add very fine noise/grain for texture"""
    arr = np.array(img, dtype=np.float32)
    noise = np.random.normal(0, intensity, arr.shape)
    arr = np.clip(arr + noise, 0, 255).astype(np.uint8)
    return Image.fromarray(arr)


def create_hexagon_elegant():
    """
    Background 1: Elegant Hexagon Texture
    CLEARLY VISIBLE hexagonal mesh pattern
    Cream base with visible burnt orange hexagon lines
    """
    print("Generating Elegant Hexagon Texture (VISIBLE)...")
    
    # Create base with gradient
    img = Image.new('RGB', (WIDTH, HEIGHT), CREAM_MID)
    draw = ImageDraw.Draw(img)
    
    # Vertical gradient from cream light to cream dark
    for y in range(HEIGHT):
        t = y / HEIGHT
        color = lerp_color(CREAM_LIGHT, CREAM_DARK, t * 0.4)
        draw.line([(0, y), (WIDTH, y)], fill=color)
    
    # Hexagon parameters - VISIBLE pattern
    hex_size = 80  # Size of each hexagon
    hex_height = hex_size * math.sqrt(3)
    line_width = 2  # Visible line width
    
    # Burnt orange line color - clearly visible but elegant
    line_color = BURNT_ORANGE
    
    # Draw hexagonal grid
    rows = int(HEIGHT / hex_height) + 2
    cols = int(WIDTH / (hex_size * 1.5)) + 2
    
    for row in range(rows):
        for col in range(cols):
            # Calculate center of hexagon
            x = col * hex_size * 1.5
            y = row * hex_height
            if col % 2 == 1:
                y += hex_height / 2
            
            # Calculate hexagon vertices
            vertices = []
            for i in range(6):
                angle = math.pi / 3 * i
                vx = x + hex_size * math.cos(angle)
                vy = y + hex_size * math.sin(angle)
                vertices.append((vx, vy))
            
            # Draw hexagon outline
            for i in range(6):
                start = vertices[i]
                end = vertices[(i + 1) % 6]
                # Only draw if within image bounds
                if (0 <= start[0] <= WIDTH and 0 <= end[0] <= WIDTH and
                    0 <= start[1] <= HEIGHT and 0 <= end[1] <= HEIGHT):
                    # Draw with slight opacity for elegance
                    draw.line([start, end], fill=line_color, width=line_width)
    
    # Add subtle noise for texture
    img = add_subtle_noise(img, intensity=1)
    
    return img


def create_terrain_farm():
    """
    Background 2: Farm Field Terrain
    VISIBLE topographic contour lines suggesting fields/hills
    Cream background with visible powder blue contour curves
    """
    print("Generating Farm Field Terrain (VISIBLE)...")
    
    img = Image.new('RGB', (WIDTH, HEIGHT), CREAM_MID)
    draw = ImageDraw.Draw(img)
    
    # Vertical gradient
    for y in range(HEIGHT):
        t = y / HEIGHT
        color = lerp_color(CREAM_LIGHT, CREAM_DARK, t * 0.35)
        draw.line([(0, y), (WIDTH, y)], fill=color)
    
    # Draw topographic contour lines - CLEARLY VISIBLE
    contour_levels = 20  # Number of contour lines
    line_width = 2
    
    for level in range(contour_levels):
        # Base Y position for this contour level
        base_y = (level + 1) * HEIGHT / (contour_levels + 1)
        
        # Create organic wave pattern for this contour
        points = []
        for x in range(0, WIDTH + 20, 20):
            # Multiple sine waves for organic terrain feel
            wave1 = math.sin(x / 200 + level * 0.5) * 60
            wave2 = math.sin(x / 350 + level * 0.3) * 40
            wave3 = math.sin(x / 150 - level * 0.2) * 30
            
            y = base_y + wave1 + wave2 + wave3
            points.append((x, y))
        
        # Draw the contour line with powder blue
        # Vary color intensity slightly for depth
        intensity = 0.7 + 0.3 * math.sin(level / 3)
        contour_color = (
            int(POWDER_BLUE[0] * intensity),
            int(POWDER_BLUE[1] * intensity),
            int(POWDER_BLUE[2] * intensity)
        )
        
        # Draw smooth curve through points
        for i in range(len(points) - 1):
            draw.line([points[i], points[i+1]], fill=contour_color, width=line_width)
        
        # Add elevation shading - subtle darker areas along curves
        for i in range(0, len(points) - 1, 3):
            x, y = points[i]
            if 0 <= x < WIDTH and 0 <= y < HEIGHT:
                # Draw small accent dots for elevation marks
                shade_color = blend_color(contour_color, DARK_TEXT, 0.2)
                draw.ellipse([x-2, y-2, x+2, y+2], fill=shade_color)
    
    # Add subtle noise
    img = add_subtle_noise(img, intensity=1)
    
    return img


def create_diamond_grid():
    """
    Background 3: Diamond Grid Pattern
    CLEARLY VISIBLE diamond tessellation
    Cream base with visible burnt orange/powder blue diamond outlines
    """
    print("Generating Diamond Grid Pattern (VISIBLE)...")
    
    img = Image.new('RGB', (WIDTH, HEIGHT), CREAM_MID)
    draw = ImageDraw.Draw(img)
    
    # Vertical gradient
    for y in range(HEIGHT):
        t = y / HEIGHT
        color = lerp_color(CREAM_LIGHT, CREAM_DARK, t * 0.3)
        draw.line([(0, y), (WIDTH, y)], fill=color)
    
    # Diamond pattern parameters
    diamond_size = 70  # Size of each diamond
    line_width = 2
    
    # Draw diagonal lines creating diamonds
    # Pattern: alternating burnt orange and powder blue
    
    # Direction 1: Top-left to bottom-right (burnt orange)
    for i in range(-HEIGHT, WIDTH + HEIGHT, diamond_size):
        start_x = max(0, i)
        start_y = max(0, -i) if i < 0 else 0
        end_x = min(WIDTH, i + HEIGHT)
        end_y = min(HEIGHT, HEIGHT - i) if i > WIDTH - HEIGHT else HEIGHT
        
        if start_x < WIDTH and end_x > 0 and start_y < HEIGHT and end_y > 0:
            draw.line([(start_x, start_y), (end_x, end_y)], 
                     fill=BURNT_ORANGE, width=line_width)
    
    # Direction 2: Top-right to bottom-left (powder blue)
    for i in range(0, WIDTH + HEIGHT, diamond_size):
        start_x = min(WIDTH, i)
        start_y = max(0, i - WIDTH)
        end_x = max(0, i - HEIGHT)
        end_y = min(HEIGHT, i)
        
        if start_x > 0 and end_x < WIDTH and start_y < HEIGHT and end_y > 0:
            draw.line([(start_x, start_y), (end_x, end_y)], 
                     fill=POWDER_BLUE, width=line_width)
    
    # Add accent dots at intersections for visual interest
    for x in range(0, WIDTH + diamond_size, diamond_size):
        for y in range(0, HEIGHT + diamond_size, diamond_size):
            # Intersection points alternate
            offset_x = (y // diamond_size % 2) * (diamond_size // 2)
            ix = x + offset_x
            
            if 0 <= ix < WIDTH and 0 <= y < HEIGHT:
                # Small accent dot
                accent_color = BURNT_ORANGE if (x // diamond_size + y // diamond_size) % 2 == 0 else POWDER_BLUE
                draw.ellipse([ix-3, y-3, ix+3, y+3], fill=accent_color)
    
    # Add subtle noise
    img = add_subtle_noise(img, intensity=1)
    
    return img


def create_furrow_waves():
    """
    Background 4: Flowing Furrow Waves
    VISIBLE horizontal wave patterns suggesting plowed fields
    Cream-to-tan gradient with visible powder blue wave lines
    """
    print("Generating Flowing Furrow Waves (VISIBLE)...")
    
    img = Image.new('RGB', (WIDTH, HEIGHT), CREAM_MID)
    draw = ImageDraw.Draw(img)
    
    # Cream-to-tan vertical gradient
    for y in range(HEIGHT):
        t = y / HEIGHT
        color = lerp_color(CREAM_LIGHT, WARM_TAN, t * 0.5)
        draw.line([(0, y), (WIDTH, y)], fill=color)
    
    # Draw horizontal wave lines - CLEARLY VISIBLE
    num_waves = 25  # Number of furrow lines
    line_width = 2
    
    for wave_idx in range(num_waves):
        # Base Y position
        base_y = (wave_idx + 1) * HEIGHT / (num_waves + 1)
        
        # Create gentle wave pattern
        points = []
        for x in range(0, WIDTH + 15, 15):
            # Gentle undulation for furrow effect
            wave = math.sin(x / 250 + wave_idx * 0.3) * 25
            wave2 = math.sin(x / 400 - wave_idx * 0.2) * 15
            
            y = base_y + wave + wave2
            points.append((x, y))
        
        # Vary color intensity for depth
        intensity = 0.6 + 0.4 * math.sin(wave_idx / 4)
        wave_color = (
            int(POWDER_BLUE[0] * intensity),
            int(POWDER_BLUE[1] * intensity),
            int(POWDER_BLUE[2] * intensity)
        )
        
        # Draw the furrow line
        for i in range(len(points) - 1):
            draw.line([points[i], points[i+1]], fill=wave_color, width=line_width)
        
        # Add subtle shading between waves
        if wave_idx > 0:
            for i in range(0, len(points) - 1, 4):
                x, y = points[i]
                if 0 <= x < WIDTH:
                    # Draw shading accent
                    shade_color = blend_color(wave_color, CREAM_DARK, 0.3)
                    draw.ellipse([x-2, y-1, x+2, y+1], fill=shade_color)
    
    # Add subtle noise
    img = add_subtle_noise(img, intensity=1)
    
    return img


def main():
    print("=" * 60)
    print("FFT Nano VISIBLE Background Generator")
    print(f"Resolution: {WIDTH}x{HEIGHT} (4K)")
    print("Patterns: CLEARLY VISIBLE & PROFESSIONAL")
    print("=" * 60)
    
    # Ensure output directory exists
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # Generate all backgrounds
    backgrounds = [
        ("bg-hexagon-elegant-cream.png", create_hexagon_elegant),
        ("bg-terrain-farm-cream.png", create_terrain_farm),
        ("bg-diamond-grid-cream.png", create_diamond_grid),
        ("bg-furrow-waves-cream.png", create_furrow_waves),
    ]
    
    for filename, generator in backgrounds:
        print(f"\n{'='*50}")
        print(f"Generating: {filename}")
        img = generator()
        output_path = os.path.join(OUTPUT_DIR, filename)
        img.save(output_path, "PNG", optimize=True)
        print(f"  Saved: {output_path}")
        print(f"  Size: {os.path.getsize(output_path) / 1024:.1f} KB")
    
    print("\n" + "=" * 60)
    print("All VISIBLE backgrounds generated successfully!")
    print("=" * 60)


if __name__ == "__main__":
    main()
