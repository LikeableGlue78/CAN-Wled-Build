/**
 * WLED Mock — Interactive Car HUD
 *
 * Injected into every HTML page served by the mock server.
 *
 * Keyboard controls:
 *   SPACE          — hold to apply throttle (releases on keyup)
 *   Arrow Right    — shift up   (one gear per press, max 6)
 *   Arrow Left     — shift down (one gear per press, min 1)
 *   B              — hold for brakes
 *   H              — toggle HUD visibility
 *
 * The HUD draws:
 *   • Gear indicator
 *   • RPM bar (red zone > 6000)
 *   • Speed (km/h / mph)
 *   • Throttle %
 *   • Temperature & fuel gauges
 *   • Keyboard hint footer
 */
(function MockHUD() {
  'use strict';

  // Don't run inside iframes (e.g. liveview.htm)
  if (window.self !== window.top) return;

  // ── State ──────────────────────────────────────────────────────────────────
  const keys = { throttle: false, brake: false };
  let hudVisible = true;
  let pollTimer  = null;
  let car = { rpm: 820, speed: 0, throttle: 0, gear: 1, temp: 88, fuel: 100, braking: false };

  // ── Throttle / brake hold loop (20 ms, matching server physics) ───────────
  function sendInput(patch) {
    fetch('/mock/input', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(patch),
    })
    .then(r => r.json())
    .then(j => { if (j.car) car = j.car; })
    .catch(() => {});
  }

  let holdInterval = null;
  function startHold() {
    if (holdInterval) return;
    holdInterval = setInterval(() => {
      if (keys.throttle || keys.brake) {
        sendInput({
          throttle: keys.throttle ? 100 : 0,
          braking:  keys.brake,
        });
      }
    }, 40);
  }
  function stopHold() {
    clearInterval(holdInterval);
    holdInterval = null;
  }

  // ── Keyboard events ────────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    // Ignore when typing in inputs / textareas
    const tag = (e.target || {}).tagName || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (!keys.throttle) {
          keys.throttle = true;
          sendInput({ throttle: 100, braking: false });
          startHold();
        }
        break;
      case 'KeyB':
      case 'ShiftLeft':
      case 'ShiftRight':
        e.preventDefault();
        if (!keys.brake) {
          keys.brake = true;
          sendInput({ throttle: 0, braking: true });
          startHold();
        }
        break;
      case 'ArrowRight':
        e.preventDefault();
        sendInput({ shiftUp: true });
        break;
      case 'ArrowLeft':
        e.preventDefault();
        sendInput({ shiftDown: true });
        break;
      case 'KeyH':
        hudVisible = !hudVisible;
        hud.style.opacity = hudVisible ? '1' : '0.15';
        break;
      default:
        break;
    }
  });

  document.addEventListener('keyup', e => {
    if (e.code === 'Space') {
      keys.throttle = false;
      if (!keys.brake) {
        stopHold();
        sendInput({ throttle: 0 });
      }
    }
    if (e.code === 'KeyB' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      keys.brake = false;
      if (!keys.throttle) {
        stopHold();
        sendInput({ braking: false });
      }
    }
  });

  // ── HUD DOM ────────────────────────────────────────────────────────────────
  const hud = document.createElement('div');
  hud.id = 'mock-hud';
  hud.style.cssText = [
    'position:fixed', 'bottom:12px', 'right:12px',
    'z-index:99999',
    'background:rgba(0,0,0,0.82)',
    'color:#eee',
    'font-family:monospace',
    'font-size:12px',
    'padding:10px 14px',
    'border-radius:8px',
    'border:1px solid #444',
    'min-width:190px',
    'user-select:none',
    'pointer-events:none',
    'line-height:1.6',
    'transition:opacity 0.3s',
  ].join(';');

  document.body.appendChild(hud);

  // ── Render loop ─────────────────────────────────────────────────────────────
  function bar(frac, len, color, bg) {
    len = len || 14;
    const filled = Math.round(Math.max(0, Math.min(1, frac)) * len);
    const empty  = len - filled;
    const block  = '█';
    const dot    = '░';
    return `<span style="color:${color || '#0f0'}">${block.repeat(filled)}</span><span style="color:#333">${dot.repeat(empty)}</span>`;
  }

  function gearColor(g) {
    // 0=N(cyan), 1–6 green→red
    return ['#0ff', '#0f0','#4f4','#ff0','#fa0','#f60','#f00'][g] || '#eee';
  }

  function rpmColor(rpm) {
    if (rpm > 6000) return '#f00';
    if (rpm > 5000) return '#f80';
    if (rpm > 3500) return '#ff0';
    return '#0f0';
  }

  function renderHud() {
    const rpmFrac   = car.rpm  / 7200;
    const speedFrac = car.speed / 200;
    const thFrac    = car.throttle / 100;
    const fuelFrac  = car.fuel / 100;
    const tempFrac  = Math.max(0, (car.temp - 60) / 60);

    const brakeInd = car.braking
      ? '<span style="color:#f00;font-weight:bold"> ■ BRAKE</span>'
      : '';
    const throttleInd = car.throttle > 5
      ? '<span style="color:#0f0;font-weight:bold"> ▲ THROTTLE</span>'
      : '';

    hud.innerHTML =
      `<div style="text-align:center;font-size:13px;letter-spacing:2px;color:#8bf">` +
        `MOCK HUD` +
      `</div>` +
      `<div style="border-top:1px solid #444;margin:4px 0"></div>` +
      `<table style="border-collapse:collapse;width:100%">` +
        `<tr><td style="color:#88f;width:64px">Gear</td>` +
          `<td><span style="font-size:20px;font-weight:bold;color:${gearColor(car.gear)}">${car.gear === 0 ? 'N' : car.gear}</span>` +
          `  ${brakeInd}${throttleInd}</td></tr>` +
        `<tr><td style="color:#88f">RPM</td>` +
          `<td>${bar(rpmFrac, 14, rpmColor(car.rpm))}` +
          ` <span style="color:${rpmColor(car.rpm)}">${Math.round(car.rpm)}</span></td></tr>` +
        `<tr><td style="color:#88f">Speed</td>` +
          `<td>${bar(speedFrac, 14, '#4df')} ` +
          `<span style="color:#4df">${car.speed.toFixed(1)} km/h (${(car.speed * 0.621371).toFixed(1)} mph)</span></td></tr>` +
        `<tr><td style="color:#88f">Throttle</td>` +
          `<td>${bar(thFrac, 14, '#0f0')} ` +
          `<span style="color:#0f0">${car.throttle}%</span></td></tr>` +
        `<tr><td style="color:#88f">Temp</td>` +
          `<td>${bar(tempFrac, 7, '#f80')} ` +
          `<span style="color:#f80">${car.temp.toFixed(0)}°C</span></td></tr>` +
        `<tr><td style="color:#88f">Fuel</td>` +
          `<td>${bar(fuelFrac, 7, '#08f')} ` +
          `<span style="color:#08f">${car.fuel.toFixed(1)}%</span></td></tr>` +
      `</table>` +
      `<div style="border-top:1px solid #444;margin:4px 0"></div>` +
      `<div style="color:#666;font-size:10px">` +
        `[SPC]=Gas  [⇧/B]=Brake  [←][→]=Gear  [H]=Hide` +
      `</div>`;
  }

  // ── Poll /mock/car for state updates ──────────────────────────────────────
  function pollCar() {
    fetch('/mock/car')
      .then(r => r.json())
      .then(j => { car = j; renderHud(); })
      .catch(() => { renderHud(); })
      .finally(() => { pollTimer = setTimeout(pollCar, 150); });
  }

  // Start polling after a short delay to let the page settle
  setTimeout(() => { renderHud(); pollCar(); }, 500);

  // ── UDP Connect Panel (with Layout tab) ─────────────────────────────────────
  // Injected into the homepage header.  Two tabs:
  //   • Devices — discover & connect/disconnect WLED devices
  //   • Layout  — map each device to a pixel-range of the simulation canvas

  function initUdpPanel() {
    const btnwrap = document.querySelector('.btnwrap');
    if (!btnwrap) return;

    // ── Header button ────────────────────────────────────────────────────────
    const udpBtn = document.createElement('button');
    udpBtn.id    = 'mock-udp-btn';
    udpBtn.title = 'UDP Device Connect & Layout (Mock)';
    udpBtn.innerHTML  = '<i class="icons">&#xe22d;</i><p class="tab-label" style="color:#4df">UDP</p>';
    udpBtn.style.cssText = 'position:relative';
    btnwrap.appendChild(udpBtn);

    const badge = document.createElement('span');
    badge.id = 'mock-udp-badge';
    badge.style.cssText = [
      'position:absolute','top:2px','right:2px',
      'background:#4df','color:#000',
      'font-size:9px','font-weight:bold',
      'border-radius:8px','padding:0 4px',
      'display:none','pointer-events:none',
    ].join(';');
    udpBtn.appendChild(badge);

    // ── Drop-down panel ──────────────────────────────────────────────────────
    const panel = document.createElement('div');
    panel.id = 'mock-udp-panel';
    panel.style.cssText = [
      'display:none','position:fixed',
      'top:56px','left:0','right:0','z-index:99998',
      'background:#1a1a2e','border-bottom:2px solid #4df',
      'padding:6px 16px 14px',
      'font-family:monospace','font-size:12px','color:#ccc',
      'box-shadow:0 4px 18px rgba(0,0,0,0.7)',
    ].join(';');

    // ── Tab bar ──────────────────────────────────────────────────────────────
    const tabStyle = (active) =>
      'background:none;border:none;border-bottom:2px solid ' + (active ? '#4df' : 'transparent') + ';' +
      'color:' + (active ? '#4df' : '#888') + ';padding:4px 14px 5px;cursor:pointer;' +
      'font-family:monospace;font-size:12px;letter-spacing:1px;margin-right:4px';

    panel.innerHTML =
      // Tab bar
      '<div id="udp-tabbar" style="display:flex;align-items:center;gap:0;margin-bottom:8px;border-bottom:1px solid #2a2a4a;padding-bottom:0">' +
        '<button id="udp-tab-devices-btn" style="' + tabStyle(true) + '">🔌 Devices</button>' +
        '<button id="udp-tab-layout-btn"  style="' + tabStyle(false) + '">🗺 Layout</button>' +
        '<span id="mock-udp-status" style="color:#666;font-size:10px;margin-left:14px">Ready</span>' +
        '<span style="flex:1"></span>' +
        '<span style="color:#444;font-size:10px">30 fps DRGB pixel-push</span>' +
      '</div>' +

      // ── DEVICES TAB ─────────────────────────────────────────────────────
      '<div id="udp-tab-devices">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
          '<button id="mock-udp-scan-btn" style="background:#2a2a4a;color:#4df;border:1px solid #4df;border-radius:4px;padding:3px 10px;cursor:pointer;font-family:monospace;font-size:11px">⟳ Scan</button>' +
          '<button id="mock-udp-all-btn"  style="background:#002a1a;color:#4f8;border:1px solid #4f8;border-radius:4px;padding:3px 10px;cursor:pointer;font-family:monospace;font-size:11px">↔ Connect All</button>' +
          '<button id="mock-udp-none-btn" style="background:#2a0000;color:#f88;border:1px solid #f44;border-radius:4px;padding:3px 10px;cursor:pointer;font-family:monospace;font-size:11px">✕ Disconnect All</button>' +
        '</div>' +
        '<div id="mock-udp-list" style="display:flex;flex-wrap:wrap;gap:8px;min-height:32px">' +
          '<span style="color:#555;font-style:italic">Click Scan to discover devices on the network…</span>' +
        '</div>' +
      '</div>' +

      // ── LAYOUT TAB ──────────────────────────────────────────────────────
      '<div id="udp-tab-layout" style="display:none">' +
        '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:5px">' +
          '<button id="mock-layout-auto-btn"  style="background:#1a2a0a;color:#9f6;border:1px solid #6a4;border-radius:4px;padding:2px 10px;cursor:pointer;font-family:monospace;font-size:11px">⚡ Auto</button>' +
          '<button id="mock-layout-reset-btn" style="background:#2a1a0a;color:#fa8;border:1px solid #a64;border-radius:4px;padding:2px 10px;cursor:pointer;font-family:monospace;font-size:11px">↺ Reset</button>' +
          '<button id="mock-layout-mir-btn"   style="background:#002a2a;color:#4cf;border:1px solid #4cf;border-radius:4px;padding:2px 10px;cursor:pointer;font-family:monospace;font-size:11px;opacity:0.4" disabled>⟺ Reverse</button>' +
          '<button id="mock-layout-curve-btn" style="background:#0a0a1e;color:#af8;border:1px solid #585;border-radius:4px;padding:2px 10px;cursor:pointer;font-family:monospace;font-size:11px;opacity:0.4" disabled>~ Curve</button>' +
          '<span style="flex:1"></span>' +
          '<span id="mock-layout-sel" style="color:#555;font-size:10px">Click strip · dbl-click=crease · Shift=snap · Ctrl+drag crease=density</span>' +
        '</div>' +
        '<canvas id="mock-layout-cvs" style="width:100%;display:block;border-radius:4px;cursor:crosshair;touch-action:none"></canvas>' +
      '</div>';

    document.body.appendChild(panel);

    // ── Tab switching ────────────────────────────────────────────────────────
    let activeTab = 'devices';
    function switchTab(name) {
      activeTab = name;
      panel.querySelector('#udp-tab-devices-btn').style.cssText = tabStyle(name === 'devices');
      panel.querySelector('#udp-tab-layout-btn').style.cssText  = tabStyle(name === 'layout');
      document.getElementById('udp-tab-devices').style.display = name === 'devices' ? '' : 'none';
      document.getElementById('udp-tab-layout').style.display  = name === 'layout'  ? '' : 'none';
      if (name === 'layout') refreshLayout();
    }
    panel.querySelector('#udp-tab-devices-btn').addEventListener('click', () => switchTab('devices'));
    panel.querySelector('#udp-tab-layout-btn').addEventListener('click',  () => switchTab('layout'));

    // ── Panel toggle ─────────────────────────────────────────────────────────
    let panelOpen = false;
    function togglePanel() {
      panelOpen = !panelOpen;
      panel.style.display = panelOpen ? 'block' : 'none';
      udpBtn.style.background = panelOpen ? 'rgba(68,221,255,0.15)' : '';
      if (panelOpen) {
        if (activeTab === 'devices') refreshDevices();
        else refreshLayout();
      } else {
        stopRulerLoop();
      }
    }
    udpBtn.addEventListener('click', togglePanel);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && panelOpen) togglePanel();
    });

    // ════════════════════════════════════════════════════════════════════════
    // DEVICES TAB
    // ════════════════════════════════════════════════════════════════════════

    function renderDevices(devices) {
      const list = document.getElementById('mock-udp-list');
      if (!devices || devices.length === 0) {
        list.innerHTML = '<span style="color:#555;font-style:italic">No devices found.</span>';
        return;
      }
      const connCount = devices.filter(d => d.connected).length;
      badge.textContent  = connCount;
      badge.style.display = connCount ? 'inline' : 'none';

      list.innerHTML = devices.map(d => {
        const con = d.connected;
        return (
          '<div style="background:' + (con ? 'rgba(68,221,255,0.08)' : '#111120') + ';' +
            'border:1px solid ' + (con ? '#4df' : '#333') + ';' +
            'border-radius:6px;padding:6px 10px;min-width:200px">' +
            '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">' +
              '<span style="width:8px;height:8px;border-radius:50%;background:' + (con ? '#4df' : '#444') + ';display:inline-block;flex-shrink:0"></span>' +
              '<span style="color:' + (con ? '#4df' : '#ccc') + ';font-weight:bold">' + d.name + '</span>' +
              (con ? '<span style="color:#4df;font-size:10px">↔ MIRRORING</span>' : '') +
            '</div>' +
            '<div style="color:#666;font-size:10px;margin-bottom:5px">' +
              d.ip + ' &nbsp;|&nbsp; ' + d.leds + ' LEDs &nbsp;|&nbsp; v' + d.ver +
            '</div>' +
            '<button data-udp-id="' + d.ip + '" data-udp-connect="' + (!con) + '" style="' +
              'background:' + (con ? '#8b0000' : '#003344') + ';' +
              'color:' + (con ? '#f88' : '#4df') + ';' +
              'border:1px solid ' + (con ? '#f44' : '#4df') + ';' +
              'border-radius:4px;padding:2px 10px;cursor:pointer;font-family:monospace;font-size:11px' +
            '">' + (con ? '✕ Disconnect' : '↔ Mirror') + '</button>' +
          '</div>'
        );
      }).join('');

      list.querySelectorAll('[data-udp-id]').forEach(btn => {
        btn.addEventListener('click', () => {
          const ip     = btn.getAttribute('data-udp-id');
          const enable = btn.getAttribute('data-udp-connect') === 'true';
          fetch('/mock/udp/connect', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ip, enable}) })
            .then(r => r.json()).then(j => { if (j.devices) renderDevices(j.devices); }).catch(() => {});
        });
      });
    }

    function refreshDevices() {
      fetch('/mock/udp/scan')
        .then(r => r.json()).then(j => renderDevices(j.devices))
        .catch(() => {});
    }

    function doScan() {
      const statusEl = document.getElementById('mock-udp-status');
      const scanBtn  = document.getElementById('mock-udp-scan-btn');
      const list     = document.getElementById('mock-udp-list');
      if (statusEl) statusEl.textContent = 'Scanning…';
      if (scanBtn)  scanBtn.disabled = true;
      if (list)     list.innerHTML = '<span style="color:#4df">⟳ Scanning network for WLED devices…</span>';
      let pollCount = 0, lastCount = -1;
      function poll() {
        fetch('/mock/udp/scan').then(r => r.json()).then(j => {
          const devs = j.devices || [];
          if (devs.length !== lastCount) { lastCount = devs.length; renderDevices(devs); }
          if (++pollCount < 8) { setTimeout(poll, 1000); }
          else {
            if (statusEl) statusEl.textContent = devs.length ? `Found ${devs.length} device${devs.length > 1 ? 's' : ''}` : 'No devices found';
            if (scanBtn)  scanBtn.disabled = false;
            if (devs.length === 0 && list)
              list.innerHTML = '<span style="color:#888;font-style:italic">No WLED devices found on this subnet. Make sure they are powered on.</span>';
          }
        }).catch(() => { if (statusEl) statusEl.textContent = 'Error'; if (scanBtn) scanBtn.disabled = false; });
      }
      poll();
    }

    setTimeout(() => {
      const scanBtn  = panel.querySelector('#mock-udp-scan-btn');
      const allBtn   = panel.querySelector('#mock-udp-all-btn');
      const noneBtn  = panel.querySelector('#mock-udp-none-btn');
      if (scanBtn)  scanBtn.addEventListener('click', doScan);
      if (allBtn)   allBtn.addEventListener('click', () => {
        fetch('/mock/udp/connect-all', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({enable:true}) })
          .then(r => r.json()).then(j => { if (j.devices) renderDevices(j.devices); }).catch(() => {});
      });
      if (noneBtn)  noneBtn.addEventListener('click', () => {
        fetch('/mock/udp/connect-all', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({enable:false}) })
          .then(r => r.json()).then(j => { if (j.devices) renderDevices(j.devices); }).catch(() => {});
      });
    }, 100);

    // ════════════════════════════════════════════════════════════════════════
    // LAYOUT TAB — free 2D canvas strip mapper
    // • Drag endpoints anywhere on canvas (start=circle, end=circle+pip)
    // • Shift+drag  →  snap to 20×16 grid
    // • Double-click on strip body  →  insert crease waypoint
    // • Double-click existing crease  →  delete it
    // • Drag crease freely  →  reposition in 2D
    // • Ctrl+drag crease  →  adjust pixel density distribution (weight)
    // • "~ Curve" button  →  toggle Catmull-Rom smooth curve through all pts
    // • Drag ◆ diamond  →  move the quadratic curve control point (when curved)
    // ════════════════════════════════════════════════════════════════════════

    const LAYOUT_COLORS = ['#ff9900','#00aaff','#00ff88','#ff4488','#ffff00','#aa44ff','#00ffcc','#ff6600','#ff3333','#33ffcc'];
    let _lastDevices  = [];
    let _lastMappings = {};
    let _totalLeds    = 650;
    let _rulerTimer   = null;
    let _livePx       = null;
    let _cvs = null, _ctx = null;
    let _sel  = null;   // selected device ip
    let _drag = null;   // { ip, role, idx?, _t }

    function _devColor(idx) { return LAYOUT_COLORS[idx % LAYOUT_COLORS.length]; }

    // ── Path math ────────────────────────────────────────────────────────────
    // All waypoints: [start, ...creases, end] in normalised 0-1 canvas coords
    function _pathPts(m) {
      const pts = [{ x: m.x1 || 0, y: m.y1 !== undefined ? m.y1 : 0.5 }];
      for (const c of (m.creases || [])) pts.push({ x: c.x, y: c.y });
      pts.push({ x: m.x2 !== undefined ? m.x2 : 1, y: m.y2 !== undefined ? m.y2 : 0.5 });
      return pts;
    }

    // Catmull-Rom evaluation through pts[] at t in [0,1]
    function _crEval(pts, t) {
      const n  = pts.length - 1;
      const tf = Math.min(t * n, n - 1e-9);
      const i  = Math.floor(tf);
      const u  = tf - i, u2 = u * u, u3 = u2 * u;
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[Math.min(n, i + 1)];
      const p3 = pts[Math.min(n, i + 2)];
      const f = (a, b, c, d) =>
        0.5 * (2*b + (-a+c)*u + (2*a-5*b+4*c-d)*u2 + (-a+3*b-3*c+d)*u3);
      return { x: f(p0.x,p1.x,p2.x,p3.x), y: f(p0.y,p1.y,p2.y,p3.y) };
    }

    // Evaluate position at t along a strip's path (normalised coords)
    function _pathEval(m, t) {
      const pts = _pathPts(m);
      if (m.hasCurve) {
        // When we have exactly start+end (no creases) use explicit CP bezier
        if (pts.length === 2 && m.cpx !== undefined) {
          const u = t, u2 = u*u;
          const v = 1 - u;
          return {
            x: v*v*pts[0].x + 2*v*u*m.cpx + u2*pts[1].x,
            y: v*v*pts[0].y + 2*v*u*m.cpy + u2*pts[1].y,
          };
        }
        return _crEval(pts, t);
      }
      // Polyline
      if (pts.length < 2) return pts[0];
      const n  = pts.length - 1;
      const tf = Math.min(t * n, n - 1e-9);
      const i  = Math.floor(tf);
      const u  = tf - i;
      return {
        x: pts[i].x + (pts[i+1].x - pts[i].x) * u,
        y: pts[i].y + (pts[i+1].y - pts[i].y) * u,
      };
    }

    // Sample path into N canvas-pixel [x,y] pairs
    function _pathSamples(m, W, H, N) {
      const out = [];
      for (let i = 0; i < N; i++) {
        const p = _pathEval(m, N > 1 ? i / (N-1) : 0);
        out.push([p.x * W, p.y * H]);
      }
      return out;
    }

    // Remap uniform t [0,1] using crease weights to produce biased t'
    // Each crease has a weight (0.1–0.9, default 0.5).  The weight controls
    // how the LED’s even spacing maps onto uneven path segments.
    // With no creases, returns t unchanged.
    function _remapT(m, t) {
      const creases = m.creases || [];
      if (creases.length === 0) return t;
      // Build breakpoints in path-t space (natural arc-t of each crease)
      const N = 80;
      const pathBreaks = [0]; // path-t of each crease
      for (const c of creases) {
        // Find nearest t on path for this crease
        const pts = _pathPts(m);
        let best = 0, bestD = Infinity;
        for (let i = 0; i <= N; i++) {
          const tt = i / N;
          const p  = _pathEval(m, tt);
          const d  = (p.x - c.x)**2 + (p.y - c.y)**2;
          if (d < bestD) { bestD = d; best = tt; }
        }
        pathBreaks.push(best);
      }
      pathBreaks.push(1);
      // Segment lengths in path-t space
      const nSeg = pathBreaks.length - 1;
      const segLens = [];
      for (let i = 0; i < nSeg; i++) segLens.push(pathBreaks[i+1] - pathBreaks[i]);
      // Build share of LED range per segment using weights
      // weight > 0.5 means "give more LEDs to the segment BEFORE me"
      const shares = segLens.slice(); // start proportional to segment length
      for (let ci = 0; ci < creases.length; ci++) {
        const w = creases[ci].weight !== undefined ? creases[ci].weight : 0.5;
        // Redistribute between segment ci and ci+1
        const total = shares[ci] + shares[ci + 1];
        shares[ci]     = total * w;
        shares[ci + 1] = total * (1 - w);
      }
      // Normalise shares to sum to 1
      const sum = shares.reduce((a, b) => a + b, 0) || 1;
      for (let i = 0; i < shares.length; i++) shares[i] /= sum;
      // Build cumulative LED-space breakpoints
      const ledBreaks = [0];
      for (let i = 0; i < nSeg; i++) ledBreaks.push(ledBreaks[i] + shares[i]);
      // Find which segment t falls in (LED space)
      let seg = 0;
      for (let i = 0; i < nSeg; i++) {
        if (t >= ledBreaks[i] && t <= ledBreaks[i + 1]) { seg = i; break; }
        if (i === nSeg - 1) seg = i; // clamp to last
      }
      // Linearly interpolate within segment: LED-space → path-t space
      const segFrac = (ledBreaks[seg + 1] - ledBreaks[seg]) || 1e-9;
      const u = (t - ledBreaks[seg]) / segFrac;
      return pathBreaks[seg] + u * (pathBreaks[seg + 1] - pathBreaks[seg]);
    }

    // Nearest t on path to canvas point (mx, my); returns { t, d }
    function _nearestT(m, W, H, mx, my) {
      const STEPS = 220;
      let bestT = 0, bestD2 = Infinity;
      for (let i = 0; i <= STEPS; i++) {
        const t  = i / STEPS;
        const p  = _pathEval(m, t);
        const d2 = (p.x*W - mx)**2 + (p.y*H - my)**2;
        if (d2 < bestD2) { bestD2 = d2; bestT = t; }
      }
      return { t: bestT, d: Math.sqrt(bestD2) };
    }

    // Snap normalised value v to nearest grid step
    function _snapN(v, steps) {
      return Math.round(v * steps) / steps;
    }

    // Ensure all 2D fields are present, back-convert from legacy start/end
    function _getM(ip) {
      const m = _lastMappings[ip];
      if (!m) return null;
      const N = _totalLeds;
      if (m.x1 === undefined) {
        m.x1 = (m.start || 0) / N;  m.y1 = 0.5;
        m.x2 = (m.end   || N) / N;  m.y2 = 0.5;
      }
      if (!m.creases)   m.creases  = [];
      if (!m.hasCurve)  m.hasCurve = false;
      if (m.cpx === undefined) { m.cpx = (m.x1+m.x2)/2; m.cpy = Math.max(0.02, (m.y1+m.y2)/2 - 0.12); }
      return m;
    }

    // Build a sensible default for a device with no saved mapping
    function _defMap(di) {
      const n = Math.max(_lastDevices.length, 1);
      const y = 0.15 + (di + 0.5) / n * 0.78;
      return { x1:0.02, y1:y, x2:0.98, y2:y, hasCurve:false, cpx:0.5, cpy:Math.max(0.02,y-0.12), creases:[], reverse:false };
    }

    function _saveM(ip) {
      const m = _lastMappings[ip]; if (!m) return;
      clearTimeout(m._st);
      m._st = setTimeout(() => {
        fetch('/mock/udp/mapping', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ ip, ...m }),
        }).catch(() => {});
      }, 60);
    }

    // ── Highlight a physical LED at a path-t position ──────────────────
    // Colors: yellow=select, cyan=drag, green=add, red=remove
    let _hlLast = 0; // throttle timestamp
    function _highlight(ip, t, color, force) {
      const now = Date.now();
      if (!force && now - _hlLast < 80) return; // throttle
      _hlLast = now;
      // Send t-value directly — server resolves LED index from mapping + device cache
      fetch('/mock/udp/highlight', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ ip, t, color }),
      }).catch(() => {});
    }

    function _startLive() {
      if (_rulerTimer) return;
      function tick() {
        fetch('/json/live').then(r=>r.json()).then(j=>{
          if (j && j.leds) _livePx = j.leds;
          _draw();
        }).catch(()=>{ _draw(); });
        _rulerTimer = setTimeout(tick, 100);
      }
      tick();
    }
    function stopRulerLoop() { clearTimeout(_rulerTimer); _rulerTimer = null; }

    // ── Draw ─────────────────────────────────────────────────────────────────
    function _draw() {
      const cvs = _cvs, ctx = _ctx;
      if (!cvs || !ctx) return;
      const pr   = window.devicePixelRatio || 1;
      const cssW = cvs.offsetWidth;
      const cssH = Math.max(260, Math.round(cssW * 0.38));
      if (cvs.width  !== Math.round(cssW * pr)) cvs.width  = Math.round(cssW * pr);
      if (cvs.height !== Math.round(cssH * pr)) { cvs.height = Math.round(cssH * pr); cvs.style.height = cssH+'px'; }

      const W = cvs.width, H = cvs.height;

      // Background
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(0, 0, W, H);

      // Grid
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      for (let g = 1; g < 10; g++) {
        const x = g / 10 * W, y = g / 10 * H;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      // ── Live reference bar (top 12%) ──────────────────────────────────────
      const REF_H = Math.round(H * 0.12);
      ctx.fillStyle = 'rgba(8,12,20,0.88)';
      ctx.fillRect(0, 0, W, REF_H);
      const live = _livePx || [];
      if (live.length > 0) {
        const tot  = live.length;
        const dotW = W / tot;
        for (let i = 0; i < tot; i++) {
          const hex = live[i] || '000000';
          const rv  = parseInt(hex.slice(0,2),16);
          const gv  = parseInt(hex.slice(2,4),16);
          const bv  = parseInt(hex.slice(4,6),16);
          const b   = (rv + gv + bv) / 765;
          ctx.globalAlpha = b > 0.01 ? Math.min(0.75, 0.28 + b * 0.55) : 0.09;
          ctx.fillStyle   = b > 0.01 ? `rgb(${rv},${gv},${bv})` : '#0e0e0e';
          if (b > 0.25) { ctx.shadowColor = `rgb(${rv},${gv},${bv})`; ctx.shadowBlur = b * 4 * pr; }
          ctx.fillRect(i * dotW, 2 * pr, Math.ceil(dotW) + 1, REF_H - 3 * pr);
          ctx.shadowBlur = 0;
        }
        ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      }
      // Device boundary markers in ref bar
      _lastDevices.forEach((dev, di) => {
        const m   = _getM(dev.ip) || _defMap(di);
        const col = _devColor(di);
        const rx1 = Math.min(m.x1, m.x2) * W;
        const rx2 = Math.max(m.x1, m.x2) * W;
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = col; ctx.lineWidth = 1.5 * pr; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(rx1, 0); ctx.lineTo(rx1, REF_H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(rx2, 0); ctx.lineTo(rx2, REF_H); ctx.stroke();
        ctx.font = `bold ${Math.round(7.5*pr)}px sans-serif`;
        ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(dev.name.slice(0,10), (rx1 + rx2) / 2, 2*pr);
        ctx.globalAlpha = 1;
      });
      ctx.font = `${Math.round(8*pr)}px sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillText('LIVE', 4*pr, REF_H * 0.6);
      ctx.textAlign = 'right';
      ctx.fillText(String(live.length || _totalLeds), W - 4*pr, REF_H * 0.6);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(0, REF_H); ctx.lineTo(W, REF_H); ctx.stroke();
      ctx.textAlign = 'left';

      // ── Per-device 2D strips ──────────────────────────────────────────────
      const Rdot  = 5 * pr;
      const R_ept = 7 * pr;
      const R_cr  = 6 * pr;   // crease handle radius
      const R_cp  = 5 * pr;   // curve-CP diamond half-size
      const SAMP  = 140;      // path sample resolution

      _lastDevices.forEach((dev, di) => {
        const m      = _getM(dev.ip) || _defMap(di);
        const col    = _devColor(di);
        const isSel  = (_sel === dev.ip);
        const samps  = _pathSamples(m, W, H, SAMP);

        // Dark backing rail along path
        ctx.strokeStyle = 'rgba(0,0,0,0.65)';
        ctx.lineWidth   = Rdot * 2.4;
        ctx.lineCap     = 'round'; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(samps[0][0], samps[0][1]);
        for (let s = 1; s < samps.length; s++) ctx.lineTo(samps[s][0], samps[s][1]);
        ctx.stroke(); ctx.lineCap = 'butt';

        // LED glowing dots along path — arc-length spaced, colour from x1→x2 direction
        let _arcL = 0;
        { let pv = _pathEval(m, 0);
          for (let k = 1; k <= 80; k++) {
            const cv = _pathEval(m, k / 80);
            _arcL += Math.hypot((cv.x - pv.x) * W, (cv.y - pv.y) * H);
            pv = cv;
          }
        }
        const nDots = Math.min(Math.max(Math.round(_arcL / (Rdot * 1.6)), 2), 220);
        ctx.shadowBlur = 0;
        for (let d = 0; d < nDots; d++) {
          const tUniform = nDots > 1 ? d / (nDots - 1) : 0;
          const t   = _remapT(m, tUniform);
          const pos = _pathEval(m, t);
          const px  = pos.x * W, py = pos.y * H;
          let dotCol = col, bri = 0.55;
          if (live.length > 0) {
            // Use the dot's actual x-position on the canvas for colour lookup
            // so curved/creased paths sample from the correct part of the strip
            const ledIdx = Math.max(0, Math.min(live.length - 1,
              Math.round((pos.x) * (live.length - 1))));
            const hex = live[ledIdx];
            if (hex) {
              const rv=parseInt(hex.slice(0,2),16),gv=parseInt(hex.slice(2,4),16),bv=parseInt(hex.slice(4,6),16);
              bri = (rv+gv+bv)/765;
              dotCol = bri>0.01 ? `rgb(${rv},${gv},${bv})` : '#0d0d0d';
            }
          }
          ctx.globalAlpha = live.length > 0 ? 1 : 0.6;
          if (bri > 0.12) { ctx.shadowColor = dotCol; ctx.shadowBlur = bri * 14 * pr; }
          ctx.beginPath(); ctx.arc(px, py, Rdot, 0, Math.PI*2);
          ctx.fillStyle = dotCol; ctx.fill();
          if (bri > 0.12) ctx.shadowBlur = 0;
        }
        ctx.globalAlpha = 1; ctx.shadowBlur = 0;

        // Selection dashed ring over path
        if (isSel) {
          ctx.setLineDash([5*pr, 3*pr]);
          ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5*pr;
          ctx.beginPath(); ctx.moveTo(samps[0][0], samps[0][1]);
          for (let s = 1; s < samps.length; s++) ctx.lineTo(samps[s][0], samps[s][1]);
          ctx.stroke(); ctx.setLineDash([]);
        }

        // Curve control-point diamond + guide lines (selected + hasCurve only)
        if (isSel && m.hasCurve) {
          const cpx = m.cpx * W, cpy = m.cpy * H;
          ctx.setLineDash([3*pr, 3*pr]);
          ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1*pr;
          ctx.beginPath(); ctx.moveTo(m.x1*W, m.y1*H); ctx.lineTo(cpx, cpy); ctx.lineTo(m.x2*W, m.y2*H); ctx.stroke();
          ctx.setLineDash([]);
          ctx.save();
          ctx.translate(cpx, cpy); ctx.rotate(Math.PI/4);
          ctx.fillStyle = '#fff8'; ctx.strokeStyle = '#4df'; ctx.lineWidth = 1.5*pr;
          ctx.fillRect(-R_cp, -R_cp, R_cp*2, R_cp*2);
          ctx.strokeRect(-R_cp, -R_cp, R_cp*2, R_cp*2);
          ctx.restore();
        }

        // Crease waypoint handles
        (m.creases||[]).forEach(c => {
          const cx=c.x*W, cy=c.y*H;
          const w = c.weight !== undefined ? c.weight : 0.5;
          ctx.beginPath(); ctx.arc(cx, cy, R_cr, 0, Math.PI*2);
          ctx.fillStyle = isSel ? col : 'rgba(200,200,200,0.4)'; ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth=1.5*pr; ctx.stroke();
          // cross-pip distinguishes crease from endpoint
          ctx.strokeStyle='#000'; ctx.lineWidth=1.5*pr;
          ctx.beginPath(); ctx.moveTo(cx-3*pr,cy); ctx.lineTo(cx+3*pr,cy); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx,cy-3*pr); ctx.lineTo(cx,cy+3*pr); ctx.stroke();
          // Weight indicator — small bar below handle showing bias
          if (isSel && Math.abs(w - 0.5) > 0.02) {
            const barW = 20*pr, barH = 3*pr;
            const by = cy + R_cr + 3*pr;
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(cx - barW/2, by, barW, barH);
            ctx.fillStyle = w > 0.5 ? '#4df' : '#f84';
            const fillW = Math.abs(w - 0.5) * 2 * barW / 2;
            if (w > 0.5) ctx.fillRect(cx, by, fillW, barH);
            else         ctx.fillRect(cx - fillW, by, fillW, barH);
          }
        });

        // Endpoint handles (circle = start, circle+pip = end)
        [[m.x1*W, m.y1*H, 'start'], [m.x2*W, m.y2*H, 'end']].forEach(([hx, hy, edge]) => {
          ctx.beginPath(); ctx.arc(hx, hy, R_ept, 0, Math.PI*2);
          ctx.fillStyle = col; ctx.fill();
          ctx.strokeStyle = isSel ? '#fff' : 'rgba(255,255,255,0.55)';
          ctx.lineWidth = 2*pr; ctx.stroke();
          if (edge === 'end') { ctx.fillStyle='#000'; ctx.fillRect(hx-3*pr,hy-3*pr,6*pr,6*pr); }
        });

        // Label at path midpoint
        const mid = _pathEval(m, 0.5);
        ctx.font = `${Math.round(11*pr)}px sans-serif`;
        ctx.fillStyle = isSel ? '#fff' : 'rgba(255,255,255,0.75)';
        ctx.textAlign='center'; ctx.textBaseline='bottom';
        ctx.fillText(
          dev.name + (m.reverse?' ⟺':'') + (m.hasCurve?' ~':'') + ((m.creases||[]).length?' ·'+m.creases.length:''),
          mid.x*W, mid.y*H - 10*pr
        );
        ctx.textAlign='left';
      });

      // LED index tick marks along the bottom edge
      ctx.font=`${Math.round(9*pr)}px monospace`; ctx.fillStyle='rgba(255,255,255,0.22)'; ctx.textBaseline='bottom';
      ctx.textAlign='left';  ctx.fillText('0', 2*pr, H-1);
      ctx.textAlign='right'; ctx.fillText(String(_totalLeds), W-2*pr, H-1);
      for (let tk=100; tk<_totalLeds; tk+=100) {
        const tx=(tk/_totalLeds)*W;
        ctx.strokeStyle='rgba(255,255,255,0.1)'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(tx,H-8*pr); ctx.lineTo(tx,H); ctx.stroke();
        ctx.textAlign='center'; ctx.fillStyle='rgba(255,255,255,0.15)'; ctx.fillText(String(tk),tx,H-1);
      }
      ctx.textAlign='left';

      // Sync toolbar button states
      const mirBtn   = panel.querySelector('#mock-layout-mir-btn');
      const curveBtn = panel.querySelector('#mock-layout-curve-btn');
      const selEl    = panel.querySelector('#mock-layout-sel');
      const selM     = _sel ? _getM(_sel) : null;
      if (mirBtn)   {
        mirBtn.disabled = !_sel; mirBtn.style.opacity = _sel?'1':'0.4';
        mirBtn.textContent = (selM&&selM.reverse) ? '⟺ Normal' : '⟺ Reverse';
      }
      if (curveBtn) {
        curveBtn.disabled = !_sel; curveBtn.style.opacity = _sel?'1':'0.4';
        curveBtn.style.background = (selM&&selM.hasCurve) ? '#00282a' : '#0a0a1e';
        curveBtn.textContent = (selM&&selM.hasCurve) ? '~ Straight' : '~ Curve';
      }
      if (selEl && _sel) {
        const di  = _lastDevices.findIndex(d=>d.ip===_sel);
        const nm  = di>=0 ? _lastDevices[di].name : _sel;
        const lo  = Math.round(Math.min(selM.x1,selM.x2)*_totalLeds);
        const hi  = Math.round(Math.max(selM.x1,selM.x2)*_totalLeds);
        selEl.textContent = `${nm}  ${lo}→${hi} (${hi-lo}px)${
          (selM.creases||[]).length?' '+selM.creases.length+' crease(s)':''}
${selM.hasCurve?' ~ curved':''}${selM.reverse?' ⟺ rev':''}   [dbl-click=crease · Shift=snap · Ctrl+drag=density]`;
      } else if (selEl) {
        selEl.textContent = 'Click a strip to select  ·  dbl-click on strip = add/remove crease';
      }
    }

    // ── Hit test ─────────────────────────────────────────────────────────────
    // Returns { ip, role:'start'|'end'|'cp'|'crease'|'body', idx? } or null
    function _hitTest(mx, my) {
      const pr    = window.devicePixelRatio || 1;
      const W     = _cvs.width, H = _cvs.height;
      const R_EPT = 7 * pr * 1.7;
      const R_CR  = 6 * pr * 1.7;
      const R_CP  = 5 * pr * 2.0;
      const R_BOD = 12 * pr;
      for (let di = 0; di < _lastDevices.length; di++) {
        const dev = _lastDevices[di];
        const m   = _getM(dev.ip); if (!m) continue;
        // endpoints (highest priority)
        if (Math.hypot(mx-m.x1*W, my-m.y1*H) <= R_EPT) return { ip:dev.ip, role:'start' };
        if (Math.hypot(mx-m.x2*W, my-m.y2*H) <= R_EPT) return { ip:dev.ip, role:'end' };
        // curve CP diamond (only when this strip is selected+curved)
        if (_sel===dev.ip && m.hasCurve)
          if (Math.hypot(mx-m.cpx*W, my-m.cpy*H) <= R_CP) return { ip:dev.ip, role:'cp' };
        // crease handles
        for (let ci=0; ci<(m.creases||[]).length; ci++) {
          const c = m.creases[ci];
          if (Math.hypot(mx-c.x*W, my-c.y*H) <= R_CR) return { ip:dev.ip, role:'crease', idx:ci };
        }
        // strip body (proximity to path)
        if (_nearestT(m, W, H, mx, my).d <= R_BOD) return { ip:dev.ip, role:'body' };
      }
      return null;
    }

    // ── Canvas events ─────────────────────────────────────────────────────────
    function _bindCanvasEvents() {
      const cvs = _cvs;
      const pr  = () => window.devicePixelRatio || 1;
      const toLocal = (e) => {
        const r = cvs.getBoundingClientRect();
        const p = e.touches ? e.touches[0] : e;
        return [(p.clientX-r.left)*pr(), (p.clientY-r.top)*pr()];
      };

      cvs.addEventListener('mousedown',  onDown);
      cvs.addEventListener('touchstart', onDown, { passive:false });
      function onDown(e) {
        e.preventDefault();
        const [mx,my] = toLocal(e);
        const hit = _hitTest(mx, my);
        if (!hit) { _sel=null; _draw(); return; }
        _sel = hit.ip;
        if (hit.role !== 'body') _drag = { ip:hit.ip, role:hit.role, idx:hit.idx, startMx:mx };
        // Highlight on select — yellow for crease, white for endpoints
        if (hit.role === 'crease') {
          const m = _getM(hit.ip);
          if (m && m.creases && m.creases[hit.idx]) {
            const W = _cvs.width, H = _cvs.height;
            const c = m.creases[hit.idx];
            const { t } = _nearestT(m, W, H, c.x*W, c.y*H);
            _highlight(hit.ip, t, 'ffff00', true); // yellow = selected
          }
        } else if (hit.role === 'start') {
          _highlight(hit.ip, 0, 'ffffff', true); // white = start endpoint
        } else if (hit.role === 'end') {
          _highlight(hit.ip, 1, 'ffffff', true); // white = end endpoint
        }
        _draw();
      }

      // Double-click: add or remove a crease waypoint
      cvs.addEventListener('dblclick', (e) => {
        e.preventDefault();
        const [mx,my] = toLocal(e);
        const hit = _hitTest(mx, my); if (!hit) return;
        const m = _getM(hit.ip); if (!m) return;
        _sel = hit.ip;
        if (!m.creases) m.creases = [];
        if (hit.role === 'crease') {
          // Highlight removed crease in red before removing
          const cRem = m.creases[hit.idx];
          if (cRem) {
            const W2=_cvs.width, H2=_cvs.height;
            const rt = _nearestT(m, W2, H2, cRem.x*W2, cRem.y*H2).t;
            _highlight(hit.ip, rt, 'ff0000', true); // red = remove
          }
          m.creases.splice(hit.idx, 1);
        } else {
          // Insert new crease at nearest-t position, sorted by arc-t
          const W=_cvs.width, H=_cvs.height;
          const { t } = _nearestT(m, W, H, mx, my);
          const pos   = _pathEval(m, t);
          // Find insert position sorted by crease t order
          let insertAt = m.creases.length;
          const tmpNoCr = Object.assign({}, m, {creases:[]});
          for (let ci=0; ci<m.creases.length; ci++) {
            const ct = _nearestT(tmpNoCr, W, H, m.creases[ci].x*W, m.creases[ci].y*H).t;
            if (ct > t) { insertAt=ci; break; }
          }
          m.creases.splice(insertAt, 0, { x:pos.x, y:pos.y });
          // Highlight added crease in green
          _highlight(hit.ip, t, '00ff00', true); // green = add
        }
        _draw(); _saveM(hit.ip);
      });

      window.addEventListener('mousemove', onMove);
      window.addEventListener('touchmove', onMove, { passive:false });
      function onMove(e) {
        if (!_drag) return;
        e.preventDefault();
        const [mx,my] = toLocal(e);
        const W=_cvs.width, H=_cvs.height;
        const m = _getM(_drag.ip); if (!m) return;
        // Clamp to [0,1] normalised
        let nx = Math.max(0, Math.min(1, mx/W));
        let ny = Math.max(0, Math.min(1, my/H));
        // Shift = grid snap (20×16 grid)
        if (e.shiftKey) { nx = _snapN(nx,20); ny = _snapN(ny,16); }

        if      (_drag.role==='start') { m.x1=nx; m.y1=ny; _highlight(_drag.ip, 0, 'ffffff'); }
        else if (_drag.role==='end')   { m.x2=nx; m.y2=ny; _highlight(_drag.ip, 1, 'ffffff'); }
        else if (_drag.role==='cp')    { m.cpx=nx; m.cpy=ny; }
        else if (_drag.role==='crease') {
          const c = (m.creases||[])[_drag.idx]; if (!c) return;
          if (e.ctrlKey) {
            // Ctrl+drag: adjust pixel distribution weight (horizontal movement)
            // Don't move the crease — just change its weight
            if (c.weight === undefined) c.weight = 0.5;
            if (_drag.startWeight === undefined) _drag.startWeight = c.weight;
            const delta = (mx - _drag.startMx) / W;
            c.weight = Math.max(0.1, Math.min(0.9, _drag.startWeight + delta));
          } else {
            c.x = nx; c.y = ny;
          }
          // Highlight crease LED in cyan while dragging
          const ct = _nearestT(m, W, H, c.x*_cvs.width, c.y*_cvs.height).t;
          _highlight(_drag.ip, ct, '00ffff'); // cyan = dragging
        }
        _draw(); _saveM(_drag.ip);
      }

      window.addEventListener('mouseup',  onUp);
      window.addEventListener('touchend', onUp);
      function onUp() { _drag = null; }
    }

    function refreshLayout() {
      Promise.all([
        fetch('/mock/udp/scan').then(r=>r.json()),
        fetch('/mock/udp/mapping').then(r=>r.json()),
      ]).then(([devData, mapData]) => {
        _lastDevices  = devData.devices  || [];
        _lastMappings = mapData.mappings || {};
        _totalLeds    = mapData.totalLeds || 650;
        // Assign default 2D positions for devices with no saved mapping
        _lastDevices.forEach((dev, di) => {
          if (!_lastMappings[dev.ip]) _lastMappings[dev.ip] = _defMap(di);
        });
        if (!_cvs) {
          _cvs = document.getElementById('mock-layout-cvs');
          if (_cvs) { _ctx = _cvs.getContext('2d'); _bindCanvasEvents(); }
        }
        _draw(); _startLive();
      }).catch(()=>{});
    }

    // Wire toolbar buttons (after DOM settles)
    setTimeout(() => {
      const autoBtn  = panel.querySelector('#mock-layout-auto-btn');
      const resetBtn = panel.querySelector('#mock-layout-reset-btn');
      const mirBtn   = panel.querySelector('#mock-layout-mir-btn');
      const curveBtn = panel.querySelector('#mock-layout-curve-btn');

      if (autoBtn) autoBtn.onclick = () => {
        // Evenly lay out strips horizontally, stacked vertically
        const n = _lastDevices.length; if (!n) return;
        const rowH = 0.78 / n;
        const saves = _lastDevices.map((dev, idx) => {
          const y   = 0.15 + (idx + 0.5) * rowH;
          const prev = _getM(dev.ip) || {};
          const nm  = Object.assign({ cpx:0.5, cpy:Math.max(0.02,y-0.12), creases:[], hasCurve:false, reverse:false },
            prev, { x1:0.02, y1:y, x2:0.98, y2:y });
          _lastMappings[dev.ip] = nm;
          return fetch('/mock/udp/mapping',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ip:dev.ip,...nm}) });
        });
        Promise.all(saves).finally(()=>_draw());
      };

      if (resetBtn) resetBtn.onclick = () => {
        const saves = _lastDevices.map((dev,di) => {
          const nm = _defMap(di);
          _lastMappings[dev.ip] = nm;
          return fetch('/mock/udp/mapping',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ip:dev.ip,...nm}) });
        });
        Promise.all(saves).finally(()=>_draw());
      };

      if (mirBtn) mirBtn.onclick = () => {
        if (!_sel) return;
        const m = _getM(_sel); if (!m) return;
        m.reverse = !m.reverse; _draw(); _saveM(_sel);
      };

      if (curveBtn) curveBtn.onclick = () => {
        if (!_sel) return;
        const m = _getM(_sel); if (!m) return;
        m.hasCurve = !m.hasCurve;
        // Place control point between start+end if first activation
        if (m.hasCurve && m.cpx === undefined)
          { m.cpx=(m.x1+m.x2)/2; m.cpy=Math.max(0.02,(m.y1+m.y2)/2-0.14); }
        _draw(); _saveM(_sel);
      };
    }, 200);
  }

  // Init UDP panel once the page DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUdpPanel);
  } else {
    setTimeout(initUdpPanel, 300);
  }

})();
