"""
LM Studio Models Tool
List available models in LM Studio
"""

import sys
import json
from pathlib import Path

# Add skill directory to path for imports
skill_dir = Path(__file__).parent.parent
sys.path.insert(0, str(skill_dir))

from client import LMStudioClient


def lm_studio_models(
    host: str = "100.72.41.118",
    port: int = 1234,
    format: str = "table"
) -> str:
    """
    List all available models in LM Studio (private)

    Args:
        host: Tailscale IP of LM Studio (default: 100.72.41.118)
        port: API port (default: 1234)
        format: Output format - "table", "json", or "list" (default: table)

    Returns:
        Formatted string with model information

    Raises:
        Exception: If request fails

    Example:
        >>> models = lm_studio_models()
        >>> print(models)
        mistralai/ministral-3-3b  (Chat)
        jan-v2-vl-high             (Vision)
        glm-4.7-flash              (Chat)
    """
    client = LMStudioClient(host=host, port=port)

    try:
        models = client.list_models()

        if format == "json":
            return json.dumps(models, indent=2)

        elif format == "list":
            return "\n".join(m["id"] for m in models)

        elif format == "table":
            # Format as table
            lines = []
            lines.append("=" * 80)
            lines.append(f"{'Model ID':<40} {'Type':<15} {'Owned By':<20}")
            lines.append("=" * 80)

            for m in models:
                model_id = m.get("id", "unknown")
                model_type = "Chat"
                if "vision" in model_id.lower() or "vl" in model_id.lower():
                    model_type = "Vision"
                elif "embed" in model_id.lower():
                    model_type = "Embedding"

                owned_by = m.get("owned_by", "unknown")[:20]

                lines.append(f"{model_id:<40} {model_type:<15} {owned_by:<20}")

            lines.append("=" * 80)
            lines.append(f"Total models: {len(models)}")

            return "\n".join(lines)

        else:
            raise ValueError(f"Unsupported format: {format}")

    except Exception as e:
        raise Exception(f"Failed to list models: {e}")


if __name__ == "__main__":
    # Test from command line
    import argparse

    parser = argparse.ArgumentParser(description="List LM Studio models")
    parser.add_argument("--host", default="100.72.41.118", help="LM Studio host")
    parser.add_argument("--port", type=int, default=1234, help="LM Studio port")
    parser.add_argument("--format", default="table", choices=["table", "json", "list"],
                       help="Output format")

    args = parser.parse_args()

    result = lm_studio_models(
        host=args.host,
        port=args.port,
        format=args.format
    )

    print(result, flush=True)
