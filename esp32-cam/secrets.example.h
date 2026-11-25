/**
 * Smart Kitchen ESP32-CAM — credential template
 * =============================================
 *
 * This file holds PLACEHOLDERS ONLY and is safe to commit. The sketch includes
 * "secrets.h", not this file.
 *
 * One-time setup on your machine:
 *
 *     cp esp32-cam/secrets.example.h esp32-cam/secrets.h
 *
 * then open secrets.h and type your real values. secrets.h is listed in
 * .gitignore, so git never stages, commits or pushes it -- which is the whole
 * point: the Wi-Fi password and the device key stay on your machine.
 *
 * Do not rename secrets.h, do not edit this template with real values, and if
 * `git status` ever shows secrets.h, stop and remove it from the index with:
 *
 *     git rm --cached esp32-cam/secrets.h
 */

#ifndef SMART_KITCHEN_SECRETS_H
#define SMART_KITCHEN_SECRETS_H

// Your Wi-Fi network name (2.4 GHz only -- the ESP32 has no 5 GHz radio).
static const char* WIFI_SSID = "YOUR_WIFI_NAME";

// Your Wi-Fi password. Leave as "" for an open network.
static const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// Shared device key. Must match DEVICE_API_KEY exactly: backend/.env locally,
// Render -> Environment when deployed. Generate one with:
//   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
static const char* DEVICE_KEY = "PUT_YOUR_DEVICE_API_KEY_HERE";

#endif  // SMART_KITCHEN_SECRETS_H
