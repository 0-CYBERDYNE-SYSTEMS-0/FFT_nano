"""
OpenRouter API client for Kimi-K2.5
Wraps OpenAI-compatible API for moonshotai/kimi-k2.5
"""

import os
from typing import Optional, List, Dict, Any
from openai import OpenAI
import json

class KimiClient:
    """Kimi-K2.5 client via OpenRouter"""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("OPENROUTER_API_KEY")
        if not self.api_key:
            raise ValueError("OPENROUTER_API_KEY not set")

        self.client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=self.api_key,
        )
        self.model = "moonshotai/kimi-k2.5"

    def chat(
        self,
        messages: List[Dict[str, Any]],
        mode: str = "thinking",
        temperature: Optional[float] = None,
        max_tokens: int = 8192,
        stream: bool = False,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Send chat completion request to Kimi-K2.5

        Args:
            messages: Chat messages with role and content
            mode: 'thinking' (t=1.0) or 'instant' (t=0.6)
            temperature: Override default (default based on mode)
            max_tokens: Maximum tokens to generate
            stream: Stream responses
            **kwargs: Additional OpenAI params

        Returns:
            Response dict with content, reasoning_content, metadata
        """

        # Set temperature based on mode
        if temperature is None:
            temperature = 1.0 if mode == "thinking" else 0.6

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=stream,
                **kwargs
            )

            if stream:
                return {"stream": response}

            # Extract response content
            choice = response.choices[0]
            result = {
                "content": choice.message.content,
                "reasoning_content": getattr(choice.message, "reasoning_content", None),
                "finish_reason": choice.finish_reason,
                "usage": {
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                    "total_tokens": response.usage.total_tokens,
                },
                "model": self.model,
                "mode": mode,
                "temperature": temperature,
            }

            return result

        except Exception as e:
            raise RuntimeError(f"OpenRouter API error: {e}")

    def write(
        self,
        prompt: str,
        system_prompt: str,
        mode: str = "thinking",
        temperature: Optional[float] = None,
        max_tokens: int = 8192,
    ) -> Dict[str, Any]:
        """
        Convenience method for single-turn writing tasks

        Args:
            prompt: User's writing request
            system_prompt: System instructions
            mode: 'thinking' or 'instant'
            temperature: Override default
            max_tokens: Max tokens to generate

        Returns:
            Response dict with generated content
        """
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ]

        return self.chat(
            messages=messages,
            mode=mode,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    def refine(
        self,
        original_text: str,
        refinement_instructions: str,
        system_prompt: str,
        mode: str = "thinking",
        temperature: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        Refine existing text with specific instructions

        Args:
            original_text: Text to refine
            refinement_instructions: How to improve it
            system_prompt: System instructions
            mode: 'thinking' or 'instant'
            temperature: Override default

        Returns:
            Response dict with refined content
        """
        messages = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": f"""Here is the original text:

```
{original_text}
```

Refinement instructions:
{refinement_instructions}

Provide the refined version only, with no explanation or commentary."""
            },
        ]

        return self.chat(
            messages=messages,
            mode=mode,
            temperature=temperature,
        )

    def health_check(self) -> Dict[str, Any]:
        """Test API connectivity"""

        try:
            response = self.chat(
                messages=[
                    {"role": "system", "content": "You are Kimi."},
                    {"role": "user", "content": "Say 'healthy' if you can read this."},
                ],
                mode="instant",
                max_tokens=10,
            )

            return {
                "status": "healthy",
                "model": self.model,
                "response": response["content"],
            }

        except Exception as e:
            return {
                "status": "error",
                "model": self.model,
                "error": str(e),
            }


# Convenience function for quick usage
def get_client(api_key: Optional[str] = None) -> KimiClient:
    """Get a configured KimiClient instance"""
    return KimiClient(api_key=api_key)
