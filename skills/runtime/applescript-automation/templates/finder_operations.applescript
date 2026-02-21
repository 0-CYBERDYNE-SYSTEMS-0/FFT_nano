-- Finder Operations Template
-- Parameters: operation_type, source, destination, options

on organizeFilesByType(source_folder, destination_folder)
    tell application "Finder"
        set sourceDir to folder source_folder
        set destDir to folder destination_folder

        -- Create destination folders for different file types
        set imageFolder to make new folder at destDir with properties {name:"Images"}
        set docFolder to make new folder at destDir with properties {name:"Documents"}
        set videoFolder to make new folder at destDir with properties {name:"Videos"}
        set audioFolder to make new folder at destDir with properties {name:"Audio"}
        set archiveFolder to make new folder at destDir with properties {name:"Archives"}

        -- Get all files in source folder
        set allFiles to every file of sourceDir

        repeat with fileItem in allFiles
            set fileName to name of fileItem
            set fileExtension to name extension of fileItem

            if fileExtension is in {"jpg", "jpeg", "png", "gif", "bmp", "tiff", "heic"} then
                move fileItem to imageFolder
            else if fileExtension is in {"pdf", "doc", "docx", "txt", "rtf", "pages"} then
                move fileItem to docFolder
            else if fileExtension is in {"mp4", "mov", "avi", "mkv", "m4v"} then
                move fileItem to videoFolder
            else if fileExtension is in {"mp3", "wav", "aac", "flac", "m4a"} then
                move fileItem to audioFolder
            else if fileExtension is in {"zip", "rar", "7z", "tar", "gz"} then
                move fileItem to archiveFolder
            end if
        end repeat
    end tell

    return "Files organized by type in " & destination_folder
end organizeFilesByType

on createSmartFolder(search_path, folder_name, search_criteria)
    tell application "Finder"
        -- Create a new smart folder
        set smartFolder to make new folder at folder search_path with properties {name:folder_name, kind:"smart"}

        -- Set up search criteria (this is simplified - actual smart folder creation is more complex)
        -- In practice, you might use Spotlight search or other methods

        return "Smart folder created: " & folder_name
    end tell
end createSmartFolder

on batchRenameFiles(source_folder, naming_pattern, start_number)
    tell application "Finder"
        set sourceDir to folder source_folder
        set allFiles to every file of sourceDir

        set currentNumber to start_number

        repeat with fileItem in allFiles
            set fileExtension to name extension of fileItem
            set newName to naming_pattern & " " & currentNumber

            if fileExtension is not "" then
                set newName to newName & "." & fileExtension
            end if

            set name of fileItem to newName
            set currentNumber to currentNumber + 1
        end repeat
    end tell

    return "Files renamed in " & source_folder
end batchRenameFiles

on duplicateFiles(file_list, destination_folder)
    tell application "Finder"
        set destDir to folder destination_folder

        repeat with filePath in file_list
            try
                set sourceFile to file filePath
                duplicate sourceFile to destDir
            on error errMsg
                log "Could not duplicate file " & filePath & ": " & errMsg
            end try
        end repeat
    end tell

    return "Files duplicated to " & destination_folder
end duplicateFiles

on createFolderStructure(base_path, folder_structure)
    tell application "Finder"
        set baseDir to folder base_path

        repeat with folderInfo in folder_structure
            set folderName to name of folderInfo
            set subfolders to subfolders of folderInfo

            set newFolder to make new folder at baseDir with properties {name:folderName}

            -- Create subfolders if specified
            repeat with subfolderName in subfolders
                make new folder at newFolder with properties {name:subfolderName}
            end repeat
        end repeat
    end tell

    return "Folder structure created in " & base_path
end createFolderStructure

on getFolderSize(folder_path)
    tell application "Finder"
        set targetFolder to folder folder_path
        set folderSize to size of targetFolder

        -- Convert to more readable format
        if folderSize > 1073741824 then
            set sizeInGB to (folderSize / 1073741824) as string
            return sizeInGB & " GB"
        else if folderSize > 1048576 then
            set sizeInMB to (folderSize / 1048576) as string
            return sizeInMB & " MB"
        else if folderSize > 1024 then
            set sizeInKB to (folderSize / 1024) as string
            return sizeInKB & " KB"
        else
            return folderSize & " bytes"
        end if
    end tell
end getFolderSize

on searchFilesByDate(source_folder, start_date, end_date)
    tell application "Finder"
        set sourceDir to folder source_folder
        set matchingFiles to {}

        set allFiles to every file of sourceDir

        repeat with fileItem in allFiles
            set fileDate to modification date of fileItem

            if (fileDate ≥ start_date) and (fileDate ≤ end_date) then
                set end of matchingFiles to (POSIX path of (fileItem as alias))
            end if
        end repeat
    end tell

    return matchingFiles
end searchFilesByDate

on compressFiles(file_list, archive_name, destination_folder)
    tell application "Finder"
        set destDir to folder destination_folder

        -- Select the files to compress
        select file_list

        -- Create compressed archive
        compress file_list

        -- Rename the archive
        set archiveFile to (first item of (get selection as alias))
        set name of archiveFile to archive_name & ".zip"

        -- Move to destination if needed
        move archiveFile to destDir
    end tell

    return "Files compressed to " & archive_name & ".zip"
end compressFiles

on setFilePermissions(file_path, permissions)
    -- Set file permissions using shell command
    try
        do shell script "chmod " & permissions & " " & quoted form of file_path
        return "Permissions set to " & permissions & " for " & file_path
    on error errMsg
        return "Failed to set permissions: " & errMsg
    end try
end setFilePermissions

on getDetailedFileList(folder_path)
    tell application "Finder"
        set sourceDir to folder folder_path
        set fileList to {}

        set allItems to every item of sourceDir

        repeat with itemRef in allItems
            set itemInfo to {}

            set end of itemInfo to {name:"Name", value:name of itemRef}
            set end of itemInfo to {name:"Type", value:kind of itemRef}
            set end of itemInfo to {name:"Size", value:size of itemRef}
            set end of itemInfo to {name:"Modified", value:modification date of itemRef}
            set end of itemInfo to {name:"Created", value:creation date of itemRef}
            set end of itemInfo to {name:"Path", value:POSIX path of (itemRef as alias)}

            set end of fileList to itemInfo
        end repeat
    end tell

    return fileList
end getDetailedFileList

on cleanOldFiles(folder_path, days_old)
    -- Delete files older than specified number of days
    tell application "Finder"
        set sourceDir to folder folder_path
        set cutoffDate to (current date) - (days_old * days)

        set allFiles to every file of sourceDir
        set deletedCount to 0

        repeat with fileItem in allFiles
            set fileDate to modification date of fileItem

            if fileDate < cutoffDate then
                delete fileItem
                set deletedCount to deletedCount + 1
            end if
        end repeat
    end tell

    return deletedCount & " old files deleted from " & folder_path
end cleanOldFiles

-- Example usage:
-- organizeFilesByType("/Users/username/Downloads", "/Users/username/OrganizedFiles")
-- batchRenameFiles("/Users/username/Documents", "Report", 1)
-- getFolderSize("/Users/username/Documents")
-- cleanOldFiles("/Users/username/Downloads", 30)