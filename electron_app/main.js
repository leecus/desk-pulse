"use strict";

const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell } = require("electron");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const APP_ROOT = __dirname;
const PROJECT_ROOT = path.resolve(APP_ROOT, "..");
const IS_WIN = process.platform === "win32";
const VENV_PYTHON = path.join(PROJECT_ROOT, ".venv", IS_WIN ? "Scripts" : "bin", IS_WIN ? "python.exe" : "python");
const FALLBACK_PYTHON = IS_WIN ? "python" : "python3";
const PYTHON = process.env.PYTHON || (fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : FALLBACK_PYTHON);
const SCRIPT = path.join(PROJECT_ROOT, "providers", "codex_usage_dashboard.py");
const DEFAULT_TARGET_DEVICE_NAME = "";
let targetDeviceName = process.env.DESK_PULSE_DEVICE || DEFAULT_TARGET_DEVICE_NAME;
const SHANGHAI_FORECAST_URL = "https://api.open-meteo.com/v1/forecast?latitude=31.2304&longitude=121.4737&current=temperature_2m,relative_humidity_2m,weather_code&forecast_days=1&timezone=Asia%2FShanghai";
const WEATHER_CODES = new Map([
  [0, "Clear"],
  [1, "Mainly clear"],
  [2, "Partly cloudy"],
  [3, "Cloudy"],
  [45, "Fog"],
  [48, "Rime fog"],
  [51, "Light drizzle"],
  [53, "Drizzle"],
  [55, "Heavy drizzle"],
  [61, "Light rain"],
  [63, "Rain"],
  [65, "Heavy rain"],
  [80, "Rain showers"],
  [81, "Showers"],
  [82, "Heavy showers"],
  [95, "Thunderstorm"],
]);

let mainWindow = null;
let tray = null;
let bluetoothSelection = null;
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

function createTrayIcon() {
  const image = nativeImage.createFromPath(path.join(APP_ROOT, "tray-icon.png"));
  image.setTemplateImage(true);
  return image;
}

function normalizeDeviceName(name) {
  return String(name || "").trim();
}

function targetDeviceLabel() {
  return targetDeviceName || "NRF_EPD*";
}

function matchesTargetDevice(name) {
  const candidate = normalizeDeviceName(name);
  if (!candidate) return false;
  if (targetDeviceName) return candidate === targetDeviceName;
  return candidate.startsWith("NRF_EPD");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 620,
    height: 760,
    show: false,
    title: "Desk Pulse",
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(APP_ROOT, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const { session } = mainWindow.webContents;
  session.setPermissionCheckHandler((_webContents, permission) => {
    return permission === "bluetooth" || permission === "bluetoothScanning";
  });
  session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "bluetooth" || permission === "bluetoothScanning");
  });
  if (session.setDevicePermissionHandler) {
    session.setDevicePermissionHandler(details => {
      const device = details.device || {};
      const name = device.name || device.deviceName || "";
      return details.deviceType === "bluetooth" && matchesTargetDevice(name);
    });
  }

  mainWindow.webContents.on("select-bluetooth-device", (event, deviceList, callback) => {
    event.preventDefault();
    const names = deviceList
      .map(device => device.deviceName)
      .filter(Boolean)
      .slice(0, 8);
    mainWindow.webContents.send(
      "client:bluetooth-status",
      names.length ? `扫描到: ${names.join(", ")}` : `正在扫描 ${targetDeviceLabel()}...`
    );

    const epd = deviceList.find(device => matchesTargetDevice(device.deviceName));
    if (epd) {
      if (bluetoothSelection?.timer) clearTimeout(bluetoothSelection.timer);
      bluetoothSelection = null;
      mainWindow.webContents.send("client:bluetooth-status", `已选择 ${epd.deviceName}`);
      callback(epd.deviceId);
      return;
    }

    if (bluetoothSelection?.timer) clearTimeout(bluetoothSelection.timer);
    bluetoothSelection = {
      callback,
      timer: setTimeout(() => {
        if (!bluetoothSelection) return;
        mainWindow.webContents.send("client:bluetooth-status", `扫描超时，未发现 ${targetDeviceLabel()}`);
        bluetoothSelection.callback("");
        bluetoothSelection = null;
      }, 15000),
    };
  });

  mainWindow.loadFile(path.join(APP_ROOT, "index.html"));
  mainWindow.on("close", event => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("minimize", event => {
    event.preventDefault();
    mainWindow.hide();
  });
}

function buildMenu() {
  const menu = Menu.buildFromTemplate([
    { label: "Show Desk Pulse", click: () => showWindow() },
    { label: "Refresh Now", click: () => mainWindow?.webContents.send("client:refresh-now") },
    { type: "separator" },
    {
      label: "Open Project",
      click: () => shell.openPath(PROJECT_ROOT),
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function showWindow() {
  if (!mainWindow) createWindow();
  mainWindow.show();
  mainWindow.focus();
}

function execPython(args) {
  return new Promise((resolve, reject) => {
    execFile(PYTHON, [SCRIPT, ...args], { cwd: PROJECT_ROOT }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || stdout || error.message).trim()));
        return;
      }
      resolve(stdout);
    });
  });
}

function parseLimitsUrlOutput(stdout) {
  const lines = stdout.trim().split(/\r?\n/);
  const urlLine = lines.find(line => line.startsWith("file://"));
  if (!urlLine) throw new Error(`Could not parse limits URL output:\n${stdout}`);
  const parsed = new URL(urlLine);
  const params = parsed.searchParams;
  return {
    codex5hLeft: params.get("codex5hLeft") || "",
    codex5hReset: params.get("codex5hReset") || "",
    codexWeeklyLeft: params.get("codexWeeklyLeft") || "",
    codexWeeklyReset: params.get("codexWeeklyReset") || "",
    latestSampleLabel: (lines.find(line => line.startsWith("Latest sample:")) || "").replace("Latest sample:", "").trim(),
    signature: [
      params.get("codex5hLeft") || "",
      params.get("codex5hReset") || "",
      params.get("codexWeeklyLeft") || "",
      params.get("codexWeeklyReset") || "",
    ].join("|"),
  };
}

ipcMain.handle("usage:get-limits", async () => {
  const stdout = await execPython(["--limits-url"]);
  return parseLimitsUrlOutput(stdout);
});

ipcMain.handle("usage:get-weather", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(SHANGHAI_FORECAST_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`Weather HTTP ${response.status}`);
    const payload = await response.json();
    const current = payload.current || {};
    const temp = Math.round(current.temperature_2m);
    const humidity = Math.round(current.relative_humidity_2m);
    const label = WEATHER_CODES.get(current.weather_code) || "Weather";
    if (Number.isNaN(temp)) throw new Error("Weather payload missing temperature");
    return {
      text: `Shanghai ${temp}C ${label}${Number.isNaN(humidity) ? "" : ` RH ${humidity}%`}`,
      updatedAt: current.time || "",
    };
  } finally {
    clearTimeout(timer);
  }
});

ipcMain.handle("app:get-target-device", () => targetDeviceName);

ipcMain.handle("app:set-target-device", (_event, deviceName) => {
  targetDeviceName = normalizeDeviceName(deviceName);
  return targetDeviceName;
});

ipcMain.handle("app:hide", () => {
  mainWindow?.hide();
});

ipcMain.handle("app:show", () => {
  showWindow();
});

if (gotSingleInstanceLock) {
  app.on("second-instance", () => showWindow());

  app.whenReady().then(() => {
    app.setName("Desk Pulse");
    if (app.dock) app.dock.hide();
    tray = new Tray(createTrayIcon());
    tray.setToolTip("Desk Pulse");
    tray.on("click", () => showWindow());
    buildMenu();
    createWindow();
    showWindow();
  });

  app.on("window-all-closed", event => {
    event.preventDefault();
  });
}
