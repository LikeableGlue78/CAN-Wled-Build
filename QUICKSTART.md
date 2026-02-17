# WLED CAN/TWAI Integration - Quick Start Guide

## What Was Built

A complete WLED firmware with CAN bus support for ESP32-S3 N16R8 (16MB flash, 8MB PSRAM) using the HiLetgo SN65HVD230 CAN transceiver module.

## Hardware Setup

### Parts Needed
- ESP32-S3 development board (16MB flash / 8MB PSRAM)
- HiLetgo SN65HVD230 CAN transceiver module
- Breadboard and jumper wires (or solder)
- Vehicle CAN bus tap (OBD-II cable or direct wiring)

### Wiring (SN65HVD230 → ESP32-S3)

| SN65HVD230 | ESP32-S3 | Notes |
|------------|----------|-------|
| 3V3        | 3.3V     | **DO NOT use 5V!** |
| GND        | GND      | Common ground |
| CTX        | GPIO 5   | CAN TX (default, configurable) |
| CRX        | GPIO 4   | CAN RX (default, configurable) |
| CANH       | Vehicle CANH | High side of CAN bus |
| CANL       | Vehicle CANL | Low side of CAN bus |
| RS (if present) | GND | Normal operation mode |

**Important Notes:**
- The transceiver is **3.3V only** - do NOT use 5V power
- If your module has a 120Ω termination resistor, **disable it** when tapping mid-bus (your car already has termination at both ends)
- Start with **listen-only mode** (default) - no transmit, safe for testing
- Most cars use **500 kbps** CAN speed (default setting)

### Vehicle CAN Bus Connection

**Option 1: OBD-II Port (Easiest)**
- Pin 6 = CANH (CAN High)
- Pin 14 = CANL (CAN Low)
- Pin 4 or 5 = Ground

**Option 2: Direct Wiring**
- Locate CAN bus wires behind dashboard or at ECU
- Use a multimeter: CANH ~2.5-3.5V idle, CANL ~1.5-2.5V idle
- Tap into wires (don't cut!) using T-taps or splice connectors

## Software Setup

### 1. Flash the Firmware

The firmware is already built at:
```
build_output/release/WLED_16.0-alpha_ESP32-S3_16MB_opi.bin
```

**Using esptool.py (command line):**
```bash
esptool.py --port COM3 write_flash 0x0 build_output/release/WLED_16.0-alpha_ESP32-S3_16MB_opi.bin
```

**Using ESP Flash Download Tool (GUI, Windows):**
1. Download from https://www.espressif.com/en/support/download/other-tools
2. Select ESP32-S3 chip
3. Load the .bin file at address 0x0
4. Select your COM port
5. Click "START"

**Using PlatformIO (if you have it):**
```bash
cd "r:\Supa Files\CAN Wled Build"
pio run -e esp32s3dev_16MB_opi_can --target upload
```

### 2. Initial WLED Setup

1. Power on the ESP32-S3
2. Connect to WiFi network "WLED-AP" (password: wled1234)
3. Browser will auto-open to 4.3.2.1, or manually go to http://4.3.2.1
4. Click "WIFI SETUP" and connect to your WiFi network
5. Note the IP address assigned (or use http://wled.local)

### 3. Configure CAN/TWAI Usermod

**Via Web UI:**
1. Go to http://wled.local (or the IP address)
2. Click **Config** → **Usermod Settings**
3. Find **CAN_TWAI** section
4. Configure:
   - **enabled**: ☑ (checked)
   - **bitrate**: 500000 (for 500 kbps, most common)
   - **rxPin**: 4 (or your chosen GPIO)
   - **txPin**: 5 (or your chosen GPIO)
   - **listenOnly**: ☑ (checked - KEEP THIS ON for safety!)
5. Click **Save**
6. Device will restart

**Trying Different Bitrates:**
If you don't see frames, try these common speeds:
- 500000 (500 kbps) - most common
- 250000 (250 kbps) - comfort systems
- 125000 (125 kbps) - older vehicles

### 4. Verify CAN Data Reception

**Method 1: JSON Info API**
Visit: `http://wled.local/json/info`

Look for:
```json
{
  "u": {
    "CAN Bus": {
      "Status": "Running",
      "Mode": "Listen-Only",
      "Bitrate": [500, " kbps"],
      "RX Frames": 1234
    }
  }
}
```

**Method 2: JSON State API**
Visit: `http://wled.local/json/state`

Scroll down to find detailed CAN data:
```json
{
  "can": {
    "enabled": true,
    "bitrate": 500000,
    "rxPin": 4,
    "txPin": 5,
    "listenOnly": true,
    "rxCount": 1234,
    "errors": 0,
    "recentFrames": [
      {
        "id": 512,
        "ext": false,
        "dlc": 8,
        "data": [0, 1, 2, 3, 4, 5, 6, 7],
        "time": 123456
      }
    ]
  }
}
```

## Troubleshooting

### No Frames Received (`"rxCount": 0`)

1. **Check wiring:**
   - Verify CTX connects to GPIO 5 (or your configured TX pin)
   - Verify CRX connects to GPIO 4 (or your configured RX pin)
   - Confirm 3.3V and GND connections

2. **Swap RX/TX pins:**
   - Some modules label pins differently
   - Try swapping rxPin and txPin in settings

3. **Try different bitrate:**
   - Start with 500000
   - Try 250000 if no success
   - Try 125000 for older vehicles

4. **Check RS pin (if present):**
   - Some SN65HVD230 modules have an RS/STB pin
   - Must be tied to GND for normal operation
   - If floating or pulled high, transceiver won't work

5. **Verify vehicle CAN bus:**
   - Use multimeter on CANH/CANL
   - Should see voltage activity when vehicle is running
   - CANH idle: ~2.5-3.5V, CANL idle: ~1.5-2.5V

### High Error Count (`"errors": >0`)

- **Wrong bitrate:** Try different speeds
- **Bad connections:** Check all wiring
- **Electrical noise:** Add 0.1µF capacitor between 3V3 and GND near transceiver
- **Termination issues:** Ensure built-in 120Ω resistor is disabled

### ESP32 Crashes/Resets

- **Insufficient power:** Use quality USB cable and power supply
- **Wrong GPIO pins:** Avoid strapping pins (0, 45, 46) and USB pins (19, 20)
- **PSRAM conflict:** Avoid GPIO 26-32 on some S3 boards

### Status Shows "Error - Failed to start"

- **Invalid GPIO pins:** Check that rxPin and txPin are valid for your board
- **GPIO conflict:** Pins may be used by PSRAM/flash or other peripherals
- Check serial monitor for error messages

## Next Steps

### Decoding CAN Messages

1. **Identify messages:**
   - Watch `recentFrames` in `/json/state`
   - Note the `id` values of interesting frames
   - Example: ID 0x200 might be engine RPM

2. **Parse data bytes:**
   - CAN data is in the `data` array (8 bytes max)
   - You'll need a DBC file or reverse-engineering for your vehicle
   - Example: RPM might be in bytes 2-3 as `(data[2] << 8) | data[3]`

3. **Create LED effects:**
   - Modify WLED to respond to CAN data
   - Example: Brightness based on speed, color based on RPM
   - Add custom effects in usermods or integrate with existing WLED effects

### Advanced Features (Future Enhancements)

- **CAN ID filtering:** Only receive specific messages you care about
- **Transmit capability:** Send CAN frames (be VERY careful!)
- **DBC file support:** Auto-decode CAN signals
- **MQTT integration:** Publish CAN data to Home Assistant
- **OBD-II queries:** Request diagnostic data (requires transmit)
- **Custom web UI:** Real-time CAN monitor page

## Testing Without a Vehicle

### CAN Bus Simulator

Use another ESP32 with a CAN transceiver to send test frames:
```cpp
#include "driver/twai.h"

void setup() {
  twai_general_config_t g_config = TWAI_GENERAL_CONFIG_DEFAULT(GPIO_NUM_5, GPIO_NUM_4, TWAI_MODE_NORMAL);
  twai_timing_config_t t_config = TWAI_TIMING_CONFIG_500KBITS();
  twai_filter_config_t f_config = TWAI_FILTER_CONFIG_ACCEPT_ALL();
  
  twai_driver_install(&g_config, &t_config, &f_config);
  twai_start();
}

void loop() {
  twai_message_t message;
  message.identifier = 0x123;
  message.data_length_code = 8;
  for (int i = 0; i < 8; i++) message.data[i] = i;
  
  twai_transmit(&message, pdMS_TO_TICKS(100));
  delay(100);
}
```

## Safety Reminders

⚠️ **CRITICAL SAFETY WARNINGS:**

1. **Listen-only mode:** Keep `listenOnly` enabled until you understand your vehicle's CAN bus completely
2. **Do NOT transmit randomly:** Sending unknown CAN frames can cause unpredictable vehicle behavior
3. **Test safely:** Always test with vehicle in Park and parking brake engaged
4. **Ground properly:** Poor grounding can cause communication issues and potential damage
5. **Bus loading:** Don't add termination resistors when tapping mid-bus
6. **Power protection:** Use proper voltage regulation if powered from vehicle

## Support & Resources

- **WLED Documentation:** https://kno.wled.ge/
- **ESP32 TWAI Driver Docs:** https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/peripherals/twai.html
- **Usermod README:** `usermods/usermod_can_twai/readme.md`
- **WLED Discord:** Join for community support

## Build Information

- **WLED Version:** 16.0-alpha
- **Build Date:** 2026-02-16
- **Environment:** esp32s3dev_16MB_opi_can
- **Flash Size:** 16MB
- **PSRAM:** 8MB
- **Build Output:** `build_output/release/WLED_16.0-alpha_ESP32-S3_16MB_opi.bin`
- **Firmware Size:** ~1.2 MB (38.1% of flash partition)
- **RAM Usage:** ~48 KB (14.7% of available RAM)

## Files Created

```
usermods/usermod_can_twai/
├── usermod_can_twai.h       - Main usermod implementation
├── usermod_can_twai.cpp     - Compilation helper
├── library.json             - PlatformIO library metadata
└── readme.md                - Detailed documentation

wled00/const.h               - Added USERMOD_ID_CAN_TWAI (ID 59)
platformio.ini               - Added esp32s3dev_16MB_opi_can environment
```

## License

This usermod is released under the MIT License, same as WLED.

---

**Happy CAN bus monitoring! Drive safely! 🚗💡**
