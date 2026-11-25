/**
 * Smart Kitchen — ESP32-CAM capture & upload
 * ===========================================
 *
 * Phase 10 of the Smart Food Inventory project. The camera wakes, photographs
 * whatever is in front of it, POSTs the JPEG to the backend, and goes back to
 * sleep. The server runs AI recognition and files the photo for human review
 * in the web app — the device itself is deliberately dumb: it knows how to
 * take a picture and where to send it, nothing else.
 *
 * Board: AI-Thinker ESP32-CAM (OV2640)
 * Arduino IDE board: "AI Thinker ESP32-CAM"
 *
 * Wiring for flashing (FT232RL USB-UART adapter):
 *
 *   FT232RL        ESP32-CAM
 *   ------------   ------------
 *   5V        ->   5V  (VIN)
 *   GND       ->   GND
 *   TX        ->   U0R (GPIO3)
 *   RX        ->   U0T (GPIO1)
 *   (3.3V mode switch on the FT232RL set to 3.3V for logic pins)
 *
 *   PLUS: jumper GPIO0 -> GND while pressing/reset for flash mode, remove it
 *   after upload or the board will boot into the bootloader forever.
 *
 * Settings (Arduino IDE > Tools):
 *   Board:            AI Thinker ESP32-CAM
 *   Partition Scheme: Huge APP (3MB No OTA)
 *   Upload Speed:     115200  (raise later if stable)
 *
 * Wi-Fi credentials and the device key are NOT in this file: they live in
 * secrets.h, which is git-ignored so they can never reach GitHub. Copy
 * secrets.example.h to secrets.h once, fill it in, then upload this sketch and
 * remove the GPIO0->GND jumper before pressing the camera board's reset.
 *
 * Serial monitor: 115200 baud.
 */

#include "esp_camera.h"
#include "secrets.h"  // Wi-Fi SSID/password + DEVICE_KEY -- local only, git-ignored
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

// ============================= CONFIG =======================================
// Wi-Fi SSID/password and DEVICE_KEY are in secrets.h (git-ignored), so this
// tracked file never holds a credential. Copy secrets.example.h to secrets.h
// and fill that in. Only the backend URL and the interval live here.

// Backend URL — the /api/device/upload endpoint, NOT the web page.
// Local dev:    "http://192.168.x.x:5000/api/device/upload"  (your PC's LAN IP;
//               "localhost" would mean the camera itself, which has no server)
// Deployed:     "https://your-backend-host/api/device/upload"
//
// https:// is handled automatically: the sketch switches to WiFiClientSecure
// when the URL starts with "https", so a Render deployment works with no code
// change -- just paste the URL.
const char* UPLOAD_URL = "http://192.168.1.100:5000/api/device/upload";

// Milliseconds between captures. 60000 = one photo a minute. The daily sweep
// only cares about expiry dates, so a photo every few minutes is plenty and
// keeps us well clear of any rate limit.
const unsigned long CAPTURE_INTERVAL_MS = 60000;
// ============================================================================

// AI-Thinker ESP32-CAM pin map — do not change, it is the module's wiring.
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22
// The built-in red status LED (also used by some flash variants).
#define FLASH_GPIO_NUM     4

// The ESP32-CAM has ~520 KB of usable heap; a frame buffer plus TLS or a big
// JSON string can exhaust it. VGA (640x480) JPEGs land around 60-150 KB —
// enough for the model to read a date off a pack, small enough to survive.
#define FRAME_SIZE FRAMESIZE_VGA

bool wifiReady = false;
unsigned long lastCaptureAt = 0;

void blink(int times, int ms) {
  for (int i = 0; i < times; i++) {
    digitalWrite(FLASH_GPIO_NUM, HIGH);
    delay(ms);
    digitalWrite(FLASH_GPIO_NUM, LOW);
    delay(ms);
  }
}

void connectWifi() {
  Serial.printf("\n[cam] connecting to %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  // Two minutes max. After that we keep retrying each cycle rather than
  // hanging forever — a router reboot must not brick the camera.
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiReady = true;
    Serial.printf("\n[cam] connected, IP=%s RSSI=%d\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
    blink(2, 80);
  } else {
    Serial.println("\n[cam] WiFi failed — will retry next cycle");
    wifiReady = false;
  }
}

bool startCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = FRAME_SIZE;
  // JPEG quality 10-13 keeps files readable without eating the heap. 0 = best
  // quality, biggest file, most likely OOM on this board.
  config.jpeg_quality = 12;
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[cam] camera init failed: 0x%x\n", err);
    return false;
  }

  sensor_t* s = esp_camera_sensor_get();
  if (s != NULL) {
    // The lens in front of a food pack is close; slight adjustments help the
    // model read printed dates. Values are safe defaults for the OV2640.
    s->set_brightness(s, 1);
    s->set_saturation(s, 1);
  }
  return true;
}

/**
 * Grab one JPEG frame.
 *
 * Returns an empty (zero-length) buffer on failure. The caller must check
 * .length — pushing a null frame to the server would just earn a 400 from
 * the backend and waste a Wi-Fi cycle.
 */
camera_fb_t* capture() {
  // Two tries: the first frame after waking is often half-exposed or stale.
  for (int attempt = 0; attempt < 2; attempt++) {
    camera_fb_t* fb = esp_camera_fb_get();
    if (fb == NULL || fb->len == 0) {
      if (fb) esp_camera_fb_return(fb);
      delay(200);
      continue;
    }
    // Throw the very first frame away on the first attempt — on the OV2640 it
    // is frequently the previous exposure.
    if (attempt == 0) {
      esp_camera_fb_return(fb);
      delay(100);
      continue;
    }
    return fb;
  }
  return NULL;
}

/**
 * POST the JPEG as a raw body with Content-Type: image/jpeg.
 *
 * No multipart encoder on purpose: the backend reads raw bytes, HTTPClient
 * already has a `POST(String url, const uint8_t* payload, size_t size)`
 * overload, and one less parser on a microcontroller is one less thing to
 * debug with no stack traces.
 *
 * TLS: a hosted backend (Render, Fly, Railway...) only answers on https, and a
 * plain WiFiClient cannot speak TLS -- the handshake fails and every upload
 * errors out. So the client is chosen from the URL scheme: https -> 
 * WiFiClientSecure, http (a LAN dev server) -> plain WiFiClient.
 *
 * setInsecure() skips certificate validation. Validating properly means
 * shipping a CA bundle (~40 KB of flash) plus the TLS handshake's heap, and
 * the photo is a JPEG of a fridge, not a password. The device key is what
 * actually authorises the call, and the server still rejects a wrong one.
 *
 * Returns the HTTP status, or -1 on a connection failure.
 */
int uploadFrame(const uint8_t* data, size_t len) {
  WiFiClient plainClient;
  WiFiClientSecure secureClient;
  WiFiClient* client = &plainClient;

  if (String(UPLOAD_URL).startsWith("https://")) {
    secureClient.setInsecure();
    client = &secureClient;
  }

  HTTPClient http;

  if (!http.begin(*client, UPLOAD_URL)) {
    Serial.println("[cam] http.begin failed (bad URL?)");
    return -1;
  }

  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("x-device-key", DEVICE_KEY);
  // The camera sends exactly what the server stores: bytes in, JSON out.
  // 30s, not 15s: a free-tier Render service sleeps after ~15 minutes idle and
  // takes up to a minute to wake. 15s would time out on the first photo after
  // a sleep, so the very first upload of the day would always look like a
  // failure even though the server was fine.
  http.setTimeout(30000);

  int code = http.POST((uint8_t*)data, len);

  if (code > 0) {
    String body = http.getString();
    // Keep the payload short in the log — the JSON is for humans skimming
    // the serial monitor, not for parsing here.
    if (body.length() > 220) body = body.substring(0, 220) + "…";
    Serial.printf("[cam] POST -> %d  %s\n", code, body.c_str());
  } else {
    Serial.printf("[cam] POST failed: %s\n", http.errorToString(code).c_str());
  }

  http.end();
  return code;
}

void setup() {
  Serial.begin(115200);
  delay(300);  // let the USB-UART finish enumerating before the first line

  pinMode(FLASH_GPIO_NUM, OUTPUT);
  digitalWrite(FLASH_GPIO_NUM, LOW);

  Serial.println("\n[cam] Smart Kitchen ESP32-CAM starting");

  if (!startCamera()) {
    // Without a camera there is nothing to do ever — blink a distinct pattern
    // and halt so the failure is obvious rather than looping obscure errors.
    Serial.println("[cam] halting: no camera");
    while (true) { blink(5, 200); delay(1000); }
  }

  connectWifi();
  lastCaptureAt = millis() - CAPTURE_INTERVAL_MS;  // first capture immediately
}

void loop() {
  unsigned long now = millis();

  if (now - lastCaptureAt < CAPTURE_INTERVAL_MS) {
    delay(500);
    return;
  }
  lastCaptureAt = now;

  // Reconnect if the router bounced — a dropped Wi-Fi must not stop the queue.
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[cam] WiFi lost, reconnecting…");
    connectWifi();
    if (!wifiReady) return;
  }

  Serial.println("[cam] capturing…");
  camera_fb_t* fb = capture();
  if (fb == NULL) {
    Serial.println("[cam] capture failed (frame buffer NULL)");
    blink(3, 60);
    return;
  }

  Serial.printf("[cam] frame %u bytes\n", (unsigned)fb->len);

  // Red blink = shutter. Short enough not to wash out the exposure we already
  // took, visible enough to tell "it tried" from "it hung".
  digitalWrite(FLASH_GPIO_NUM, HIGH);
  delay(60);
  digitalWrite(FLASH_GPIO_NUM, LOW);

  int code = uploadFrame(fb->buf, fb->len);
  esp_camera_fb_return(fb);

  if (code >= 200 && code < 300) {
    blink(2, 50);   // success: two quick blinks
  } else {
    blink(5, 100);  // failure: five slow blinks, readable through a window
  }
}
