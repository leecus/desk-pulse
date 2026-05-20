param()

$ErrorActionPreference = "Stop"
$ROOT_DIR = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$APP_DIR = Join-Path $ROOT_DIR "electron_app"
$RUN_DIR = Join-Path $ROOT_DIR ".run"
$PID_FILE = Join-Path $RUN_DIR "desk_pulse.pid"
$LOG_FILE = Join-Path $RUN_DIR "desk_pulse.log"

$pid = $null
if (Test-Path $PID_FILE) {
    $pid = Get-Content $PID_FILE -Raw | ForEach-Object { $_.Trim() }
}

if ($pid -and (Get-Process -Id $pid -ErrorAction SilentlyContinue)) {
    Write-Host "Desk Pulse is running. PID: $pid"
    Write-Host "Log: $LOG_FILE"
} elseif ($running = Get-Process | Where-Object { $_.CommandLine -like "*$APP_DIR*" } | Select-Object -First 1) {
    Write-Host "Desk Pulse is running. PID file is missing or stale."
    Write-Host "PID: $($running.Id)"
    Write-Host "Log: $LOG_FILE"
} else {
    Write-Host "Desk Pulse is not running."
    Write-Host "Log: $LOG_FILE"
}
