-- Multi-Screen Layout Template
-- Parameters: layout_type, app_configurations

on getDisplayInformation()
    tell application "System Events"
        set displayList to {}
        set allDisplays to every display

        repeat with i from 1 to count of allDisplays
            set currentDisplay to display i
            set displayBounds to bounds of currentDisplay
            set displayResolution to size of currentDisplay
            set displayPosition to position of currentDisplay

            set displayInfo to {
                id:i,
                bounds:displayBounds,
                resolution:displayResolution,
                position:displayPosition,
                width:(item 1 of displayResolution),
                height:(item 2 of displayResolution),
                x:(item 1 of displayPosition),
                y:(item 2 of displayPosition),
                isMain:(i = 1)
            }

            set end of displayList to displayInfo
        end repeat
    end tell

    return displayList
end getDisplayInformation

on applyCodingLayout()
    set displayInfo to getDisplayInformation()
    set mainDisplay to item 1 of displayInfo

    -- Terminal on left half of main display
    set terminalBounds to {
        x of mainDisplay,
        y of mainDisplay,
        x of mainDisplay + (width of mainDisplay / 2),
        y of mainDisplay + height of mainDisplay
    }

    -- Browser on right half of main display
    set browserBounds to {
        x of mainDisplay + (width of mainDisplay / 2),
        y of mainDisplay,
        x of mainDisplay + width of mainDisplay,
        y of mainDisplay + height of mainDisplay
    }

    -- Position Terminal
    tell application "Terminal"
        activate
        if (count of windows) = 0 then make new document
        set bounds of window 1 to terminalBounds
    end tell

    delay 1

    -- Position Browser (Chrome or Safari)
    try
        tell application "Google Chrome"
            activate
            if (count of windows) = 0 then
                make new window
            end if
            set bounds of window 1 to browserBounds
        end tell
    on error
        tell application "Safari"
            activate
            if (count of windows) = 0 then
                make new document
            end if
            set bounds of window 1 to browserBounds
        end tell
    end try
end applyCodingLayout

on applyResearchLayout()
    set displayInfo to getDisplayInformation()
    set mainDisplay to item 1 of displayInfo

    -- Browser taking center 60% of main display
    set browserBounds to {
        x of mainDisplay + (width of mainDisplay * 0.2),
        y of mainDisplay,
        x of mainDisplay + (width of mainDisplay * 0.8),
        y of mainDisplay + (height of mainDisplay * 0.85)
    }

    -- Notes on right side (20%)
    set notesBounds to {
        x of mainDisplay + (width of mainDisplay * 0.8),
        y of mainDisplay,
        x of mainDisplay + width of mainDisplay,
        y of mainDisplay + (height of mainDisplay * 0.6)
    }

    -- Terminal on bottom strip (15% height, full width)
    set terminalBounds to {
        x of mainDisplay,
        y of mainDisplay + (height of mainDisplay * 0.85),
        x of mainDisplay + width of mainDisplay,
        y of mainDisplay + height of mainDisplay
    }

    -- Position Browser
    try
        tell application "Google Chrome"
            activate
            if (count of windows) = 0 then make new window
            set bounds of window 1 to browserBounds
        end tell
    on error
        tell application "Safari"
            activate
            if (count of windows) = 0 then make new document
            set bounds of window 1 to browserBounds
        end tell
    end try

    delay 1

    -- Position Notes
    tell application "Notes"
        activate
        if (count of windows) = 0 then
            make new note
        end if
        set bounds of window 1 to notesBounds
    end tell

    delay 1

    -- Position Terminal
    tell application "Terminal"
        activate
        if (count of windows) = 0 then make new document
        set bounds of window 1 to terminalBounds
    end tell
end applyResearchLayout

on applyPresentationLayout()
    set displayInfo to getDisplayInformation()

    repeat with displayInfoItem in displayInfo
        if isMain of displayInfoItem then
            -- Fullscreen presentation on main display
            try
                tell application "Keynote"
                    activate
                    if (count of slideshows) > 0 then
                        tell slideshow 1
                            play
                        end tell
                    end if
                end tell
            on error
                try
                    tell application "PowerPoint"
                        activate
                        if (count of presentations) > 0 then
                            start slide show of presentation 1
                        end if
                    end tell
                on error
                    -- Fallback: Open PDF in fullscreen
                    tell application "Preview"
                        activate
                        -- User would need to have a presentation open
                    end tell
                end try
            end try
        else
            -- Notes on secondary display
            set notesBounds to {
                x of displayInfoItem,
                y of displayInfoItem,
                x of displayInfoItem + width of displayInfoItem,
                y of displayInfoItem + height of displayInfoItem
            }

            tell application "Notes"
                activate
                if (count of windows) = 0 then make new note
                set bounds of window 1 to notesBounds
            end tell
        end if
    end repeat
end applyPresentationLayout

on applyDataAnalysisLayout()
    set displayInfo to getDisplayInformation()
    set mainDisplay to item 1 of displayInfo

    -- Terminal on left 33% of main display
    set terminalBounds to {
        x of mainDisplay,
        y of mainDisplay,
        x of mainDisplay + (width of mainDisplay / 3),
        y of mainDisplay + height of mainDisplay
    }

    -- Spreadsheet on right 67% of main display
    set spreadsheetBounds to {
        x of mainDisplay + (width of mainDisplay / 3),
        y of mainDisplay,
        x of mainDisplay + width of mainDisplay,
        y of mainDisplay + height of mainDisplay
    }

    -- Position Terminal
    tell application "Terminal"
        activate
        if (count of windows) = 0 then make new document
        set bounds of window 1 to terminalBounds
    end tell

    delay 1

    -- Position Spreadsheet (Numbers, Excel, or Google Sheets)
    try
        tell application "Numbers"
            activate
            if (count of documents) = 0 then make new document
            set bounds of window 1 to spreadsheetBounds
        end tell
    on error
        try
            tell application "Microsoft Excel"
                activate
                if (count of workbooks) = 0 then make new workbook
                set bounds of active window to spreadsheetBounds
            end tell
        on error
            tell application "Google Chrome"
                activate
                tell application "System Events" to tell process "Google Chrome" to keystroke "n" using command down
                delay 2
                tell application "System Events" to tell process "Google Chrome" to keystroke "https://sheets.google.com" & return
                set bounds of window 1 to spreadsheetBounds
            end tell
        end try
    end try
end applyDataAnalysisLayout

-- Example usage:
-- applyCodingLayout()
-- applyResearchLayout()
-- applyPresentationLayout()
-- applyDataAnalysisLayout()