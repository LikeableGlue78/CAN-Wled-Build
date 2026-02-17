# Project Overview

Goal
- Add CAN (TWAI) receive support to WLED for ESP32-S3, with a native web UI page for live monitoring.
- Prioritize stability on high-traffic buses by defaulting to lightweight JSON and optional frame capture.

Scope
- Firmware usermod: TWAI driver setup, receive loop, ring buffer, JSON export, and config persistence.
- Web UI: dedicated CAN monitor page with status, counters, and optional frames view.
- API: /json/can endpoint with lite and full modes.

Non-goals (current)
- Transmit support (listen-only by default).
- Full decoding of signals (frames are displayed raw).
- Complex visual effects driven by CAN data (placeholders only).

Key Design Choices
- Listen-only mode enabled by default for safety.
- JSON payload is lite by default to reduce memory pressure.
- Full frames are only returned on explicit request or Capture mode.

Status Summary
- CAN usermod is registered and active on ESP32-S3 builds.
- /json/can works in lite and full modes.
- Web UI shows pins, bitrate, counters, and optional frames.
