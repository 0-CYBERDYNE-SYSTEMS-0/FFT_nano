---
name: plantnet-api
description: Identify plants using the PlantNet API - a free non-profit plant identification service with 50,000+ species and support for multiple plant organs.
---

# PlantNet API

## When to use this skill
- User needs to identify a plant from an image
- User wants plant species identification with confidence scores
- User needs to detect specific plant parts (leaf, flower, fruit, bark)
- User wants multiple plant species suggestions with probabilities
- User needs related reference images for comparison

## When not to use this skill
- Request is for image generation (use nanobanana-image-gen skill)
- Request is for text-based plant information without image input
- Request is for plant care advice rather than identification

## API Configuration
- **Base URL:** `https://my-api.plantnet.org/v2/identify`
- **API Key:** set `PLANTNET_API_KEY` in your `.env` file (free key at https://my.plantnet.org)
- **Documentation:** `https://my.plantnet.org/doc/api/identify`
- **Free Tier:** 500 identifications/day (15,000/month)
- **Species Database:** 50,000+ plant species
- **Supported Organs:** leaf, flower, fruit, bark, auto

## Supported Parameters

### Required
- `images`: 1-5 images of the same plant (JPEG or PNG, max 50MB total)

### Optional
- `organs`: List of plant organs - one per image
  - `leaf` - leaf image
  - `flower` - flower image
  - `fruit` - fruit image
  - `bark` - bark image
  - `auto` - automatic detection (default)

- `project`: Geographic/project filter
  - `all` - all projects (default)
  - `north_america` - North American flora
  - `europe` - European flora
  - `asia` - Asian flora
  - And more specific projects

- `include-related-images`: `true/false` - return similar reference images
- `no-reject`: `true/false` - prevent rejection if result isn't a plant
- `nb-results`: Integer (≥1) - limit number of results
- `detailed`: `true/false` - include family/genus results (slower)
- `lang`: Language code for common names (e.g., `en`, `fr`, `es`, `de`)

## API Usage Examples

### Basic Identification (cURL)
```bash
curl -X POST 'https://my-api.plantnet.org/v2/identify/all?api-key=YOUR_API_KEY' \
  -F 'images=@plant.jpg' \
  -F 'organs=leaf'
```

### Multiple Images
```bash
curl -X POST 'https://my-api.plantnet.org/v2/identify/all?api-key=YOUR_API_KEY' \
  -F 'images=@leaf.jpg' \
  -F 'images=@flower.jpg' \
  -F 'organs=leaf' \
  -F 'organs=flower'
```

### With Reference Images
```bash
curl -X POST 'https://my-api.plantnet.org/v2/identify/all?api-key=YOUR_API_KEY' \
  -F 'images=@plant.jpg' \
  -F 'organs=leaf' \
  -F 'include-related-images=true'
```

## Response Format

```json
{
  "query": {
    "project": "all",
    "images": [...],
    "organs": [...],
    "include-related-images": false,
    "no-reject": false,
    "type": "kt"
  },
  "bestMatch": "Ajuga genevensis L.",
  "results": [
    {
      "score": 0.90734,
      "species": {
        "scientificNameWithoutAuthor": "Ajuga genevensis",
        "scientificNameAuthorship": "L.",
        "genus": {
          "scientificNameWithoutAuthor": "Ajuga",
          "scientificName": "Ajuga"
        },
        "family": {
          "scientificNameWithoutAuthor": "Lamiaceae",
          "scientificName": "Lamiaceae"
        },
        "commonNames": ["Blue bugleweed", "Blue bugle", "Geneva Bugle"]
      },
      "gbif": { "id": "2927079" },
      "powo": { "id": "444576-1" }
    }
  ],
  "otherResults": {
    "genus": [...],
    "family": [...]
  },
  "remainingIdentificationRequests": 498
}
```

## Key Response Fields
- `bestMatch` - Top species name (string)
- `results` - List of predictions with confidence scores
- `score` - Confidence score (0-1), higher is better
- `species.commonNames` - Common names in requested language
- `species.scientificNameWithoutAuthor` - Scientific name without author
- `remainingIdentificationRequests` - Daily quota remaining (free tier: 500)

## Error Handling
- **401 Unauthorized:** Missing or invalid API key
- **400 Bad Request:** Invalid parameters or image format
- **413 Payload Too Large:** Images exceed 50MB total
- **429 Rate Limit:** Exceeded daily quota (500 free requests)
- **404 Not Found:** Invalid project or endpoint

## Quotas
- **Free Tier:** 500 identifications/day
- **Simultaneous Requests:** 20 max per client
- **Image Size:** Max 50MB total per request
- **Images per Request:** 1-5 images (must be same plant)

## Testing Strategy
1. Test basic single image identification
2. Test with multiple images
3. Test different organs (leaf, flower, fruit, bark)
4. Test auto organ detection
5. Test with include-related-images
6. Test detailed mode (family/genus results)
7. Test different projects (all vs regional)
8. Verify quota tracking
9. Test error handling with invalid inputs
10. Test confidence scores on known plants

## CLI Tool
Use `scripts/plantnet_identify.py` for easy command-line access.
