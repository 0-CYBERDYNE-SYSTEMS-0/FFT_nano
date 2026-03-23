# Nano Banana 2 Image Generator Scripts

## nanobanana_gen.py

Command-line tool for generating images with the Gemini 3.1 Flash Image Preview API.

### Usage

```bash
python3 scripts/nanobanana_gen.py "your prompt here"
```

### Options

- `-r, --resolution`: Set resolution (512, 1K, 2K, 4K). Default: 1K
- `-i, --input`: Path to input image for editing
- `-o, --output`: Custom output filename

### Examples

Generate a 1K image:
```bash
python3 scripts/nanobanana_gen.py "a cyberpunk cityscape at night"
```

Generate at specific resolution:
```bash
python3 scripts/nanobanana_gen.py "a serene mountain lake" -r 2K
```

Edit an existing image:
```bash
python3 scripts/nanobanana_gen.py "make this look like a watercolor painting" -i input.png
```

Generate with custom filename:
```bash
python3 scripts/nanobanana_gen.py "a cute robot" -o robot.png
```

### Output

Images are saved to `~/generated_images/ (override with NANOBANANA_OUTPUT_DIR)` with timestamp-based filenames.
All generations are logged to `image_generation_log.md`.

### API Notes

- Model: gemini-3.1-flash-image-preview (Nano Banana 2)
- Rate limits may apply for free tier
- Images returned as PNG format
