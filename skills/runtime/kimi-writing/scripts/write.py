#!/usr/bin/env python3
"""
Kimi-K2.5 Writing CLI
Professional and creative writing assistant powered by Kimi-K2.5 via OpenRouter
"""

import os
import sys
import argparse
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from tools.openrouter_client import KimiClient
from scripts.domain_analyzer import analyze_context
from scripts.modes import select_mode, get_mode_config


def load_system_prompt() -> str:
    """Load core system prompt"""
    system_prompt_path = Path(__file__).parent.parent / "prompts" / "system.md"
    if not system_prompt_path.exists():
        raise FileNotFoundError(f"System prompt not found: {system_prompt_path}")

    return system_prompt_path.read_text()


def load_domain_style(domain: str) -> str:
    """Load domain-specific style guide if available"""
    style_path = Path(__file__).parent.parent / "prompts" / "styles" / f"{domain}.md"

    if style_path.exists():
        return f"\n\n# Domain-Specific Guidance for {domain.title()}\n\n" + style_path.read_text()

    return ""


def build_enhanced_system_prompt(domain: str, style: str, tone: str,
                                  audience: str, make_human: bool) -> str:
    """Build complete system prompt with context"""
    base_system = load_system_prompt()
    domain_style = load_domain_style(domain)

    # Add context-specific instructions
    context_addendum = f"""

## Current Context

- **Domain:** {domain}
- **Style:** {style}
- **Tone:** {tone}
- **Audience:** {audience}
"""

    if make_human:
        context_addendum += """
## Humanize Directives

**CRITICAL:** Make this sound genuinely human-written:
- Vary sentence length naturally (mix of short, medium, long)
- Use occasional sentence fragments for emphasis
- Avoid over-polished corporate language
- Write like someone with actual experience
- Include subtle imperfections that signal authenticity
- Use contractions naturally where appropriate
- Show personality and voice
- Make it feel like it was written by a person, not optimized by AI
"""

    return base_system + domain_style + context_addendum


def write_content(client: KimiClient, prompt: str, context: dict,
                 mode: str, make_human: bool, max_tokens: int) -> dict:
    """Generate content using Kimi-K2.5"""

    # Build enhanced system prompt
    system_prompt = build_enhanced_system_prompt(
        domain=context["domain"],
        style=context["style"],
        tone=context["tone"],
        audience=context["audience"],
        make_human=make_human
    )

    # Get mode config
    mode_config = get_mode_config(mode)

    # Generate content
    print(f"\n📝 Generating content using {mode.upper()} mode...")
    print(f"   Domain: {context['domain']} | Style: {context['style']} | Tone: {context['tone']}\n")

    result = client.write(
        prompt=prompt,
        system_prompt=system_prompt,
        mode=mode,
        temperature=mode_config["temperature"],
        max_tokens=max_tokens,
    )

    return result


def refine_content(client: KimiClient, original_text: str,
                   refinement_instructions: str, context: dict,
                   mode: str, max_tokens: int) -> dict:
    """Refine existing content"""

    # Build system prompt
    system_prompt = build_enhanced_system_prompt(
        domain=context["domain"],
        style=context["style"],
        tone=context["tone"],
        audience=context["audience"],
        make_human=False
    )

    print(f"\n✏️  Refining content using {mode.upper()} mode...")

    result = client.refine(
        original_text=original_text,
        refinement_instructions=refinement_instructions,
        system_prompt=system_prompt,
        mode=mode,
        max_tokens=max_tokens,
    )

    return result


def parse_args():
    """Parse CLI arguments"""
    parser = argparse.ArgumentParser(
        description="Kimi-K2.5 Writing Assistant",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    # Input
    parser.add_argument(
        "prompt",
        nargs="?",
        help="Writing prompt or 'refine' to refine existing text"
    )

    parser.add_argument(
        "--refine",
        metavar="FILE",
        help="Refine existing file instead of generating new content"
    )

    parser.add_argument(
        "--instructions",
        help="Refinement instructions (use with --refine)",
        default="Make it more human and natural"
    )

    # Mode and Style
    parser.add_argument(
        "--mode",
        choices=["thinking", "instant", "auto"],
        default="auto",
        help="Generation mode (default: auto)"
    )

    parser.add_argument(
        "--style",
        choices=["business", "creative", "technical", "marketing", "professional"],
        help="Writing style (default: auto-detect)"
    )

    parser.add_argument(
        "--domain",
        choices=["agriculture", "technology", "saas", "marketing", "business", "creative", "general"],
        help="Domain/niche (default: auto-detect)"
    )

    parser.add_argument(
        "--tone",
        choices=["formal", "casual", "authoritative", "enthusiastic", "neutral"],
        help="Tone (default: auto-detect)"
    )

    parser.add_argument(
        "--audience",
        help="Target audience (default: auto-detect)"
    )

    # Options
    parser.add_argument(
        "--make-human",
        action="store_true",
        help="Apply strong humanization directives"
    )

    parser.add_argument(
        "--force-thinking",
        action="store_true",
        help="Force thinking mode even for short prompts"
    )

    parser.add_argument(
        "--max-tokens",
        type=int,
        default=8192,
        help="Maximum tokens to generate (default: 8192)"
    )

    parser.add_argument(
        "--format",
        choices=["markdown", "plain", "html"],
        default="markdown",
        help="Output format (default: markdown)"
    )

    parser.add_argument(
        "--output", "-o",
        metavar="FILE",
        help="Write output to file"
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show analysis without generating content"
    )

    parser.add_argument(
        "--health-check",
        action="store_true",
        help="Test API connectivity and exit"
    )

    return parser.parse_args()


def print_dry_run(prompt: str, context: dict, mode: str):
    """Print analysis for dry run mode"""
    print("=" * 60)
    print("DRY RUN MODE - Analysis Only")
    print("=" * 60)
    print(f"\n📋 Prompt:")
    print(f"   {prompt[:200]}{'...' if len(prompt) > 200 else ''}\n")

    print("🔍 Detected Context:")
    print(f"   Domain:        {context['domain']} ({context['domain_confidence']:.2f})")
    print(f"   Style:         {context['style']} ({context['style_confidence']:.2f})")
    print(f"   Tone:          {context['tone']} ({context['tone_confidence']:.2f})")
    print(f"   Audience:      {context['audience']} ({context['audience_confidence']:.2f})")
    print(f"   Mode:          {mode.upper()}")

    mode_config = get_mode_config(mode)
    print(f"\n⚙️  Mode Configuration:")
    print(f"   Temperature:   {mode_config['temperature']}")
    print(f"   Top P:         {mode_config['top_p']}")
    print(f"   Max Tokens:    {mode_config['max_tokens']}")

    print(f"\n📝 Best For:")
    for use_case in mode_config['best_for']:
        print(f"   • {use_case}")

    print("\n" + "=" * 60)


def print_result(content: str, reasoning: str = None, output_format: str = "markdown"):
    """Print generated content"""
    if reasoning and output_format != "plain":
        print("\n🧠 Reasoning:")
        print("-" * 60)
        print(reasoning)
        print("-" * 60 + "\n")

    print("\n✨ Generated Content:")
    print("=" * 60)
    print(content)
    print("=" * 60)


def main():
    """Main CLI entry point"""
    args = parse_args()

    # Health check
    if args.health_check:
        print("🔍 Testing Kimi-K2.5 connectivity...")
        client = KimiClient()
        result = client.health_check()
        if result["status"] == "healthy":
            print(f"✅ Connected to {result['model']}")
            print(f"   Response: {result['response']}")
            return 0
        else:
            print(f"❌ Connection failed: {result.get('error', 'Unknown error')}")
            return 1

    # Validate input
    if not args.prompt and not args.refine:
        print("❌ Error: Provide a prompt or use --refine to modify existing text")
        print("   Use --help for usage information")
        return 1

    # Initialize client
    try:
        client = KimiClient()
    except ValueError as e:
        print(f"❌ Error: {e}")
        print("   Set OPENROUTER_API_KEY environment variable")
        return 1

    # Analyze context
    if args.refine:
        prompt = "Refine this content"
    else:
        prompt = args.prompt

    context = analyze_context(
        prompt,
        domain_override=args.domain,
        style_override=args.style,
        tone_override=args.tone,
        audience_override=args.audience
    )

    # Select mode
    mode = select_mode(
        prompt,
        override=None if args.mode == "auto" else args.mode,
        force_thinking=args.force_thinking
    )

    # Dry run mode
    if args.dry_run:
        print_dry_run(prompt, context, mode)
        return 0

    # Refine mode
    if args.refine:
        # Load original content
        refine_file = Path(args.refine)
        if not refine_file.exists():
            print(f"❌ Error: File not found: {args.refine}")
            return 1

        original_text = refine_file.read_text()

        # Refine content
        result = refine_content(
            client=client,
            original_text=original_text,
            refinement_instructions=args.instructions,
            context=context,
            mode=mode,
            max_tokens=args.max_tokens
        )

    # Generate mode
    else:
        # Generate content
        result = write_content(
            client=client,
            prompt=prompt,
            context=context,
            mode=mode,
            make_human=args.make_human,
            max_tokens=args.max_tokens
        )

    # Display results
    content = result.get("content", "")
    reasoning = result.get("reasoning_content")

    print_result(content, reasoning, args.format)

    # Output to file
    if args.output:
        output_path = Path(args.output)
        output_path.write_text(content)
        print(f"\n💾 Output written to: {output_path}")

    # Print usage stats
    usage = result.get("usage", {})
    if usage:
        print(f"\n📊 Token Usage:")
        print(f"   Prompt:    {usage['prompt_tokens']:,}")
        print(f"   Generated: {usage['completion_tokens']:,}")
        print(f"   Total:     {usage['total_tokens']:,}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
