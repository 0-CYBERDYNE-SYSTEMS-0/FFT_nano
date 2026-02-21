-- Development Environment Setup Workflow
-- Automated setup for coding environment with multiple screens and apps

on runDevelopmentSetup()
    -- Step 1: Get display information
    tell application "System Events"
        set allDisplays to every display
        set mainDisplay to display 1
        set mainBounds to bounds of mainDisplay
        set mainWidth to item 3 of mainBounds - item 1 of mainBounds
        set mainHeight to item 4 of mainBounds - item 2 of mainBounds
    end tell

    -- Step 2: Launch and position development tools
    set devTools to {
        {app:"Terminal", x:0, y:0, width:mainWidth / 2, height:mainHeight},
        {app:"Visual Studio Code", x:mainWidth / 2, y:0, width:mainWidth / 2, height:mainHeight * 0.7},
        {app:"Google Chrome", x:mainWidth / 2, y:mainHeight * 0.7, width:mainWidth / 2, height:mainHeight * 0.3}
    }

    repeat with toolConfig in devTools
        set appName to app of toolConfig
        set appX to x of toolConfig
        set appY to y of toolConfig
        set appWidth to width of toolConfig
        set appHeight to height of toolConfig

        -- Launch app if not running
        tell application "System Events"
            if not (exists process appName) then
                tell application appName to launch
                delay 3
            end if
        end tell

        -- Position and size the window
        tell application appName
            activate
            delay 1

            try
                if (count of windows) > 0 then
                    set bounds of window 1 to {appX, appY, appX + appWidth, appY + appHeight}
                end if
            on error errMsg
                log "Could not position " & appName & ": " & errMsg
            end try
        end tell

        delay 1
    end repeat

    -- Step 3: Set up development directories in Terminal
    tell application "Terminal"
        activate
        if (count of windows) > 0 then
            tell window 1
                -- Create new tabs for different development contexts
                keystroke "t" using command down
                delay 0.5
                do script "cd ~/projects && clear" in selected tab of window 1

                keystroke "t" using command down
                delay 0.5
                do script "cd ~/projects && git status" in selected tab of window 1

                keystroke "t" using command down
                delay 0.5
                do script "cd ~/projects && npm run dev" in selected tab of window 1
            end tell
        end if
    end tell

    -- Step 4: Open relevant development tabs in Chrome
    tell application "Google Chrome"
        activate
        if (count of windows) > 0 then
            -- Documentation tabs
            tell window 1
                make new tab with properties {URL:"https://developer.mozilla.org/"}
                make new tab with properties {URL:"https://stackoverflow.com/"}
                make new tab with properties {URL:"https://github.com/"}
            end tell
        end if
    end tell

    -- Step 5: Open VS Code with project folder
    tell application "Visual Studio Code"
        activate
        delay 2
        tell application "System Events"
            tell process "Visual Studio Code"
                -- Open recent project (adjust path as needed)
                keystroke "o" using command down
                delay 1
                keystroke "~/projects"
                delay 0.5
                keystroke return
            end tell
        end tell
    end tell

    -- Step 6: Show notification that setup is complete
    display notification "Development environment ready!" with title "Setup Complete" subtitle "All development tools are positioned and ready"

    return "Development environment setup completed successfully"
end runDevelopmentSetup

on runWebDevelopmentSetup()
    -- Specialized setup for web development
    tell application "System Events"
        set mainBounds to bounds of display 1
        set mainWidth to item 3 of mainBounds - item 1 of mainBounds
        set mainHeight to item 4 of mainBounds - item 2 of mainBounds
    end tell

    -- Launch web development tools
    set webTools to {
        {app:"Visual Studio Code", x:0, y:0, width:mainWidth * 0.5, height:mainHeight * 0.6},
        {app:"Google Chrome", x:mainWidth * 0.5, y:0, width:mainWidth * 0.5, height:mainHeight * 0.6},
        {app:"Terminal", x:0, y:mainHeight * 0.6, width:mainWidth, height:mainHeight * 0.4}
    }

    repeat with toolConfig in webTools
        set appName to app of toolConfig
        set appX to x of toolConfig
        set appY to y of toolConfig
        set appWidth to width of toolConfig
        set appHeight to height of toolConfig

        tell application "System Events"
            if not (exists process appName) then
                tell application appName to launch
                delay 3
            end if
        end tell

        tell application appName
            activate
            delay 1
            try
                if (count of windows) > 0 then
                    set bounds of window 1 to {appX, appY, appX + appWidth, appY + appHeight}
                end if
            end try
        end tell

        delay 1
    end repeat

    -- Set up Chrome with developer tools
    tell application "Google Chrome"
        activate
        if (count of windows) > 0 then
            tell window 1
                set URL of active tab to "http://localhost:3000"
                make new tab with properties {URL:"http://localhost:3001"}
            end tell

            -- Open developer tools
            tell application "System Events"
                tell process "Google Chrome"
                    keystroke "i" using {option down, command down}
                end tell
            end tell
        end if
    end tell

    display notification "Web development environment ready!" with title "Web Setup Complete"

    return "Web development setup completed"
end runWebDevelopmentSetup

on runDataScienceSetup()
    -- Setup for data science and analysis
    tell application "System Events"
        set mainBounds to bounds of display 1
        set mainWidth to item 3 of mainBounds - item 1 of mainBounds
        set mainHeight to item 4 of mainBounds - item 2 of mainBounds
    end tell

    -- Launch data science tools
    set dataTools to {
        {app:"Visual Studio Code", x:0, y:0, width:mainWidth * 0.5, height:mainHeight},
        {app:"Terminal", x:mainWidth * 0.5, y:0, width:mainWidth * 0.5, height:mainHeight * 0.5},
        {app:"Numbers", x:mainWidth * 0.5, y:mainHeight * 0.5, width:mainWidth * 0.5, height:mainHeight * 0.5}
    }

    repeat with toolConfig in dataTools
        set appName to app of toolConfig
        set appX to x of toolConfig
        set appY to y of toolConfig
        set appWidth to width of toolConfig
        set appHeight to height of toolConfig

        tell application "System Events"
            if not (exists process appName) then
                tell application appName to launch
                delay 3
            end if
        end tell

        tell application appName
            activate
            delay 1
            try
                if (count of windows) > 0 then
                    set bounds of window 1 to {appX, appY, appX + appWidth, appY + appHeight}
                end if
            end try
        end tell

        delay 1
    end repeat

    -- Set up Terminal for data science work
    tell application "Terminal"
        activate
        if (count of windows) > 0 then
            tell window 1
                -- Jupyter notebook tab
                keystroke "t" using command down
                delay 0.5
                do script "cd ~/datasets && jupyter notebook" in selected tab of window 1

                -- Python analysis tab
                keystroke "t" using command down
                delay 0.5
                do script "cd ~/datasets && python3" in selected tab of window 1

                -- Data processing tab
                keystroke "t" using command down
                delay 0.5
                do script "cd ~/datasets && ls -la" in selected tab of window 1
            end tell
        end if
    end tell

    display notification "Data science environment ready!" with title "Data Setup Complete"

    return "Data science setup completed"
end runDataScienceSetup

-- Example usage:
-- runDevelopmentSetup()
-- runWebDevelopmentSetup()
-- runDataScienceSetup()