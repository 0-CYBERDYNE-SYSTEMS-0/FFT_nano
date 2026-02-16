#!/usr/bin/env python3
"""
Take a full-page screenshot of FFT Nano website
"""

import subprocess
import time
import os

# Use native macOS screenshot tool
# First, open the URL in default browser
url = "http://localhost:8080"

# Use Safari via AppleScript for controlled screenshot
apple_script = f'''
tell application "Safari"
    activate
    open location "{url}"
    delay 3
    tell application "System Events"
        tell process "Safari"
            keystroke "s" using {{command down, shift down}}
            delay 1
            keystroke return
        end tell
    end tell
end tell
'''

# Alternative: Use screencapture utility
output_path = "/Users/scrimwiggins/clawd/fft-nano-work/screenshots/fft-nano-bg-warm-ambient.png"

# Open in Safari and wait
subprocess.run(["open", "-a", "Safari", url])
time.sleep(4)

# Take screenshot of entire screen
subprocess.run(["screencapture", "-x", output_path])
print(f"Screenshot saved to: {output_path}")
