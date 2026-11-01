# ESP32-CAM — setup, wiring & upload guide

Phase 10 hardware. The camera photographs food (or its packaging), POSTs the
JPEG to the backend, and the server takes it from there: AI recognition, then
human review in the web app. The device itself runs one loop — wake, shoot,
send, wait — and holds no logic about what it photographed.

## What you need

| Part | Notes |
|---|---|
| ESP32-CAM (AI-Thinker, OV2640) | The board in the order — 2 MP, Wi-Fi + BT |
| FT232RL USB-UART adapter | To flash the sketch; **set its switch to 3.3V** |
| Jumper wires | 4 female-to-female |
| Micro-USB cable | Data-capable, not charge-only |

> ⚠️ The ESP32-CAM has **no USB port** of its own — that is what the FT232RL
> is for. And the FT232RL's I/O must be in **3.3V mode**: the ESP32 is not
> 5V-tolerant on its logic pins.

## Wiring (flashing mode)

```
FT232RL          ESP32-CAM
---------        -------------
5V          →    5V (the pin labelled VIN/5V)
GND         →    GND
TX          →    U0R  (GPIO3)
RX          →    U0T  (GPIO1)

plus, temporarily:  GPIO0 → GND   (holds the chip in flash mode)
```

**GPIO0 → GND must be removed after uploading**, otherwise the board boots
back into the bootloader every reset and appears "dead".

## 1. Install the board package

Arduino IDE → **Tools → Board → Boards Manager**, search `esp32`, install
**esp32 by Espressif Systems** (v3.x).

## 2. Open the sketch

File → Open → `esp32-cam/smart_kitchen_cam.ino`, then fill the CONFIG block:

```cpp
const char* WIFI_SSID     = "YOUR_WIFI_NAME";
const char* WIFI_PASS     = "YOUR_WIFI_PASSWORD";
const char* UPLOAD_URL    = "http://<YOUR_PC_LAN_IP>:5000/api/device/upload";
const char* DEVICE_KEY    = "<value of DEVICE_API_KEY in backend/.env>";
```

- **UPLOAD_URL uses your PC's LAN IP, not `localhost`.** `localhost` on the
  camera means the camera. Find your IP with `ipconfig` (Windows) or
  `ifconfig` (macOS/Linux). For a deployed backend use its full `https://…` URL.
- **DEVICE_KEY** must match `DEVICE_API_KEY` in `backend/.env` exactly.
  Generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
  ```
- Both machines must be on the **same Wi-Fi network**.

## 3. Tools → settings

| Setting | Value |
|---|---|
| Board | **AI Thinker ESP32-CAM** |
| Partition Scheme | Huge APP (3MB No OTA) |
| Upload Speed | 115200 |

## 4. Flash

1. Connect the four wires **plus GPIO0 → GND**.
2. Press the small reset button on the ESP32-CAM once.
3. IDE → **Upload** (▶). If it hangs at "Connecting…", press reset again
   while it retries.
4. When done: **remove GPIO0 → GND**, press reset.

## 5. Watch it work

Serial Monitor at **115200 baud**. Healthy cycle:

```
[cam] Smart Kitchen ESP32-CAM starting
[cam] connected, IP=192.168.1.42 RSSI=-48
[cam] capturing…
[cam] frame 87344 bytes
[cam] POST -> 201  {"ok":true,"detection":{...},"recognition":{"detected":true,...}}
```

- **Two quick blinks** = accepted. **Five slow blinks** = server rejected it.
- `POST failed: connection refused` → backend not running, or wrong IP/port.
- `401 Invalid device key` → `DEVICE_KEY` ≠ `DEVICE_API_KEY` in `.env`.
- `503 Device uploads are disabled` → set `DEVICE_API_KEY` in `backend/.env`.
- Camera halts with continuous slow blinking → ribbon cable not seated
  (power off first; the connector is a ZIF — lift, reseat, close).

## 6. Confirm in the web app

Every upload appears on **Inventory → Camera detections**. Nothing enters the
inventory until you press **Review → Add to inventory** (or Discard) — the
camera and the AI only ever *propose*.

## How it behaves

- First photo fires ~1 s after boot, then every `CAPTURE_INTERVAL_MS`
  (default 60 s).
- Wi-Fi drop → reconnects, skips that cycle, resumes. No reboot loop.
- Failed upload → error blinks and retries on the next cycle; nothing is lost
  because the camera never assumed success.
- Photos are stored under `backend/uploads/` (git-ignored) and served at
  `/uploads/detections/…`.

## Where each piece lives

| Piece | File |
|---|---|
| The sketch | [`smart_kitchen_cam.ino`](smart_kitchen_cam.ino) |
| Upload endpoint | `backend/src/routes/device.routes.js` |
| Shared-key check | `backend/src/middleware/deviceAuth.js` |
| AI recognition | `backend/src/services/foodRecognition.js` |
| Review UI | `frontend/src/components/CameraReview.jsx` |
| Config template | `backend/.env.example` (ESP32-CAM section) |
