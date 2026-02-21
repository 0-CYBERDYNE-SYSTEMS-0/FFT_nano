-- URL Scheme Handler Template
-- Parameters: scheme_name, handler_app, handler_script

on registerCustomURLScheme(scheme_name, handler_app, handler_script)
    -- Register URL scheme with Launch Services
    do shell script "defaults write com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers -array-add '{\"LSHandlerURLScheme\":\"" & scheme_name & "\",\"LSHandlerRoleAll\":\"" & handler_app & "\"}'"

    -- Refresh Launch Services to make changes take effect
    do shell script "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -kill -r -domain local -domain system -domain user"

    return "URL scheme " & scheme_name & " registered for " & handler_app
end registerCustomURLScheme

on createURLHandlerScript(scheme_name)
    set scriptContent to "
on urlSchemeHandler(url_data)
    -- Parse URL components
    set url_parts to splitString(url_data, \"/\")

    if (count of url_parts) > 0 then
        set command to item 1 of url_parts

        if command = \"automate\" then
            -- Handle automation commands
            if (count of url_parts) > 1 then
                set task_name to item 2 of url_parts
                executeAutomationTask(task_name, url_parts)
            end if

        else if command = \"workflow\" then
            -- Handle workflow commands
            if (count of url_parts) > 1 then
                set workflow_name to item 2 of url_parts
                runWorkflow(workflow_name)
            end if

        else if command = \"layout\" then
            -- Handle layout commands
            if (count of url_parts) > 1 then
                set layout_name to item 2 of url_parts
                applyLayout(layout_name)
            end if

        else if command = \"message\" then
            -- Handle message passing
            if (count of url_parts) > 1 then
                set message_text to item 2 of url_parts
                display notification message_text
            end if
        end if
    end if
end urlSchemeHandler

on executeAutomationTask(task_name, parameters)
    -- Execute specific automation tasks
    if task_name = \"open_apps\" then
        openApplicationSet(parameters)
    else if task_name = \"arrange_windows\" then
        arrangeWindows(parameters)
    else if task_name = \"screenshot\" then
        takeScreenshot(parameters)
    end if
end executeAutomationTask

on splitString(source_string, delimiter)
    set AppleScript's text item delimiters to delimiter
    set text_items to text items of source_string
    set AppleScript's text item delimiters to \"\"
    return text_items
end splitString
"

    return scriptContent
end createURLHandlerScript

on createFFTerminalHandler()
    -- Create URL handler for ff-terminal:// scheme
    set scriptPath to (path to desktop as string) & "ff_terminal_handler.scpt"

    set scriptContent to createURLHandlerScript("ff-terminal")

    -- Save the script
    try
        set scriptFile to open for access file scriptPath with write permission
        write scriptContent to scriptFile
        close access scriptFile
        return "Handler script created at " & scriptPath
    on error
        return "Error creating handler script"
    end try
end createFFTerminalHandler

on enableAppURLScheme(target_app, scheme_name)
    tell application target_app
        activate

        -- Create URL handler specific to the app
        set handlerScript to "
on urlSchemeHandler(url_data)
    tell application \"" & target_app & "\"
        activate

        -- Parse the URL data and take appropriate action
        -- This is a placeholder - customize based on app capabilities
        display notification \"Received URL: \" & url_data
    end tell
end urlSchemeHandler
"

        -- Save script to app's script folder (if supported)
        try
            -- Some apps support script loading
            -- This would need to be customized for each app
            log "URL handler script prepared for " & target_app
        on error errMsg
            return "Could not create URL handler: " & errMsg
        end try
    end tell
end enableAppURLScheme

on testURLScheme(scheme_name, test_data)
    -- Test if URL scheme is working
    set testURL to scheme_name & "://test/" & test_data

    try
        open location testURL
        return "URL scheme test initiated: " & testURL
    on error errMsg
        return "URL scheme test failed: " & errMsg
    end try
end testURLScheme

on createAutomationURL(base_url, action, parameters)
    -- Construct automation URL from components
    set automationURL to base_url & "://automate/" & action

    if (count of parameters) > 0 then
        repeat with param in parameters
            set automationURL to automationURL & "/" & param
        end repeat
    end if

    return automationURL
end createAutomationURL

on executeURLAutomation(automation_url)
    -- Execute automation via URL
    try
        open location automation_url
        delay 2 -- Allow time for URL handling
        return "Automation URL executed: " & automation_url
    on error errMsg
        return "Failed to execute automation URL: " & errMsg
    end try
end executeURLAutomation

-- Example usage:
-- registerCustomURLScheme("ff-terminal", "FF-Terminal", "")
-- createFFTerminalHandler()
-- testURLScheme("ff-terminal", "hello_world")
-- executeURLAutomation("ff-terminal://automate/arrange_windows/coding_layout")