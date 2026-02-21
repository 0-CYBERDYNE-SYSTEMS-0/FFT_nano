-- Browser Automation Template
-- Parameters: browser_type, operation, parameters

on openBrowserWithURL(browser_type, url)
    if browser_type = "chrome" then
        tell application "Google Chrome"
            activate
            if (count of windows) = 0 then
                make new window
            end if
            set URL of active tab of window 1 to url
        end tell

    else if browser_type = "safari" then
        tell application "Safari"
            activate
            if (count of windows) = 0 then
                make new document
            end if
            set URL of document 1 to url
        end tell

    else if browser_type = "firefox" then
        tell application "Firefox"
            activate
            -- Firefox URL handling might need different approach
            do shell script "open -a Firefox " & quoted form of url
        end tell
    end if

    return "Opened " & browser_type & " with URL: " & url
end openBrowserWithURL

on createNewTab(browser_type, url)
    if browser_type = "chrome" then
        tell application "Google Chrome"
            tell window 1
                make new tab with properties {URL:url}
            end tell
        end tell

    else if browser_type = "safari" then
        tell application "Safari"
            tell window 1
                set current tab to (make new tab with properties {URL:url})
            end tell
        end tell
    end if

    return "New tab created in " & browser_type
end createNewTab

on closeCurrentTab(browser_type)
    if browser_type = "chrome" then
        tell application "Google Chrome"
            if (count of windows) > 0 then
                close active tab of window 1
            end if
        end tell

    else if browser_type = "safari" then
        tell application "Safari"
            if (count of windows) > 0 then
                close current tab of window 1
            end if
        end tell
    end if

    return "Current tab closed in " & browser_type
end closeCurrentTab

on switchToTab(browser_type, tab_index)
    if browser_type = "chrome" then
        tell application "Google Chrome"
            if (count of windows) > 0 then
                set active tab index of window 1 to tab_index
            end if
        end tell

    else if browser_type = "safari" then
        tell application "Safari"
            if (count of windows) > 0 then
                set current tab to tab tab_index of window 1
            end if
        end tell
    end if

    return "Switched to tab " & tab_index & " in " & browser_type
end switchToTab

on reloadCurrentPage(browser_type)
    if browser_type = "chrome" then
        tell application "Google Chrome"
            if (count of windows) > 0 then
                reload active tab of window 1
            end if
        end tell

    else if browser_type = "safari" then
        tell application "Safari"
            if (count of windows) > 0 then
                tell document 1 to do JavaScript "window.location.reload()"
            end if
        end tell
    end if

    return "Current page reloaded in " & browser_type
end reloadCurrentPage

on navigateBack(browser_type)
    if browser_type = "chrome" then
        tell application "Google Chrome"
            if (count of windows) > 0 then
                tell window 1 to go back
            end if
        end tell

    else if browser_type = "safari" then
        tell application "Safari"
            if (count of windows) > 0 then
                tell document 1 to do JavaScript "window.history.back()"
            end if
        end tell
    end if

    return "Navigated back in " & browser_type
end navigateBack

on navigateForward(browser_type)
    if browser_type = "chrome" then
        tell application "Google Chrome"
            if (count of windows) > 0 then
                tell window 1 to go forward
            end if
        end tell

    else if browser_type = "safari" then
        tell application "Safari"
            if (count of windows) > 0 then
                tell document 1 to do JavaScript "window.history.forward()"
            end if
        end tell
    end if

    return "Navigated forward in " & browser_type
end navigateForward

on zoomPage(browser_type, zoom_level)
    if browser_type = "chrome" then
        tell application "Google Chrome"
            if (count of windows) > 0 then
                tell active tab of window 1
                    set zoom level to zoom_level
                end tell
            end if
        end tell

    else if browser_type = "safari" then
        tell application "Safari"
            if (count of windows) > 0 then
                tell document 1 to do JavaScript "document.body.style.zoom='" & zoom_level & "'"
            end if
        end tell
    end if

    return "Page zoomed to " & zoom_level & " in " & browser_type
end zoomPage

on findTextOnPage(browser_type, search_text)
    if browser_type = "chrome" then
        tell application "System Events"
            tell process "Google Chrome"
                activate
                keystroke "f" using command down
                delay 0.5
                keystroke search_text
                delay 0.5
                keystroke return
            end tell
        end tell

    else if browser_type = "safari" then
        tell application "System Events"
            tell process "Safari"
                activate
                keystroke "f" using command down
                delay 0.5
                keystroke search_text
                delay 0.5
                keystroke return
            end tell
        end tell
    end if

    return "Searching for '" & search_text & "' in " & browser_type
end findTextOnPage

on takeBrowserScreenshot(browser_type, file_path)
    if browser_type = "chrome" then
        tell application "Google Chrome"
            activate
            if (count of windows) > 0 then
                tell window 1
                    save as PDF file_path
                end tell
            end if
        end tell

    else if browser_type = "safari" then
        tell application "Safari"
            activate
            if (count of windows) > 0 then
                tell document 1
                    save as PDF in file file_path
                end tell
            end if
        end tell
    end if

    return "Screenshot saved to " & file_path
end takeBrowserScreenshot

on getBrowserTabs(browser_type)
    set tabList to {}

    if browser_type = "chrome" then
        tell application "Google Chrome"
            if (count of windows) > 0 then
                repeat with w from 1 to count of windows
                    repeat with t from 1 to count of tabs of window w
                        set tabTitle to title of tab t of window w
                        set tabURL to URL of tab t of window w
                        set end of tabList to {title:tabTitle, url:tabURL, window:w, tab:t}
                    end repeat
                end repeat
            end if
        end tell

    else if browser_type = "safari" then
        tell application "Safari"
            if (count of windows) > 0 then
                repeat with w from 1 to count of windows
                    repeat with t from 1 to count of tabs of window w
                        set tabTitle to name of tab t of window w
                        set tabURL to URL of tab t of window w
                        set end of tabList to {title:tabTitle, url:tabURL, window:w, tab:t}
                    end repeat
                end repeat
            end if
        end tell
    end if

    return tabList
end getBrowserTabs

on bookmarkCurrentPage(browser_type, bookmark_title)
    if browser_type = "chrome" then
        tell application "Google Chrome"
            if (count of windows) > 0 then
                tell active tab of window 1
                    -- Chrome bookmarking requires UI interaction
                    tell application "System Events"
                        tell process "Google Chrome"
                            keystroke "d" using command down
                            delay 1
                            keystroke bookmark_title
                            keystroke return
                        end tell
                    end tell
                end tell
            end if
        end tell

    else if browser_type = "safari" then
        tell application "Safari"
            if (count of windows) > 0 then
                tell document 1
                    -- Safari bookmarking requires UI interaction
                    tell application "System Events"
                        tell process "Safari"
                            keystroke "d" using command down
                            delay 1
                            keystroke bookmark_title
                            keystroke return
                        end tell
                    end tell
                end tell
            end if
        end tell
    end if

    return "Page bookmarked as '" & bookmark_title & "' in " & browser_type
end bookmarkCurrentPage

on clearBrowserCache(browser_type)
    if browser_type = "chrome" then
        tell application "Google Chrome"
            activate
            tell application "System Events"
                tell process "Google Chrome"
                    keystroke "," using command down
                    delay 1
                    tell window 1
                        click button "Clear browsing data..." of toolbar 1
                    end tell
                end tell
            end tell
        end tell

    else if browser_type = "safari" then
        tell application "Safari"
            activate
            tell application "System Events"
                tell process "Safari"
                    keystroke "," using command down
                    delay 1
                    tell window 1
                        click button "Remove All Website Data" of toolbar 1
                        delay 0.5
                        click button "Remove Now" of sheet 1
                    end tell
                end tell
            end tell
        end tell
    end if

    return "Cache cleared in " & browser_type
end clearBrowserCache

on openDeveloperTools(browser_type)
    if browser_type = "chrome" then
        tell application "System Events"
            tell process "Google Chrome"
                activate
                keystroke "i" using {option down, command down}
            end tell
        end tell

    else if browser_type = "safari" then
        tell application "Safari"
            activate
            tell application "System Events"
                tell process "Safari"
                    keystroke "i" using {option down, command down}
                end tell
            end tell
        end tell
    end if

    return "Developer tools opened in " & browser_type
end openDeveloperTools

-- Example usage:
-- openBrowserWithURL("chrome", "https://www.google.com")
-- createNewTab("chrome", "https://www.github.com")
-- getBrowserTabs("chrome")
-- findTextOnPage("chrome", "AppleScript")
-- takeBrowserScreenshot("safari", "/Users/username/Desktop/screenshot.pdf")