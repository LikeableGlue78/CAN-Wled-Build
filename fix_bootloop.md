# ESP32-S3 Bootloop Fix Guide

## Current Issue
Device is resetting at ROM bootloader stage (rst:0x3 RTC_SW_SYS_RST) before WLED starts.

## Solutions to Try (in order)

### 1. Full Flash Erase + Reflash
```powershell
# Erase everything
platformio run -e esp32s3dev_16MB_opi_can -t erase

# Rebuild and upload
platformio run -e esp32s3dev_16MB_opi_can -t upload
```

### 2. Power Supply Check
ESP32-S3 with 8MB PSRAM can draw 400-500mA during boot:
- Use a quality USB cable (data + power rated)
- Try a powered USB hub or dedicated 5V power supply
- Add 100-220µF capacitor between 3.3V and GND near the ESP32

### 3. Try Base ESP32-S3 Build (without CAN)
CAN GPIO pins might conflict with boot:
```powershell
# Build basic S3 firmware first
platformio run -e esp32s3dev_16MB_opi -t upload
```

### 4. Check Flash Mode Configuration
Your current build uses `qio_opi` for PSRAM. Try safer flash mode:

Add to platformio.ini under esp32s3dev_16MB_opi_can:
```ini
board_build.flash_mode = dio  ; More compatible than qio
```

### 5. Disable PSRAM Temporarily
Test if PSRAM is causing issues:
```ini
; Comment out PSRAM in build_flags:
; -DBOARD_HAS_PSRAM
```

### 6. Check GPIO Pins (CAN specific)
If using CAN transceiver, ensure:
- TX/RX pins are NOT strapping pins (0, 3, 45, 46)
- NOT USB pins (19, 20)
- NOT PSRAM pins (26-32 on some boards)

Recommended CAN pins for ESP32-S3:
- TX: GPIO 4, 5, 6, 7, 8, 9
- RX: GPIO 10, 11, 12, 13, 14, 15

### 7. Monitor with Exception Decoder
After any fix attempt:
```powershell
platformio device monitor -e esp32s3dev_16MB_opi_can --filter esp32_exception_decoder
```

## Understanding Reset Codes
- `rst:0x3 (RTC_SW_SYS_RST)` = Software reset (watchdog or panic)
- `rst:0x8` = Brownout/power issue
- `rst:0x10` = RTC watchdog timeout

## WLED Bootloop Protection
WLED has built-in bootloop detection, but it only works if the device boots far enough to run the application. Your device isn't reaching that stage.
