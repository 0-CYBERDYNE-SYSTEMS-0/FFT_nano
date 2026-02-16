#!/usr/bin/env python3
"""
FFT Nano CLEARLY VISIBLE Background Generator - Version 2
Generates 4 backgrounds with CLEARLY PERCEPTIBLE patterns
"""

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
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

def add_subtle_noise(img, intensity=1):
    """Add very fine noise/grain for texture"""
    arr = np.array(img, dtype=np.float32)
    noise = np.random.normal(0, intensity, arr.shape)
    arr = np.clip(arr + noise, 0, 255).astype(np.uint8)
    return Image.fromarray(arr)


def create_hexagon_elegant_v2():
    """
    Background 1: Elegant Hexagon Texture - VISIBLE VERSION 2
    CLEARLY VISIBLE hexagonal mesh pattern
    """
    print("Generating Elegant Hexagon Texture V2 (MORE VISIBLE)...")
    
    img = Image.new('RGB', (WIDTH, HEIGHT), CREAM_MID)
    draw = ImageDraw.Draw(img)
    
    # Vertical gradient
    for y in range(HEIGHT):
        t = y / HEIGHT
        color = lerp_color(CREAM_LIGHT, CREAM_DARK, t * 0.4)
        draw.line([(0, y), (WIDTH, y)], fill=color)
    
    # Hexagon parameters - LARGER and MORE VISIBLE
    hex_size = 100  # Larger hexagons
    hex_height = hex_size * math.sqrt(3)
    line_width = 3  # Thicker lines
    
    line_color = BURNT_ORANGE
    
    # Draw hexagonal grid
    rows = int(HEIGHT / hex_height) + 2
    cols = int(WIDTH / (hex_size * 1.5)) + 2
    
    for row in range(rows):
        for col in range(cols):
            x = col * hex_size * 1.5
            y = row * hex_height
            if col % 2 == 1:
                y += hex_height / 2
            
            vertices = []
            for i in range(6):
                angle = math.pi / 3 * i
                vx = x + hex_size * math.cos(angle)
                vy = y + hex_size * math.sin(angle)
                vertices.append((vx, vy))
            
            for i in range(6):
                start = vertices[i]
                end = vertices[(i + 1) % 6]
                draw.line([start, end], fill=line_color, width=line_width)
    
    img = add_subtle_noise(img, intensity=1)
    return img


def create_terrain_farm_v2():
    """
    Background 2: Farm Field Terrain - VISIBLE VERSION 2
    CLEARLY VISIBLE topographic contour lines
    """
    print("Generating Farm Field Terrain V2 (MORE VISIBLE)...")
    
    img = Image.new('RGB', (WIDTH, HEIGHT), CREAM_MID)
    draw = ImageDraw.Draw(img)
    
    # Gradient
    for y in range(HEIGHT):
        t = y / HEIGHT
        color = lerp_color(CREAM_LIGHT, CREAM_DARK, t * 0.35)
        draw.line([(0, y), (WIDTH, y)], fill=color)
    
    # FEWER contour lines, THICKER, MORE VISIBLE
    contour_levels = 12  # Fewer lines, more space between
    line_width = 3  # Thicker lines
    
    for level in range(contour_levels):
        base_y = (level + 1) * HEIGHT / (contour_levels + 1)
        
        points = []
        for x in range(0, WIDTH + 20, 15):
            # LARGER waves for visibility
            wave1 = math.sin(x / 180 + level * 0.7) * 80
            wave2 = math.sin(x / 300 + level * 0.4) * 50
            wave3 = math.sin(x / 120 - level * 0.3) * 40
            
            y = base_y + wave1 + wave2 + wave3
            points.append((x, y))
        
        # Vary intensity for depth
        intensity = 0.8 + 0.2 * math.sin(level / 2)
        contour_color = (
            int(POWDER_BLUE[0] * intensity),
            int(POWDER_BLUE[1] * intensity),
            int(POWDER_BLUE[2] * intensity)
        )
        
        # Draw thick visible lines
        for i in range(len(points) - 1):
            draw.line([points[i], points[i+1]], fill=contour_color, width=line_width)
    
    img = add_subtle_noise(img, intensity=1)
    return img


def create_diamond_grid_v2():
    """
    Background 3: Diamond Grid Pattern - VISIBLE VERSION 2
    CLEARLY VISIBLE diamond tessellation
    """
    print("Generating Diamond Grid Pattern V2 (MORE VISIBLE)...")
    
    img = Image.new('RGB', (WIDTH, HEIGHT), CREAM_MID)
    draw = ImageDraw.Draw(img)
    
    # Gradient
    for y in range(HEIGHT):
        t = y / HEIGHT
        color = lerp_color(CREAM_LIGHT, CREAM_DARK, t * 0.3)
        draw.line([(0, y), (WIDTH, y)], fill=color)
    
    # Larger diamonds, thicker lines
    diamond_size = 90
    line_width = 3
    
    # Direction 1: Top-left to bottom-right (burnt orange)
    for i in range(-HEIGHT, WIDTH + HEIGHT, diamond_size):
        start_x = max(0, i)
        start_y = max(0, -i) if i < 0 else 0
        end_x = min(WIDTH, i + HEIGHT)
        end_y = min(HEIGHT, HEIGHT - i) if i > WIDTH - HEIGHT else HEIGHT
        
        if start_x < WIDTH and end_x > 0:
            draw.line([(start_x, start_y), (end_x, end_y)], 
                     fill=BURNT_ORANGE, width=line_width)
    
    # Direction 2: Top-right to bottom-left (powder blue)
    for i in range(0, WIDTH + HEIGHT, diamond_size):
        start_x = min(WIDTH, i)
        start_y = max(0, i - WIDTH)
        end_x = max(0, i - HEIGHT)
        end_y = min(HEIGHT, i)
        
        if start_x > 0 and end_x < WIDTH:
            draw.line([(start_x, start_y), (end_x, end_y)], 
                     fill=POWDER_BLUE, width=line_width)
    
    # Larger accent dots at intersections
    for x in range(0, WIDTH + diamond_size, diamond_size):
        for y in range(0, HEIGHT + diamond_size, diamond_size):
            offset_x = (y // diamond_size % 2) * (diamond_size // 2)
            ix = x + offset_x
            
            if 0 <= ix < WIDTH and 0 <= y < HEIGHT:
                accent_color = BURNT_ORANGE if (x // diamond_size + y // diamond_size) % 2 == 0 else POWDER_BLUE
                draw.ellipse([ix-5, y-5, ix+5, y+5], fill=accent_color)
    
    img = add_subtle_noise(img, intensity=1)
    return img


def create_furrow_waves_v2():
    """
    Background 4: Flowing Furrow Waves - VISIBLE VERSION 2
    CLEARLY VISIBLE horizontal wave patterns
    """
    print("Generating Flowing Furrow Waves V2 (MORE VISIBLE)...")
    
    img = Image.new('RGB', (WIDTH, HEIGHT), CREAM_MID)
    draw = ImageDraw.Draw(img)
    
    # Cream-to-tan gradient
    for y in range(HEIGHT):
        t = y / HEIGHT
        color = lerp_color(CREAM_LIGHT, WARM_TAN, t * 0.5)
        draw.line([(0, y), (WIDTH, y)], fill=color)
    
    # FEWER wave lines, THICKER, MORE VISIBLE
    num_waves = 15  # Fewer, more prominent waves
    line_width = 3  # Thicker lines
    
    for wave_idx in range(num_waves):
        base_y = (wave_idx + 1) * HEIGHT / (num_waves + 1)
        
        points = []
        for x in range(0, WIDTH + 12, 12):
            # LARGER waves for visibility
            wave = math.sin(x / 200 + wave_idx * 0.4) * 35
            wave2 = math.sin(x / 350 - wave_idx * 0.3) * 20
            
            y = base_y + wave + wave2
            points.append((x, y))
        
        # Vary intensity for depth
        intensity = 0.75 + 0.25 * math.sin(wave_idx / 3)
        wave_color = (
            int(POWDER_BLUE[0] * intensity),
            int(POWDER_BLUE[1] * intensity),
            int(POWDER_BLUE[2] * intensity)
        )
        
        # Draw thick visible lines
        for i in range(len(points) - 1):
            draw.line([points[i], points[i+1]], fill=wave_color, width=line_width)
    
    img = add_subtle_noise(img, intensity=1)
    return img


def main():
    print("=" * 60)
    print("FFT Nano CLEARLY VISIBLE Background Generator V2")
    print(f"Resolution: {WIDTH}x{HEIGHT} (4K)")
    print("Patterns: CLEARLY PERCEPTIBLE & ELEGANT")
    print("=" * 60)
    
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    backgrounds = [
        ("bg-hexagon-elegant-cream.png", create_hexagon_elegant_v2),
        ("bg-terrain-farm-cream.png", create_terrain_farm_v2),
        ("bg-diamond-grid-cream.png", create_diamond_grid_v2),
        ("bg-furrow-waves-cream.png", create_furrow_waves_v2),
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
    print("All CLEARLY VISIBLE backgrounds generated!")
    print("=" * 60)


if __name__ == "__main__":
    main()
