"""
LM Studio Chat Tool
Private text completion and chat via LM Studio
"""

import sys
from pathlib import Path

# Add skill directory to path for imports
skill_dir = Path(__file__).parent.parent
sys.path.insert(0, str(skill_dir))

from client import LMStudioClient


def lm_studio_chat(
    prompt: str,
    model: str = "mistralai/ministral-3-3b",
    max_tokens: int = 2000,
    temperature: float = 0.7,
    host: str = "100.72.41.118",
    port: int = 1234
) -> str:
    """
    Send chat completion request to LM Studio (private)

    Args:
        prompt: The text prompt to send
        model: Model to use (default: mistralai/ministral-3-3b)
        max_tokens: Max tokens in response (default: 2000)
        temperature: Sampling temperature 0.0-1.0 (default: 0.7)
        host: Tailscale IP of LM Studio (default: 100.72.41.118)
        port: API port (default: 1234)

    Returns:
        Response text from the model

    Raises:
        Exception: If request fails

    Example:
        >>> result = lm_studio_chat("Say hello!")
        >>> print(result)
        "Hello! How can I help you today?"
    """
    client = LMStudioClient(host=host, port=port)

    try:
        response = client.chat(
            prompt=prompt,
            model=model,
            max_tokens=max_tokens,
            temperature=temperature
        )

        # Extract content from response
        content = response["choices"][0]["message"]["content"]

        # Add usage info
        usage = response.get("usage", {})
        usage_str = f"\n\n[LM Studio Usage: {usage.get('total_tokens', '?')} tokens]"

        return content + usage_str

    except Exception as e:
        raise Exception(f"LM Studio chat failed: {e}")


if __name__ == "__main__":
    # Test from command line
    import argparse

    parser = argparse.ArgumentParser(description="Chat with LM Studio")
    parser.add_argument("prompt", help="Text prompt to send")
    parser.add_argument("--model", default="mistralai/ministral-3-3b", help="Model ID")
    parser.add_argument("--tokens", type=int, default=2000, help="Max tokens")
    parser.add_argument("--temp", type=float, default=0.7, help="Temperature")
    parser.add_argument("--host", default="100.72.41.118", help="LM Studio host")
    parser.add_argument("--port", type=int, default=1234, help="LM Studio port")

    args = parser.parse_args()

    result = lm_studio_chat(
        prompt=args.prompt,
        model=args.model,
        max_tokens=args.tokens,
        temperature=args.temp,
        host=args.host,
        port=args.port
    )

    print(result, flush=True)
