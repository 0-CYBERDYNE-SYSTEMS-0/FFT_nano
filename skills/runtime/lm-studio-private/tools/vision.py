"""
LM Studio Vision Tool
Private image analysis via LM Studio
"""

import sys
from pathlib import Path

# Add skill directory to path for imports
skill_dir = Path(__file__).parent.parent
sys.path.insert(0, str(skill_dir))

from client import LMStudioClient


def lm_studio_vision(
    image_path: str,
    prompt: str,
    model: str = "mistralai/ministral-3-3b",
    max_tokens: int = 1000,
    host: str = "100.72.41.118",
    port: int = 1234
) -> str:
    """
    Analyze image with LM Studio's vision model (private)

    Args:
        image_path: Absolute path to image file
        prompt: What to analyze in the image
        model: Vision model ID (default: mistralai/ministral-3-3b, fallback: jan-v2-vl-high)
        max_tokens: Max tokens in response (default: 1000)
        host: Tailscale IP of LM Studio (default: 100.72.41.118)
        port: API port (default: 1234)

    Returns:
        Analysis text from the model

    Raises:
        ValueError: If image path is not absolute
        FileNotFoundError: If image doesn't exist
        Exception: If request fails

    Example:
        >>> result = lm_studio_vision("/path/to/screenshot.jpg", "Extract text")
        >>> print(result)
        "The image contains text that says: Hello World"
    """
    client = LMStudioClient(host=host, port=port)

    try:
        response = client.vision(
            image_path=image_path,
            prompt=prompt,
            model=model,
            max_tokens=max_tokens
        )

        # Extract content from response
        content = response["choices"][0]["message"]["content"]

        # Add usage info
        usage = response.get("usage", {})
        usage_str = f"\n\n[LM Studio Vision Usage: {usage.get('total_tokens', '?')} tokens]"

        return content + usage_str

    except ValueError as e:
        raise ValueError(f"Invalid input: {e}")
    except FileNotFoundError as e:
        raise FileNotFoundError(f"Image not found: {e}")
    except Exception as e:
        raise Exception(f"LM Studio vision failed: {e}")


if __name__ == "__main__":
    # Test from command line
    import argparse

    parser = argparse.ArgumentParser(description="Analyze image with LM Studio")
    parser.add_argument("image", help="Path to image file")
    parser.add_argument("prompt", help="What to analyze")
    parser.add_argument("--model", default="mistralai/ministral-3-3b", help="Vision model ID (default: mistralai/ministral-3-3b, fallback: jan-v2-vl-high)")
    parser.add_argument("--tokens", type=int, default=1000, help="Max tokens")
    parser.add_argument("--host", default="100.72.41.118", help="LM Studio host")
    parser.add_argument("--port", type=int, default=1234, help="LM Studio port")

    args = parser.parse_args()

    result = lm_studio_vision(
        image_path=args.image,
        prompt=args.prompt,
        model=args.model,
        max_tokens=args.tokens,
        host=args.host,
        port=args.port
    )

    print(result, flush=True)
