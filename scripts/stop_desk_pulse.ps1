param()

$ErrorActionPreference = "Stop"
$ROOT_DIR = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$APP_DIR = Join-Path $ROOT_DIR "electron_app"
$RUN_DIR = Join-Path $ROOT_DIR ".run"
$PID_FILE = Join-Path $RUN_DIR "desk_pulse.pid"

$stopped = $false

if (Test-Path $PID_FILE) {
    $pid = Get-Content $PID_FILE -Raw | ForEach-Object { $_.Trim() }
    if ($pid) {
        $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($process) {
            $process.CloseMainWindow() | Out-Null
            if (-not $process.HasExited) {
                Start-Sleep -Milliseconds 200
                for ($i = 0; $i -lt 20; $i++) {
                    if ($process.HasExited) { break }
                    Start-Sleep -Milliseconds 200
                }
            }
            if (-not $process.HasExited) {
                $process | Stop-Process -Force
            }
            $stopped = $true
        }
    }
}

$remaining = Get-Process | Where-Object { $_.CommandLine -like "*$APP_DIR*" }
if ($remaining) {
    $remaining | Stop-Process -Force -ErrorAction SilentlyContinue
    $stopped = $true
}

Remove-Item $PID_FILE -Force -ErrorAction SilentlyContinue

if ($stopped) {
    Write-Host "Desk Pulse stopped."
} else {
    Write-Host "Desk Pulse is not running."
}
