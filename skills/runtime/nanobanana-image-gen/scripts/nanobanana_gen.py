#!/usr/bin/env python3
"""
Nano Banana 2 Image Generator
Uses Gemini 3.1 Flash Image Preview API
"""

import argparse
import base64
import json
import os
import sys
from datetime import datetime
from pathlib import Path
import urllib.request
import urllib.error

# Configuration — set GEMINI_API_KEY in your environment or .env
API_KEY = os.environ.get("GEMINI_API_KEY", "")
if not API_KEY:
    print("Error: GEMINI_API_KEY environment variable is not set.")
    print("Set it in your .env file: GEMINI_API_KEY=your_key_here")
    sys.exit(1)

MODEL = "gemini-3.1-flash-image-preview"
API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"

# Resolution mapping
RESOLUTIONS = {
    "512": "512x512",
    "1K": "1024x1024",
    "2K": "2048x2048",
    "4K": "4096x4096"
}

DEFAULT_RESOLUTION = "1K"
OUTPUT_DIR = Path(os.environ.get("NANOBANANA_OUTPUT_DIR", str(Path.home() / "generated_images")))
LOG_FILE = OUTPUT_DIR / "image_generation_log.md"


def log_generation(prompt: str, resolution: str, filename: str, status: str):
    """Log image generation details"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_entry = f"\n## {timestamp}\n- **Prompt**: {prompt}\n- **Resolution**: {resolution}\n- **Filename**: {filename}\n- **Status**: {status}\n"

    with open(LOG_FILE, "a") as f:
        f.write(log_entry)


def generate_image(prompt: str, resolution: str = None, input_image: str = None) -> str:
    """
    Generate an image using Nano Banana 2 API

    Args:
        prompt: Text description of the image to generate
        resolution: Resolution (512, 1K, 2K, 4K), defaults to 1K
        input_image: Path to input image for editing (optional)

    Returns:
        Path to the generated image file
    """
    if resolution is None:
        resolution = DEFAULT_RESOLUTION

    if resolution not in RESOLUTIONS:
        print(f"Invalid resolution: {resolution}. Using default: {DEFAULT_RESOLUTION}")
        resolution = DEFAULT_RESOLUTION

    res_size = RESOLUTIONS[resolution]
    full_prompt = f"Generate {prompt} at {res_size} resolution"

    # Build request
    parts = [{"text": full_prompt}]

    # Add input image if provided (for editing)
    if input_image and os.path.exists(input_image):
        with open(input_image, "rb") as f:
            image_data = base64.b64encode(f.read()).decode("utf-8")
        parts.insert(0, {
            "inline_data": {
                "mime_type": "image/png",
                "data": image_data
            }
        })

    request_data = {
        "contents": [{"parts": parts}]
    }

    # Make API call
    url = f"{API_URL}?key={API_KEY}"

    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(request_data).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )

        with urllib.request.urlopen(req) as response:
            response_data = json.loads(response.read().decode("utf-8"))

        # Extract image from response
        if "candidates" in response_data and len(response_data["candidates"]) > 0:
            content = response_data["candidates"][0]["content"]
            for part in content.get("parts", []):
                # Try both camelCase and snake_case keys
                inline_data = part.get("inlineData") or part.get("inline_data")
                if inline_data:
                    image_b64 = inline_data.get("data")
                    if image_b64:
                        image_data = base64.b64decode(image_b64)

                    # Save image
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    filename = f"image_{timestamp}.png"
                    filepath = OUTPUT_DIR / filename

                    with open(filepath, "wb") as f:
                        f.write(image_data)

                    # Log generation
                    log_generation(prompt, resolution, filename, "Success")

                    return str(filepath)

        print("No image data in response")
        return None

    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        if e.code == 429:
            print("Rate limit exceeded. Please wait before trying again.")
            print(f"Details: {error_body}")
        else:
            print(f"HTTP Error {e.code}: {error_body}")
        return None
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        return None


def main():
    parser = argparse.ArgumentParser(description="Generate images with Nano Banana 2")
    parser.add_argument("prompt", help="Text description of the image")
    parser.add_argument("-r", "--resolution", choices=["512", "1K", "2K", "4K"],
                        help="Resolution (default: 1K)")
    parser.add_argument("-i", "--input", help="Input image path for editing")
    parser.add_argument("-o", "--output", help="Output filename (optional)")

    args = parser.parse_args()

    print(f"Generating image with Nano Banana 2...")
    print(f"Prompt: {args.prompt}")
    print(f"Resolution: {args.resolution or DEFAULT_RESOLUTION}")
    if args.input:
        print(f"Input image: {args.input}")

    result = generate_image(args.prompt, args.resolution, args.input)

    if result:
        print(f"\n✅ Image saved to: {result}")

        # Rename if custom output filename provided
        if args.output:
            new_path = OUTPUT_DIR / args.output
            os.rename(result, new_path)
            print(f"✅ Renamed to: {new_path}")
            result = str(new_path)

        return 0
    else:
        print("\n❌ Failed to generate image")
        return 1


if __name__ == "__main__":
    sys.exit(main())
