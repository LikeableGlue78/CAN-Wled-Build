# CAN Web UI Integration - Complete!

## Overview

Added a native WLED web UI page for the CAN/TWAI usermod with live monitoring, frame viewing, and reactive effects configuration.

## What Was Added

### 1. New CAN Monitor Page (`/can`)
- **URL**: `http://wled.local/can`
- **Access**: Click "CAN" button on WLED home screen navigation bar
- **Features**:
  - Live connection status monitoring
  - Real-time frame counter updates
  - Scrollable frames table with last 20 frames
  - Pause/Resume, Clear, and Copy JSON controls
  - Configurable poll rate (Slow/Normal/Fast: 1Hz/2Hz/5Hz)
  - CAN Reactive Effects dropdown (placeholder for future features)
  - Quick navigation to Home and Colors/Palette pages

### 2. JSON API Endpoint
- **Route**: `/json/can`
- **Purpose**: Lightweight endpoint for CAN-specific data (doesn't poll full state)
- **Returns**:
  ```json
  {
    "uptime": 123456,
    "nowMs": 123456,
    "can": {
      "enabled": true,
      "started": true,
      "bitrate": 500000,
      "rxPin": 4,
      "txPin": 5,
      "listenOnly": true,
      "rxCount": 1234,
      "txCount": 0,
      "errors": 0,
      "overruns": 0,
      "lastFrameMs": 123400,
      "msSinceFrame": 56,
      "uiEffect": 0,
      "uiPollRate": 2
    },
    "frames": [
      {
        "id": 512,
        "ext": false,
        "rtr": false,
        "dlc": 8,
        "t_ms": 123400,
        "data": [0,1,2,3,4,5,6,7]
      },
      ...
    ]
  }
  ```

### 3. Usermod Enhancements
- Added `/json/can` endpoint handler
- Added `readFromJsonState()` to accept UI settings
- Persisted UI settings: `uiPollRate` (0-2), `uiEffect` (0-2)
- Exposed last 20 frames instead of 10
- Added `msSinceFrame` calculation for live status indicator

### 4. Home Screen Integration
- Added "CAN" navigation button on main WLED interface
- Icon: 🚗 (&#xe531; - car icon from WLED icon font)
- Positioned between "Info" and "Nodes" buttons

## Manual Test Checklist

### ✅ Pre-Flight Checks
- [x] Firmware builds successfully
- [x] Firmware flashed without errors
- [x] ESP32-S3 boots normally
- [x] WLED web interface loads

### 🏠 Home Screen
- [ ] "CAN" button appears in top navigation bar
- [ ] "CAN" button has car icon
- [ ] Clicking "CAN" button navigates to `/can`

### 🚗 CAN Page - Initial Load
- [ ] Page loads at `http://wled.local/can`
- [ ] Title shows "🚗 CAN Bus Monitor"
- [ ] "Home" and "Colors" buttons visible at top-right
- [ ] Status card shows connection info
- [ ] Statistics card shows counters (all zeros if no traffic)
- [ ] CAN Reactive Effects dropdown shows 3 options
- [ ] Frames table shows "No frames received yet" message
- [ ] Poll rate dropdown defaults to "Fast (5 Hz)"

### 📊 CAN Page - With CAN Traffic
**Prerequisites**: CAN transceiver wired, vehicle CAN bus connected

- [ ] Status badge changes from "Loading" → "Waiting" → "Receiving"
- [ ] Bitrate shows configured value (e.g., "500 kbps")
- [ ] Mode shows "Listen-Only"
- [ ] Pins show correct RX/TX pins (e.g., "4/5")
- [ ] "Last Frame" updates in real-time (e.g., "123 ms ago")
- [ ] RX Count increments continuously
- [ ] TX Count stays at 0 (listen-only)
- [ ] Errors and Overruns stay at 0 (if bus is healthy)

### 📋 Frames Table
- [ ] Table populates with frames as they arrive
- [ ] Newest frames appear at top
- [ ] Columns show: Time, ID (hex), Type, DLC, Data (hex), Label
- [ ] Time shows relative time (e.g., "123 ms")
- [ ] ID shows in hex format (e.g., "0x200")
- [ ] Type shows "STD" or "EXT" correctly
- [ ] DLC shows correct data length (0-8)
- [ ] Data bytes show in hex (e.g., "01 23 45 67 89 AB CD EF")
- [ ] Table scrolls horizontally on narrow screens
- [ ] Table scrolls vertically when > ~10 frames

### 🎮 Controls
- [ ] **Pause button**: Click "⏸ Pause"
  - Button changes to "▶ Resume"
  - Yellow "PAUSED" banner appears
  - Frames stop updating
  - Click "▶ Resume" to continue
- [ ] **Clear button**: Click "🗑 Clear"
  - Frames table empties
  - Shows "Frames cleared" message
  - New frames populate after clearing
- [ ] **Copy JSON button**: Click "📋 Copy JSON"
  - Alert shows "Frames JSON copied to clipboard!"
  - Paste into text editor shows valid JSON array
- [ ] **Poll Rate dropdown**: Change from Fast → Normal → Slow
  - Updates are visibly slower at lower rates
  - Setting persists on page reload

### 🎨 CAN Reactive Effects
- [ ] Dropdown shows "None (default WLED)" selected
- [ ] Change to "RPM Pulse (coming soon)"
  - Selection persists on page reload
  - POST to `/json/state` with `{"can":{"uiEffect":1}}`
- [ ] Change to "Speed Sweep (coming soon)"
  - Selection persists on page reload
  - POST to `/json/state` with `{"can":{"uiEffect":2}}`

### 🧭 Navigation
- [ ] Click "🏠 Home" button → Returns to WLED main page
- [ ] Click "🎨 Colors" button → Opens WLED at `/#Colors` section
- [ ] Browser back button works correctly
- [ ] Direct URL (`/can`) loads page correctly

### 📱 Responsive Design
**Test on narrow screen (< 600px)**
- [ ] Header stacks CAN" title on top, buttons below
- [ ] Status grid wraps to fewer columns
- [ ] Controls wrap to multiple rows
- [ ] Frames table uses smaller fonts
- [ ] Horizontal scroll works for wide data
- [ ] No horizontal overflow issues

### 🔄 Auto-Refresh
- [ ] Page updates every ~200ms (Fast mode)
- [ ] Counters increment in real-time
- [ ] "Last Frame" time updates continuously
- [ ] Status badge changes appropriately (Receiving/Idle)
- [ ] No visible flickering or lag

### 🛡️ Error Handling
- [ ] With CAN disabled in usermod settings:
  - Status shows "Disabled" badge (red)
  - Frames table shows waiting message
- [ ] With CAN enabled but failed to start:
  - Status shows "Failed" badge (red)
- [ ] With no CAN traffic for > 5 seconds:
  - Status shows "Idle" badge (yellow)
  - "Last Frame" shows seconds (e.g., "10 s ago")
- [ ] With network error:
  - Status shows "Error" badge (red)
  - Console shows fetch error

### 💾 Persistence
- [ ] Poll rate setting survives page reload
- [ ] CAN effect selection survives page reload
- [ ] Settings persist across ESP32 reboots

## Files Modified

### Usermod
- `usermods/usermod_can_twai/usermod_can_twai.h` - Added `/json/can` endpoint, UI settings, readFromJsonState

### Web UI
- `wled00/data/can.htm` - New CAN monitor page (13,677 bytes → 3,342 bytes compressed)
- `wled00/data/index.htm` - Added "CAN" button to home screen navigation
- `tools/cdata.js` - Added `PAGE_can` to build pipeline
- `wled00/wled_server.cpp` - Registered `/can` route

### Generated
- `wled00/html_other.h` - Now includes compressed can.htm (PAGE_can)
- `wled00/html_ui.h` - Updated with CAN button in index.htm

## Build Info
- **Size**: 1,203,997 bytes (38.3% of flash, +5KB from base)
- **Compressed CAN page**: 3,342 bytes (from 13,677 bytes)
- **Build time**: ~12 seconds (incremental)
- **Flash time**: ~26 seconds

## Known Limitations / Future Enhancements

### Current Limitations
1. **Effects are placeholders** - "RPM Pulse" and "Speed Sweep" don't do anything yet (usermod needs effect logic)
2. **No frame filtering** - Shows all frames, no ID whitelist/blacklist
3. **No DBC decoding** - "Label" column is always "--" (needs DBC file parser)
4. **Maximum 32 frames** - Ring buffer limited by `CAN_FRAME_BUFFER_SIZE`
5. **No transmit UI** - Only shows receive statistics (intentional safety feature)

### Planned Enhancements
1. **Frame filtering UI** - Add whitelist/blacklist for specific CAN IDs
2. **DBC file upload** - Parse and decode signals (e.g., "Engine RPM: 2500")
3. **Reactive effects** - Implement actual LED effects driven by CAN data:
   - RPM Pulse: Brightness pulses with engine RPM
   - Speed Sweep: Color chase speed matches vehicle speed
   - Custom effects using usermod API
4. **Frame statistics** - Per-ID frame rates, histograms
5. **Export/Import** - Save/load CAN logs to SD card
6. **Advanced filtering** - By extended/standard, by DLC, by data patterns
7. **Transmit UI** - For advanced users (with safety warnings)
8. **Graph view** - Real-time plots of decoded signals

## Usage Instructions

### Accessing the CAN Page
1. Open WLED web interface: `http://wled.local/`
2. Click the "CAN" button in the top navigation bar
3. Or directly visit: `http://wled.local/can`

### Monitoring CAN Traffic
1. Ensure usermod is enabled (Config → Usermod Settings → CAN_TWAI)
2. Wire CAN transceiver to vehicle bus
3. Open CAN page
4. Watch status change from "Waiting" → "Receiving"
5. Frames populate automatically in the table

### Using Poll Rate
- **Slow (1 Hz)**: Updates once per second - conserves bandwidth
- **Normal (2 Hz)**: Updates twice per second - balanced
- **Fast (5 Hz)**: Updates 5 times per second - most responsive (default)

### Pausing/Resuming
- Click "⏸ Pause" to freeze the display while examining frames
- Click "▶ Resume" to continue live updates
- Useful when debugging specific frame sequences

### Copying Frame Data
1. Click "📋 Copy JSON" button
2. Paste into text editor or analysis tool
3. JSON format is easy to parse in Python/JavaScript

### Configuring Reactive Effects
1. Select effect from "CAN Reactive Effects" dropdown
2. Effect setting is saved to usermod config
3. Effect implementation is in usermod (placeholder for now)

## Developer Notes

### Adding New Effects
To implement new CAN-reactive effects in the usermod:

1. Read `uiEffect` value from config
2. In `loop()`, check current effect:
   ```cpp
   if (uiEffect == 1) { // RPM Pulse
     // Read CAN frames for specific ID
     // Calculate RPM from data bytes
     // Modulate LED brightness based on RPM
   } else if (uiEffect == 2) { // Speed Sweep
     // Similar logic for speed
   }
   ```
3. Update WLED effects via usermod API
4. Document mapping of CAN IDs to effects

### Customizing Frame Display
To show more/fewer frames, edit `usermod_can_twai.h`:
```cpp
uint8_t uiFrameCount = 20;  // Change this value
```

### Adding Frame Labels
To decode frames and populate the "Label" column:
1. Add DBC parser to usermod
2. Map CAN ID → Signal name
3. Add label to frame JSON: `frameObj["label"] = "Engine RPM: 2500";`
4. UI will display automatically

## Support

For issues or enhancements:
- Check WLED Discord: #usermods channel
- Review usermod README: `usermods/usermod_can_twai/readme.md`
- ESP32 TWAI docs: https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/peripherals/twai.html

---

**Status**: ✅ COMPLETE - Ready for testing!
