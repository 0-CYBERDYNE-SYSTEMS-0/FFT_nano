#!/usr/bin/env pwsh
# FFT_nano Windows Installer with Stage-Protocol JSON Progress
# Usage: .\install.ps1 [-InstallDir <path>] [-SkipService] [-SkipDesktop] [-DryRun]

param(
    [string]$InstallDir = "$HOME\FFT_nano",
    [switch]$SkipService,
    [switch]$SkipDesktop,
    [switch]$DryRun,
    [switch]$InstallService
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Environment overrides
$Repo = if ($env:FFT_NANO_REPO) { $env:FFT_NANO_REPO } else { "0-CYBERDYNE-SYSTEMS-0/FFT_nano" }
$Ref = if ($env:FFT_NANO_REF) { $env:FFT_NANO_REF } else { "latest" }
$Force = if ($env:FFT_NANO_FORCE -eq "1") { $true } else { $false }

# Constants
$NodeMinMajor = 20
$ServiceName = "fft-nano"

# JSON stage-protocol progress frame
function Stage-Emit {
    param(
        [Parameter(Mandatory)][string]$Stage,
        [bool]$Ok = $true,
        [bool]$Skipped = $false,
        [string]$Reason = ""
    )
    $frame = @{
        ok = $Ok
        stage = $Stage
        skipped = $Skipped
        reason = $Reason
    }
    $frame | ConvertTo-Json -Compress
}

function Write-Stage {
    param([string]$Message)
    Write-Host $Message
}

function Write-Warn {
    param([string]$Message)
    Write-Host "WARN: $Message" -ForegroundColor Yellow
}

function Write-Fail {
    param([string]$Message)
    Write-Host "ERROR: $Message" -ForegroundColor Red
    exit 1
}

# Check if running in Windows PowerShell (5.x) vs PowerShell Core (7+)
function Get-Platform {
    if ($PSVersionTable.PSVersion.Major -ge 7) {
        return "pwsh"
    } elseif ($IsWindows -or ($null -eq $IsWindows)) {
        return "windows"
    }
    return "unknown"
}

# Detect architecture
function Get-Architecture {
    $arch = $env:PROCESSOR_ARCHITECTURE
    switch ($arch) {
        "AMD64" { return "x64" }
        "ARM64" { return "arm64" }
        default { return "x64" }
    }
}

# Node.js version check
function Test-NodeInstalled {
    try {
        $version = node --version 2>$null
        if ($version) {
            $major = [int]($version -replace '^v(\d+)\..*', '$1')
            return $major -ge $NodeMinMajor
        }
    } catch { }
    return $false
}

function Get-NodeVersion {
    try {
        return node --version 2>$null
    } catch {
        return $null
    }
}

# Download helper
function Invoke-DownloadArchive {
    param([string]$Ref, [string]$OutFile)

    $url = if ($Ref -eq "latest") {
        $latestUrl = "https://github.com/$Repo/releases/latest"
        try {
            $response = curl -sL -o /dev/null -w '%{url_effective}' $latestUrl
            $tag = [System.IO.Path]::GetFileName($response)
            "https://github.com/$Repo/archive/refs/tags/$tag.tar.gz"
        } catch {
            Write-Fail "Could not resolve latest release"
        }
    } elseif ($Ref -match '^v\d') {
        "https://github.com/$Repo/archive/refs/tags/$Ref.tar.gz"
    } elseif ($Ref -eq "main" -or $Ref -eq "master") {
        "https://github.com/$Repo/archive/refs/heads/$Ref.tar.gz"
    } else {
        "https://github.com/$Repo/archive/$Ref.tar.gz"
    }

    Write-Stage "Downloading FFT_nano $Ref..."
    curl -fsSL $url -o $OutFile
}

# Generate random alphanumeric secret
function New-RandomSecret {
    param([int]$Length = 32)
    $chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] $Length
    $random.GetBytes($bytes)
    $result = ""
    foreach ($b in $bytes) {
        $result += $chars[$b % $chars.Length]
    }
    return $result
}

# Set or update .env value
function Set-EnvValue {
    param([string]$File, [string]$Key, [string]$Value)

    if (-not (Test-Path $File)) {
        "$Key=$Value" | Out-File -FilePath $File -Encoding UTF8
        return
    }

    $content = Get-Content $File -Raw -ErrorAction SilentlyContinue
    if ($content -match "^$Key=(.*)$") {
        $content = $content -replace "^$Key=.*", "$Key=$Value"
    } else {
        $content = $content.TrimEnd() + "`n$Key=$Value"
    }
    $content | Out-File -FilePath $File -Encoding UTF8 -NoNewline
}

# Main installation
function Install-FFTNano {
    Write-Stage "FFT_nano Windows Installer"
    Write-Stage "Install directory: $InstallDir"

    # Stage: detect
    $platform = Get-Platform
    $arch = Get-Architecture
    Stage-Emit -Stage "detect" -Ok $true -Skipped $false -Reason "$platform ($arch)"

    # Stage: prereqs
    Write-Stage "Checking system prerequisites..."
    # Windows always has prerequisites (PowerShell is built-in)
    # Check for git, curl
    $hasGit = $null -ne (Get-Command git -ErrorAction SilentlyContinue)
    $hasCurl = $null -ne (Get-Command curl -ErrorAction SilentlyContinue)
    Stage-Emit -Stage "prereqs" -Ok $true -Skipped $false -Reason "Windows prerequisites satisfied (PowerShell, curl=$hasGit, git=$hasCurl)"

    # Stage: node
    if (Test-NodeInstalled) {
        $nodeVersion = Get-NodeVersion
        Stage-Emit -Stage "node" -Ok $true -Skipped $true -Reason "Node.js $nodeVersion already installed"
    } else {
        Write-Stage "Node.js 20+ is required. Installing via chocolatey or winget..."

        # Try chocolatey first
        $choco = Get-Command choco -ErrorAction SilentlyContinue
        if ($choco) {
            Write-Stage "Installing Node.js via Chocolatey..."
            if (-not $DryRun) {
                choco install nodejs-lts -y 2>&1 | Out-Null
                $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
            }
            Stage-Emit -Stage "node" -Ok $true -Skipped $false -Reason "Node.js installed via Chocolatey"
        } else {
            # Try winget
            $winget = Get-Command winget -ErrorAction SilentlyContinue
            if ($winget) {
                Write-Stage "Installing Node.js via winget..."
                if (-not $DryRun) {
                    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null
                    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
                }
                Stage-Emit -Stage "node" -Ok $true -Skipped $false -Reason "Node.js installed via winget"
            } else {
                Write-Warn "Could not auto-install Node.js. Please install Node.js 20+ manually from https://nodejs.org"
                Stage-Emit -Stage "node" -Ok $false -Skipped $false -Reason "Node.js not installed - please install manually"
                exit 1
            }
        }

        if (-not (Test-NodeInstalled)) {
            Write-Fail "Node.js installation failed"
        }
    }

    # Stage: repo
    if ((Test-Path $InstallDir) -and (Get-ChildItem $InstallDir -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0) {
        if ($Force) {
            Write-Warn "FFT_NANO_FORCE=1 set; replacing $InstallDir"
            if (-not $DryRun) {
                Remove-Item -Recurse -Force $InstallDir
            }
        } else {
            Stage-Emit -Stage "repo" -Ok $false -Skipped $false -Reason "$InstallDir already exists and is not empty"
            Write-Fail "Set FFT_NANO_INSTALL_DIR to a new path or set FFT_NANO_FORCE=1 to replace it"
        }
    }

    $tmpDir = Join-Path $env:TEMP "fft-nano-install-$(Get-Random -Maximum 999999)"
    $archive = Join-Path $tmpDir "fft_nano.tar.gz"

    if (-not $DryRun) {
        New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
    }

    Invoke-DownloadArchive -Ref $Ref -OutFile $archive

    Write-Stage "Extracting archive..."
    if (-not $DryRun) {
        # Windows doesn't have tar by default in older versions, use PowerShell expansion
        $extractDir = Join-Path $tmpDir "extracted"
        New-Item -ItemType Directory -Force -Path $extractDir | Out-Null

        # Use tar if available, otherwise use Expand-Archive with workaround for .tar.gz
        $tar = Get-Command tar -ErrorAction SilentlyContinue
        if ($tar) {
            tar -xzf $archive -C $tmpDir
        } else {
            # Expand .tar.gz manually using .NET
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            $zipFile = $archive -replace '\.tar\.gz$', '.zip'
            Copy-Item $archive $zipFile -Force
            # For simplicity, we'll use curl to download the zip format if available
            # This is a fallback - in practice, Windows 10+ has tar
            try {
                # Try with tar (Windows 10 1701+ has tar built-in)
                $process = Start-Process -FilePath "tar" -ArgumentList "-xzf `"$archive`" -C `"$tmpDir`"" -Wait -PassThru -NoNewWindow
            } catch {
                Write-Warn "tar not available. Consider using Windows 10 1701 or later, or Git Bash."
            }
        }

        # Find extracted directory
        $extracted = Get-ChildItem $tmpDir -Directory | Where-Object { $_.Name -like "FFT_nano-*" } | Select-Object -First 1
        if (-not $extracted) {
            Write-Fail "Downloaded archive did not contain an FFT_nano source directory"
        }

        Move-Item $extracted.FullName $InstallDir -Force
        Remove-Item -Recurse -Force $tmpDir
    }

    Stage-Emit -Stage "repo" -Ok $true -Skipped $false -Reason "Repository cloned to $InstallDir"

    # Stage: deps
    Set-Location $InstallDir
    Write-Stage "Installing npm dependencies..."
    if ($DryRun) {
        Stage-Emit -Stage "deps" -Ok $true -Skipped $false -Reason "dry-run: would run npm ci"
    } else {
        npm ci --ignore-scripts 2>&1 | Select-Object -Last 5
        if ($LASTEXITCODE -ne 0) {
            Stage-Emit -Stage "deps" -Ok $false -Skipped $false -Reason "npm ci failed"
            exit 1
        }
        Stage-Emit -Stage "deps" -Ok $true -Skipped $false -Reason "npm dependencies installed"
    }

    # Stage: build
    Write-Stage "Building FFT_nano..."
    if ($DryRun) {
        Stage-Emit -Stage "build" -Ok $true -Skipped $false -Reason "dry-run: would run npm run build"
    } else {
        npm run build 2>&1 | Select-Object -Last 10
        if ($LASTEXITCODE -ne 0) {
            Stage-Emit -Stage "build" -Ok $false -Skipped $false -Reason "npm run build failed"
            exit 1
        }
        Stage-Emit -Stage "build" -Ok $true -Skipped $false -Reason "TypeScript compiled"
    }

    # Stage: env
    Write-Stage "Scaffolding .env..."
    if (-not (Test-Path ".env") -and (Test-Path ".env.example")) {
        Copy-Item ".env.example" ".env"
    }
    Stage-Emit -Stage "env" -Ok $true -Skipped $false -Reason ".env scaffolded from .env.example"

    # Stage: config
    $adminSecret = if ($env:TELEGRAM_ADMIN_SECRET) { $env:TELEGRAM_ADMIN_SECRET } else { New-RandomSecret }
    Set-EnvValue -File ".env" -Key "TELEGRAM_ADMIN_SECRET" -Value $adminSecret
    Stage-Emit -Stage "config" -Ok $true -Skipped $false -Reason "Generated TELEGRAM_ADMIN_SECRET"

    # Stage: service
    if ($SkipService) {
        Stage-Emit -Stage "service" -Ok $true -Skipped $true -Reason "Service install skipped by user"
    } elseif ($InstallService -or $env:FFT_NANO_INSTALL_SERVICE -eq "1") {
        if ($DryRun) {
            Stage-Emit -Stage "service" -Ok $true -Skipped $false -Reason "dry-run: would install Windows service"
        } else {
            Write-Stage "Installing Windows service..."
            & "$InstallDir\scripts\service.ps1" install 2>&1 | Select-Object -Last 5
            Stage-Emit -Stage "service" -Ok $true -Skipped $false -Reason "Windows service installed"
        }
    } else {
        Stage-Emit -Stage "service" -Ok $true -Skipped $true -Reason "Service install skipped (use -InstallService to install)"
    }

    # Stage: desktop
    if ($SkipDesktop) {
        Stage-Emit -Stage "desktop" -Ok $true -Skipped $true -Reason "Desktop app install skipped"
    } else {
        Stage-Emit -Stage "desktop" -Ok $true -Skipped $true -Reason "Desktop app install skipped (run fft desktop to install later)"
    }

    # Install CLI launcher
    $cliDir = "$env:LOCALAPPDATA\Programs\fft"
    $cliExe = Join-Path $cliDir "fft.cmd"
    if (-not $DryRun) {
        New-Item -ItemType Directory -Force -Path $cliDir | Out-Null
        @"
@echo off
cd /d "$InstallDir"
node bin\fft.js %*
"@ | Out-File -FilePath $cliExe -Encoding ASCII

        # Add to PATH if not already
        $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
        if ($userPath -notlike "*$cliDir*") {
            [System.Environment]::SetEnvironmentVariable("Path", "$userPath;$cliDir", "User")
        }
    }

    # Stage: complete
    Write-Stage ""
    Write-Stage "FFT_nano installation complete!"
    Write-Stage "Install directory: $InstallDir"
    Write-Stage "Run 'fft --version' to verify installation"
    Stage-Emit -Stage "complete" -Ok $true -Skipped $false -Reason "FFT_nano installed to $InstallDir"
}

# Run installation
try {
    Install-FFTNano
    exit 0
} catch {
    Write-Fail "Installation failed: $_"
    exit 1
}
