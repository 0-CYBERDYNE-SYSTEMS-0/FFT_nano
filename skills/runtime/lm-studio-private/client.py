"""
LM Studio Private API Client
HTTP client for LM Studio running on Tailscale network
With auto-loading capability
"""

import requests
import json
import base64
import time
import subprocess
from typing import Optional, List, Dict, Any
from pathlib import Path


class LMStudioClient:
    """Client for LM Studio OpenAI-compatible API with auto-loading"""

    # Default models
    DEFAULT_CHAT_MODEL = "mistralai/ministral-3-3b"
    DEFAULT_VISION_MODEL = "mistralai/ministral-3-3b"

    def __init__(
        self,
        host: str = "100.72.41.118",
        port: int = 1234,
        timeout: int = 120,
        auto_load: bool = True,
        default_model: str = None
    ):
        """
        Initialize LM Studio client

        Args:
            host: Tailscale IP of LM Studio
            port: API port (default: 1234)
            timeout: Request timeout in seconds
            auto_load: Auto-load model if not loaded (default: True)
            default_model: Default model to use (default: mistralai/ministral-3-3b)
        """
        self.base_url = f"http://{host}:{port}/v1"
        self.rest_url = f"http://{host}:{port}/api/v1"
        self.timeout = timeout
        self.auto_load = auto_load
        self.default_model = default_model or self.DEFAULT_CHAT_MODEL

    def is_running(self) -> bool:
        """Check if LM Studio API is accessible."""
        try:
            response = requests.get(f"{self.base_url}/models", timeout=5)
            return response.status_code == 200
        except:
            return False

    def start_lm_studio(self) -> bool:
        """Start LM Studio application."""
        try:
            subprocess.Popen(
                ["open", "-a", "LM Studio"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            # Wait for LM Studio to start
            for _ in range(30):
                time.sleep(2)
                if self.is_running():
                    return True
            return False
        except Exception as e:
            print(f"Error starting LM Studio: {e}")
            return False

    def load_model(self, model: str) -> Dict[str, Any]:
        """
        Load a model into LM Studio

        Args:
            model: Model identifier to load

        Returns:
            Load response with status
        """
        url = f"{self.rest_url}/models/load"
        data = {"model": model}
        
        response = requests.post(url, json=data, timeout=self.timeout)
        response.raise_for_status()
        return response.json()

    def unload_model(self, model: str) -> Dict[str, Any]:
        """
        Unload a model from LM Studio

        Args:
            model: Model identifier to unload

        Returns:
            Unload response
        """
        url = f"{self.rest_url}/models/unload"
        data = {"model": model}
        
        response = requests.post(url, json=data, timeout=self.timeout)
        response.raise_for_status()
        return response.json()

    def get_loaded_models(self) -> List[str]:
        """Get list of currently loaded models."""
        try:
            response = self._make_request("models", "GET")
            models = response.get("data", [])
            return [m.get("id") for m in models]
        except:
            return []

    def ensure_model_loaded(self, model: str) -> bool:
        """
        Ensure a model is loaded, auto-load if not

        Args:
            model: Model identifier

        Returns:
            True if model is loaded/loaded successfully
        """
        loaded = self.get_loaded_models()
        
        # Check if model is already loaded
        # LM Studio model IDs might have different formats, so check partial match
        for loaded_model in loaded:
            if model.lower() in loaded_model.lower() or loaded_model.lower() in model.lower():
                return True
        
        # Model not loaded, try to load it
        if self.auto_load:
            print(f"Auto-loading model: {model}")
            try:
                result = self.load_model(model)
                if result.get("status") == "loaded":
                    print(f"Successfully loaded: {model}")
                    return True
            except Exception as e:
                print(f"Failed to load model {model}: {e}")
                return False
        
        return False

    def _make_request(
        self,
        endpoint: str,
        method: str = "GET",
        data: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """Make HTTP request to LM Studio API"""
        url = f"{self.base_url}/{endpoint}"
        headers = {"Content-Type": "application/json"}

        try:
            if method == "GET":
                response = requests.get(url, headers=headers, timeout=self.timeout)
            elif method == "POST":
                response = requests.post(url, headers=headers, json=data, timeout=self.timeout)
            else:
                raise ValueError(f"Unsupported method: {method}")

            response.raise_for_status()
            return response.json()

        except requests.exceptions.Timeout:
            raise requests.RequestException(f"Request to {url} timed out after {self.timeout}s")
        except requests.exceptions.ConnectionError as e:
            raise requests.RequestException(f"Could not connect to LM Studio at {url}. Error: {e}")
        except requests.exceptions.HTTPError as e:
            raise requests.RequestException(f"HTTP error from LM Studio: {e}")
        except json.JSONDecodeError as e:
            raise requests.RequestException(f"Invalid JSON response: {e}")

    def chat(
        self,
        prompt: str,
        model: str = None,
        max_tokens: int = 2000,
        temperature: float = 0.7,
        stream: bool = False,
        auto_load: bool = None
    ) -> Dict[str, Any]:
        """
        Send chat completion request with auto-loading

        Args:
            prompt: User prompt text
            model: Model ID (default: mistralai/ministral-3-3b)
            max_tokens: Maximum tokens in response
            temperature: Sampling temperature (0.0-1.0)
            stream: Whether to stream response
            auto_load: Override auto_load setting

        Returns:
            Chat completion response
        """
        model = model or self.default_model
        
        # Auto-load if enabled
        do_auto_load = auto_load if auto_load is not None else self.auto_load
        if do_auto_load:
            self.ensure_model_loaded(model)

        data = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": stream
        }

        return self._make_request("chat/completions", "POST", data)

    def vision(
        self,
        image_path: str,
        prompt: str,
        model: str = None,
        max_tokens: int = 1000,
        auto_load: bool = None
    ) -> Dict[str, Any]:
        """
        Send vision analysis request with auto-loading

        Args:
            image_path: Absolute path to image file
            prompt: What to analyze in image
            model: Vision model ID (default: mistralai/ministral-3-3b)
            max_tokens: Maximum tokens in response
            auto_load: Override auto_load setting

        Returns:
            Vision analysis response
        """
        model = model or self.DEFAULT_VISION_MODEL
        
        # Auto-load if enabled
        do_auto_load = auto_load if auto_load is not None else self.auto_load
        if do_auto_load:
            self.ensure_model_loaded(model)

        # Read and encode image
        path = Path(image_path)
        if not path.is_absolute():
            raise ValueError(f"Image path must be absolute: {image_path}")
        if not path.exists():
            raise FileNotFoundError(f"Image not found: {image_path}")

        with open(path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode("utf-8")

        # Detect image type
        ext = path.suffix.lower()
        mime_type = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg", 
            ".png": "image/png",
            ".webp": "image/webp",
            ".gif": "image/gif"
        }.get(ext, "image/jpeg")

        data = {
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{image_data}"}},
                        {"type": "text", "text": prompt}
                    ]
                }
            ],
            "max_tokens": max_tokens
        }

        return self._make_request("chat/completions", "POST", data)

    def list_models(self) -> List[Dict[str, Any]]:
        """List all available models"""
        response = self._make_request("models", "GET")
        return response.get("data", [])

    def health_check(self) -> Dict[str, Any]:
        """Check if LM Studio is accessible"""
        import time
        start_time = time.time()
        try:
            models = self.list_models()
            response_time = (time.time() - start_time) * 1000
            return {
                "status": "ok",
                "response_time_ms": round(response_time, 2),
                "models_count": len(models),
                "loaded_models": models
            }
        except Exception as e:
            response_time = (time.time() - start_time) * 1000
            return {
                "status": "error",
                "response_time_ms": round(response_time, 2),
                "error": str(e)
            }


def create_client(
    host: str = None, 
    port: int = None, 
    auto_load: bool = True,
    default_model: str = "mistralai/ministral-3-3b"
) -> LMStudioClient:
    """Create LM Studio client with auto-loading enabled"""
    if host is None:
        host = "100.72.41.118"
    if port is None:
        port = 1234

    return LMStudioClient(
        host=host, 
        port=port, 
        auto_load=auto_load,
        default_model=default_model
    )


# Convenience functions for skill integration
def lm_studio_chat(prompt: str, model: str = "mistralai/ministral-3-3b", **kwargs) -> Dict:
    """Send chat request with auto-loading"""
    client = create_client(default_model=model)
    return client.chat(prompt, model=model, **kwargs)


def lm_studio_vision(image_path: str, prompt: str, model: str = "mistralai/ministral-3-3b", **kwargs) -> Dict:
    """Send vision request with auto-loading"""
    client = create_client()
    return client.vision(image_path, prompt, model=model, **kwargs)


def lm_studio_health() -> Dict:
    """Check LM Studio health"""
    client = create_client()
    return client.health_check()


def lm_studio_models() -> List:
    """List available models"""
    client = create_client()
    return client.list_models()
