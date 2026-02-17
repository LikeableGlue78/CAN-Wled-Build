# Contributing Notes

- Keep changes minimal and aligned with WLED patterns.
- Prefer incremental, testable changes.
- Avoid editing generated html_*.h files.
- Rebuild web UI after changes in wled00/data.

Checklist
- npm test
- pio run -e esp32dev
- pio run -e esp32s3dev_16MB_opi_can --target upload (if hardware present)
