# CAN UI Behavior

Polling
- The UI polls /json/can at the selected rate.
- When Capture is off, it requests lite data only.
- When Capture is on, it requests full frames.

Frames table
- Shows the last 20 frames in reverse order (newest first).
- Filters operate client-side on the fetched frame list.

Capture
- Capture runs for 10 seconds and exports JSON.
- Capture is intended for short snapshots to reduce load.

Performance
- The UI shows a simple fps indicator based on rxCount deltas.
- For highest performance, keep Capture off.
