#!/usr/bin/env python3
"""
Path Resolver Utility
Resolves domain names to full paths using .env configuration
"""

import os
from dotenv import load_dotenv
from pathlib import Path

# Load environment variables from skill directory
script_dir = Path(__file__).parent.parent
env_path = script_dir / '.env'
load_dotenv(dotenv_path=env_path)


def extract_domain(path_input):
    """
    Extract domain name from a path input.

    Examples:
        "farm-friend.com" → "farm-friend.com"
        "farm-friend.com/subdir" → "farm-friend.com"
        "/home/dh_cqevup/farm-friend.com" → "farm-friend.com"

    Args:
        path_input: Either a domain name, domain/path, or a full path

    Returns:
        Domain name string, or None if domain cannot be determined
    """
    # If it starts with /, it's a full path - extract last component
    if path_input.startswith('/'):
        # Get the last path component
        parts = path_input.rstrip('/').split('/')
        if parts:
            potential_domain = parts[-1]
            if '.' in potential_domain and not potential_domain.startswith('.'):
                return potential_domain
        return None

    # Otherwise check if first component is a domain
    parts = path_input.split('/', 1)
    potential_domain = parts[0]

    if '.' in potential_domain and not potential_domain.startswith('.'):
        return potential_domain

    return None


def resolve_path(path_input):
    """
    Resolve domain name to full path or return path as-is.

    Examples:
        "farm-friend.com" → "/home/dh_cqevup/farm-friend.com"
        "farm-friend.com/subdir" → "/home/dh_cqevup/farm-friend.com/subdir"
        "/home/dh_cqevup/farm-friend.com" → "/home/dh_cqevup/farm-friend.com" (unchanged)

    Args:
        path_input: Either a domain name, domain/path, or a full path

    Returns:
        Full path string

    Raises:
        ValueError: If domain name looks like a domain but isn't configured
    """
    # If it starts with /, it's already a full path
    if path_input.startswith('/'):
        return path_input

    # Check if path starts with a domain name
    # Split on first / to separate domain from subpath
    parts = path_input.split('/', 1)
    potential_domain = parts[0]

    # Check if it looks like a domain name (contains a dot and doesn't start with .)
    if '.' in potential_domain and not potential_domain.startswith('.'):
        # Try to find domain mapping in environment
        env_key = f"DOMAIN_{potential_domain}"
        domain_path = os.getenv(env_key)

        if domain_path:
            # If there's a subpath, append it
            if len(parts) > 1:
                return f"{domain_path}/{parts[1]}"
            else:
                return domain_path
        else:
            # Domain format but not configured
            raise ValueError(
                f"Domain '{potential_domain}' not configured in .env file.\n"
                f"Add this line to your .env:\n"
                f"  {env_key}=/home/username/{potential_domain}\n"
                f"Or use the full path instead."
            )

    # Doesn't look like a domain, return as-is (might be relative path)
    return path_input


def get_credentials(domain):
    """
    Get DreamHost credentials for a specific domain.

    First tries domain-specific credentials (DREAMHOST_HOST_domain, etc).
    Falls back to global credentials if domain-specific ones not found.

    Args:
        domain: Domain name (e.g., "farm-friend.com")

    Returns:
        Tuple of (host, user, password, ssh_key_path)

    Raises:
        ValueError: If no credentials found for domain
    """
    # Try domain-specific credentials first
    host = os.getenv(f"DREAMHOST_HOST_{domain}")
    user = os.getenv(f"DREAMHOST_USER_{domain}")
    password = os.getenv(f"DREAMHOST_PASSWORD_{domain}")
    ssh_key = os.getenv(f"DREAMHOST_SSH_KEY_PATH_{domain}")

    # Fall back to global credentials if domain-specific not found
    if not host:
        host = os.getenv('DREAMHOST_HOST')
    if not user:
        user = os.getenv('DREAMHOST_USER')
    if not password:
        password = os.getenv('DREAMHOST_PASSWORD')
    if not ssh_key:
        ssh_key = os.getenv('DREAMHOST_SSH_KEY_PATH')

    # Validate we have at least host and user
    if not host or not user:
        raise ValueError(
            f"No credentials found for domain '{domain}'.\n"
            f"Add domain-specific credentials to .env:\n"
            f"  DREAMHOST_HOST_{domain}=your.dreamhost.com\n"
            f"  DREAMHOST_USER_{domain}=your_username\n"
            f"  DREAMHOST_PASSWORD_{domain}=your_password\n"
            f"Or set global credentials:\n"
            f"  DREAMHOST_HOST=your.dreamhost.com\n"
            f"  DREAMHOST_USER=your_username\n"
            f"  DREAMHOST_PASSWORD=your_password"
        )

    return host, user, password, ssh_key


def list_configured_domains():
    """List all configured domain mappings from .env"""
    domains = {}
    for key, value in os.environ.items():
        if key.startswith('DOMAIN_'):
            domain_name = key.replace('DOMAIN_', '')
            domains[domain_name] = value
    return domains


if __name__ == '__main__':
    # Test/demo the resolver
    import sys

    if len(sys.argv) > 1:
        test_path = sys.argv[1]
        try:
            resolved = resolve_path(test_path)
            print(f"Input:    {test_path}")
            print(f"Resolved: {resolved}")
        except ValueError as e:
            print(f"Error: {e}")
    else:
        print("Configured domains:")
        domains = list_configured_domains()
        if domains:
            for domain, path in domains.items():
                print(f"  {domain} → {path}")
        else:
            print("  No domains configured in .env")
