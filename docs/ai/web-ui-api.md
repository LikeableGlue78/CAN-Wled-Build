# Web UI and API

Web UI
- Page: /can (wled00/data/can.htm)
- Poll rate: selectable (1, 2, 5, 10 Hz)
- Capture mode: when enabled, the UI requests full frames

API endpoints
- /json/can
  - Lite response (status + counters only)
  - Used for normal polling to reduce load
- /json/can?full=1
  - Adds frames array
  - Only used for Capture mode
- /json/can?ping=1
  - Returns plain text can_ok for connectivity checks

JSON schema (lite)
- uptime: millis
- nowMs: millis
- can: object
  - enabled, started, bitrate, listenOnly
  - rxPin, txPin
  - rxQueueLen
  - filterEnabled, filterExt, filterId, filterMask
  - rxCount, txCount, errors, overruns
  - lastFrameMs, msSinceFrame

JSON schema (full)
- All lite fields plus:
- frames: array of recent frames
  - id, ext, rtr, dlc, t_ms, data[]

Settings persistence
- Usermod config keys:
  - enabled, bitrate, rxPin, txPin, listenOnly
  - rxQueueLen
  - filterEnabled, filterExt, filterId, filterMask
  - uiPollRate, uiEffect

Notes
- The frames array is only produced when requested to avoid memory pressure.
- If memory allocation fails, keep the UI in lite mode and enable Capture only when needed.
