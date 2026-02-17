# CAN Performance Tuning

Symptoms
- Overruns high: RX queue or processing cannot keep up.
- Errors: bitrate mismatch, termination issues, noise, or wiring problems.

Tuning steps
1) Increase rxQueueLen (128 or 256).
2) Enable ID filtering to drop irrelevant traffic.
3) Keep /json/can in lite mode and only fetch frames in capture mode.
4) Verify bitrate matches the actual bus.
5) Check grounding and twisted pair for CANH/CANL.

Example filter
- Standard OBD-II responses only:
  - filterEnabled: true
  - filterExt: false
  - filterId: 2024 (0x7E8)
  - filterMask: 2047 (0x7FF)
