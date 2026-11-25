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

File → Open → `esp32-cam/smart_kitchen_cam.ino`. Credentials are **not** in the
sketch — they live in a local `secrets.h` that git never sees.

**a. Copy the template once** (from the project root):

```bash
cp esp32-cam/secrets.example.h esp32-cam/secrets.h
```

**b. Fill in `esp32-cam/secrets.h`:**

```cpp
static const char* WIFI_SSID  = "your-wifi-name";
static const char* WIFI_PASS  = "your-wifi-password";
static const char* DEVICE_KEY = "<value of DEVICE_API_KEY in backend/.env>";
```

**c. Set the backend URL** in the sketch's CONFIG block:

```cpp
const char* UPLOAD_URL = "http://<YOUR_PC_LAN_IP>:5000/api/device/upload";
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
- **Never commit `secrets.h`.** It is in `.gitignore`; `secrets.example.h`
  (placeholders only) is the file that belongs in the repo. If `git status`
  ever lists `secrets.h`, run `git rm --cached esp32-cam/secrets.h` before
  committing anything.

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
- **HTTPS is automatic.** If `UPLOAD_URL` starts with `https://` the sketch
  switches to `WiFiClientSecure`, so a hosted backend (Render) works with no
  code change — paste the URL and flash. Plain `http://` (LAN dev server) is
  unchanged.
- **First upload after an idle period is slow.** A free Render service sleeps
  after ~15 minutes and can take up to a minute to wake; the sketch waits 30 s.
  If it still times out, watch the next cycle — the service is awake by then.

## Where each piece lives

| Piece | File |
|---|---|
| The sketch | [`smart_kitchen_cam.ino`](smart_kitchen_cam.ino) |
| Credential template | [`secrets.example.h`](secrets.example.h) (copy to git-ignored `secrets.h`) |
| Upload endpoint | `backend/src/routes/device.routes.js` |
| Shared-key check | `backend/src/middleware/deviceAuth.js` |
| AI recognition | `backend/src/services/foodRecognition.js` |
| Review UI | `frontend/src/components/CameraReview.jsx` |
| Config template | `backend/.env.example` (ESP32-CAM section) |
