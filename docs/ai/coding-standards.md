# Coding Standards

General
- Follow existing WLED code style.
- C++: 2-space indentation.
- Web files (HTML/CSS/JS): tabs for indentation.

C++
- Avoid dynamic allocations in hot paths.
- Prefer small, bounded buffers and ring buffers.
- Use PROGMEM for static strings.

Web UI
- Keep polling light by default.
- Use Capture mode for heavier data.
- Avoid large JSON payloads on frequent refresh.

Generated content
- Do not edit wled00/html_*.h directly.
- Modify files in wled00/data and run npm run build.
