-- Maps Satellite View Template
-- Auto-opens Apple Maps with satellite imagery
-- Parameters: __ADDRESS__ or __LAT__,__LON__,__ZOOM__

property theAddress : "__ADDRESS__"
property theLat : "__LAT__"
property theLon : "__LON__"
property theZoom : "__ZOOM__"

-- Determine if using address or coordinates
property useAddress : (theAddress is not "__ADDRESS__")

-- Build the URL
property mapURL : ""
if useAddress then
    set mapURL to "maps://?q=" & theAddress & "&t=h"
else
    set mapURL to "maps://?t=h&ll=" & theLat & "," & theLon & "&z=" & theZoom
end if

-- Open Apple Maps
do shell script "open '" & mapURL & "'"

-- Activate and configure Maps.app
tell application "Maps"
    activate
end tell

delay 2

-- Ensure satellite/hybrid view (Cmd+3)
tell application "System Events"
    tell process "Maps"
        keystroke "3" using command down
    end tell
end tell

-- Wait for tiles to load
delay 4

-- Maximize window for better screenshot quality
tell application "System Events"
    tell process "Maps"
        keystroke "f" using {command down, control down}
    end tell
end tell

delay 1

-- Generate timestamp for unique filename
set timestamp to (do shell script "date +%Y%m%d_%H%M%S")

-- Capture screenshot
do shell script "screencapture -x ~/Desktop/satellite_" & timestamp & ".png"

-- Return success
return "✓ Satellite screenshot captured: ~/Desktop/satellite_" & timestamp & ".png"
