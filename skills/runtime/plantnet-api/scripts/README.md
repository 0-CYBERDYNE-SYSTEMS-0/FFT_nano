# PlantNet API CLI Tool

## Quick Start

```bash
# Basic identification
python3 scripts/plantnet_identify.py /path/to/plant.jpg

# With specific organ
python3 scripts/plantnet_identify.py /path/to/plant.jpg -o flower

# With multiple images (same plant)
python3 scripts/plantnet_identify.py leaf.jpg flower.jpg fruit.jpg

# Get more details
python3 scripts/plantnet_identify.py /path/to/plant.jpg -l 5 -d

# Quiet mode (for scripts)
python3 scripts/plantnet_identify.py /path/to/plant.jpg -q
```

## Examples

```bash
# Identify a daisy flower
python3 scripts/plantnet_identify.py /path/to/plant.jpg

# Identify with specific organ and language
python3 scripts/plantnet_identify.py /path/to/plant.jpg -o flower -l 5 -d

# Multiple images of same plant
python3 scripts/plantnet_identify.py leaf.jpg flower.jpg bark.jpg
```

## Options

- `-o {leaf,flower,fruit,bark,auto}` - Specify plant organ (default: auto)
- `-p PROJECT` - Use specific flora project (default: all)
- `-r` - Include reference images in response
- `-n` - Don't reject if result isn't a plant
- `-l N` - Limit to top N results
- `-d` - Include family/genus results (slower)
- `-g CODE` - Language for common names (default: en)
- `-q` - Quiet mode

## Output

The tool displays:
- Best match with scientific name
- Top 10 species predictions with confidence scores
- Common names (up to 5 shown)
- Genus and family information
- GBIF and PowO taxonomic IDs
- Remaining daily quota
- Detected organ type with confidence

## Free Tier Quota

- **500 identifications per day**
- Track quota with `remainingIdentificationRequests` in response
