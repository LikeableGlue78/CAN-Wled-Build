# CAN/TWAI Usermod for WLED

This usermod adds CAN bus (Controller Area Network) receive support to WLED using the ESP32's built-in TWAI (Two-Wire Automotive Interface) controller. It's designed for ESP32-S3 boards with 16MB flash and 8MB PSRAM, using an external SN65HVD230 CAN transceiver module.

## Features

- **Receive-only mode** (listen-only) by default for safety - won't transmit on your vehicle's CAN bus
- **Configurable bitrate** (25k, 50k, 100k, 125k, 250k, 500k, 800k, 1000 kbps)
- **Configurable GPIO pins** for RX and TX
- **Ring buffer** stores last 32 received CAN frames
- **JSON API** exposes CAN data via `/json/info` and `/json/state`
- **Settings UI** integration for easy configuration
- **Statistics tracking**: frames received, bus errors, buffer overruns

## Hardware Requirements

### Parts
- **ESP32-S3** development board (16MB flash, 8MB PSRAM recommended)
- **HiLetgo SN65HVD230 CAN transceiver module** (or equivalent)
- **CAN bus tap** (to connect to your vehicle's CAN bus)

### Wiring

Connect the SN65HVD230 module to your ESP32-S3 as follows:

| SN65HVD230 Pin | ESP32-S3 Pin | Notes |
|----------------|--------------|-------|
| 3V3            | 3.3V         | Power supply (DO NOT use 5V!) |
| GND            | GND          | Ground |
| CTX            | GPIO 5       | CAN TX (default, configurable) |
| CRX            | GPIO 4       | CAN RX (default, configurable) |
| CANH           | Vehicle CANH | Connect to vehicle CAN bus |
| CANL           | Vehicle CANL | Connect to vehicle CAN bus |
| RS (if present)| GND          | Ties transceiver to normal mode (some boards only) |

**Important Notes:**
- The transceiver must be powered with **3.3V**, not 5V
- Some SN65HVD230 breakout boards have an RS (slope control/standby) pin - tie it to GND for normal operation
- Some boards have a built-in 120Ω termination resistor - this should typically be **disabled/removed** when tapping into a vehicle CAN bus mid-stream (the bus should already have termination at both ends)

### GPIO Pin Selection

The default pins are GPIO 4 (RX) and GPIO 5 (TX), but you can configure any available GPIOs. Avoid these on ESP32-S3:
- **GPIO 0**: Boot mode selection (strapping pin)
- **GPIO 19, 20**: USB D- and D+ (if using USB-OTG)
- **GPIO 26-32**: Used for PSRAM/Flash on some boards
- **GPIO 45**: Strapping pin
- **GPIO 46**: Strapping pin

Safe choices include GPIO 1-18, 21, 33-39, 47-48 (but verify your specific board's schematic).

## Vehicle CAN Bus

### Typical Bitrates
Most modern vehicles use one of these CAN bus speeds:
- **500 kbps** - Most common (powertrain, body control)
- **250 kbps** - Comfort systems (lights, windows, seats)
- **125 kbps** - Older vehicles
- **1000 kbps** - High-speed diagnostics

Start with **500 kbps** - it's the most common. If you don't see any frames, try 250 kbps.

### Finding Your Vehicle's CAN Bus

Common locations:
- **OBD-II port** (pins 6 and 14): CANH and CANL
- **Behind the dashboard** (instrument cluster connectors)
- **Near the BCM** (Body Control Module)

Use a multimeter to verify voltage levels:
- CANH idle: ~2.5-3.5V
- CANL idle: ~1.5-2.5V
- Differential voltage when active: ~1-2V

### Safety Warnings

⚠️ **IMPORTANT SAFETY CONSIDERATIONS:**

1. **Listen-only mode**: Keep `listenOnly` enabled (true) until you thoroughly understand your vehicle's CAN bus. Transmitting random data can cause unpredictable behavior or even damage.

2. **No termination resistor**: Your vehicle's CAN bus already has 120Ω termination resistors at both ends. Adding another can disrupt communication.

3. **Proper grounding**: Connect the ESP32 ground to your vehicle's ground to prevent ground loops and ensure reliable operation.

4. **Power supply**: Use a proper voltage regulator if powering from the vehicle. Car electrical systems can have voltage spikes and noise.

5. **Test in park**: Always test with the vehicle in Park/Neutral and the parking brake engaged.

## Software Setup

### 1. Enable the Usermod

Edit `wled00/usermods_list.cpp` and add:

```cpp
#include "../usermods/usermod_can_twai/usermod_can_twai.h"
```

And in the `registerUsermods()` function:

```cpp
#ifdef USERMOD_CAN_TWAI
  usermods.add(new UsermodCANTWAI());
#endif
```

### 2. Add Usermod ID

Edit `wled00/const.h` and add this to the usermod ID section:

```cpp
#define USERMOD_ID_CAN_TWAI 47  // Choose an unused ID number
```

### 3. Configure Build

In your `platformio_override.ini` (or `platformio.ini`), add the usermod define:

```ini
[env:esp32s3dev_16MB_opi_can]
extends = env:esp32s3dev_16MB_opi
build_flags = 
  ${env:esp32s3dev_16MB_opi.build_flags}
  -D USERMOD_CAN_TWAI
```

### 4. Build and Flash

```bash
pio run -e esp32s3dev_16MB_opi_can --target upload
```

## Configuration

### Via Web UI

1. Open WLED web interface
2. Go to **Config** → **Usermod Settings**
3. Find **CAN_TWAI** section
4. Configure:
   - **enabled**: Enable/disable the usermod
   - **bitrate**: CAN bus speed in bps (e.g., 500000 for 500 kbps)
   - **rxPin**: GPIO for receiving (connects to CRX)
   - **txPin**: GPIO for transmitting (connects to CTX)
   - **listenOnly**: Keep true for receive-only mode (recommended)

### Via JSON API

POST to `/json/cfg` or edit `cfg.json` directly:

```json
{
  "CAN_TWAI": {
    "enabled": true,
    "bitrate": 500000,
    "rxPin": 4,
    "txPin": 5,
    "listenOnly": true
  }
}
```

## Viewing CAN Data

### JSON Info Endpoint

Visit `http://wled.local/json/info` to see basic CAN status:

```json
{
  "u": {
    "CAN Bus": {
      "Status": "Running",
      "Mode": "Listen-Only",
      "Bitrate": [500, " kbps"],
      "RX Frames": 1234,
      "Last Frame": [5, " sec ago"]
    }
  }
}
```

### JSON State Endpoint

Visit `http://wled.local/json/state` for detailed frame data:

```json
{
  "can": {
    "enabled": true,
    "bitrate": 500000,
    "rxPin": 4,
    "txPin": 5,
    "listenOnly": true,
    "rxCount": 1234,
    "txCount": 0,
    "errors": 0,
    "overruns": 0,
    "recentFrames": [
      {
        "id": 512,
        "ext": false,
        "rtr": false,
        "dlc": 8,
        "data": [0, 1, 2, 3, 4, 5, 6, 7],
        "time": 123456
      }
    ]
  }
}
```

### Frame Data Explanation

- **id**: CAN identifier (11-bit standard or 29-bit extended)
- **ext**: true if extended 29-bit ID
- **rtr**: true if Remote Transmission Request
- **dlc**: Data Length Code (0-8 bytes)
- **data**: Array of data bytes
- **time**: Timestamp when frame was received (milliseconds since boot)

## Troubleshooting

### No Frames Received

1. **Check wiring**: Verify CTX→GPIO5, CRX→GPIO4, CANH/CANL to vehicle
2. **Swap RX/TX pins**: Some modules label pins differently - try swapping in config
3. **Try different bitrate**: Start with 500k, then try 250k
4. **Check RS/STB pin**: If your transceiver has an RS pin, make sure it's tied to GND
5. **Verify vehicle bus**: Use a multimeter to check voltage on CANH/CANL
6. **Check serial monitor**: Look for "CAN: TWAI driver started successfully" message

### Bus Errors

- **Incorrect bitrate**: Try different speeds (500k, 250k, 125k)
- **Poor connections**: Check all wiring, especially ground
- **Electrical noise**: Add filtering capacitors (0.1µF) near transceiver power pins
- **Wrong termination**: Ensure any built-in 120Ω resistor is disabled

### Buffer Overruns

- High CAN bus traffic can overflow the 32-frame buffer
- This is normal on very busy buses
- Consider increasing `CAN_FRAME_BUFFER_SIZE` in the code if needed

### ESP32 Crashes

- **Bad GPIO pins**: Make sure you're not using strapping pins or pins used by PSRAM/Flash
- **Power issues**: Ensure adequate power supply (ESP32-S3 + LEDs can draw significant current)
- **Watchdog timeout**: Very high CAN traffic might cause watchdog resets - check serial output

## Advanced Usage

### Filtering CAN IDs

Currently, the usermod accepts all CAN frames. To filter specific IDs, modify the `initTWAI()` function to use a custom filter instead of `TWAI_FILTER_CONFIG_ACCEPT_ALL()`.

Example to accept only ID 0x123:
```cpp
twai_filter_config_t f_config = {
  .acceptance_code = (0x123 << 21),
  .acceptance_mask = ~(0x7FF << 21),
  .single_filter = true
};
```

### Transmitting CAN Frames

To enable transmission:
1. Set `listenOnly` to false in configuration
2. Add a transmit function:

```cpp
bool transmitFrame(uint32_t id, const uint8_t* data, uint8_t len, bool extended = false) {
  if (!twaiStarted || listenOnlyMode) return false;
  
  twai_message_t message;
  message.identifier = id;
  message.data_length_code = len;
  message.extd = extended;
  message.rtr = false;
  message.ss = 0;
  message.self = 0;
  message.dlc_non_comp = 0;
  
  for (int i = 0; i < len && i < 8; i++) {
    message.data[i] = data[i];
  }
  
  return (twai_transmit(&message, pdMS_TO_TICKS(100)) == ESP_OK);
}
```

⚠️ **WARNING**: Only transmit if you know what you're doing! Random CAN messages can cause unpredictable vehicle behavior.

## Future Enhancements

Potential features for future versions:
- Custom CAN ID filters (whitelist/blacklist)
- Transmit capability with safety checks
- DBC file support for message decoding
- Custom web UI page for real-time CAN monitoring
- MQTT publishing of CAN data
- OBD-II (SAE J1979) diagnostic query support
- Save/replay CAN traffic logs

## License

This usermod is released under the same license as WLED (MIT License).

## Credits

Created for ESP32-S3 N16R8 with HiLetgo SN65HVD230 CAN transceiver module.

Based on ESP-IDF TWAI driver documentation:
https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/peripherals/twai.html

## Support

For issues or questions about this usermod:
1. Check the troubleshooting section above
2. Review ESP32 TWAI driver documentation
3. Post in WLED Discord or GitHub discussions
