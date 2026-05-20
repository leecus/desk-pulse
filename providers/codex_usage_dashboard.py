#!/usr/bin/env python3
"""Codex usage dashboard for EPD-nRF5 compatible displays.

Reads local Codex session logs, renders a two-color usage dashboard image, and
optionally pushes it to an E-paper display over the EPD-nRF5 BLE protocol.

Examples:
  python3 codex_usage_dashboard.py -o codex_dashboard.png
  python3 codex_usage_dashboard.py --width 400 --height 300
  python3 codex_usage_dashboard.py --ble --device NRF_EPD_A4A2
"""

import argparse
import asyncio
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode

from PIL import Image, ImageDraw, ImageFont


EPD_SERVICE_UUID = "62750001-d828-918d-fb46-b6c11c675aec"
EPD_CHAR_UUID = "62750002-d828-918d-fb46-b6c11c675aec"

EPD_CMD_INIT = 0x01
EPD_CMD_SET_PINS = 0x00
EPD_CMD_CLEAR = 0x02
EPD_CMD_WRITE_IMAGE = 0x30
EPD_CMD_REFRESH = 0x05
EPD_CMD_SET_CONFIG = 0x90
EPD_CMD_CFG_ERASE = 0x99

DEFAULT_DEVICE_NAME = "NRF_EPD_A4A2"
DEFAULT_WIDTH = 400
DEFAULT_HEIGHT = 300
TASK_MODEL_ID = 0x02
DEFAULT_STATE_PATH = Path(__file__).resolve().parent / "state.json"

WHITE = (255, 255, 255)
BLACK = (0, 0, 0)
RED = (255, 0, 0)


def parse_ts(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def local_day(dt):
    return dt.astimezone().date()


def find_font(size, bold=False):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "C:\\Windows\\Fonts\\arialbd.ttf" if bold else "C:\\Windows\\Fonts\\arial.ttf",
    ]
    for path in candidates:
        if path and os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                pass
    return ImageFont.load_default()


def find_mono_font(size):
    candidates = [
        "/System/Library/Fonts/Menlo.ttc",
        "/System/Library/Fonts/Monaco.ttf",
        "/System/Library/Fonts/Supplemental/Courier New.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "C:\\Windows\\Fonts\\consola.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                pass
    return find_font(size)


def fmt_num(n):
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.0f}K"
    return str(n)


def iso_week(dt):
    return dt.isocalendar().week


def weekend_label(dt):
    weekday = dt.weekday()
    if weekday >= 5:
        return "WEEKEND NOW"
    return f"WEEKEND IN {5 - weekday}D"


def weekday_label(dt):
    return ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"][dt.weekday()]


def fmt_time(epoch_seconds):
    if not epoch_seconds:
        return "unknown"
    dt = datetime.fromtimestamp(epoch_seconds).astimezone()
    now = datetime.now().astimezone()
    if dt.date() == now.date():
        return dt.strftime("%H:%M")
    return dt.strftime("%H:%M on %d %b")


def hex_bytes(value):
    value = value.strip().replace(" ", "").replace(":", "").replace("-", "")
    if len(value) % 2:
        raise argparse.ArgumentTypeError("hex byte string must contain an even number of digits")
    try:
        return bytes.fromhex(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(str(exc)) from exc


def adv_name(device, adv):
    return device.name or getattr(adv, "local_name", None) or ""


def adv_services(adv):
    return {str(uuid).lower() for uuid in (getattr(adv, "service_uuids", None) or [])}


async def find_ble_device(scanner, device_name, service_uuid, timeout):
    found = await scanner.discover(timeout=timeout, return_adv=True)
    records = []
    for device, adv in found.values():
        name = adv_name(device, adv)
        services = adv_services(adv)
        records.append((device, adv, name, services))

    exact = [r for r in records if r[2] == device_name]
    if exact:
        return exact[0][0], records

    epd = [r for r in records if r[2].startswith("NRF_EPD")]
    if epd:
        suffix = device_name.split("_")[-1]
        suffix_matches = [r for r in epd if r[2].endswith(suffix)]
        return (suffix_matches[0] if suffix_matches else epd[0])[0], records

    service_matches = [r for r in records if service_uuid.lower() in r[3]]
    if service_matches:
        return service_matches[0][0], records

    return None, records


def visible_names(records):
    names = sorted({name for _device, _adv, name, _services in records if name})
    return ", ".join(names) or "none"


def fmt_reset(epoch_seconds):
    if not epoch_seconds:
        return ""
    dt = datetime.fromtimestamp(epoch_seconds).astimezone()
    now = datetime.now().astimezone()
    if dt.date() == now.date():
        return dt.strftime("%H:%M")
    return dt.strftime("%d %b")


def codex_limits_payload(codex_home):
    stats = collect_usage(codex_home, 7)
    rate = stats.get("latest_rate") or {}
    primary = rate.get("primary") or {}
    secondary = rate.get("secondary") or {}
    five_left = max(0, 100 - float(primary.get("used_percent") or 0))
    weekly_left = max(0, 100 - float(secondary.get("used_percent") or 0))
    latest_event_at = stats.get("latest_event_at")
    latest_sample = latest_event_at.astimezone().isoformat(timespec="seconds") if latest_event_at else ""
    latest_sample_label = latest_event_at.astimezone().strftime("%Y-%m-%d %H:%M:%S") if latest_event_at else ""
    latest_usage = (stats.get("latest_info") or {}).get("last_token_usage") or {}
    token_used = int(latest_usage.get("total_tokens") or 0)
    payload = {
        "codex5hLeft": str(round(five_left)),
        "codex5hReset": fmt_reset(primary.get("resets_at")),
        "codexWeeklyLeft": str(round(weekly_left)),
        "codexWeeklyReset": fmt_reset(secondary.get("resets_at")),
        "codexTokenUsed": str(token_used) if token_used else "",
        "codexTokenLimit": "",
        "latestSample": latest_sample,
        "latestSampleLabel": latest_sample_label,
    }
    payload["signature"] = "|".join([
        payload["codex5hLeft"],
        payload["codex5hReset"],
        payload["codexWeeklyLeft"],
        payload["codexWeeklyReset"],
    ])
    return payload


def load_state(path):
    path = Path(path).expanduser()
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def save_state(path, state):
    path = Path(path).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(path)


def should_run_now(now, work_start_hour, work_end_hour, skip_weekends):
    if skip_weekends and now.weekday() >= 5:
        return False, "weekend"
    if now.hour < work_start_hour or now.hour >= work_end_hour:
        return False, f"outside work window {work_start_hour}:00-{work_end_hour}:00"
    return True, "inside work window"


def evaluate_task_refresh(payload, state, work_start_hour, work_end_hour, skip_weekends, force=False):
    now = datetime.now().astimezone()
    signature = payload.get("signature") or ""
    if not force:
        ok, reason = should_run_now(now, work_start_hour, work_end_hour, skip_weekends)
        if not ok:
            return False, reason
        if signature and signature == state.get("last_sent_signature"):
            return False, "limits unchanged"
    return True, "refresh required"


def print_limits_url(codex_home):
    payload = codex_limits_payload(codex_home)
    url_params = {
        "codex5hLeft": payload["codex5hLeft"],
        "codex5hReset": payload["codex5hReset"],
        "codexWeeklyLeft": payload["codexWeeklyLeft"],
        "codexWeeklyReset": payload["codexWeeklyReset"],
    }
    index_path = Path(__file__).resolve().parents[1] / "electron_app" / "index.html"
    print(f"5h left: {url_params['codex5hLeft']}% reset {url_params['codex5hReset']}")
    print(f"Weekly left: {url_params['codexWeeklyLeft']}% reset {url_params['codexWeeklyReset']}")
    if payload.get("latestSampleLabel"):
        print(f"Latest sample: {payload['latestSampleLabel']}")
    print(f"{index_path.as_uri()}?{urlencode(url_params)}")


def serve_dashboard(codex_home, host, port):
    html_root = Path(__file__).resolve().parents[2] / "html"

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(html_root), **kwargs)

        def log_message(self, fmt, *args):
            print(f"[web] {self.address_string()} - {fmt % args}")

        def do_GET(self):
            if self.path.split("?", 1)[0] == "/api/codex-limits":
                payload = codex_limits_payload(codex_home)
                body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            super().do_GET()

    server = ThreadingHTTPServer((host, port), Handler)
    url_host = "127.0.0.1" if host in {"", "0.0.0.0"} else host
    print(f"Serving dashboard: http://{url_host}:{port}/index.html")
    print("Keep this process running. The browser will poll /api/codex-limits for fresh Codex usage.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()


def empty_day():
    return {
        "input_tokens": 0,
        "cached_input_tokens": 0,
        "output_tokens": 0,
        "reasoning_output_tokens": 0,
        "total_tokens": 0,
        "turns": 0,
        "sessions": set(),
    }


def collect_usage(codex_home, days):
    root = Path(codex_home).expanduser()
    session_root = root / "sessions"
    since = datetime.now(timezone.utc) - timedelta(days=days)
    by_day = defaultdict(empty_day)
    sessions = {}
    model_counts = Counter()
    latest_rate = None
    latest_info = None
    latest_event_at = None
    latest_model = None

    for path in sorted(session_root.glob("*/*/*/*.jsonl")):
        current_session_id = path.stem
        with path.open("r", encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    continue

                ts = parse_ts(item.get("timestamp"))
                if ts is None:
                    continue

                payload = item.get("payload") or {}
                if item.get("type") == "session_meta":
                    meta = payload
                    sid = meta.get("id") or current_session_id
                    current_session_id = sid
                    sessions.setdefault(sid, {"started_at": ts, "cwd": meta.get("cwd"), "model": meta.get("model")})
                    if meta.get("model"):
                        model_counts[meta["model"]] += 1
                        latest_model = meta["model"]
                    continue

                if item.get("type") != "event_msg" or payload.get("type") != "token_count":
                    continue
                if ts < since:
                    continue

                info = payload.get("info") or {}
                usage = info.get("last_token_usage") or {}
                day = by_day[local_day(ts)]
                day["input_tokens"] += int(usage.get("input_tokens") or 0)
                day["cached_input_tokens"] += int(usage.get("cached_input_tokens") or 0)
                day["output_tokens"] += int(usage.get("output_tokens") or 0)
                day["reasoning_output_tokens"] += int(usage.get("reasoning_output_tokens") or 0)
                day["total_tokens"] += int(usage.get("total_tokens") or 0)
                day["turns"] += 1
                day["sessions"].add(current_session_id)

                if latest_event_at is None or ts > latest_event_at:
                    latest_event_at = ts
                    latest_info = info
                    latest_rate = payload.get("rate_limits")

    today = local_day(datetime.now(timezone.utc))
    daily = []
    for offset in range(days - 1, -1, -1):
        d = today - timedelta(days=offset)
        values = by_day[d]
        daily.append({
            "date": d,
            "input_tokens": values["input_tokens"],
            "cached_input_tokens": values["cached_input_tokens"],
            "output_tokens": values["output_tokens"],
            "reasoning_output_tokens": values["reasoning_output_tokens"],
            "total_tokens": values["total_tokens"],
            "turns": values["turns"],
            "sessions": len(values["sessions"]),
        })

    totals = {
        "input_tokens": sum(d["input_tokens"] for d in daily),
        "cached_input_tokens": sum(d["cached_input_tokens"] for d in daily),
        "output_tokens": sum(d["output_tokens"] for d in daily),
        "reasoning_output_tokens": sum(d["reasoning_output_tokens"] for d in daily),
        "total_tokens": sum(d["total_tokens"] for d in daily),
        "turns": sum(d["turns"] for d in daily),
        "sessions": len({sid for d in by_day.values() for sid in d["sessions"]}),
    }

    return {
        "daily": daily,
        "totals": totals,
        "today": daily[-1] if daily else empty_day(),
        "latest_rate": latest_rate,
        "latest_info": latest_info,
        "latest_event_at": latest_event_at,
        "latest_model": latest_model,
        "model_counts": model_counts,
        "session_count_all_time": len(sessions),
    }


class DashboardRenderer:
    def __init__(self, width, height):
        self.w = width
        self.h = height
        self.img = Image.new("RGB", (width, height), WHITE)
        self.d = ImageDraw.Draw(self.img)
        scale = min(width / 400, height / 300)
        self.title = find_mono_font(max(15, int(20 * scale)))
        self.big = find_mono_font(max(28, int(34 * scale)))
        self.mid = find_mono_font(max(12, int(13 * scale)))
        self.small = find_mono_font(max(9, int(11 * scale)))
        self.tiny = find_mono_font(max(8, int(10 * scale)))
        self.m = max(10, int(18 * scale))

    def text_width(self, text, font):
        return self.d.textbbox((0, 0), text, font=font)[2]

    def draw_metric_card(self, x, y, w, label, left_pct, reset_text):
        self.d.rectangle([x, y, x + w, y + 64], outline=BLACK, width=2)
        self.d.text((x + 10, y + 7), label, font=self.small, fill=BLACK)
        self.d.text((x + 10, y + 24), f"{left_pct:.0f}", font=self.big, fill=BLACK)
        self.d.text((x + 72, y + 35), "%", font=self.mid, fill=BLACK)
        self.d.text((x + 98, y + 36), "left", font=self.small, fill=RED)
        reset = f"reset {reset_text}" if reset_text else "reset --"
        self.d.text((x + w - 92, y + 7), reset, font=self.tiny, fill=BLACK)

    def draw_bar(self, x, y, w, h, used_pct):
        used_pct = max(0, min(100, used_pct))
        self.d.rectangle([x, y, x + w, y + h], outline=BLACK, width=2)
        fill_w = int(w * used_pct / 100)
        if fill_w > 0:
            self.d.rectangle([x + 2, y + 2, x + fill_w, y + h - 2], fill=RED)

    def limit_row(self, y, label, used_pct, detail):
        bar_x = 112
        bar_w = 248
        bar_h = 22
        left_pct = max(0, 100 - used_pct)
        self.d.text((22, y), label, font=self.mid, fill=BLACK)
        self.d.text((bar_x, y), f"{left_pct:.0f}% left", font=self.small, fill=BLACK)
        if detail:
            self.d.text((bar_x + 96, y), detail, font=self.small, fill=BLACK)
        self.draw_bar(bar_x, y + 20, bar_w, bar_h, used_pct)
        self.d.text((bar_x + bar_w - 30, y + 27), "used", font=self.tiny, fill=BLACK)

    def status_cell(self, x, y, w, label, value, red=False):
        self.d.rectangle([x, y, x + w, y + 34], outline=BLACK)
        self.d.text((x + 6, y + 4), label, font=self.tiny, fill=BLACK)
        self.d.text((x + 6, y + 18), value or "--", font=self.small, fill=RED if red else BLACK)

    def render(self, stats):
        now = datetime.now().astimezone()
        rate = stats.get("latest_rate") or {}
        info = stats.get("latest_info") or {}
        latest_usage = info.get("last_token_usage") or {}
        primary = rate.get("primary") or {}
        secondary = rate.get("secondary") or {}

        five_used = float(primary.get("used_percent") or 0)
        weekly_used = float(secondary.get("used_percent") or 0)
        five_left = max(0, 100 - five_used)
        weekly_left = max(0, 100 - weekly_used)
        five_reset = fmt_reset(primary.get("resets_at"))
        weekly_reset = fmt_reset(secondary.get("resets_at"))

        self.d.text((18, 9), "CODEX LIMITS", font=self.title, fill=BLACK)
        self.d.text((292, 16), now.strftime("%m/%d %H:%M"), font=self.tiny, fill=BLACK)
        self.d.rectangle([18, 38, 382, 41], fill=RED)
        self.d.text((18, 44), f"WEEK {iso_week(now)} {weekday_label(now)}", font=self.tiny, fill=BLACK)
        self.d.text((286, 44), weekend_label(now), font=self.tiny, fill=RED)

        self.draw_metric_card(18, 54, 174, "5H LIMIT", five_left, five_reset)
        self.draw_metric_card(208, 54, 174, "WEEKLY", weekly_left, weekly_reset)

        self.limit_row(132, "5h used", five_used, f"resets {five_reset}" if five_reset else "")
        self.limit_row(184, "week used", weekly_used, f"resets {weekly_reset}" if weekly_reset else "")

        token_used = int(latest_usage.get("total_tokens") or 0)
        token_label = fmt_num(token_used) if token_used else "--"
        seen_at = stats.get("latest_event_at")
        sample = seen_at.astimezone().strftime("%m-%d %H:%M") if seen_at else now.strftime("%H:%M")

        self.status_cell(18, 238, 86, "last turn", token_label)
        self.status_cell(112, 238, 86, "sample", sample)
        self.status_cell(206, 238, 80, "check", "30m")
        self.status_cell(294, 238, 88, "task", "ON", red=True)

        self.d.text((18, 286), "weekdays 9:00-20:00, sends only when limits change", font=self.tiny, fill=BLACK)
        return self.img


def render_test_pattern(width, height, pattern):
    img = Image.new("RGB", (width, height), WHITE)
    d = ImageDraw.Draw(img)
    if pattern == "white":
        return img

    font = find_mono_font(max(48, int(min(width, height) * 0.32)))
    text = "OK"
    bbox = d.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    x = (width - tw) // 2
    y = (height - th) // 2 - 10
    d.text((x, y), text, font=font, fill=BLACK)
    d.rectangle([20, 20, width - 21, height - 21], outline=BLACK, width=3)
    d.rectangle([width - 90, height - 55, width - 25, height - 25], fill=RED)
    return img


def image_to_planes(img, red_mode):
    img = img.convert("RGB")
    w, h = img.size
    stride = (w + 7) // 8
    black = bytearray([0xFF] * (stride * h))
    red = bytearray([0xFF] * (stride * h))
    pixels = img.load()
    for y in range(h):
        for x in range(w):
            r, g, b = pixels[x, y]
            idx = y * stride + x // 8
            bit = 0x80 >> (x & 7)
            if r > 180 and g < 80 and b < 80:
                if red_mode == "red":
                    red[idx] &= ~bit
                elif red_mode == "black":
                    black[idx] &= ~bit
            elif r < 80 and g < 80 and b < 80:
                black[idx] &= ~bit
    return black, red


async def write_plane(client, char_uuid, plane, first_cfg, next_cfg, chunk_size, name, confirm_interval, packet_delay):
    chunks = 0
    for pos in range(0, len(plane), chunk_size):
        cfg = first_cfg if pos == 0 else next_cfg
        payload = bytes([EPD_CMD_WRITE_IMAGE, cfg]) + plane[pos:pos + chunk_size]
        use_response = confirm_interval <= 0 or chunks % (confirm_interval + 1) == confirm_interval
        await client.write_gatt_char(char_uuid, payload, response=use_response)
        if packet_delay > 0:
            await asyncio.sleep(packet_delay)
        chunks += 1
        if chunks % 100 == 0:
            print(f"  {name}: {pos + len(payload) - 2}/{len(plane)} bytes")
    return chunks


async def send_ble(image, device_name, service_uuid, char_uuid, color_mode, chunk_size, model_id, pins, confirm_interval, packet_delay, red_mode):
    try:
        from bleak import BleakClient, BleakScanner
        from bleak.exc import BleakError
    except ImportError as exc:
        raise SystemExit("Missing dependency: pip install bleak") from exc

    print(f"Scanning for {device_name}...")
    try:
        target, records = await find_ble_device(BleakScanner, device_name, service_uuid, 15)
    except BleakError as exc:
        raise SystemExit(f"Bluetooth scan failed: {exc}") from exc
    if target is None:
        names = visible_names(records)
        epd_names = ", ".join(sorted(name for _device, _adv, name, _services in records if name.startswith("NRF_EPD"))) or "none"
        if epd_names != "none":
            raise SystemExit(
                f"Device '{device_name}' not found. Visible EPD devices: {epd_names}. "
                "Pass the exact name with --device."
            )
        raise SystemExit(f"Device not found. Visible BLE names: {names}")
    print(f"Found: {target.name or target.address}")

    black_plane, red_plane = image_to_planes(image, red_mode)
    try:
        async with BleakClient(target) as client:
            services = client.services
            if service_uuid.lower() not in {str(s.uuid).lower() for s in services}:
                raise SystemExit(f"Connected to {device_name}, but EPD service UUID was not found.")

            if pins:
                print(f"Setting pins: {pins.hex().upper()}")
                await client.write_gatt_char(char_uuid, bytes([EPD_CMD_SET_PINS]) + pins, response=True)
                await asyncio.sleep(0.2)

            init_payload = bytes([EPD_CMD_INIT]) if model_id is None else bytes([EPD_CMD_INIT, model_id])
            await client.write_gatt_char(char_uuid, init_payload, response=True)
            await asyncio.sleep(0.2)
            mtu = getattr(client, "mtu_size", 23) or 23
            negotiated_chunk_size = max(1, mtu - 5)
            chunk_size = negotiated_chunk_size if chunk_size <= 0 else min(chunk_size, negotiated_chunk_size)
            print(f"MTU={mtu}, data chunk={chunk_size}, confirm interval={confirm_interval}, packet delay={packet_delay}s")
            black_chunks = await write_plane(client, char_uuid, black_plane, 0x0F, 0xFF, chunk_size, "black", confirm_interval, packet_delay)
            red_chunks = 0
            if color_mode == "bwr":
                red_chunks = await write_plane(client, char_uuid, red_plane, 0x00, 0xF0, chunk_size, "red", confirm_interval, packet_delay)
            await asyncio.sleep(0.2)
            await client.write_gatt_char(char_uuid, bytes([EPD_CMD_REFRESH]), response=True)
            print(f"Sent black={len(black_plane)} bytes/{black_chunks} chunks, red={len(red_plane)} bytes/{red_chunks} chunks.")
            print("Refresh command sent.")
    except BleakError as exc:
        raise SystemExit(f"Bluetooth transfer failed: {exc}") from exc


def render_codex_image(codex_home, days, width, height):
    stats = collect_usage(codex_home, days)
    print(
        f"Collected {fmt_num(stats['totals']['total_tokens'])} tokens, "
        f"{stats['totals']['turns']} turns, {stats['totals']['sessions']} sessions."
    )
    renderer = DashboardRenderer(width, height)
    return renderer.render(stats), stats


def print_task_decision(payload, state, should_refresh, reason):
    print(f"5h left: {payload['codex5hLeft']}% reset {payload['codex5hReset']}")
    print(f"Weekly left: {payload['codexWeeklyLeft']}% reset {payload['codexWeeklyReset']}")
    if payload.get("latestSampleLabel"):
        print(f"Latest sample: {payload['latestSampleLabel']}")
    if state.get("last_sent_at"):
        print(f"Last sent: {state['last_sent_at']}")
    print(f"Signature: {payload.get('signature') or '-'}")
    print(f"Decision: {'send' if should_refresh else 'skip'} ({reason})")


def mark_task_sent(state_file, state, payload):
    state["last_sent_signature"] = payload.get("signature") or ""
    state["last_sent_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
    state["last_payload"] = payload
    save_state(state_file, state)


def run_task_mode(args, mode):
    state = load_state(args.state_file)
    payload = codex_limits_payload(args.codex_home)
    should_refresh, reason = evaluate_task_refresh(
        payload,
        state,
        args.work_start_hour,
        args.work_end_hour,
        not args.no_skip_weekends,
        force=args.force,
    )
    print_task_decision(payload, state, should_refresh, reason)

    if mode == "dry-run":
        return

    if mode == "once" and not should_refresh:
        return

    if mode == "test-white":
        print("Using safe test pattern: white")
        image = render_test_pattern(args.width, args.height, "white")
    elif mode == "test-ok":
        print("Using safe test pattern: ok")
        image = render_test_pattern(args.width, args.height, "ok")
    else:
        image, _stats = render_codex_image(args.codex_home, args.days, args.width, args.height)

    image.save(args.output)
    print(f"Saved {args.output} ({args.width}x{args.height}).")
    print("Safe BLE task mode: no SET_PINS, no SET_CONFIG, no CFG_ERASE.")
    asyncio.run(send_ble(
        image,
        args.device,
        args.service_uuid,
        args.char_uuid,
        "bwr",
        args.chunk_size,
        TASK_MODEL_ID,
        None,
        args.confirm_interval,
        args.packet_delay,
        args.red_mode,
    ))

    if mode == "once":
        mark_task_sent(args.state_file, state, payload)
        print(f"State updated: {args.state_file}")


async def send_recovery(device_name, service_uuid, char_uuid, action, model_id, pins, config):
    try:
        from bleak import BleakClient, BleakScanner
        from bleak.exc import BleakError
    except ImportError as exc:
        raise SystemExit("Missing dependency: pip install bleak") from exc

    print(f"Scanning for {device_name}...")
    try:
        target, records = await find_ble_device(BleakScanner, device_name, service_uuid, 15)
    except BleakError as exc:
        raise SystemExit(f"Bluetooth scan failed: {exc}") from exc
    if target is None:
        raise SystemExit(f"Device '{device_name}' not found. Visible BLE names: {visible_names(records)}")
    print(f"Found: {target.name or target.address}")

    try:
        async with BleakClient(target) as client:
            services = client.services
            if service_uuid.lower() not in {str(s.uuid).lower() for s in services}:
                raise SystemExit(f"Connected to {device_name}, but EPD service UUID was not found.")

            if action == "erase-config":
                print("Sending CFG_ERASE. Device should reset/disconnect.")
                await client.write_gatt_char(char_uuid, bytes([EPD_CMD_CFG_ERASE]), response=True)
                return

            if action == "set-config":
                print(f"Sending full config: {config.hex().upper()}")
                await client.write_gatt_char(char_uuid, bytes([EPD_CMD_SET_CONFIG]) + config, response=True)
                print("Waiting for flash write...")
                await asyncio.sleep(3.0)
                print("Config command sent. Reconnect with index.html to verify.")
                return

            if pins:
                print(f"Setting pins: {pins.hex().upper()}")
                await client.write_gatt_char(char_uuid, bytes([EPD_CMD_SET_PINS]) + pins, response=True)
                await asyncio.sleep(2.0)

            init_payload = bytes([EPD_CMD_INIT]) if model_id is None else bytes([EPD_CMD_INIT, model_id])
            print(f"Sending INIT{' model=' + str(model_id) if model_id is not None else ''}")
            await client.write_gatt_char(char_uuid, init_payload, response=True)
            await asyncio.sleep(0.5)

            print("Sending CLEAR.")
            await client.write_gatt_char(char_uuid, bytes([EPD_CMD_CLEAR, 1]), response=True)
            print("Clear command sent. Wait for the EPD refresh to finish.")
    except BleakError as exc:
        raise SystemExit(f"Bluetooth recovery failed: {exc}") from exc


def main():
    parser = argparse.ArgumentParser(description="Render and optionally push a Codex usage dashboard to EPD.")
    parser.add_argument("--codex-home", default=os.environ.get("CODEX_HOME", "~/.codex"))
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--width", type=int, default=DEFAULT_WIDTH)
    parser.add_argument("--height", type=int, default=DEFAULT_HEIGHT)
    parser.add_argument("-o", "--output", default="codex_dashboard.png")
    parser.add_argument("--ble", action="store_true")
    parser.add_argument("--device", default=DEFAULT_DEVICE_NAME)
    parser.add_argument("--color", choices=["bwr", "bw"], default="bwr")
    parser.add_argument("--red-mode", choices=["red", "black", "white"], default="red", help="render red pixels as red, black, or white")
    parser.add_argument("--chunk-size", type=int, default=0, help="image data bytes per BLE packet; 0 means auto")
    parser.add_argument("--model-id", type=lambda s: int(s, 0), help="optional EPD model id, e.g. 3 for UC8176 4.2 BWR")
    parser.add_argument("--pins", type=hex_bytes, help="EPD pin hex mapping, e.g. 0A0B0C0D0E0F10")
    parser.add_argument("--confirm-interval", type=int, default=50, help="write without response N times before one confirmed write")
    parser.add_argument("--packet-delay", type=float, default=0.0, help="delay after each BLE image packet in seconds")
    parser.add_argument("--erase-config", action="store_true", help="send CFG_ERASE and reset the device")
    parser.add_argument("--clear", action="store_true", help="send INIT then CLEAR without image transfer")
    parser.add_argument("--set-config", type=hex_bytes, help="write full 13-byte EPD config and exit")
    parser.add_argument("--service-uuid", default=EPD_SERVICE_UUID)
    parser.add_argument("--char-uuid", default=EPD_CHAR_UUID)
    parser.add_argument("--test-pattern", choices=["white", "ok"], help="send a simple generated test image instead of Codex stats")
    parser.add_argument("--limits-url", action="store_true", help="print an index.html URL with the latest Codex limit values")
    parser.add_argument("--serve", action="store_true", help="serve index.html and a fresh /api/codex-limits endpoint; does not use BLE")
    parser.add_argument("--host", default="127.0.0.1", help="host for --serve")
    parser.add_argument("--port", type=int, default=8765, help="port for --serve")
    parser.add_argument("--dry-run", action="store_true", help="task mode: print refresh decision without BLE")
    parser.add_argument("--once", action="store_true", help="task mode: send dashboard once if schedule and limits changed")
    parser.add_argument("--test-white", action="store_true", help="task mode: send a white test frame using the safe BLE path")
    parser.add_argument("--test-ok", action="store_true", help="task mode: send an OK test frame using the safe BLE path")
    parser.add_argument("--force", action="store_true", help="task mode: ignore schedule and unchanged-signature checks")
    parser.add_argument("--state-file", default=DEFAULT_STATE_PATH, help="task mode state file")
    parser.add_argument("--work-start-hour", type=int, default=9)
    parser.add_argument("--work-end-hour", type=int, default=20)
    parser.add_argument("--no-skip-weekends", action="store_true", help="task mode: allow weekend refreshes")
    args = parser.parse_args()

    task_modes = [
        ("dry-run", args.dry_run),
        ("once", args.once),
        ("test-white", args.test_white),
        ("test-ok", args.test_ok),
    ]
    selected_task_modes = [name for name, enabled in task_modes if enabled]
    if len(selected_task_modes) > 1:
        raise SystemExit("Choose only one of --dry-run, --once, --test-white, or --test-ok")

    if args.serve:
        serve_dashboard(args.codex_home, args.host, args.port)
        return

    if args.limits_url:
        print_limits_url(args.codex_home)
        return

    if selected_task_modes:
        run_task_mode(args, selected_task_modes[0])
        return

    if args.erase_config or args.clear or args.set_config:
        action = "set-config" if args.set_config else ("erase-config" if args.erase_config else "clear")
        if args.set_config and len(args.set_config) != 13:
            raise SystemExit("--set-config expects exactly 13 bytes")
        asyncio.run(send_recovery(
            args.device,
            args.service_uuid,
            args.char_uuid,
            action,
            args.model_id,
            args.pins,
            args.set_config,
        ))
        return

    if args.test_pattern:
        print(f"Using test pattern: {args.test_pattern}")
        image = render_test_pattern(args.width, args.height, args.test_pattern)
    else:
        stats = collect_usage(args.codex_home, args.days)
        print(
            f"Collected {fmt_num(stats['totals']['total_tokens'])} tokens, "
            f"{stats['totals']['turns']} turns, {stats['totals']['sessions']} sessions."
        )
        renderer = DashboardRenderer(args.width, args.height)
        image = renderer.render(stats)
    image.save(args.output)
    print(f"Saved {args.output} ({args.width}x{args.height}).")

    if args.ble:
        asyncio.run(send_ble(
            image,
            args.device,
            args.service_uuid,
            args.char_uuid,
            args.color,
            args.chunk_size,
            args.model_id,
            args.pins,
            args.confirm_interval,
            args.packet_delay,
            args.red_mode,
        ))


if __name__ == "__main__":
    main()
