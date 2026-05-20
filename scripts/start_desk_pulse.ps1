param()

$ErrorActionPreference = "Stop"
$ROOT_DIR = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$APP_DIR = Join-Path $ROOT_DIR "electron_app"
$RUN_DIR = Join-Path $ROOT_DIR ".run"
$PID_FILE = Join-Path $RUN_DIR "desk_pulse.pid"
$LOG_FILE = Join-Path $RUN_DIR "desk_pulse.log"
$ELECTRON_BIN = Join-Path $ROOT_DIR "node_modules" ".bin" "electron.cmd"

New-Item -ItemType Directory -Force -Path $RUN_DIR | Out-Null

if (Test-Path $PID_FILE) {
    $old_pid = Get-Content $PID_FILE -Raw | ForEach-Object { $_.Trim() }
    if ($old_pid -and (Get-Process -Id $old_pid -ErrorAction SilentlyContinue)) {
        Write-Host "Desk Pulse is already running. PID: $old_pid"
        Write-Host "Log: $LOG_FILE"
        exit 0
    }
    Remove-Item $PID_FILE -Force -ErrorAction SilentlyContinue
}

$running = Get-Process | Where-Object { $_.CommandLine -like "*$APP_DIR*" } | Select-Object -First 1
if ($running) {
    Write-Host "Desk Pulse is already running. PID file was missing."
    $running.Id | Out-File -FilePath $PID_FILE -Encoding ASCII
    Write-Host "PID: $(Get-Content $PID_FILE -Raw | ForEach-Object { $_.Trim() })"
    Write-Host "Log: $LOG_FILE"
    exit 0
}

if (-not (Test-Path $ELECTRON_BIN)) {
    Write-Host "Electron is not installed. Run this first:"
    Write-Host "  cd ""$ROOT_DIR"" && npm install"
    exit 1
}

$process = Start-Process -FilePath $ELECTRON_BIN -ArgumentList "`"$APP_DIR`"" -NoNewWindow -PassThru -RedirectStandardOutput $LOG_FILE -RedirectStandardError $LOG_FILE
$process.Id | Out-File -FilePath $PID_FILE -Encoding ASCII

Write-Host "Desk Pulse started. PID: $($process.Id)"
Write-Host "Log: $LOG_FILE"
