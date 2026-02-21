-- Application Control Template
-- Parameters: app_name, x_position, y_position, width, height, fullscreen

on launchAndPositionApp(app_name, x_position, y_position, width, height, fullscreen)
    tell application "System Events"
        -- Check if the application is already running
        if not (exists process app_name) then
            -- Launch the application if it's not running
            tell application app_name to launch
            delay 3 -- Wait for application to fully load
        end if
    end tell

    tell application app_name
        activate

        -- Check if the application has windows
        if (count of windows) > 0 then
            if fullscreen then
                -- Set window to fullscreen
                tell application "System Events"
                    tell process app_name
                        click menu item "Enter Full Screen" of menu "View" of menu bar 1
                    end tell
                end tell
            else
                -- Set window bounds
                set bounds of window 1 to {x_position, y_position, x_position + width, y_position + height}
            end if
        else
            -- Create a new window if none exists (for apps that support it)
            try
                make new document
                set bounds of window 1 to {x_position, y_position, x_position + width, y_position + height}
            on error
                -- If the app doesn't support creating documents, just activate it
                activate
            end try
        end if
    end tell
end launchAndPositionApp

-- Example usage:
-- launchAndPositionApp("Terminal", 0, 0, 800, 600, false)
-- launchAndPositionApp("Google Chrome", 800, 0, 1200, 900, false)