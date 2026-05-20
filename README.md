# Desk Pulse

Terminal-style desk dashboard for small e-paper displays.

Desk Pulse is an Electron + Web Bluetooth client that renders a 400x300 black/red/white dashboard and pushes it to EPD-nRF5 compatible displays. It was built around the NRF_EPD 4.2-inch three-color firmware path, with the device name configurable in the app.

## Features

- Menu bar Electron app (cross-platform: macOS / Windows / Linux)
- Web Bluetooth image transfer
- Terminal/ASCII inspired e-paper layout
- Bitmap ASCII font with Chinese fallback rendering
- Codex usage provider from local `~/.codex` logs
- Shanghai weather via Open-Meteo
- Local TODO text stored in `localStorage`
- Smart refresh: push only when dashboard content changes
- Configurable BLE device name, work window, refresh interval, weather, TODO, and battery label

## Hardware

Tested with:

- EPD-nRF5 compatible BLE firmware
- 4.2-inch black/red/white panel
- Firmware version `0x19`

The BLE device name is configurable. Leave it blank to scan `NRF_EPD*`, or set an exact name such as `NRF_EPD_A4A2`.

## Install

```bash
npm install
python3 -m venv .venv
.venv/bin/pip install -r providers/requirements.txt
```

On Windows:
```powershell
npm install
python -m venv .venv
.venv\Scripts\pip install -r providers\requirements.txt
```

## Run

```bash
npm start
```

Or run in the background:

```bash
# macOS / Linux
node scripts/run.js start
node scripts/run.js status
node scripts/run.js stop
```

Or directly:
```bash
scripts/start_desk_pulse.sh    # Unix
scripts/status_desk_pulse.sh
scripts/stop_desk_pulse.sh
```

```powershell
# Windows
scripts\start_desk_pulse.ps1
scripts\status_desk_pulse.ps1
scripts\stop_desk_pulse.ps1
```

## Configuration

Open the app and set:

- `BLE 设备`: exact BLE name, or blank for `NRF_EPD*`
- work start/end hour
- refresh interval
- weather text
- TODO text
- battery label
- smart refresh / weekend skip toggles

You can also set the initial BLE target via:

```bash
# macOS / Linux
DESK_PULSE_DEVICE=NRF_EPD_A4A2 npm start
```

```powershell
# Windows
$env:DESK_PULSE_DEVICE="NRF_EPD_A4A2"; npm start
```

## Privacy

- Codex usage is read from local Codex logs.
- TODO and app settings are stored locally in Electron `localStorage`.
- Weather is fetched from Open-Meteo.
- No telemetry is sent by Desk Pulse.
- Dashboard images are sent only to the selected BLE e-paper device.

## Notes

This project intentionally uses Chromium Web Bluetooth for the device transfer path. Direct Python/Node BLE writes may appear to send all bytes but can leave some panels in a gray intermediate state.

## Credits

The e-paper image conversion logic is adapted from the EPD-nRF5 web tooling. See comments in `lib/dithering.js`.
