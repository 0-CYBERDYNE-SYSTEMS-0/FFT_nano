-- System Automation Template
-- Parameters: operation_type, parameters

on setSystemVolume(volume_level)
    tell application "System Events"
        set volume output volume volume_level
    end tell
    return "Volume set to " & volume_level
end setSystemVolume

on setSystemBrightness(brightness_level)
    tell application "System Events"
        set brightness to brightness_level
    end tell

    -- Alternative method using brightness command
    try
        do shell script "brightness -l " & brightness_level
    on error
        -- Fallback for systems without brightness command
        log "Brightness command not available"
    end try

    return "Brightness set to " & brightness_level
end setSystemBrightness

on toggleWiFi(wifi_state)
    if wifi_state then
        do shell script "networksetup -setairportpower en0 on"
        return "WiFi enabled"
    else
        do shell script "networksetup -setairportpower en0 off"
        return "WiFi disabled"
    end if
end toggleWiFi

on showSystemNotification(title, message, sound_name)
    tell application "System Events"
        -- Play sound if specified
        if sound_name is not "" then
            do shell script "afplay /System/Library/Sounds/" & sound_name & ".aiff"
        end if
    end tell

    -- Display notification
    display notification message with title title

    return "Notification displayed: " & title
end showSystemNotification

on emptyTrash()
    tell application "Finder"
        if (count of items in trash) > 0 then
            empty trash
            return "Trash emptied successfully"
        else
            return "Trash is already empty"
        end if
    end tell
end emptyTrash

on restartComputer()
    tell application "System Events"
        restart
    end tell
end restartComputer

on shutdownComputer()
    tell application "System Events"
        shut down
    end tell
end shutdownComputer

on lockScreen()
    tell application "System Events"
        tell process "SystemUIServer"
            keystroke "q" using {control down, command down}
        end tell
    end tell
    return "Screen locked"
end lockScreen

on sleepComputer()
    tell application "System Events"
        sleep
    end tell
end sleepComputer

on openSystemPreferences(pane_name)
    tell application "System Preferences"
        activate

        if pane_name = "general" then
            set current pane to pane "General"
        else if pane_name = "desktop" then
            set current pane to pane "Desktop & Screen Saver"
        else if pane_name = "dock" then
            set current pane to pane "Dock & Menu Bar"
        else if pane_name = "security" then
            set current pane to pane "Security & Privacy"
        else if pane_name = "notifications" then
            set current pane to pane "Notifications"
        else if pane_name = "energy" then
            set current pane to pane "Energy Saver"
        else if pane_name = "keyboard" then
            set current pane to pane "Keyboard"
        else if pane_name = "mouse" then
            set current pane to pane "Mouse"
        else if pane_name = "sound" then
            set current pane to pane "Sound"
        else if pane_name = "network" then
            set current pane to pane "Network"
        else if pane_name = "bluetooth" then
            set current pane to pane "Bluetooth"
        else
            -- Just open System Preferences
            activate
        end if
    end tell

    return "System Preferences opened to " & pane_name
end openSystemPreferences

on setDesktopBackground(image_path)
    tell application "Finder"
        set desktop picture to file image_path
    end tell
    return "Desktop background set to " & image_path
end setDesktopBackground

on openApplicationsFolder()
    tell application "Finder"
        open home folder
        open folder "Applications" of startup disk
    end tell
    return "Applications folder opened"
end openApplicationsFolder

on showAboutThisMac()
    tell application "System Events"
        tell process "Finder"
            click menu item "About This Mac" of menu "Apple" of menu bar 1
        end tell
    end tell
    return "About This Mac window opened"
end showAboutThisMac

on getSystemInfo()
    -- Get system information
    set systemInfo to {}

    tell application "System Events"
        set systemName to name of computer
        set systemVersion to system version
        set systemModel to model of computer

        -- Get RAM information
        set ramInfo to do shell script "sysctl -n hw.memsize"
        set ramGB to (ramInfo / 1024 / 1024 / 1024) as integer

        -- Get disk information
        set diskInfo to do shell script "df -h /"
        set diskItems to splitString(diskInfo, " ")
        set diskUsage to item (count of diskItems) of diskItems

        set end of systemInfo to {name:systemName, version:systemVersion, model:systemModel, ram:ramGB & "GB", disk:diskUsage}
    end tell

    return systemInfo
end getSystemInfo

on splitString(source_string, delimiter)
    set AppleScript's text item delimiters to delimiter
    set text_items to text items of source_string
    set AppleScript's text item delimiters to ""
    return text_items
end splitString

on executeSystemCommand(command_string)
    try
        set command_result to do shell script command_string
        return command_result
    on error errMsg
        return "Command failed: " & errMsg
    end try
end executeSystemCommand

on monitorSystemPerformance()
    -- Get system performance metrics
    set performanceInfo to {}

    -- CPU usage
    try
        set cpuUsage to do shell script "top -l 1 | grep 'CPU usage' | awk '{print $3}'"
        set end of performanceInfo to {metric:"CPU Usage", value:cpuUsage}
    on error
        set end of performanceInfo to {metric:"CPU Usage", value:"N/A"}
    end try

    -- Memory usage
    try
        set memUsage to do shell script "vm_stat | grep 'Pages free' | awk '{print $3}' | sed 's/\\.//'"
        set end of performanceInfo to {metric:"Free Memory", value:memUsage & " pages"}
    on error
        set end of performanceInfo to {metric:"Free Memory", value:"N/A"}
    end try

    -- Disk usage
    try
        set diskUsage to do shell script "df -h / | tail -1 | awk '{print $5}'"
        set end of performanceInfo to {metric:"Disk Usage", value:diskUsage}
    on error
        set end of performanceInfo to {metric:"Disk Usage", value:"N/A"}
    end try

    return performanceInfo
end monitorSystemPerformance

-- Example usage:
-- setSystemVolume(75)
-- showSystemNotification("Task Complete", "Your automation has finished successfully.", "Glass")
-- toggleWiFi(true)
-- getSystemInfo()
-- monitorSystemPerformance()