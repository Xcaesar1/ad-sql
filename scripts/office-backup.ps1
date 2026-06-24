[CmdletBinding()]
param(
  [string]$DataDir = "E:\ad-sql\data",
  [string]$BackupRoot = "E:\ad-sql-backups"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $DataDir)) {
  throw "Data directory not found: $DataDir"
}

$Stamp = Get-Date -Format "yyyy-MM-dd-HHmmss"
$TargetDir = Join-Path $BackupRoot $Stamp
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

$DbFiles = @("app.db", "app.db-wal", "app.db-shm")
foreach ($Name in $DbFiles) {
  $Source = Join-Path $DataDir $Name
  if (Test-Path -LiteralPath $Source) {
    Copy-Item -LiteralPath $Source -Destination (Join-Path $TargetDir $Name) -Force
  }
}

$UploadsDir = Join-Path $DataDir "uploads"
if (Test-Path -LiteralPath $UploadsDir) {
  Copy-Item -LiteralPath $UploadsDir -Destination (Join-Path $TargetDir "uploads") -Recurse -Force
}

$ManifestPath = Join-Path $TargetDir "backup-manifest.txt"
@(
  "CreatedAt=$((Get-Date).ToString('s'))",
  "SourceDataDir=$DataDir",
  "BackupDir=$TargetDir",
  "Included=app.db, app.db-wal, app.db-shm, uploads",
  "Excluded=chrome-profile, downloads, diagnostics, logs"
) | Set-Content -LiteralPath $ManifestPath -Encoding UTF8

Write-Host "Backup completed: $TargetDir"
