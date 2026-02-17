# Hardware Integration

Target
- ESP32-S3 N16R8 (16MB flash, 8MB PSRAM)
- CAN transceiver: SN65HVD230 or equivalent (3.3V)

Default pins
- RX: GPIO4
- TX: GPIO5

Wiring
- ESP32-S3 RX (GPIO4) -> Transceiver CRX
- ESP32-S3 TX (GPIO5) -> Transceiver CTX
- 3.3V -> VCC
- GND -> GND
- CANH/CANL -> vehicle bus

Bus considerations
- Confirm bitrate (commonly 500k on CAN-C; CAN-IHS often 125k or 250k).
- Use a short, twisted pair for CANH/CANL.
- Avoid adding extra termination unless you are at the physical end of the bus.

Runtime behavior
- Listen-only mode by default for safety.
- If frames are not received, check bitrate, wiring, and pin conflicts.
- Overruns usually indicate the RX queue or processing cannot keep up.

Performance controls
- Increase rxQueueLen to reduce overruns.
- Use filters to drop unwanted IDs.
- Keep /json/can in lite mode unless capturing frames.
