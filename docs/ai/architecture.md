# Architecture and Data Flow

High-level components
- Firmware (ESP32-S3): TWAI driver + usermod
- Web UI: can.htm + common.js
- API: /json/can and /json/state

Data flow
1) TWAI driver receives CAN frames into the RX queue.
2) Usermod reads frames in loop(), stores them in a ring buffer, and tracks counters.
3) /json/can returns a lite payload by default (status + counters).
4) /json/can?full=1 returns recent frames plus status.
5) Web UI polls /json/can at a selected rate; frames are only fetched when Capture is enabled.

Key files
- usermods/usermod_can_twai/usermod_can_twai.h: TWAI driver, ring buffer, JSON exports.
- wled00/json.cpp: /json/can response handling (lite vs full).
- wled00/data/can.htm: UI layout, polling logic, and capture mode.

Notes
- Lite JSON reduces heap usage and avoids allocation failures.
- Capture mode triggers full frames to keep baseline traffic minimal.
