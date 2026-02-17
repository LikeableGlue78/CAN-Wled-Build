# Architecture Notes

Usermod lifecycle
- setup(): initializes TWAI if enabled and pins are valid.
- loop(): reads frames from TWAI RX queue and updates counters.
- addToJsonState(): exports status and optional frames.
- readFromConfig(): updates runtime settings and restarts TWAI if needed.

Key risks
- Heap pressure when returning large frame lists.
- Overruns on high-traffic buses.

Mitigations
- Lite JSON by default; full frames on demand.
- Larger RX queue and optional filter.
