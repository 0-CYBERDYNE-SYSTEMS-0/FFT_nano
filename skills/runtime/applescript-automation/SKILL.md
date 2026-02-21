---
name: applescript-automation
description: Comprehensive AppleScript expertise for enterprise-grade macOS
  automation including multi-display management, URL scheme handling, deep
  linking, and complex workflow orchestration
allowed-tools: macos_control workflow_automation bash
metadata:
  legacy_slug: applescript_automation
  legacy_summary: Advanced macOS automation with AppleScript, multi-screen
    management, URL schemes, and workflow orchestration
  legacy_version: "1.0"
  legacy_author: FF-Terminal
  legacy_priority: high
  legacy_tags: '["applescript","macos","automation","multi-screen","url-schemes","workflow"]'
  legacy_triggers: '["applescript","macos automation","multi-screen","url
    scheme","deep linking","window management","system
    control","automate.*mac","control.*app","position.*window","url.*handler","open.*app.*position","arrange.*windows","create.*url.*scheme","multi.*display","screen.*layout"]'
  legacy_assets: '["templates/app_control.applescript","templates/multi_screen_layout.applescript","templates/url_scheme_handler.applescript","templates/system_automation.applescript","templates/finder_operations.applescript","templates/browser_automation.applescript","workflows/development_setup.applescript","workflows/research_automation.applescript","workflows/meeting_preparation.applescript","workflows/content_creation.applescript"]'
  legacy_recommended_tools: '["macos_control","workflow_automation","bash"]'
  legacy_capabilities: '{"multi_screen_management":"Advanced multi-display
    automation","url_scheme_handling":"Custom URL scheme creation and
    handling","workflow_orchestration":"Complex multi-app workflow
    automation","system_integration":"Deep macOS system integration"}'
---

# AppleScript Automation Mastery

## When to use this skill
- Use when the user request matches this skill's domain and capabilities.
- Use when this workflow or toolchain is explicitly requested.

## When not to use this skill
- Do not use when another skill is a better direct match for the task.
- Do not use when the request is outside this skill's scope.

You are an expert AppleScript automation specialist with deep knowledge of macOS system architecture, multi-display management, URL scheme implementation, and complex workflow orchestration. When this skill is activated, provide enterprise-grade macOS automation solutions.

## Quick Reference - Immediate Patterns

### Application Launch & Position
```applescript
-- Launch app and position on specific display
tell application "System Events"
    set screenWidth to item 1 of (size of main screen)
    set screenHeight to item 2 of (size of main screen)
end tell

tell application "Terminal"
    activate
    if (count of windows) = 0 then make new document
    set bounds of window 1 to {0, 0, screenWidth/2, screenHeight}
end tell
```

### Multi-Screen Window Management
```applescript
-- Get information about all displays
tell application "System Events"
    set allDisplays to every display
    repeat with i from 1 to count of allDisplays
        set displayBounds to bounds of display i
        set displayResolution to size of display i
        log ("Display " & i & ": " & displayResolution)
    end repeat
end tell
```

### URL Scheme Registration
```applescript
-- Register custom URL scheme handler
tell application "System Events"
    make new preference pane at end of preference panes with properties {name:"URL Handlers"}
    tell preference pane "URL Handlers"
        make new URL handler with properties {scheme:"ff-terminal", handler:"/Applications/FF-Terminal.app"}
    end tell
end tell
```

## Multi-Screen Mastery

### Display Detection & Analysis
```applescript
-- Comprehensive multi-display information
on getDisplayInfo()
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
                isMain:(i = 1)
            }

            set end of displayList to displayInfo
        end repeat
    end tell

    return displayList
end getDisplayInfo
```

### Cross-Display Window Positioning
```applescript
-- Position window across multiple displays
on positionWindowAcrossDisplays(appName, windowIndex, displayLayout)
    tell application "System Events"
        set displayInfo to getDisplayInfo()
        set targetDisplay to item displayLayout of displayInfo
        set displayBounds to bounds of targetDisplay

        tell application appName
            activate
            if (count of windows) ≥ windowIndex then
                set windowBounds to {
                    item 1 of displayBounds,
                    item 2 of displayBounds,
                    item 1 of displayBounds + (item 3 of displayBounds - item 1 of displayBounds),
                    item 2 of displayBounds + (item 4 of displayBounds - item 2 of displayBounds)
                }
                set bounds of window windowIndex to windowBounds
            end if
        end tell
    end tell
end positionWindowAcrossDisplays
```

### Layout Templates
```applescript
-- Predefined layout templates for different workflows
on applyLayoutTemplate(templateName)
    tell application "System Events"
        set displayInfo to getDisplayInfo()

        if templateName = "coding" then
            -- Terminal left 50%, Browser right 50% on main display
            positionWindowAcrossDisplays("Terminal", 1, 1)
            delay 1
            positionWindowAcrossDisplays("Google Chrome", 1, 1)

            -- Resize Chrome to right half
            tell application "Google Chrome"
                set mainBounds to bounds of display 1
                set chromeBounds to {
                    (item 1 of mainBounds) + ((item 3 of mainBounds - item 1 of mainBounds) / 2),
                    item 2 of mainBounds,
                    item 3 of mainBounds,
                    item 4 of mainBounds
                }
                set bounds of window 1 to chromeBounds
            end tell

        else if templateName = "research" then
            -- Browser center 60%, Notes right 40%, Terminal bottom strip
            positionWindowAcrossDisplays("Google Chrome", 1, 1)
            positionWindowAcrossDisplays("Notes", 1, 1)
            positionWindowAcrossDisplays("Terminal", 1, 1)

        else if templateName = "data_analysis" then
            -- Terminal left 33%, Data tools right 67%
            positionWindowAcrossDisplays("Terminal", 1, 1)
            positionWindowAcrossDisplays("Numbers", 1, 1)

        end if
    end tell
end applyLayoutTemplate
```

## Application Control & Orchestration

### Advanced App Launching
```applescript
-- Intelligent application launching with state management
on launchAppWithConfiguration(appName, config)
    tell application "System Events"
        -- Check if app is already running
        set appProcess to (first process whose name is appName)

        if appProcess exists then
            -- App is running, bring to front
            tell application appName to activate
        else
            -- App not running, launch it
            tell application appName to launch
            delay 3 -- Wait for app to fully load
        end if

        -- Apply configuration if provided
        if config contains "position" then
            set targetPosition to position of config
            tell application appName
                if (count of windows) > 0 then
                    set position of window 1 to targetPosition
                end if
            end tell
        end if

        if config contains "size" then
            set targetSize to size of config
            tell application appName
                if (count of windows) > 0 then
                    set size of window 1 to targetSize
                end if
            end tell
        end if

        if config contains "fullscreen" then
            tell application appName
                if (count of windows) > 0 then
                    set fullscreen of window 1 to true
                end if
            end tell
        end if
    end tell
end launchAppWithConfiguration
```

### Multi-App Workflow Orchestration
```applescript
-- Coordinate multiple applications in a workflow
on orchestrateWorkflow(workflowSteps)
    repeat with step in workflowSteps
        set stepType to type of step
        set stepApp to application of step
        set stepConfig to configuration of step

        if stepType = "launch" then
            launchAppWithConfiguration(stepApp, stepConfig)
        else if stepType = "configure" then
            configureApplication(stepApp, stepConfig)
        else if stepType = "communicate" then
            set sourceApp to source of step
            set targetApp to target of step
            set dataTransfer to data of step

            transferDataBetweenApps(sourceApp, targetApp, dataTransfer)
        end if

        -- Add delay between steps for stability
        delay 1
    end repeat
end orchestrateWorkflow
```

## URL Schemes & Deep Linking

### Custom URL Scheme Registration
```applescript
-- Register custom URL schemes for deep linking
on registerURLScheme(schemeName, handlerApp, handlerScript)
    tell application "System Events"
        -- Create URL scheme registration
        set schemeInfo to {
            scheme:schemeName,
            handler:handlerApp,
            script:handlerScript
        }

        -- Write to Launch Services database
        do shell script "defaults write com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers -array-add '{\"LSHandlerURLScheme\":\"" & schemeName & "\",\"LSHandlerRoleAll\":\"" & handlerApp & "\"}'"

        -- Refresh Launch Services
        do shell script "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -kill -r -domain local -domain system -domain user"
    end tell
end registerURLScheme
```

### URL Handler Implementation
```applescript
-- Handle incoming URL scheme requests
on handleURLRequest(scheme, data)
    if scheme = "ff-terminal" then
        -- Parse URL data
        set urlComponents to splitString(data, "/")
        set command to item 1 of urlComponents

        if command = "automate" then
            set automationTask to item 2 of urlComponents
            executeAutomationTask(automationTask)
        else if command = "workflow" then
            set workflowName to item 2 of urlComponents
            runWorkflow(workflowName)
        else if command = "layout" then
            set layoutName to item 2 of urlComponents
            applyLayoutTemplate(layoutName)
        end if

    else if scheme = "automation" then
        -- Handle automation-specific URLs
        processAutomationURL(data)
    end if
end handleURLRequest
```

### Cross-Application Communication
```applescript
-- Enable apps to communicate via URL schemes
on enableAppCommunication(sourceApp, targetApp, messageFormat)
    -- Register URL scheme in target app
    registerURLScheme(targetApp & "://", sourceApp, "")

    -- Configure source app to generate appropriate URLs
    tell application sourceApp
        -- Implementation depends on source app capabilities
        -- Example for browser-based automation:
        set communicationURL to targetApp & "://message/" & urlEncode(messageFormat)
        open location communicationURL
    end tell
end enableAppCommunication
```

## System Integration & Control

### System Preferences Automation
```applescript
-- Automated system preferences configuration
on configureSystemPreference(pane, setting, value)
    tell application "System Preferences"
        activate
        set current pane to pane pane

        delay 1 -- Wait for pane to load

        tell application "System Events"
            tell process "System Preferences"
                -- Navigate to specific setting
                click UI element setting of group 1 of window pane

                -- Set the value
                set value of UI element setting of group 1 of window pane to value
            end tell
        end tell

        quit
    end tell
end configureSystemPreference
```

### Notification Center Integration
```applescript
-- System notifications with advanced options
on showNotification(title, subtitle, message, soundName)
    tell application "System Events"
        -- Create notification
        set notification to {
            title:title,
            subtitle:subtitle,
            informativeText:message,
            soundName:soundName,
            hasActionButton:true,
            actionButtonTitle:"Open"
        }

        -- Display notification
        display notification message with title title subtitle subtitle sound name soundName
    end tell
end showNotification
```

### Finder Operations
```applescript
-- Advanced Finder automation
on automateFinderOperation(operation, source, destination)
    tell application "Finder"
        if operation = "move" then
            move source to destination
        else if operation = "copy" then
            duplicate source to destination
        else if operation = "organize" then
            -- Organize files by type
            set sourceFolder to folder source
            set filesInFolder to every file of sourceFolder

            repeat with fileItem in filesInFolder
                set fileType to file type of fileItem
                set targetFolder to folder fileType of destination

                if not (exists targetFolder) then
                    make new folder at destination with properties {name:fileType}
                    set targetFolder to folder fileType of destination
                end if

                move fileItem to targetFolder
            end repeat
        end if
    end tell
end automateFinderOperation
```

## Error Handling & Recovery

### Robust Error Management
```applescript
-- Comprehensive error handling with recovery
on executeWithErrorRecovery(scriptBlock, recoveryBlock)
    try
        -- Execute main script block
        execute script scriptBlock

    on error errMsg number errNum
        -- Log error details
        log "AppleScript Error: " & errMsg & " (Error " & errNum & ")"

        -- Attempt recovery
        if recoveryBlock is not missing then
            try
                execute script recoveryBlock
            on error recoveryErr
                log "Recovery failed: " & recoveryErr
            end try
        end if

        -- Return error information
        return {
            success:false,
            error:errMsg,
            errorNumber:errNum
        }
    end try

    return {success:true}
end executeWithErrorRecovery
```

### Application State Validation
```applescript
-- Validate application state before operations
on validateApplicationState(appName, requiredState)
    tell application "System Events"
        set appProcess to first process whose name is appName

        if not (appProcess exists) then
            return {valid:false, reason:"Application not running"}
        end if

        tell application appName
            if requiredState contains "window" then
                if (count of windows) = 0 then
                    return {valid:false, reason:"No windows open"}
                end if
            end if

            if requiredState contains "frontmost" then
                if not frontmost then
                    return {valid:false, reason:"Application not frontmost"}
                end if
            end if
        end tell
    end tell

    return {valid:true}
end validateApplicationState
```

## Performance Optimization

### Template Caching System
```applescript
-- Cache frequently used AppleScript templates
property scriptCache : {}

on getCachedScript(templateName)
    if scriptCache contains templateName then
        return scriptCache's item templateName
    else
        -- Load script from file
        set scriptPath to "/path/to/templates/" & templateName & ".applescript"
        set scriptContent to read file scriptPath

        -- Cache for future use
        set scriptCache's item templateName to scriptContent
        return scriptContent
    end if
end getCachedScript
```

### Batch Operations
```applescript
-- Execute multiple operations efficiently
on executeBatchOperation(operations)
    tell application "System Events"
        -- Group similar operations
        set appOperations to {}
        set systemOperations to {}

        repeat with operation in operations
            set operationType to type of operation

            if operationType = "application" then
                set end of appOperations to operation
            else if operationType = "system" then
                set end of systemOperations to operation
            end if
        end repeat

        -- Execute application operations
        repeat with appOp in appOperations
            executeApplicationOperation(appOp)
        end repeat

        -- Execute system operations
        repeat with sysOp in systemOperations
            executeSystemOperation(sysOp)
        end repeat
    end tell
end executeBatchOperation
```

## Best Practices for Agents

### 1. **Always Validate Before Execution**
- Check application availability and state
- Verify screen configurations
- Test URL scheme registration

### 2. **Use Progressive Disclosure**
- Start with simple operations
- Build complexity gradually
- Provide clear feedback at each step

### 3. **Implement Robust Error Handling**
- Always include try-catch blocks
- Provide meaningful error messages
- Include recovery mechanisms

### 4. **Optimize for Performance**
- Cache frequently used scripts
- Batch operations when possible
- Minimize delays between operations

### 5. **Maintain Security**
- Request permissions before sensitive operations
- Validate user input and parameters
- Use secure communication methods

## Integration with FF-Terminal Tools

This skill integrates seamlessly with existing FF-Terminal tools:

- **macos_control**: Use for direct AppleScript execution
- **workflow_automation**: Combine with workflow orchestration
- **bash**: Use for system-level operations alongside AppleScript

When implementing AppleScript solutions, always consider how they can be enhanced through FF-Terminal's broader automation ecosystem.
