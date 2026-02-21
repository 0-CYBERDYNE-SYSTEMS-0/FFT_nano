"""
Domain and audience detection for writing context
"""

import re
from typing import Dict, List, Optional, Tuple

class DomainAnalyzer:
    """Detect writing domain, audience, and style from input"""

    # Domain keywords
    DOMAIN_KEYWORDS = {
        "agriculture": [
            "crop", "farm", "soil", "harvest", "yield", "irrigation",
            "livestock", "corn", "soybean", "wheat", "cotton",
            "pesticide", "fertilizer", "tractor", "combine", "precision",
            "agriculture", "farming", "drought", "season", "acre",
            "cattle", "hogs", "poultry", "grazing", "planting",
            "agronomy", "extension", "usda", "rural", "ranch"
        ],
        "technology": [
            "api", "sdk", "framework", "deployment", "infrastructure",
            "cloud", "aws", "azure", "gcp", "kubernetes", "docker",
            "ci/cd", "devops", "scaling", "latency", "throughput",
            "backend", "frontend", "fullstack", "database", "cache",
            "monitoring", "logging", "security", "encryption", "auth"
        ],
        "saas": [
            "churn", "retention", "onboarding", "arr", "mrr",
            "subscription", "recurring", "trial", "upgrade", "downgrade",
            "lifetime value", "acquisition", "funnel", "conversion",
            "customer success", "account management", "self-service",
            "enterprise", "mid-market", "smb", "startup"
        ],
        "marketing": [
            "campaign", "conversion", "funnel", "engagement", "reach",
            "impression", "click", "ctr", "roi", "roas", "cpa",
            "landing page", "cta", "copy", "headline", "value prop",
            "brand", "positioning", "messaging", "persona", "segment",
            "social media", "email", "content", "influencer", "affiliate"
        ],
        "business": [
            "revenue", "profit", "margin", "ebitda", "burn rate",
            "runway", "valuation", "equity", "funding", "investment",
            "acquisition", "merger", "ipo", "kpi", "okr",
            "board", "stakeholder", "executive", "strategy", "operations",
            "proposal", "contract", "negotiation", "deal"
        ],
        "creative": [
            "story", "narrative", "character", "plot", "scene",
            "dialogue", "novel", "script", "screenplay", "short story",
            "poem", "poetry", "fiction", "creative writing", "genre",
            "voice", "tone", "imagery", "metaphor", "setting"
        ]
    }

    # Style indicators
    STYLE_INDICATORS = {
        "professional": [
            "report", "proposal", "memo", "policy", "documentation",
            "manual", "guide", "whitepaper", "case study", "executive",
            "formal", "professional", "business", "corporate"
        ],
        "creative": [
            "story", "narrative", "novel", "fiction", "creative",
            "poetic", "voice", "character", "plot", "scene"
        ],
        "technical": [
            "api", "documentation", "reference", "tutorial", "guide",
            "code", "developer", "engineer", "implementation", "integration"
        ],
        "marketing": [
            "copy", "ad", "landing page", "cta", "headline",
            "value proposition", "messaging", "campaign", "email"
        ]
    }

    # Tone indicators
    TONE_INDICATORS = {
        "formal": [
            "formal", "professional", "executive", "official", "policy"
        ],
        "casual": [
            "casual", "friendly", "conversational", "informal", "relaxed"
        ],
        "authoritative": [
            "expert", "authority", "authoritative", "definitive", "guide"
        ],
        "enthusiastic": [
            "exciting", "enthusiastic", "energetic", "passionate", "vibrant"
        ]
    }

    # Audience keywords
    AUDIENCE_KEYWORDS = {
        "technical": [
            "developer", "engineer", "programmer", "architect",
            "cto", "vp engineering", "tech lead"
        ],
        "business": [
            "ceo", "executive", "manager", "director", "business",
            "exec", "leadership", "stakeholder"
        ],
        "consumer": [
            "customer", "user", "consumer", "reader", "audience",
            "public", "general"
        ],
        "farmer": [
            "farmer", "grower", "producer", "rancher", "agricultural"
        ]
    }

    @classmethod
    def detect_domain(cls, text: str) -> Tuple[str, float]:
        """
        Detect primary domain from text

        Returns:
            (domain_name, confidence_score)
        """
        text_lower = text.lower()
        scores = {}

        for domain, keywords in cls.DOMAIN_KEYWORDS.items():
            matches = sum(1 for kw in keywords if kw in text_lower)
            if matches > 0:
                # Normalize score by keyword count
                scores[domain] = matches / len(keywords)

        if not scores:
            return "general", 0.0

        # Return top domain and its confidence
        top_domain = max(scores.items(), key=lambda x: x[1])
        return top_domain

    @classmethod
    def detect_style(cls, text: str) -> Tuple[str, float]:
        """Detect writing style from text"""
        text_lower = text.lower()
        scores = {}

        for style, indicators in cls.STYLE_INDICATORS.items():
            matches = sum(1 for ind in indicators if ind in text_lower)
            if matches > 0:
                scores[style] = matches / len(indicators)

        if not scores:
            return "professional", 0.0

        return max(scores.items(), key=lambda x: x[1])

    @classmethod
    def detect_tone(cls, text: str) -> Tuple[str, float]:
        """Detect tone from text"""
        text_lower = text.lower()
        scores = {}

        for tone, indicators in cls.TONE_INDICATORS.items():
            matches = sum(1 for ind in indicators if ind in text_lower)
            if matches > 0:
                scores[tone] = matches / len(indicators)

        if not scores:
            return "neutral", 0.0

        return max(scores.items(), key=lambda x: x[1])

    @classmethod
    def detect_audience(cls, text: str) -> Tuple[str, float]:
        """Detect target audience from text"""
        text_lower = text.lower()
        scores = {}

        for audience, keywords in cls.AUDIENCE_KEYWORDS.items():
            matches = sum(1 for kw in keywords if kw in text_lower)
            if matches > 0:
                scores[audience] = matches / len(keywords)

        if not scores:
            return "general", 0.0

        return max(scores.items(), key=lambda x: x[1])

    @classmethod
    def analyze(cls, prompt: str, style_override: Optional[str] = None,
                domain_override: Optional[str] = None,
                tone_override: Optional[str] = None,
                audience_override: Optional[str] = None) -> Dict[str, any]:
        """
        Complete analysis of writing context

        Args:
            prompt: User's writing request
            style_override: Manual style specification
            domain_override: Manual domain specification
            tone_override: Manual tone specification
            audience_override: Manual audience specification

        Returns:
            Dict with detected context and confidence scores
        """
        combined_text = prompt.lower()

        # Detect each dimension
        domain, domain_conf = cls.detect_domain(combined_text)
        style, style_conf = cls.detect_style(combined_text)
        tone, tone_conf = cls.detect_tone(combined_text)
        audience, audience_conf = cls.detect_audience(combined_text)

        # Apply overrides
        if domain_override:
            domain = domain_override
        if style_override:
            style = style_override
        if tone_override:
            tone = tone_override
        if audience_override:
            audience = audience_override

        return {
            "domain": domain,
            "domain_confidence": domain_conf,
            "style": style,
            "style_confidence": style_conf,
            "tone": tone,
            "tone_confidence": tone_conf,
            "audience": audience,
            "audience_confidence": audience_conf,
        }

    @classmethod
    def should_use_thinking_mode(cls, prompt: str) -> bool:
        """
        Determine if task requires thinking mode

        Returns True if:
        - Task is complex (> 200 words)
        - Requires deep reasoning
        - Multiple perspectives needed
        """
        prompt_lower = prompt.lower()

        # Complex task indicators
        complex_indicators = [
            "analyze", "evaluate", "critique", "comprehensive", "detailed",
            "in-depth", "thorough", "examine", "explore", "deep dive"
        ]

        # Long-form indicators
        long_form_indicators = [
            "article", "report", "whitepaper", "guide", "documentation",
            "series", "chapter", "book", "narrative", "story"
        ]

        # Check for complex indicators
        has_complex = any(ind in prompt_lower for ind in complex_indicators)
        has_long_form = any(ind in prompt_lower for ind in long_form_indicators)
        is_long_prompt = len(prompt.split()) > 100

        return has_complex or has_long_form or is_long_prompt


def analyze_context(prompt: str, **overrides) -> Dict[str, any]:
    """Convenience function for context analysis"""
    return DomainAnalyzer.analyze(prompt, **overrides)
