"""
LM Studio Health Check Tool
Check if LM Studio is accessible on Tailscale network
"""

import sys
from pathlib import Path

# Add skill directory to path for imports
skill_dir = Path(__file__).parent.parent
sys.path.insert(0, str(skill_dir))

from client import LMStudioClient


def lm_studio_health(
    host: str = "100.72.41.118",
    port: int = 1234
) -> str:
    """
    Check if LM Studio is accessible and responding

    Args:
        host: Tailscale IP of LM Studio (default: 100.72.41.118)
        port: API port (default: 1234)

    Returns:
        Formatted health status string

    Raises:
        Exception: If health check fails

    Example:
        >>> status = lm_studio_health()
        >>> print(status)
        ✅ LM Studio Status: OK
        Response time: 45ms
        Models available: 10
    """
    client = LMStudioClient(host=host, port=port)

    try:
        health = client.health_check()

        if health["status"] == "ok":
            return (
                f"✅ LM Studio Status: OK\n"
                f"Response time: {health['response_time_ms']}ms\n"
                f"Models available: {health['models_count']}"
            )
        else:
            return (
                f"❌ LM Studio Status: ERROR\n"
                f"Response time: {health['response_time_ms']}ms\n"
                f"Error: {health.get('error', 'Unknown')}"
            )

    except Exception as e:
        return (
            f"❌ LM Studio Status: ERROR\n"
            f"Could not connect to {host}:{port}\n"
            f"Error: {e}"
        )


if __name__ == "__main__":
    # Test from command line
    import argparse

    parser = argparse.ArgumentParser(description="Check LM Studio health")
    parser.add_argument("--host", default="100.72.41.118", help="LM Studio host")
    parser.add_argument("--port", type=int, default=1234, help="LM Studio port")

    args = parser.parse_args()

    result = lm_studio_health(
        host=args.host,
        port=args.port
    )

    print(result, flush=True)
