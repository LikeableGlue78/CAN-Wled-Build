# Troubleshooting

No frames
- Verify bitrate matches the bus.
- Check wiring and transceiver power.
- Confirm pins are not used by LED data or buttons.
- Use /json/can?ping=1 to verify endpoint.

High overruns
- Increase rxQueueLen.
- Enable ID filtering.
- Reduce UI polling rate.
- Avoid full frames unless capturing.

Errors above 0.5%
- Check termination and grounding.
- Verify correct bus (CAN-C vs CAN-IHS).
- Reduce stub length.
