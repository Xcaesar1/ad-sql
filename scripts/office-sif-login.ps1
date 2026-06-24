[CmdletBinding()]
param(
  [string]$AppDir = "E:\ad-sql",
  [string]$DataDir = "E:\ad-sql\data",
  [string]$ChromeChannel = "chrome"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $AppDir)) {
  throw "App directory not found: $AppDir"
}

$ChromeProfileDir = Join-Path $DataDir "chrome-profile"
New-Item -ItemType Directory -Force -Path $DataDir, $ChromeProfileDir | Out-Null

$env:DATA_DIR = $DataDir
$env:SIF_CHROME_PROFILE_DIR = $ChromeProfileDir
$env:SIF_CHROME_CHANNEL = $ChromeChannel

Set-Location -LiteralPath $AppDir

Write-Host "Opening dedicated SIF Chrome profile..."
Write-Host "Profile: $ChromeProfileDir"
Write-Host "Log in to SIF manually, then close Chrome or press Ctrl+C in this window."
npm run sif:login
