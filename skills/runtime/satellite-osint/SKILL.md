---
name: satellite-osint
description: Open satellite imagery using deeplinks with coordinates and zoom
  levels via bash `open` command. Capture screenshots at multiple zoom levels
  for land analysis, building inventory, structure identification, and
  agricultural planning. Use when user needs satellite imagery, aerial view,
  farm analysis, land survey, building detection, structure inventory, property
  boundaries, coordinates lookup, or OSINT of any location. Triggers on requests
  for overhead views, map screenshots, or geographic reconnaissance.
allowed-tools: bash macos_control gemini_image_analysis
metadata:
  legacy_slug: satellite_osint
  legacy_summary: Deeplink satellite maps with coordinates/zoom, capture
    screenshots, analyze land and structures for farming
  legacy_version: "1.0"
  legacy_author: FF-Terminal
  legacy_priority: high
  legacy_tags: '["satellite","osint","maps","coordinates","aerial","farming","land-analysis"]'
  legacy_triggers: '["satellite","aerial","land
    analysis","farm","coordinates","google earth","overhead
    view","property","building inventory"]'
  legacy_recommended_tools: '["bash","macos_control","gemini_image_analysis"]'
---

# Satellite OSINT & Land Analysis

## When to use this skill
- Use when the user request matches this skill's domain and capabilities.
- Use when this workflow or toolchain is explicitly requested.

## When not to use this skill
- Do not use when another skill is a better direct match for the task.
- Do not use when the request is outside this skill's scope.

Open satellite maps via deeplinks. Capture at multiple zoom levels. Analyze land/structures.

## 🚀 CRITICAL: Address-First Approach (FASTEST METHOD)

**ALWAYS try the address directly in the URL first.** Both Google Maps and Apple Maps auto-geocode addresses - no parsing needed!

### Apple Maps (Preferred - Native macOS, Fastest)
```bash
# Satellite view with address (Apple Maps auto-geocodes)
open "maps://?q=110+Clover+St+Cedar+Creek+Texas&t=h"

# Satellite view with coordinates and zoom
open "maps://?t=h&ll=30.0872,-97.5014&z=18"
```

### Google Maps (Alternative - Browser-based)
```bash
# Satellite view with address (Google Maps auto-geocodes)
open "https://www.google.com/maps/search/110+Clover+St+Cedar+Creek+Texas/@?layer=satellite"

# Satellite view with coordinates and zoom
open "https://www.google.com/maps/@30.0872,-97.5014,18z/data=!3m1!1e3"
```

### Force Satellite View with AppleScript
```bash
# Activate Maps and set to satellite view (Cmd+3)
osascript -e 'tell app "Maps" to activate' \
  -e 'delay 1' \
  -e 'tell app "System Events" to keystroke "3" using command down'
```

### Only Geocode If:
- ❌ You need exact lat/lon for calculations
- ❌ The address format is unusual or international
- ❌ You're doing multi-location analysis with coordinates

**NEVER waste tool calls geocoding when the address works directly in the URL!**

## Obtaining Coordinates

### From Address (Geocoding - No API Key)
```bash
# Nominatim/OpenStreetMap - replace spaces with +
ADDRESS="123+Main+St,+Des+Moines,+Iowa"
curl -s "https://nominatim.openstreetmap.org/search?q=${ADDRESS}&format=json" | jq -r '.[0] | "\(.lat),\(.lon)"'
```

### From Device Location (macOS)
```bash
# Requires Location Services enabled in System Settings > Privacy
osascript -e 'tell application "System Events" to get the value of location'

# Alternative: Use CoreLocation via swift (more reliable)
swift -e 'import CoreLocation; let m=CLLocationManager(); if let l=m.location { print("\(l.coordinate.latitude),\(l.coordinate.longitude)") }'
```

### From IP (Approximate - Fallback)
```bash
curl -s "https://ipapi.co/json" | jq -r '"\(.latitude),\(.longitude)"'
```

### Manual Lookup
- **Google Maps**: Right-click location → "What's here?" → coordinates appear at bottom
- **Apple Maps**: Long-press to drop pin → tap pin → coordinates in info panel
- **What3Words**: Convert 3-word address at what3words.com

### From Property Address (Google Geocoding)
```bash
# If you have Google API key
curl -s "https://maps.googleapis.com/maps/api/geocode/json?address=123+Farm+Rd,+Iowa&key=YOUR_KEY" | jq -r '.results[0].geometry.location | "\(.lat),\(.lng)"'
```

## URL Patterns (Use with bash `open` command)

### Google Maps Satellite
```
https://www.google.com/maps/@{LAT},{LON},{ZOOM}z/data=!3m1!1e3
```
- ZOOM: 1-21 (21=max detail, 18=buildings clear, 15=property, 12=region)

### Google Earth Web
```
https://earth.google.com/web/@{LAT},{LON},{ALT}a,35y,0h,0t,0r
```
- ALT: altitude in meters (500=high detail, 2000=overview)

### Bing Maps Aerial
```
https://www.bing.com/maps?cp={LAT}~{LON}&lvl={ZOOM}&style=a
```

### Sentinel Hub (Agricultural/NDVI)
```
https://apps.sentinel-hub.com/eo-browser/?zoom={ZOOM}&lat={LAT}&lng={LON}
```

### ESRI World Imagery
```
https://www.arcgis.com/home/webmap/viewer.html?center={LON},{LAT}&level={ZOOM}
```

## Execution Examples

### Method 1: Direct Address (FASTEST)
```bash
# Apple Maps - Single command for address + satellite + screenshot
open "maps://?q=110+Clover+St+Cedar+Creek+Texas&t=h"
sleep 4
screencapture -x ~/Desktop/satellite_capture.png
```

### Method 2: Address with Multi-Zoom (Apple Maps)
```bash
ADDRESS="110+Clover+St+Cedar+Creek+Texas"

# Regional view (zoom 12)
open "maps://?q=${ADDRESS}&t=h&z=12"
sleep 4
screencapture -x ~/Desktop/overview_z12.png

# Property level (zoom 16)
open "maps://?q=${ADDRESS}&t=h&z=16"
sleep 4
screencapture -x ~/Desktop/property_z16.png

# Structure detail (zoom 19)
open "maps://?q=${ADDRESS}&t=h&z=19"
sleep 4
screencapture -x ~/Desktop/structures_z19.png
```

### Method 3: Coordinates with Multi-Zoom (Google Maps)
```bash
LAT=37.7749; LON=-122.4194

# Regional context
open "https://www.google.com/maps/@${LAT},${LON},12z/data=!3m1!1e3"
sleep 4
screencapture -x ~/Desktop/z12.png

# Property level
open "https://www.google.com/maps/@${LAT},${LON},16z/data=!3m1!1e3"
sleep 4
screencapture -x ~/Desktop/z16.png

# Structure detail
open "https://www.google.com/maps/@${LAT},${LON},19z/data=!3m1!1e3"
sleep 4
screencapture -x ~/Desktop/z19.png
```

### Method 4: With AppleScript for Reliable Satellite View
```bash
# Uses AppleScript to force satellite mode and fullscreen for better quality
osascript <<'EOF'
property theAddress : "110 Clover St, Cedar Creek, Texas"

-- Open Apple Maps with satellite view
do shell script "open 'maps://?q=" & theAddress & "&t=h'"

tell application "Maps"
    activate
end tell

delay 2

-- Force satellite view (Cmd+3)
tell application "System Events"
    tell process "Maps"
        keystroke "3" using command down
    end tell
end tell

delay 4

-- Fullscreen for better screenshot
tell application "System Events"
    tell process "Maps"
        keystroke "f" using {command down, control down}
    end tell
end tell

delay 1

-- Capture
do shell script "screencapture -x ~/Desktop/satellite_" & (do shell script "date +%Y%m%d_%H%M%S") & ".png"
EOF
```

### Screenshot commands
```bash
screencapture -x ~/Desktop/capture.png          # Silent full screen
screencapture -i ~/Desktop/selection.png        # Interactive select
screencapture -T 5 -x ~/Desktop/delayed.png     # 5 second delay
```

## Visual Verification (CRITICAL STEP)

**After opening the map, ALWAYS verify you're looking at the correct location!**

```bash
# After capture, analyze the screenshot to confirm the address
# Use image analysis to check that the location markers and labels are correct
# If location is wrong:
#   1. Check the address spelling
#   2. Try full address with ZIP code
#   3. Use explicit coordinates instead
#   4. Re-open map and re-capture
```

**Why This Matters:**
- Last session used approximate town coordinates (Cedar Creek center) instead of actual property
- Result: 4 wrong screenshots wasted before discovery
- Prevention: Analyze first screenshot to confirm correct location before multi-zoom sequence

## Complete Workflow (Agent Must Follow)

### Step 1: Detect Input Type
```
- User provides ADDRESS → Use directly in URL (Method 1 or 2)
- User provides COORDINATES → Use in URL (Method 3)
- User says "my location" → Get device location first
```

### Step 2: Open Map with Address/Coordinates
```bash
# Preferred: Apple Maps (faster, native)
open "maps://?q=ADDRESS&t=h"

# Alternative: Google Maps (browser-based)
open "https://www.google.com/maps/search/ADDRESS/@?layer=satellite"
```

### Step 3: Wait for Tiles
```bash
sleep 4  # Allow satellite imagery to load fully
```

### Step 4: Capture Screenshot
```bash
screencapture -x ~/Desktop/satellite_$(date +%Y%m%d_%H%M%S).png
```

### Step 5: Visual Verification
```bash
# Analyze the screenshot:
# - Does it show the correct address?
# - Are the location labels visible?
# - Is the satellite view active (not road view)?
# If NO → Adjust and re-open map
```

### Step 6: Multi-Zoom Analysis (Optional)
```bash
# If more detail needed, repeat steps 2-5 at different zoom levels:
# - zoom 12 (regional)
# - zoom 16 (property)
# - zoom 19 (structures)
```

## Zoom Level Reference

| Zoom | View Level | Use Case |
|------|------------|----------|
| 10-12 | County/Region | Context, neighboring properties |
| 13-15 | Township | Property boundaries, road access |
| 16-17 | Property | Field layout, major structures |
| 18-19 | Buildings | Structure identification |
| 20-21 | Detail | Roof condition, equipment |

## Provider Selection

| Need | Best Provider |
|------|---------------|
| General/Buildings | Google Maps |
| 3D/Terrain | Google Earth |
| Crop health/NDVI | Sentinel Hub |
| Alternative imagery | Bing Maps |
| Historical | Google Earth timeline |

## Farm Analysis Workflow

1. **Overview** (zoom 12): Regional context, access roads
2. **Property** (zoom 16): Boundaries, field divisions
3. **Structures** (zoom 19): Building inventory
4. **Crop Analysis**: Use Sentinel for vegetation indices

## Coordinate Format

Use Decimal Degrees (DD):
- Latitude: -90 to 90 (negative = South)
- Longitude: -180 to 180 (negative = West)
- Example: 37.7749, -122.4194

## Output Organization

Save captures to organized folders:
```
~/Desktop/farm_analysis/
├── overview/    (zoom 10-14)
├── property/    (zoom 15-17)
├── structures/  (zoom 18-21)
```

## Integration

Use bash tool to execute `open` commands. Use `sleep 3-5` between URL and screenshot to allow tiles to load. Maximize browser window for best capture quality.
