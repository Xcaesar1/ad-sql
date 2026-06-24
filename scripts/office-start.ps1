[CmdletBinding()]
param(
  [string]$AppDir = "E:\ad-sql",
  [string]$DataDir = "E:\ad-sql\data",
  [string]$ListenHost = "0.0.0.0",
  [int]$Port = 5173,
  [string]$ChromeChannel = "chrome"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $AppDir)) {
  throw "App directory not found: $AppDir"
}

$LogDir = Join-Path $AppDir "logs"
$ChromeProfileDir = Join-Path $DataDir "chrome-profile"

New-Item -ItemType Directory -Force -Path $DataDir, $ChromeProfileDir, $LogDir | Out-Null

$env:NODE_ENV = "production"
$env:HOST = $ListenHost
$env:PORT = [string]$Port
$env:DATA_DIR = $DataDir
$env:SIF_CHROME_PROFILE_DIR = $ChromeProfileDir
$env:SIF_CHROME_CHANNEL = $ChromeChannel

Set-Location -LiteralPath $AppDir

$LogPath = Join-Path $LogDir ("server-{0}.log" -f (Get-Date -Format "yyyyMMdd"))
$TranscriptStarted = $false
try {
  Start-Transcript -Path $LogPath -Append | Out-Null
  $TranscriptStarted = $true
}
catch {
  Write-Warning "Transcript logging is unavailable in this PowerShell host. Continuing without transcript log."
}

try {
  Write-Host "Starting SIF ASIN dashboard..."
  Write-Host "AppDir: $AppDir"
  Write-Host "DataDir: $DataDir"
  Write-Host "ChromeProfileDir: $ChromeProfileDir"
  Write-Host "URL: http://$ListenHost`:$Port"
  npm run start
}
finally {
  if ($TranscriptStarted) {
    Stop-Transcript | Out-Null
  }
}
