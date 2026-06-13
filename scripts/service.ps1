#!/usr/bin/env pwsh
# FFT_nano Windows Service Manager
# Usage: .\service.ps1 <install|uninstall|start|stop|restart|status|logs>

param(
    [Parameter(Position = 0, Mandatory)]
    [ValidateSet("install", "uninstall", "start", "stop", "restart", "status", "logs")]
    [string]$Action
)

$ErrorActionPreference = "Stop"

$ServiceName = "fft-nano"
$DisplayName = "FFT_nano Service"
$ProjectRoot = if ($env:FFT_NANO_PROJECT_ROOT) { $env:FFT_NANO_PROJECT_ROOT } else { Split-Path (Split-Path $PSScriptRoot -Parent) }
$NodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
$HostExe = Join-Path $ProjectRoot "dist\index.js"
$LogDir = Join-Path $ProjectRoot "logs"
$ServiceLog = Join-Path $LogDir "fft_nano.log"
$ServiceErrorLog = Join-Path $LogDir "fft_nano.error.log"
$ServiceWrapper = Join-Path $ProjectRoot "scripts\service-wrapper.ps1"

function Write-Stage {
    param([string]$Message)
    Write-Host $Message
}

function Write-Fail {
    param([string]$Message)
    Write-Host "ERROR: $Message" -ForegroundColor Red
    exit 1
}

function New-ServiceWrapper {
    # Create a PowerShell wrapper script that the Windows Service will execute
    $wrapperContent = @"
# FFT_nano Service Wrapper
# This script is called by the Windows Service

`$ErrorActionPreference = "Stop"
`$logFile = "$ServiceLog"
`$errorLogFile = "$ServiceErrorLog"

function Write-Log {
    param([string]`$Message)
    `$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    `"`$timestamp `$(`$Message)`" | Out-File -FilePath `$logFile -Append -Encoding UTF8
}

try {
    Write-Log "Starting FFT_nano host..."
    Write-Log "Node executable: $NodeExe"
    Write-Log "Host executable: $HostExe"

    # Start the host process
    `$process = Start-Process -FilePath "$NodeExe" -ArgumentList `"$HostExe`" -PassThru -NoNewWindow -RedirectStandardOutput `$logFile -RedirectStandardError `$errorLogFile -WorkingDirectory "$ProjectRoot"

    Write-Log "FFT_nano started with PID: `$(`$process.Id)"

    # Wait for process to exit
    `$process.WaitForExit()

    Write-Log "FFT_nano exited with code: `$(`$process.ExitCode)"
} catch {
    Write-Log "Error: `$(`$_.Exception.Message)"
    `"`$(Get-Date -Format "yyyy-MM-dd HH:mm:ss") ERROR: `$(`$_.Exception.Message)`" | Out-File -FilePath `$errorLogFile -Append -Encoding UTF8
    exit 1
}
"@
    $wrapperContent | Out-File -FilePath $ServiceWrapper -Encoding UTF8 -NoNewline
}

function Test-ServiceInstalled {
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    return $null -ne $service
}

function Get-ServiceStatusString {
    try {
        $service = Get-Service -Name $ServiceName -ErrorAction Stop
        switch ($service.Status) {
            "Running" { return "running" }
            "Stopped" { return "stopped" }
            "Paused" { return "stopped" }
            default { return "stopped" }
        }
    } catch {
        return "not_installed"
    }
}

# Ensure log directory exists
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
}

switch ($Action) {
    "install" {
        Write-Stage "Installing $DisplayName..."

        if (-not (Test-Path $HostExe)) {
            Write-Fail "FFT_nano host not found at $HostExe. Run 'npm run build' first."
        }

        # Create service wrapper
        New-ServiceWrapper

        # Check if service already exists
        $existingService = Get-WmiObject -Class Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
        if ($existingService) {
            Write-Stage "Service already exists. Stopping and removing..."
            Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
            & "$env:SystemRoot\System32\sc.exe" delete $ServiceName 2>&1 | Out-Null
        }

        # Create the service using PowerShell's New-Service
        # We need to use a wrapper since node can't be a Windows Service directly
        $createOut = & "$env:SystemRoot\System32\sc.exe" create $ServiceName binPath= "powershell.exe -NoLogo -ExecutionPolicy Bypass -File `"$ServiceWrapper`"" DisplayName= $DisplayName start="Automatic" 2>&1

        if ($LASTEXITCODE -ne 0) {
            Write-Fail "Failed to create service: $createOut"
        }

        # Set recovery options
        & "$env:SystemRoot\System32\sc.exe" failure $ServiceName reset= 86400 actions= restart/5000/restart/10000/restart/30000 2>&1 | Out-Null

        Write-Stage "Service installed: $ServiceName"
        Write-Stage "Run 'service.ps1 start' to start the service"
    }

    "uninstall" {
        Write-Stage "Uninstalling $DisplayName..."

        if (Test-ServiceInstalled) {
            Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
            & "$env:SystemRoot\System32\sc.exe" delete $ServiceName 2>&1 | Out-Null
            Write-Stage "Service uninstalled"
        } else {
            Write-Stage "Service is not installed"
        }

        # Remove wrapper
        if (Test-Path $ServiceWrapper) {
            Remove-Item $ServiceWrapper -Force -ErrorAction SilentlyContinue
        }
    }

    "start" {
        Write-Stage "Starting $DisplayName..."

        if (-not (Test-ServiceInstalled)) {
            Write-Fail "Service is not installed. Run 'service.ps1 install' first."
        }

        Start-Service -Name $ServiceName -ErrorAction Stop
        Write-Stage "Service started"
    }

    "stop" {
        Write-Stage "Stopping $DisplayName..."

        if (-not (Test-ServiceInstalled)) {
            Write-Stage "Service is not installed"
            return
        }

        Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
        Write-Stage "Service stopped"
    }

    "restart" {
        Write-Stage "Restarting $DisplayName..."

        if (-not (Test-ServiceInstalled)) {
            Write-Fail "Service is not installed"
        }

        Restart-Service -Name $ServiceName -Force -ErrorAction Stop
        Write-Stage "Service restarted"
    }

    "status" {
        $status = Get-ServiceStatusString
        Write-Stage "FFT_nano Service: $status"

        if ($status -eq "running") {
            $service = Get-Service -Name $ServiceName
            Write-Stage "PID: $($service.Status)"
        }
    }

    "logs" {
        Write-Stage "=== FFT_nano Service Logs ==="
        $tailLines = if ($env:FFT_NANO_LOG_TAIL_LINES) { [int]$env:FFT_NANO_LOG_TAIL_LINES } else { 120 }

        if (Test-Path $ServiceLog) {
            Get-Content $ServiceLog -Tail $tailLines
        } else {
            Write-Stage "(no logs available)"
        }

        if (Test-Path $ServiceErrorLog) {
            Write-Stage ""
            Write-Stage "=== Errors ==="
            Get-Content $ServiceErrorLog -Tail $tailLines
        }
    }
}
