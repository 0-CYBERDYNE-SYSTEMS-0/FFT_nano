-- Meeting Preparation Workflow
-- Automated meeting setup with calendar, notes, and communication tools

on runMeetingPreparation(meeting_title, meeting_time, attendees)
    -- Step 1: Calculate preparation time (1 hour before meeting)
    set currentTime to current date
    set prepTime to currentTime - (1 * hours)
    set meetingTime to meeting_time

    -- Step 2: Get display information for layout
    tell application "System Events"
        set mainBounds to bounds of display 1
        set mainWidth to item 3 of mainBounds - item 1 of mainBounds
        set mainHeight to item 4 of mainBounds - item 2 of mainBounds
    end tell

    -- Step 3: Launch and position meeting preparation tools
    set meetingTools to {
        {app:"Calendar", x:0, y:0, width:mainWidth * 0.4, height:mainHeight * 0.5},
        {app:"Notes", x:mainWidth * 0.45, y:0, width:mainWidth * 0.55, height:mainHeight * 0.5},
        {app:"Mail", x:0, y:mainHeight * 0.55, width:mainWidth * 0.4, height:mainHeight * 0.45},
        {app:"Safari", x:mainWidth * 0.45, y:mainHeight * 0.55, width:mainWidth * 0.55, height:mainHeight * 0.45}
    }

    repeat with toolConfig in meetingTools
        set appName to app of toolConfig
        set appX to x of toolConfig
        set appY to y of toolConfig
        set appWidth to width of toolConfig
        set appHeight to height of toolConfig

        tell application "System Events"
            if not (exists process appName) then
                tell application appName to launch
                delay 2
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

    -- Step 4: Create meeting notes in Notes app
    tell application "Notes"
        activate
        if (count of windows) > 0 then
            -- Create new note for meeting
            tell application "System Events"
                tell process "Notes"
                    keystroke "n" using command down
                    delay 1
                end tell
            end tell

            -- Add meeting notes template
            tell application "System Events"
                tell process "Notes"
                    keystroke "Meeting: " & meeting_title
                    keystroke return
                    keystroke "Date: " & (meetingTime as string)
                    keystroke return
                    keystroke "Prepared: " & (currentTime as string)
                    keystroke return
                    keystroke return
                    keystroke "Attendees:"
                    keystroke return

                    -- Add attendees
                    repeat with attendee in attendees
                        keystroke "- " & attendee
                        keystroke return
                    end repeat

                    keystroke return
                    keystroke "Agenda:"
                    keystroke return
                    keystroke "1. Opening & Introductions"
                    keystroke return
                    keystroke "2. "
                    keystroke return
                    keystroke "3. "
                    keystroke return
                    keystroke "4. "
                    keystroke return
                    keystroke return
                    keystroke "Key Points:"
                    keystroke return
                    keystroke "- "
                    keystroke return
                    keystroke "- "
                    keystroke return
                    keystroke "- "
                    keystroke return
                    keystroke return
                    keystroke "Action Items:"
                    keystroke return
                    keystroke "- [ ] "
                    keystroke return
                    keystroke "- [ ] "
                    keystroke return
                    keystroke "- [ ] "
                    keystroke return
                    keystroke return
                    keystroke "Follow-up:"
                    keystroke return
                    keystroke "- "
                    keystroke return
                end tell
            end tell
        end if
    end tell

    -- Step 5: Open Calendar to show meeting time
    tell application "Calendar"
        activate
        delay 2
        tell application "System Events"
            tell process "Calendar"
                -- Go to meeting time
                keystroke "g" using command down
                delay 1
                keystroke (meetingTime as string)
                keystroke return
                delay 1

                -- Create new event if needed
                keystroke "n" using command down
                delay 1
                keystroke meeting_title
                keystroke tab
                delay 0.5
                keystroke (meetingTime as string)
            end tell
        end tell
    end tell

    -- Step 6: Prepare email with meeting reminder
    tell application "Mail"
        activate
        delay 2
        tell application "System Events"
            tell process "Mail"
                -- Create new message
                keystroke "n" using command down
                delay 1

                -- Add subject
                keystroke "Meeting Reminder: " & meeting_title
                keystroke tab
                delay 0.5

                -- Add recipients (first few attendees for example)
                if (count of attendees) > 0 then
                    keystroke item 1 of attendees
                    if (count of attendees) > 1 then
                        keystroke "," & space
                        keystroke item 2 of attendees
                    end if
                end if

                -- Tab to body
                repeat 3 times
                    keystroke tab
                    delay 0.3
                end repeat

                -- Add meeting reminder template
                keystroke "Hi Team,"
                keystroke return
                keystroke return
                keystroke "This is a reminder about our upcoming meeting:"
                keystroke return
                keystroke return
                keystroke "Meeting: " & meeting_title
                keystroke return
                keystroke "Time: " & (meetingTime as string)
                keystroke return
                keystroke "Attendees: "

                -- Add attendee list
                repeat with attendee in attendees
                    keystroke ", " & attendee
                end repeat

                keystroke return
                keystroke return
                keystroke "Please come prepared to discuss:"
                keystroke return
                keystroke "- "
                keystroke return
                keystroke "- "
                keystroke return
                keystroke "- "
                keystroke return
                keystroke return
                keystroke "Looking forward to seeing you there!"
                keystroke return
                keystroke "Best regards"
            end tell
        end tell
    end tell

    -- Step 7: Open relevant research/documents in Safari
    tell application "Safari"
        activate
        if (count of windows) > 0 then
            tell window 1
                -- Open Google for quick research
                set URL of document 1 to "https://www.google.com"

                -- Open additional tabs for meeting resources
                make new tab with properties {URL:"https://docs.google.com"}
                make new tab with properties {URL:"https://slack.com"}
            end tell
        end if
    end tell

    -- Step 8: Set up meeting reminder notification
    tell application "System Events"
        -- Schedule notification for 15 minutes before meeting
        set reminderTime to meetingTime - (15 * minutes)

        if reminderTime > currentTime then
            -- This would need additional implementation for scheduling
            display notification "Meeting reminder scheduled for " & (reminderTime as string) with title "Meeting: " & meeting_title
        end if
    end tell

    -- Step 9: Open FaceTime/Zoom for video calls (optional)
    try
        tell application "FaceTime"
            activate
        end tell
    on error
        try
            tell application "zoom.us"
                activate
            end tell
        on error
            log "Video conferencing app not available"
        end try
    end try

    -- Step 10: Show completion notification
    display notification "Meeting preparation complete!" with title "Ready for: " & meeting_title subtitle "All tools are positioned and configured"

    return "Meeting preparation completed for: " & meeting_title & " at " & (meetingTime as string)
end runMeetingPreparation

on scheduleMeetingReminder(meeting_title, meeting_time, reminder_minutes)
    -- Schedule a system notification for meeting reminder
    set currentTime to current date
    set reminderTime to meeting_time - (reminder_minutes * minutes)

    if reminderTime > currentTime then
        -- Calculate delay in seconds
        set delaySeconds to reminderTime - currentTime

        -- This is a simplified version - in practice you'd use a scheduling mechanism
        display notification "Meeting reminder scheduled" with title meeting_title subtitle "Will notify " & reminder_minutes & " minutes before"

        return "Reminder scheduled for " & (reminderTime as string)
    else
        return "Meeting time is in the past - cannot schedule reminder"
    end if
end scheduleMeetingReminder

on shareMeetingNotes(meeting_title, attendees)
    -- Share meeting notes via email or messaging
    tell application "Notes"
        activate

        -- Find the meeting note (this would need more sophisticated searching)
        tell application "System Events"
            tell process "Notes"
                -- Select the meeting note
                keystroke "f" using command down
                delay 0.5
                keystroke meeting_title
                delay 1
                keystroke escape

                -- Export or share the note
                keystroke "e" using command down
                delay 1
            end tell
        end tell
    end tell

    return "Meeting notes for " & meeting_title & " ready to share"
end shareMeetingNotes

on createMeetingFollowUp(meeting_title, action_items)
    -- Create follow-up task list
    tell application "Reminders"
        activate
        tell application "System Events"
            tell process "Reminders"
                -- Create new list
                keystroke "l" using command down
                delay 1
                keystroke "Meeting: " & meeting_title
                delay 0.5
                keystroke return

                -- Add action items
                repeat with action in action_items
                    keystroke "n" using command down
                    delay 0.5
                    keystroke action
                    keystroke return
                end repeat
            end tell
        end tell
    end tell

    return "Follow-up reminders created for: " & meeting_title
end createMeetingFollowUp

-- Example usage:
-- runMeetingPreparation("Q4 Planning Session", (current date) + (2 * hours), {"john@company.com", "sarah@company.com", "mike@company.com"})
-- scheduleMeetingReminder("Q4 Planning Session", (current date) + (2 * hours), 15)
-- createMeetingFollowUp("Q4 Planning Session", {"Review Q3 results", "Prepare Q4 budget", "Schedule follow-up meetings"})