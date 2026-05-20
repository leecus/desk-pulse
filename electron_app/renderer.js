"use strict";

let bleDevice = null;
let gattServer = null;
let epdCharacteristic = null;
let notificationCharacteristic = null;
let msgIndex = 0;
let startTime = 0;
let autoRefreshTimer = null;
let authorizationInFlight = false;
let refreshInFlight = false;
let lastSentSignature = localStorage.getItem("codexEpdLastSignature") || "";
let latestSampleLabel = "";

const SERVICE_UUID = "62750001-d828-918d-fb46-b6c11c675aec";
const CHAR_UUID = "62750002-d828-918d-fb46-b6c11c675aec";
const VERSION_CHAR_UUID = "62750003-d828-918d-fb46-b6c11c675aec";
const DEFAULT_TARGET_DEVICE_NAME = "";
let targetDeviceName = DEFAULT_TARGET_DEVICE_NAME;
const REFRESH_SETTLE_MS = 90000;
const CONNECT_RETRY_COUNT = 3;
const CONNECT_RETRY_DELAY_MS = 8000;

const EpdCmd = {
  INIT: 0x01,
  WRITE_IMG: 0x30,
  REFRESH: 0x05,
};

const GEEK_TAGLINES = [
  "NO NEWS == GOOD NEWS",
  "PUSH_ON_CHANGE=1",
  "DIRTY BIT DRIVES BLE",
  "DIFF ONLY. SLEEP MORE.",
  "IF SAME: NO-OP",
  "WAKE FETCH RENDER PUSH SLEEP",
  "CRON TICKS. BLE WAITS.",
  "O(1) PUSHES PER CHANGE",
  "SCREEN UPDATED IF DIRTY",
  "CHANGE TRIGGERS TX",
  "NO DIFF, NO DRAMA",
  "IDLE IS A FEATURE",
  "BLE PUSH ON DELTA",
  "SHIP DELTAS, NOT NOISE",
];

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

const FONT_5X7 = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "\"": ["01010", "01010", "01010", "00000", "00000", "00000", "00000"],
  "#": ["01010", "01010", "11111", "01010", "11111", "01010", "01010"],
  "%": ["11001", "11010", "00100", "01000", "10110", "00110", "00000"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "*": ["00000", "10101", "01110", "11111", "01110", "10101", "00000"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  ",": ["00000", "00000", "00000", "00000", "00100", "00100", "01000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "00100", "00100"],
  "/": ["00001", "00010", "00100", "01000", "10000", "00000", "00000"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  ":": ["00000", "00100", "00100", "00000", "00100", "00100", "00000"],
  ";": ["00000", "00100", "00100", "00000", "00100", "00100", "01000"],
  "<": ["00010", "00100", "01000", "10000", "01000", "00100", "00010"],
  "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
  ">": ["01000", "00100", "00010", "00001", "00010", "00100", "01000"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
  "[": ["01110", "01000", "01000", "01000", "01000", "01000", "01110"],
  "]": ["01110", "00010", "00010", "00010", "00010", "00010", "01110"],
  "_": ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
  "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  "G": ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
  "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  "I": ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  "J": ["00001", "00001", "00001", "00001", "10001", "10001", "01110"],
  "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
};

function addLog(text, action = "") {
  const log = document.getElementById("log");
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")} `;
  const line = document.createElement("div");
  line.innerHTML = `<span class="time">${time}</span>${action ? `<span class="action">${action}</span>` : ""}${text}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function setStatus(text) {
  document.getElementById("status").textContent = text;
}

function bytes2hex(data) {
  return new Uint8Array(data).reduce((memo, i) => memo + (`0${i.toString(16)}`).slice(-2), "");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function write(cmd, data, withResponse = true) {
  if (!epdCharacteristic) {
    addLog("服务不可用，请先连接");
    return false;
  }
  const payload = [cmd];
  if (data) payload.push(...Array.from(data));
  addLog(bytes2hex(payload), "⇑");
  const bytes = Uint8Array.from(payload);
  if (withResponse) await epdCharacteristic.writeValueWithResponse(bytes);
  else await epdCharacteristic.writeValueWithoutResponse(bytes);
  return true;
}

async function writeImage(data, step = "bw") {
  const chunkSize = parseInt(document.getElementById("mtusize").value, 10) - 2;
  const interleavedCount = parseInt(document.getElementById("interleavedcount").value, 10);
  let noReplyCount = interleavedCount;
  let chunkIdx = 0;

  for (let i = 0; i < data.length; i += chunkSize) {
    const payload = [
      (step === "bw" ? 0x0f : 0x00) | (i === 0 ? 0x00 : 0xf0),
      ...data.slice(i, i + chunkSize),
    ];
    if (noReplyCount > 0) {
      await write(EpdCmd.WRITE_IMG, payload, false);
      noReplyCount--;
    } else {
      await write(EpdCmd.WRITE_IMG, payload, true);
      noReplyCount = interleavedCount;
    }
    chunkIdx++;
    if (chunkIdx % 20 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      setStatus(`${step} ${chunkIdx} chunks, ${elapsed}s`);
    }
  }
}

function handleNotification(event) {
  const data = new Uint8Array(event.target.value.buffer, event.target.value.byteOffset, event.target.value.byteLength);
  if (msgIndex === 0) {
    addLog(`收到配置：${bytes2hex(data)}`);
    msgIndex++;
    return;
  }
  msgIndex++;
  try {
    const msg = new TextDecoder().decode(data);
    addLog(msg, "⇓");
    if (msg.startsWith("mtu=")) document.getElementById("mtusize").value = parseInt(msg.slice(4), 10);
  } catch (_err) {
    addLog(bytes2hex(data), "⇓");
  }
}

function bindDevice(device) {
  if (bleDevice === device) return;
  bleDevice = device;
  bleDevice.addEventListener("gattserverdisconnected", () => {
    epdCharacteristic = null;
    gattServer = null;
    notificationCharacteristic = null;
    setStatus(`已授权 ${bleDevice?.name || "EPD"}，空闲`);
    addLog("已断开连接");
  });
}

function disconnectDevice(logText) {
  if (bleDevice?.gatt?.connected) bleDevice.gatt.disconnect();
  epdCharacteristic = null;
  gattServer = null;
  notificationCharacteristic = null;
  if (logText) addLog(logText);
  setStatus(bleDevice ? `已授权 ${bleDevice.name || "EPD"}，空闲` : "未授权");
}

function shouldKeepConnectionAlive() {
  return Boolean(autoRefreshTimer);
}

function releaseConnection(disconnectLog, keepAliveLog) {
  if (shouldKeepConnectionAlive() && bleDevice?.gatt?.connected) {
    setStatus(`已连接 ${bleDevice.name || "EPD"}，自动待机`);
    if (keepAliveLog) addLog(keepAliveLog);
    return;
  }
  disconnectDevice(disconnectLog);
}

function clearGattState() {
  epdCharacteristic = null;
  gattServer = null;
  notificationCharacteristic = null;
}

function normalizeDeviceName(name) {
  return String(name || "").trim();
}

function getConfiguredDeviceName() {
  return normalizeDeviceName(document.getElementById("targetDeviceName").value);
}

function targetDeviceLabel() {
  return targetDeviceName || "NRF_EPD*";
}

function matchesConfiguredDevice(name) {
  const candidate = normalizeDeviceName(name);
  if (!candidate) return false;
  if (targetDeviceName) return candidate === targetDeviceName;
  return candidate.startsWith("NRF_EPD");
}

function bluetoothRequestFilters() {
  if (targetDeviceName) {
    return [
      { name: targetDeviceName },
      { services: [SERVICE_UUID] },
    ];
  }
  return [
    { namePrefix: "NRF_EPD" },
    { services: [SERVICE_UUID] },
  ];
}

async function syncTargetDeviceName() {
  const nextName = getConfiguredDeviceName();
  const changed = nextName !== targetDeviceName;
  targetDeviceName = nextName;
  await window.codexEpd.setTargetDevice(targetDeviceName);
  if (changed && bleDevice && !matchesConfiguredDevice(bleDevice.name)) {
    disconnectDevice("设备目标已变更，已断开旧设备");
    bleDevice = null;
    setStatus("未授权");
  }
  return targetDeviceName;
}

async function restoreAuthorizedDevice() {
  await syncTargetDeviceName();
  if (!navigator.bluetooth.getDevices) return false;
  const devices = await navigator.bluetooth.getDevices();
  const device = devices.find(item => matchesConfiguredDevice(item.name));
  if (!device) return false;
  bindDevice(device);
  setStatus(`已授权 ${device.name || "EPD"}，空闲`);
  addLog(`已恢复授权设备: ${device.name || "EPD"}`);
  return true;
}

async function connectGattOnce() {
  if (!bleDevice) throw new Error("未授权设备，请先点“授权设备”");
  if (!matchesConfiguredDevice(bleDevice.name)) {
    throw new Error(`已授权设备 ${bleDevice.name || "EPD"} 不匹配目标 ${targetDeviceLabel()}`);
  }
  if (epdCharacteristic && bleDevice.gatt.connected) return;
  addLog(`正在连接: ${bleDevice.name || "EPD"}`);
  gattServer = await bleDevice.gatt.connect();
  const service = await gattServer.getPrimaryService(SERVICE_UUID);
  epdCharacteristic = await service.getCharacteristic(CHAR_UUID);
  try {
    const versionCharacteristic = await service.getCharacteristic(VERSION_CHAR_UUID);
    const versionData = await versionCharacteristic.readValue();
    addLog(`固件版本: 0x${versionData.getUint8(0).toString(16)}`);
  } catch (_err) {
    addLog("未读取到固件版本");
  }
  msgIndex = 0;
  await epdCharacteristic.startNotifications();
  if (notificationCharacteristic !== epdCharacteristic) {
    epdCharacteristic.addEventListener("characteristicvaluechanged", handleNotification);
    notificationCharacteristic = epdCharacteristic;
  }
  setStatus(`已连接 ${bleDevice.name || "EPD"}`);
}

async function connectGatt(options = {}) {
  const retries = Math.max(1, options.retries || 1);
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await connectGattOnce();
      return;
    } catch (err) {
      clearGattState();
      if (attempt >= retries) throw err;
      addLog(`连接失败，${Math.round(CONNECT_RETRY_DELAY_MS / 1000)}s 后重试 ${attempt + 1}/${retries}: ${err.message}`);
      await sleep(CONNECT_RETRY_DELAY_MS);
      await restoreAuthorizedDevice();
    }
  }
}

async function authorizeDevice() {
  if (refreshInFlight) {
    addLog("屏幕刷新保护中，暂不授权");
    return;
  }
  if (authorizationInFlight) {
    addLog("授权检查已在进行");
    return;
  }
  authorizationInFlight = true;
  try {
    await syncTargetDeviceName();
    const device = await navigator.bluetooth.requestDevice({
      filters: bluetoothRequestFilters(),
      optionalServices: [SERVICE_UUID],
    });
    bindDevice(device);
    addLog(`已授权: ${device.name || "EPD"}`);
    await connectGatt();
    await sleep(300);
    releaseConnection("授权检查完成，已断开", "授权检查完成，保持蓝牙连接");
  } finally {
    authorizationInFlight = false;
  }
}

function readPercentInput(id, fallback) {
  const value = parseFloat(document.getElementById(id).value);
  if (Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(100, value));
}

function formatNumber(n) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function daySeed(date) {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

function getDailyTagline(date) {
  return GEEK_TAGLINES[daySeed(date) % GEEK_TAGLINES.length];
}

function getPixelGlyph(char) {
  const upper = String(char || " ").toUpperCase();
  return FONT_5X7[upper] || null;
}

function fallbackFontSize(scale) {
  return Math.max(9, scale === 1 ? 11 : 15);
}

function setFallbackFont(scale) {
  ctx.font = `${fallbackFontSize(scale)}px "PingFang SC", "Hiragino Sans GB", "Heiti SC", sans-serif`;
  ctx.textBaseline = "top";
}

function pixelTextWidth(text, scale = 1) {
  let width = 0;
  for (const char of String(text || "")) {
    if (getPixelGlyph(char)) {
      width += 6 * scale;
    } else {
      setFallbackFont(scale);
      width += Math.ceil(ctx.measureText(char).width) + scale;
    }
  }
  return width;
}

function drawPixelText(text, x, y, scale = 1, color = "#000") {
  let cursorX = x;
  ctx.fillStyle = color;
  for (const char of String(text || "")) {
    const glyph = getPixelGlyph(char);
    if (!glyph) {
      setFallbackFont(scale);
      ctx.fillStyle = color;
      ctx.fillText(char, cursorX, y - (scale === 1 ? 2 : 1));
      cursorX += Math.ceil(ctx.measureText(char).width) + scale;
      continue;
    }
    for (let row = 0; row < glyph.length; row++) {
      for (let col = 0; col < glyph[row].length; col++) {
        if (glyph[row][col] === "1") {
          ctx.fillRect(cursorX + col * scale, y + row * scale, scale, scale);
        }
      }
    }
    cursorX += 6 * scale;
  }
  return cursorX - x;
}

function getIsoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function getWeekdayLabel(date) {
  return ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][date.getDay()];
}

function getWeekendLabel(date) {
  const day = date.getDay();
  if (day === 0 || day === 6) return "WEEKEND NOW";
  return `WEEKEND IN ${6 - day}D`;
}

function drawStatusCell(x, y, w, label, value, red = false) {
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, 34);
  drawPixelText(label, x + 6, y + 7, 1, "#000");
  drawPixelText(value || "--", x + 6, y + 20, 1, red ? "#f00" : "#000");
}

function drawBattery(x, y, label) {
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, 48, 20);
  ctx.fillStyle = "#000";
  ctx.fillRect(x + 48, y + 6, 4, 8);
  const match = (label || "").match(/(\d{1,3})/);
  let display = "--%";
  if (match) {
    const pct = Math.max(0, Math.min(100, parseInt(match[1], 10)));
    display = `${pct}%`;
    ctx.fillStyle = pct <= 20 ? "#f00" : "#000";
    ctx.fillRect(x + 3, y + 3, Math.round(42 * pct / 100), 14);
  }
  drawPixelText(display, x - 32, y + 7, 1, "#000");
}

function drawTitleTag(x, y, text) {
  const w = 54;
  const h = 20;
  ctx.fillStyle = "#fff";
  ctx.fillRect(x + 4, y + 3, w, h);
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 4, y + 3, w, h);

  ctx.fillStyle = "#f00";
  ctx.beginPath();
  ctx.arc(x + 12, y + 13, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x + w - 8, y + 6, 2, h - 6);
  ctx.fillRect(x + w - 4, y + 6, 2, h - 6);

  drawPixelText(text, x + 20, y + 10, 1, "#000");
}

function drawWrappedText(text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text || "").split(/(\s+)/).filter(Boolean);
  const lines = [];
  let line = "";
  for (let word of words) {
    if (/^\s+$/.test(word)) {
      if (line && !line.endsWith(" ")) line += " ";
      continue;
    }
    const test = line ? `${line} ${word}` : word;
    if (pixelTextWidth(test, 2) <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = "";
      for (const char of word) {
        const charTest = line ? `${line}${char}` : char;
        if (pixelTextWidth(charTest, 2) <= maxWidth) {
          line = charTest;
        } else {
          if (line) lines.push(line);
          line = char;
        }
        if (lines.length >= maxLines) break;
      }
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  lines.forEach((item, index) => drawPixelText(item, x, y + index * lineHeight, 2, "#000"));
  return lines.length;
}

function getTodoLines() {
  return document.getElementById("todoText").value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function truncateMixedText(text, maxWidth, scale = 1) {
  let result = "";
  for (const char of String(text || "")) {
    const next = `${result}${char}`;
    if (pixelTextWidth(next, scale) > maxWidth) break;
    result = next;
  }
  return result;
}

function drawLimitTextRow(y, label, leftPct, resetText) {
  const clamped = Math.max(0, Math.min(100, leftPct));
  const barX = 146;
  const barY = y - 12;
  const segmentW = 5;
  const segmentGap = 1;
  const segmentH = 11;
  const totalSegments = 20;
  const filledSegments = Math.round(totalSegments * clamped / 100);

  drawPixelText(`${label}:`, 32, y - 10, 1, "#000");
  drawPixelText("[", barX - 10, y - 10, 1, "#000");
  drawPixelText("]", barX + totalSegments * (segmentW + segmentGap) + 2, y - 10, 1, "#000");

  for (let i = 0; i < totalSegments; i++) {
    const x = barX + i * (segmentW + segmentGap);
    if (i < filledSegments) {
      ctx.fillStyle = "#000";
      ctx.fillRect(x, barY, segmentW, segmentH);
    } else {
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, barY, segmentW, segmentH);
    }
  }

  drawPixelText(`${Math.round(clamped)}% left`, 286, y - 10, 1, "#f00");
  drawPixelText(resetText ? `resets ${resetText}` : "resets --", 286, y + 4, 1, "#000");
}

function renderDashboard() {
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawPixelText("DESK PULSE", 18, 14, 2, "#000");
  drawTitleTag(152, 11, "LIVE");
  const now = new Date();
  drawPixelText(now.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }), 222, 17, 1, "#000");
  drawBattery(340, 10, document.getElementById("batteryText").value.trim());
  ctx.fillStyle = "#f00";
  ctx.fillRect(18, 38, 364, 4);
  drawPixelText(`WEEK ${getIsoWeek(now)} ${getWeekdayLabel(now)}`, 18, 48, 1, "#000");
  drawPixelText(getWeekendLabel(now), 286, 48, 1, "#f00");

  const fiveHourLeft = readPercentInput("codex5hLeft", 84);
  const weeklyLeft = readPercentInput("codexWeeklyLeft", 98);
  const fiveHourReset = document.getElementById("codex5hReset").value.trim();
  const weeklyReset = document.getElementById("codexWeeklyReset").value.trim();

  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 58, 174, 86);
  ctx.strokeRect(208, 58, 174, 86);
  drawPixelText("SHANGHAI WEATHER", 28, 72, 1, "#000");
  drawPixelText("TODO", 218, 72, 1, "#000");
  ctx.fillStyle = "#f00";
  ctx.fillRect(28, 84, 64, 3);
  ctx.fillRect(218, 84, 32, 3);
  drawWrappedText(document.getElementById("weatherText").value.trim() || "Shanghai --", 28, 98, 144, 18, 2);
  const todoLines = getTodoLines();
  if (todoLines.length === 0) {
    drawPixelText("No tasks", 218, 108, 2, "#f00");
  } else {
    todoLines.forEach((line, index) => {
      const y = 106 + index * 15;
      ctx.fillStyle = index === 0 ? "#f00" : "#000";
      ctx.fillRect(218, y - 6, 4, 4);
      drawPixelText(truncateMixedText(line, 136, 1), 228, y - 6, 1, index === 0 ? "#f00" : "#000");
    });
    ctx.fillStyle = "#000";
  }

  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 154, 364, 74);
  drawLimitTextRow(176, "5h limit", fiveHourLeft, fiveHourReset);
  drawLimitTextRow(208, "Weekly limit", weeklyLeft, weeklyReset);

  const tokenUsed = parseInt(document.getElementById("codexTokenUsed").value, 10);
  const tokenLabel = !Number.isNaN(tokenUsed) && tokenUsed > 0 ? formatNumber(tokenUsed) : "--";
  const interval = parseInt(document.getElementById("autoRefreshInterval").value, 10);
  const intervalLabel = interval >= 3600 ? `${(interval / 3600).toFixed(1)}h` : `${Math.round(interval / 60)}m`;
  const sample = latestSampleLabel ? latestSampleLabel.slice(5, 16) : now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  drawStatusCell(18, 238, 86, "last turn", tokenLabel);
  drawStatusCell(112, 238, 86, "sample", sample);
  drawStatusCell(206, 238, 80, "check", intervalLabel);
  drawStatusCell(294, 238, 88, "auto", autoRefreshTimer ? "ON" : "OFF", Boolean(autoRefreshTimer));

  const workStart = String(document.getElementById("workStartHour").value || "9").padStart(2, "0");
  const workEnd = String(document.getElementById("workEndHour").value || "18").padStart(2, "0");
  const footer = `WORK ${workStart}:00-${workEnd}:00  ${getDailyTagline(now)}`;
  const deviceText = truncateMixedText(`DEV ${targetDeviceLabel()}`, 112, 1);
  const deviceX = 382 - pixelTextWidth(deviceText, 1);
  drawPixelText(truncateMixedText(footer, Math.max(120, deviceX - 28), 1), 18, 283, 1, "#000");
  drawPixelText(deviceText, deviceX, 283, 1, "#f00");
}

function loadSettings() {
  const pairs = [
    ["targetDeviceName", "deskPulseTargetDevice"],
    ["autoRefreshInterval", "codexEpdInterval"],
    ["workStartHour", "codexEpdWorkStart"],
    ["workEndHour", "codexEpdWorkEnd"],
    ["weatherText", "codexEpdWeather"],
    ["batteryText", "codexEpdBattery"],
    ["todoText", "codexEpdTodo"],
  ];
  pairs.forEach(([id, key]) => {
    const saved = localStorage.getItem(key);
    if (saved !== null) document.getElementById(id).value = saved;
  });
  const skipWeekends = localStorage.getItem("codexEpdSkipWeekends");
  if (skipWeekends !== null) document.getElementById("skipWeekends").checked = skipWeekends === "true";
  const smartRefresh = localStorage.getItem("codexEpdSmartRefresh");
  if (smartRefresh !== null) document.getElementById("smartRefreshEnabled").checked = smartRefresh === "true";
}

function saveSettings() {
  localStorage.setItem("deskPulseTargetDevice", document.getElementById("targetDeviceName").value);
  localStorage.setItem("codexEpdInterval", document.getElementById("autoRefreshInterval").value);
  localStorage.setItem("codexEpdWorkStart", document.getElementById("workStartHour").value);
  localStorage.setItem("codexEpdWorkEnd", document.getElementById("workEndHour").value);
  localStorage.setItem("codexEpdWeather", document.getElementById("weatherText").value);
  localStorage.setItem("codexEpdBattery", document.getElementById("batteryText").value);
  localStorage.setItem("codexEpdTodo", document.getElementById("todoText").value);
  localStorage.setItem("codexEpdSkipWeekends", String(document.getElementById("skipWeekends").checked));
  localStorage.setItem("codexEpdSmartRefresh", String(document.getElementById("smartRefreshEnabled").checked));
}

function clientContentSignature() {
  return [
    document.getElementById("weatherText").value.trim(),
    document.getElementById("batteryText").value.trim(),
    document.getElementById("todoText").value.trim(),
  ].join("|");
}

async function refreshWeather() {
  try {
    const payload = await window.codexEpd.getWeather();
    if (payload?.text) {
      document.getElementById("weatherText").value = payload.text;
      saveSettings();
      renderDashboard();
      addLog(`天气已更新: ${payload.text}`);
    }
  } catch (err) {
    addLog(`天气更新失败，使用手动值: ${err.message}`);
  }
}

function applyLimits(payload) {
  document.getElementById("codex5hLeft").value = payload.codex5hLeft || "";
  document.getElementById("codex5hReset").value = payload.codex5hReset || "";
  document.getElementById("codexWeeklyLeft").value = payload.codexWeeklyLeft || "";
  document.getElementById("codexWeeklyReset").value = payload.codexWeeklyReset || "";
  document.getElementById("codexTokenUsed").value = payload.codexTokenUsed || "";
  latestSampleLabel = payload.latestSampleLabel || "";
  return payload.signature || [
    payload.codex5hLeft || "",
    payload.codex5hReset || "",
    payload.codexWeeklyLeft || "",
    payload.codexWeeklyReset || "",
  ].join("|");
}

function shouldRefresh(signature, force) {
  if (force) return { ok: true, reason: "forced" };
  if (document.getElementById("smartRefreshEnabled").checked && signature === lastSentSignature) {
    return { ok: false, reason: "用量无变化" };
  }
  const now = new Date();
  if (document.getElementById("skipWeekends").checked && (now.getDay() === 0 || now.getDay() === 6)) {
    return { ok: false, reason: "周末跳过" };
  }
  const start = parseInt(document.getElementById("workStartHour").value, 10);
  const end = parseInt(document.getElementById("workEndHour").value, 10);
  if (now.getHours() < start || now.getHours() >= end) {
    return { ok: false, reason: `非工作时段 ${start}:00-${end}:00` };
  }
  return { ok: true, reason: "需要刷新" };
}

async function refreshNow(options = {}) {
  if (authorizationInFlight) {
    addLog("授权检查中，跳过本次发送");
    return;
  }
  if (refreshInFlight) {
    addLog("屏幕刷新保护中，跳过本次发送");
    return;
  }
  refreshInFlight = true;
  let refreshCommandSent = false;
  let connectionOpened = false;
  try {
    const payload = await window.codexEpd.getLimits();
    const usageSignature = applyLimits(payload);
    const signature = `${usageSignature}|${clientContentSignature()}`;
    renderDashboard();
    addLog(`最新样本: ${payload.latestSampleLabel || "--"}`);
    addLog(`用量: 5H ${payload.codex5hLeft || "--"}%, WEEKLY ${payload.codexWeeklyLeft || "--"}%`);
    const decision = shouldRefresh(signature, options.force === true);
    if (!decision.ok) {
      addLog(`跳过: ${decision.reason}`);
      return;
    }
    await syncTargetDeviceName();
    if (!bleDevice) await restoreAuthorizedDevice();
    if (!bleDevice) {
      addLog("未授权墨水屏，跳过发送。请先点“授权设备”。");
      return;
    }
    await connectGatt({ retries: options.force === true ? 1 : CONNECT_RETRY_COUNT });
    connectionOpened = true;
    startTime = Date.now();
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const processedData = processImageData(imageData, "threeColor");
    const halfLength = Math.floor(processedData.length / 2);
    await write(EpdCmd.INIT);
    await writeImage(processedData.slice(0, halfLength), "bw");
    await writeImage(processedData.slice(halfLength), "red");
    await write(EpdCmd.REFRESH);
    refreshCommandSent = true;
    lastSentSignature = signature;
    localStorage.setItem("codexEpdLastSignature", signature);
    setStatus("刷新中，请等待");
    addLog(`发送完成，等待屏幕刷新，${Math.round(REFRESH_SETTLE_MS / 1000)}s 后${shouldKeepConnectionAlive() ? "进入待机" : "断开"}`);
    await sleep(REFRESH_SETTLE_MS);
  } finally {
    if (refreshCommandSent) {
      releaseConnection("刷新保护结束，已断开", "刷新保护结束，保持蓝牙连接");
    } else if (connectionOpened) {
      releaseConnection("本次刷新未完成，已断开", "本次刷新未完成，保持蓝牙连接");
    } else {
      clearGattState();
      setStatus(bleDevice ? `已授权 ${bleDevice.name || "EPD"}，空闲` : "未授权");
    }
    refreshInFlight = false;
  }
}

async function toggleAuto() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
    document.getElementById("autoBtn").textContent = "启动自动刷新";
    disconnectDevice("自动刷新已停止，已断开");
    renderDashboard();
    addLog("自动刷新已停止");
    return;
  }
  const interval = parseInt(document.getElementById("autoRefreshInterval").value, 10);
  autoRefreshTimer = setInterval(() => refreshNow({ force: false }).catch(err => addLog(err.message)), interval * 1000);
  document.getElementById("autoBtn").textContent = "停止自动刷新";
  renderDashboard();
  addLog(`自动刷新已启动: ${interval}s`);
  if (authorizationInFlight) {
    addLog("授权检查完成后会保持蓝牙连接");
    return;
  }
  try {
    await syncTargetDeviceName();
    if (!bleDevice) await restoreAuthorizedDevice();
    if (!bleDevice) {
      addLog("未授权墨水屏，自动刷新会等待你先授权设备");
      return;
    }
    await connectGatt({ retries: CONNECT_RETRY_COUNT });
    setStatus(`已连接 ${bleDevice.name || "EPD"}，自动待机`);
    addLog("自动刷新待机连接已保持");
  } catch (err) {
    addLog(`自动刷新已启动，但待机连接失败: ${err.message}`);
  }
}

document.getElementById("connectBtn").addEventListener("click", () => {
  authorizeDevice().catch(err => addLog(err.message));
});
document.getElementById("refreshBtn").addEventListener("click", () => {
  refreshNow({ force: true }).catch(err => addLog(err.message));
});
document.getElementById("autoBtn").addEventListener("click", () => {
  toggleAuto().catch(err => addLog(err.message));
});
document.getElementById("hideBtn").addEventListener("click", () => window.codexEpd.hide());
window.codexEpd.onRefreshNow(() => refreshNow({ force: true }).catch(err => addLog(err.message)));
window.codexEpd.onBluetoothStatus(message => {
  setStatus(message);
  addLog(message);
});

[
  "autoRefreshInterval",
  "targetDeviceName",
  "workStartHour",
  "workEndHour",
  "weatherText",
  "batteryText",
  "todoText",
  "skipWeekends",
  "smartRefreshEnabled",
].forEach(id => {
  const element = document.getElementById(id);
  element.addEventListener("input", () => {
    saveSettings();
    renderDashboard();
  });
  element.addEventListener("change", () => {
    saveSettings();
    if (id === "targetDeviceName") {
      syncTargetDeviceName().catch(err => addLog(err.message));
    }
    renderDashboard();
  });
});

loadSettings();
syncTargetDeviceName().catch(err => addLog(err.message));

window.codexEpd.getLimits()
  .then(payload => {
    applyLimits(payload);
    renderDashboard();
    return Promise.allSettled([
      refreshWeather(),
      restoreAuthorizedDevice(),
    ]);
  })
  .catch(err => {
    addLog(err.message);
    renderDashboard();
  });
