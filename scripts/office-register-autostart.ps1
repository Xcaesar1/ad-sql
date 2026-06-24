[CmdletBinding()]
param(
  [string]$AppDir = "E:\ad-sql",
  [string]$DataDir = "E:\ad-sql\data",
  [string]$ListenHost = "0.0.0.0",
  [int]$Port = 5173,
  [string]$TaskName = "SIF ASIN Dashboard",
  [switch]$RunNow
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $AppDir)) {
  throw "App directory not found: $AppDir"
}

$StartScript = Join-Path $AppDir "scripts\office-start.ps1"
if (-not (Test-Path -LiteralPath $StartScript)) {
  throw "Start script not found: $StartScript"
}

$PowerShellExe = (Get-Command pwsh -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)
if (-not $PowerShellExe) {
  $PowerShellExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
}

$TaskUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$Arguments = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", "`"$StartScript`"",
  "-AppDir", "`"$AppDir`"",
  "-DataDir", "`"$DataDir`"",
  "-ListenHost", "`"$ListenHost`"",
  "-Port", $Port
) -join " "

$Action = New-ScheduledTaskAction -Execute $PowerShellExe -Argument $Arguments -WorkingDirectory $AppDir
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $TaskUser
$Principal = New-ScheduledTaskPrincipal -UserId $TaskUser -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Principal $Principal `
  -Settings $Settings `
  -Description "Start SIF ASIN dashboard from $AppDir when $TaskUser logs on." `
  -Force | Out-Null

Write-Host "Registered scheduled task: $TaskName"
Write-Host "Trigger: user logon ($TaskUser)"
Write-Host "Command: $PowerShellExe $Arguments"

if ($RunNow) {
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "Started scheduled task: $TaskName"
}
