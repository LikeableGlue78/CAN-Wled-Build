from pathlib import Path
p = Path('.pio/build/esp32s3dev_16MB_opi_can/firmware.bin')
if not p.exists():
    print('firmware.bin not found at', p)
    raise SystemExit(1)

b = p.read_bytes()
search = [b'CAN RPM Pulse', b'CAN Speed Color', b'CAN Throttle']
for s in search:
    print(s.decode('utf-8'), '->', 'FOUND' if s in b else 'MISSING')

# show nearby context if found
for s in search:
    idx = b.find(s)
    if idx != -1:
        start = max(0, idx-80)
        end = min(len(b), idx+len(s)+80)
        print('\n--- context for', s.decode(), '---')
        print(b[start:end].decode('latin-1', errors='replace'))
