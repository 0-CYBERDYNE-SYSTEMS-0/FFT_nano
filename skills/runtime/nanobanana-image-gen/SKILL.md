---
name: nanobanana-image-gen
description: Generate images using Gemini 3.1 Flash Image Preview (Nano Banana 2) API with configurable resolutions (512, 1K, 2K, 4K) and image editing capabilities.
---

# Nano Banana Image Generation

## When to use this skill
- User requests to generate an image from a text prompt
- User wants to edit an existing image using AI
- User specifies resolution (512, 1K, 2K, 4K) for image generation
- User references "nanobanana" or "Nano Banana 2" for image generation

## When not to use this skill
- Request is for text generation or other non-image tasks
- User specifically asks for a different image generation service
- The task requires image analysis or understanding without generation

## API Configuration
- **Model**: `gemini-3.1-flash-image-preview` (Nano Banana 2)
- **API Key**: set `GEMINI_API_KEY` in your `.env` file (get one at https://aistudio.google.com/apikey)
- **Endpoint**: `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent`

## Supported Resolutions
- `512` - 512x512 pixels
- `1K` - 1024x1024 pixels (default)
- `2K` - 2048x2048 pixels
- `4K` - 4096x4096 pixels

## Image Generation Workflow

### Basic Image Generation
1. Parse the user's prompt for the image description
2. Set default resolution to 1K (1024x1024) unless specified
3. Construct API request with prompt and resolution
4. Call the Gemini API
5. Extract base64 image data from response
6. Decode and save image to file
7. Return image path and generation details

### Resolution Specification
Users can specify resolution in prompts like:
- "generate a cat at 512 resolution"
- "create a landscape at 2K"
- "make a portrait at 4K"
- Default to 1K if not specified

### Image Editing (with -i flag)
1. Check if input image path is provided with `-i` flag
2. Read and encode the input image as base64
3. Include the image in the API request parts
4. Provide edit instructions in the text prompt
5. Process the response and save edited image

## API Request Format

### Basic Generation
```json
{
  "contents": [{
    "parts": [{
      "text": "Generate [image description] at [resolution] resolution"
    }]
  }]
}
```

### Image Editing
```json
{
  "contents": [{
    "parts": [
      {
        "inline_data": {
          "mime_type": "image/png",
          "data": "[base64 encoded image]"
        }
      },
      {
        "text": "[edit instructions]"
      }
    ]
  }]
}
```

## Response Handling
The API returns images as base64-encoded data within the response structure:
```json
{
  "candidates": [{
    "content": {
      "parts": [
        {
          "text": "[optional text description]"
        },
        {
          "inlineData": {
            "mime_type": "image/png",
            "data": "[base64 image data]"
          }
        }
      ]
    }
  }]
}
```

## Error Handling
- Handle rate limits (429 errors) with retry delay
- Handle quota exceeded errors with appropriate messaging
- Handle invalid prompts by asking for clarification
- Handle API errors with clear user feedback

## File Management
- Save generated images to `~/generated_images/` (or set `NANOBANANA_OUTPUT_DIR` env var)
- Use timestamp-based filenames: `image_YYYYMMDD_HHMMSS.png`
- Maintain a simple log of generations in `image_generation_log.md`

## Usage Examples
- "generate a cyberpunk cityscape at night" → 1K resolution
- "create a portrait of a robot at 2K" → 2K resolution  
- "-i input.png make it look like a watercolor painting" → edit mode
- "generate a sunset over mountains at 512" → 512 resolution

## Testing
Test all resolutions:
- 512: ✅ Verified working
- 1K: ✅ Verified working
- 2K: Support included
- 4K: Support included
