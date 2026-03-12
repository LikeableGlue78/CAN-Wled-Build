'use strict';
/**
 * WLED Mock Server — local UI development without hardware
 *
 * Serves the wled00/data/ web interface on http://localhost:8080 and
 * responds to every JSON API endpoint with realistic simulated data so
 * the full UI (index.htm, can.htm, settings pages) runs as if a real
 * WLED ESP32-S3 + CAN usermod is connected.
 *
 * Usage:   node tools/mock/server.js
 *  or:     npm run mock
 *
 * Pages:
 *   http://localhost:8080/           — Main WLED UI
 *   http://localhost:8080/can.htm    — CAN Bus Monitor
 *   http://localhost:8080/settings.htm — Settings
 *
 * No extra npm packages needed — only Node.js built-ins.
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const dgram = require('dgram');

const PORT     = 8080;
const HOST     = '0.0.0.0';
const DATA_DIR = path.resolve(__dirname, '../../wled00/data');

const {
  getMockSI, getState, applyCommand,
  getPalettes, getPalx, getEffects, getFxData,
  getPresets, getNodes,
  getCanStatus, getCanFull,
  applyCarInput, getCarState,
  getLayout, applyLayout,
  renderEffect,
} = require('./mock-data');

// ─── Real UDP / network device discovery ───────────────────────────────────────────
const _deviceCache   = new Map();  // ip → { ip, name, leds, ver, id }
const _mirroredIPs   = new Set();  // IPs we are currently mirroring to
let   _scanInProgress = false;
let   _mirrorTimer    = null;

// Probe a single IP — GETs /json/info with a short timeout.
// Resolves to a device object or null.
function probeWledDevice(ip) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { req.destroy(); resolve(null); }, 650);
    const req = http.get(
      { host: ip, path: '/json/info', port: 80, timeout: 600 },
      (res) => {
        let body = '';
        res.on('data', c => (body += c));
        res.on('end', () => {
          clearTimeout(timeout);
          try {
            const info = JSON.parse(body);
            if (info && info.ver && (info.name || info.udpport !== undefined)) {
              resolve({
                id:   ip,
                ip,
                name: info.name  || 'WLED-' + ip.split('.').pop(),
                leds: (info.leds && info.leds.count) || 0,
                ver:  info.ver || '?',
              });
            } else resolve(null);
          } catch { resolve(null); }
        });
      }
    );
    req.on('error',   () => { clearTimeout(timeout); resolve(null); });
    req.on('timeout', () => { req.destroy(); });
  });
}

// Return all IPv4 /24 subnets on local interfaces (skip loopback).
function getLocalSubnets() {
  const seen = new Set();
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const addr of ifaces) {
      if (addr.family === 'IPv4' && !addr.internal) {
        const parts = addr.address.split('.');
        seen.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
      }
    }
  }
  return [...seen];
}

// Scan all /24 subnets for WLED devices.  Resolves when done.
async function scanNetwork() {
  if (_scanInProgress) return;
  _scanInProgress = true;
  const subnets = getLocalSubnets();
  const ips = [];
  for (const base of subnets)
    for (let i = 1; i <= 254; i++) ips.push(`${base}.${i}`);

  // Fire all probes concurrently (non-blocking HTTP with 650 ms timeout each)
  const results = await Promise.all(ips.map(probeWledDevice));
  for (const d of results) if (d) _deviceCache.set(d.ip, d);
  _scanInProgress = false;
}

// Listen on UDP 21324 for WLED broadcast "notify" packets.
// WLED sends these when its state changes, letting us detect devices passively.
const _udpSock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
_udpSock.on('message', (msg, rinfo) => {
  // Any UDP packet from an unknown host on port 21324 is treated as a WLED device.
  // We schedule a targeted HTTP probe to get its full info.
  const ip = rinfo.address;
  if (!_deviceCache.has(ip)) {
    probeWledDevice(ip).then(d => { if (d) _deviceCache.set(ip, d); });
  }
});
_udpSock.bind(21324, () => {
  try { _udpSock.setBroadcast(true); } catch (_) {}
  console.log('  UDP listener active on port 21324 (passive WLED discovery)');
});
_udpSock.on('error', (err) => {
  // Port may already be in use if a real WLED-sync process is running — that's fine.
  console.warn('  UDP 21324 unavailable:', err.code, '— passive discovery disabled');
});

// ── Real-time pixel push via WLED DRGB UDP protocol ──────────────────────────
// No explicit bind() — Node auto-binds the send socket on first send, avoiding
// the async race condition where packets fire before the socket is ready.
const _sendSock = dgram.createSocket('udp4');
_sendSock.on('error', (e) => { console.warn('  UDP send error:', e.code); });

// Persist mirror state across server restarts
const _mirrorStatePath = path.join(__dirname, '.udp-mirror-state.json');
function _saveMirrorState() {
  try { fs.writeFileSync(_mirrorStatePath, JSON.stringify([..._mirroredIPs])); } catch(_) {}
}
function _loadMirrorState() {
  try {
    const data = fs.readFileSync(_mirrorStatePath, 'utf8');
    for (const ip of JSON.parse(data)) _mirroredIPs.add(ip);
    if (_mirroredIPs.size > 0)
      console.log(`  Restored ${_mirroredIPs.size} mirrored device(s) from last session`);
  } catch(_) {}
}
_loadMirrorState();

// Persist device pixel-range mappings (which slice of the sim canvas each device plays)
const TOTAL_SIM_LEDS = 650; // matches renderEffect() output length
const _deviceMappings = new Map(); // ip → { start, end, reverse }
const _mappingStatePath = path.join(__dirname, '.udp-mapping-state.json');
function _saveMappingState() {
  try {
    const obj = {};
    for (const [k, v] of _deviceMappings) obj[k] = v;
    fs.writeFileSync(_mappingStatePath, JSON.stringify(obj));
  } catch(_) {}
}
function _loadMappingState() {
  try {
    const saved = JSON.parse(fs.readFileSync(_mappingStatePath, 'utf8'));
    for (const [k, v] of Object.entries(saved)) _deviceMappings.set(k, v);
    if (_deviceMappings.size > 0)
      console.log(`  Restored ${_deviceMappings.size} device mapping(s) from last session`);
  } catch(_) {}
}
_loadMappingState();

// Resample `pixels` (any length) to exactly `n` LEDs via nearest-neighbour
function resamplePixels(pixels, n) {
  if (n <= 0) return [];
  if (pixels.length === n) return pixels;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const src = Math.min(Math.round(i / Math.max(n - 1, 1) * (pixels.length - 1)), pixels.length - 1);
    out[i] = pixels[src];
  }
  return out;
}

function buildDrgbPacket(pixels) {
  const buf = Buffer.allocUnsafe(2 + pixels.length * 3);
  buf[0] = 0x02;  // DRGB protocol
  buf[1] = 0x05;  // 5-second realtime timeout
  let offset = 2;
  for (const hex of pixels) {
    buf[offset++] = parseInt(hex.slice(0, 2), 16);
    buf[offset++] = parseInt(hex.slice(2, 4), 16);
    buf[offset++] = parseInt(hex.slice(4, 6), 16);
  }
  return buf;
}

// ── Path math (mirrors the HUD's _pathEval) ──────────────────────────────────
// Evaluates a mapping's 2D path at parameter t ∈ [0,1], returns { x, y }.
// Supports: straight line, polyline with creases, Catmull-Rom curve, quadratic
// bezier when curved with no creases.
function _pathPts(m) {
  const pts = [{ x: m.x1 || 0, y: m.y1 !== undefined ? m.y1 : 0.5 }];
  for (const c of (m.creases || [])) pts.push({ x: c.x, y: c.y });
  pts.push({ x: m.x2 !== undefined ? m.x2 : 1, y: m.y2 !== undefined ? m.y2 : 0.5 });
  return pts;
}
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
function _pathEval(m, t) {
  const pts = _pathPts(m);
  if (m.hasCurve) {
    if (pts.length === 2 && m.cpx !== undefined) {
      const u = t, v = 1 - u;
      return { x: v*v*pts[0].x + 2*v*u*m.cpx + u*u*pts[1].x,
               y: v*v*pts[0].y + 2*v*u*m.cpy + u*u*pts[1].y };
    }
    return _crEval(pts, t);
  }
  if (pts.length < 2) return pts[0];
  const n  = pts.length - 1;
  const tf = Math.min(t * n, n - 1e-9);
  const i  = Math.floor(tf);
  const u  = tf - i;
  return { x: pts[i].x + (pts[i+1].x - pts[i].x)*u,
           y: pts[i].y + (pts[i+1].y - pts[i].y)*u };
}

// Remap uniform t [0,1] using crease weights to produce biased t'.
// Mirrors the HUD's _remapT exactly.
function _remapT(m, t) {
  const creases = m.creases || [];
  if (creases.length === 0) return t;
  const S = 80;
  const pathBreaks = [0];
  for (const c of creases) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i <= S; i++) {
      const tt = i / S;
      const p  = _pathEval(m, tt);
      const d  = (p.x - c.x)**2 + (p.y - c.y)**2;
      if (d < bestD) { bestD = d; best = tt; }
    }
    pathBreaks.push(best);
  }
  pathBreaks.push(1);
  const nSeg = pathBreaks.length - 1;
  const segLens = [];
  for (let i = 0; i < nSeg; i++) segLens.push(pathBreaks[i+1] - pathBreaks[i]);
  const shares = segLens.slice();
  for (let ci = 0; ci < creases.length; ci++) {
    const w = creases[ci].weight !== undefined ? creases[ci].weight : 0.5;
    const total = shares[ci] + shares[ci + 1];
    shares[ci]     = total * w;
    shares[ci + 1] = total * (1 - w);
  }
  const sum = shares.reduce((a, b) => a + b, 0) || 1;
  for (let i = 0; i < shares.length; i++) shares[i] /= sum;
  const ledBreaks = [0];
  for (let i = 0; i < nSeg; i++) ledBreaks.push(ledBreaks[i] + shares[i]);
  let seg = 0;
  for (let i = 0; i < nSeg; i++) {
    if (t >= ledBreaks[i] && t <= ledBreaks[i + 1]) { seg = i; break; }
    if (i === nSeg - 1) seg = i;
  }
  const segFrac = (ledBreaks[seg + 1] - ledBreaks[seg]) || 1e-9;
  const u = (t - ledBreaks[seg]) / segFrac;
  return pathBreaks[seg] + u * (pathBreaks[seg + 1] - pathBreaks[seg]);
}

// Sample the LED buffer along a mapping's actual 2D path.
// For each output LED, evaluate the path position and use its x-coordinate
// to look up the source pixel — exactly matching the canvas display.
function samplePixelsAlongPath(mapping, allPixels, devLeds) {
  const N = Math.min(devLeds, 490);
  if (N <= 0) return [];
  const out = new Array(N);
  const len = allPixels.length;
  for (let i = 0; i < N; i++) {
    const tUniform = N > 1 ? i / (N - 1) : 0;
    const t   = _remapT(mapping, tUniform);
    const pos = _pathEval(mapping, mapping.reverse ? (1 - t) : t);
    // x-position on the normalised canvas → LED index
    const idx = Math.max(0, Math.min(len - 1, Math.round(pos.x * (len - 1))));
    out[i] = allPixels[idx];
  }
  return out;
}

// Per-device highlight hold: ip → expiry timestamp.  Mirror loop skips
// any device whose highlight hasn't expired yet so the flash is visible.
const _highlightHold = new Map();

function startMirrorLoop() {
  if (_mirrorTimer) return;
  _mirrorTimer = setInterval(() => {
    if (_mirroredIPs.size === 0) return;
    const allPixels = renderEffect();
    if (!allPixels || allPixels.length === 0) return;
    const now = Date.now();
    for (const ip of _mirroredIPs) {
      // Skip this device while a highlight flash is active
      const holdUntil = _highlightHold.get(ip);
      if (holdUntil && now < holdUntil) continue;
      if (holdUntil) _highlightHold.delete(ip);
      const mapping = _deviceMappings.get(ip) || {};
      const dev     = _deviceCache.get(ip);
      const devLeds = dev ? Math.min(dev.leds, 490) : 490;

      let pixels;
      if (mapping.x1 !== undefined) {
        // 2D path-aware sampling — matches canvas display exactly
        pixels = samplePixelsAlongPath(mapping, allPixels, devLeds);
      } else {
        // Legacy start/end fallback
        let mStart = mapping.start || 0;
        let mEnd   = mapping.end   || allPixels.length;
        mStart = Math.max(0, mStart);
        mEnd   = Math.min(allPixels.length, Math.max(mEnd, mStart + 1));
        let slice = allPixels.slice(mStart, mEnd);
        if (slice.length === 0) slice = allPixels;
        if (mapping.reverse) slice = slice.slice().reverse();
        pixels = resamplePixels(slice, devLeds);
      }

      const pkt = buildDrgbPacket(pixels);
      _sendSock.send(pkt, 0, pkt.length, 21324, ip, (err) => {
        if (err) console.warn(`  DRGB send to ${ip} failed:`, err.code);
      });
    }
  }, 33); // ~30 fps
}
startMirrorLoop();

function getUdpDeviceList() {
  return Array.from(_deviceCache.values()).map(d => ({
    ...d, connected: _mirroredIPs.has(d.ip),
  }));
}

// ─── MIME types ───────────────────────────────────────────────────────────────
const MIME = {
  '.htm':   'text/html',
  '.html':  'text/html',
  '.css':   'text/css',
  '.js':    'application/javascript',
  '.json':  'application/json',
  '.ico':   'image/x-icon',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.gif':   'image/gif',
  '.svg':   'image/svg+xml',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
};

// ─── Response helpers ─────────────────────────────────────────────────────────
function sendJSON(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type':               'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control':              'no-cache, no-store',
  });
  res.end(JSON.stringify(data));
}

function sendText(res, body, status = 200, type = 'text/plain') {
  res.writeHead(status, {
    'Content-Type':               type,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control':              'no-cache, no-store',
  });
  res.end(body);
}

// ─── Static file serving ─────────────────────────────────────────────────────
function serveStatic(res, reqPath) {
  // Map / → index.htm, /liveview → liveview.htm, /liveviewws2D → liveviewws2D.htm
  let rel = reqPath;
  if      (reqPath === '/')              rel = 'index.htm';
  else if (reqPath === '/liveview')      rel = 'liveview.htm';
  else if (reqPath === '/liveviewws2D')  rel = 'liveviewws2D.htm';
  const filePath = path.normalize(path.join(DATA_DIR, rel));

  // Block path traversal attempts
  if (!filePath.startsWith(DATA_DIR + path.sep) && filePath !== DATA_DIR) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`404 Not Found: ${reqPath}`);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';

    // Inject mock HUD script into all HTML pages
    if (ext === '.htm' || ext === '.html') {
      let html = data.toString('utf8');
      const inject = '\n<script src="/mock/hud.js"></script>\n';
      html = html.replace('</body>', inject + '</body>');
      if (!html.includes('/mock/hud.js')) html += inject; // fallback if no </body>
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
      res.end(html);
    } else {
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
      res.end(data);
    }
  });
}

// ─── API routing ─────────────────────────────────────────────────────────────
function handleAPI(method, pathname, query, body, res) {
  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end(); return;
  }

  // Parse JSON body from POST requests
  let cmd = null;
  if (method === 'POST' && body) {
    try { cmd = JSON.parse(body); } catch (_) {}
  }

  switch (pathname) {
    // ── Main state + info combined (primary polling endpoint) ──────────────
    case '/json/si':
    case '/json':
      if (cmd) applyCommand(cmd);
      return sendJSON(res, getMockSI());

    // ── State only ─────────────────────────────────────────────────────────
    case '/json/state':
      if (cmd) applyCommand(cmd);
      return sendJSON(res, getState());

    // ── Info only ──────────────────────────────────────────────────────────
    case '/json/info':
      return sendJSON(res, getMockSI().info);

    // ── Palette list ───────────────────────────────────────────────────────
    case '/json/palettes':
      return sendJSON(res, getPalettes());

    // ── Palette colour-stop data (for preview bars) ────────────────────────
    case '/json/palx':
      return sendJSON(res, getPalx(query.page));

    // ── Effect list ────────────────────────────────────────────────────────
    case '/json/effects':
      return sendJSON(res, getEffects());

    // ── Effect parameter strings (sliders / colors / palette / flags) ──────
    case '/json/fxdata':
      return sendJSON(res, getFxData());

    // ── Multi-instance node list ───────────────────────────────────────────
    case '/json/nodes':
      return sendJSON(res, getNodes());

    // ── CAN bus endpoints ──────────────────────────────────────────────────
    case '/json/can':
      if (query.ping  === '1') return sendText(res, 'can_ok');
      if (query.full  === '1') return sendJSON(res, getCanFull());
      return sendJSON(res, getCanStatus());

    // ── Liveview / Peek pixel data ─────────────────────────────────────────
    case '/json/live':
      return sendJSON(res, { leds: renderEffect() });

    // ── Mock interactive inputs ────────────────────────────────────────────
    case '/mock/input':
      if (method === 'POST' && cmd) {
        applyCarInput(cmd);
        return sendJSON(res, { success: true, car: getCarState() });
      }
      return sendJSON(res, { error: 'POST only' }, 405);

    case '/mock/car':
      return sendJSON(res, getCarState());

    case '/mock/layout':
      if (method === 'POST' && cmd) {
        applyLayout(cmd);
        return sendJSON(res, { success: true });
      }
      return sendJSON(res, getLayout());

    // ── HUD browser script (served from tools/mock/) ───────────────────────
    case '/mock/hud.js': {
      const hudPath = path.join(__dirname, 'mock-hud.js');
      fs.readFile(hudPath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, {
          'Content-Type': 'application/javascript',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        });
        res.end(data);
      });
      return;
    }

    // ── SPIFFS file editor (used by UI to read/write version-info.json) ─────
    // Return a version-info.json whose version matches info.ver so the
    // "Thank you for installing" upgrade dialog never fires.
    case '/edit': {
      const { getMockInfo } = require('./mock-data');
      const ver = getMockInfo().ver;
      if (method === 'GET') {
        return sendJSON(res, { version: ver, neverAsk: false });
      }
      // PUT/POST from the editor — accept silently
      return sendJSON(res, { success: true });
    }

    // ── Catch-all config endpoint (accept all writes silently) ─────────────
    case '/json/cfg':
      return sendJSON(res, { success: true });

    // ── Preset storage ─────────────────────────────────────────────────────
    case '/presets.json':
      return sendJSON(res, getPresets());
    // ── UDP device discovery + sync-mirror ────────────────────────────────
    case '/mock/udp/scan': {
      // Return currently cached devices immediately, then kick off a fresh
      // background scan so next scan call will have up-to-date results.
      const cached = getUdpDeviceList();
      scanNetwork(); // async, non-blocking
      return sendJSON(res, { devices: cached, scanning: !_scanInProgress });
    }

    case '/mock/udp/connect':
      if (method === 'POST' && cmd) {
        const ip = String(cmd.ip || cmd.id || '');
        if (cmd.enable !== false) _mirroredIPs.add(ip);
        else _mirroredIPs.delete(ip);
        _saveMirrorState();
        return sendJSON(res, { success: true, devices: getUdpDeviceList() });
      }
      return sendJSON(res, { error: 'POST only' }, 405);

    case '/mock/udp/connect-all':
      if (method === 'POST') {
        const enableAll = !cmd || cmd.enable !== false;
        if (enableAll) {
          for (const ip of _deviceCache.keys()) _mirroredIPs.add(ip);
        } else {
          _mirroredIPs.clear();
        }
        _saveMirrorState();
        return sendJSON(res, { success: true, devices: getUdpDeviceList() });
      }
      return sendJSON(res, { error: 'POST only' }, 405);

    // ── Highlight a single LED on a device ─────────────────────────────
    case '/mock/udp/highlight':
      if (method === 'POST' && cmd) {
        const ip    = String(cmd.ip || '');
        const color = String(cmd.color || 'ffffff');
        const dev   = _deviceCache.get(ip);
        const count = dev ? Math.min(dev.leds, 490) : 490;
        // Accept either t (parametric 0-1) or led (integer index)
        let led;
        if (cmd.t !== undefined) {
          const t = Math.max(0, Math.min(1, parseFloat(cmd.t) || 0));
          // Evaluate path at t to find the x-position, then map to LED index
          const mapping = _deviceMappings.get(ip);
          if (mapping && mapping.x1 !== undefined) {
            const pos = _pathEval(mapping, mapping.reverse ? (1 - t) : t);
            led = Math.round(pos.x * (count - 1));
          } else {
            led = Math.round(t * (count - 1));
          }
        } else {
          led = parseInt(cmd.led) || 0;
        }
        led = Math.max(0, Math.min(count - 1, led));
        console.log(`  HL: ip=${ip} led=${led} color=${color} count=${count} dev=${!!dev}`);
        if (ip && led >= 0 && led < count) {
          const r = parseInt(color.slice(0, 2), 16) || 0;
          const g = parseInt(color.slice(2, 4), 16) || 0;
          const b = parseInt(color.slice(4, 6), 16) || 0;
          const buf = Buffer.allocUnsafe(2 + count * 3);
          buf[0] = 0x02; buf[1] = 0x02; // 2-second timeout
          // Fill with dim background
          for (let i = 0; i < count; i++) {
            const off = 2 + i * 3;
            buf[off] = 2; buf[off+1] = 2; buf[off+2] = 2;
          }
          // Light up target LED ±5 with distance falloff
          const SPREAD = 5;
          for (let j = -SPREAD; j <= SPREAD; j++) {
            const idx = led + j;
            if (idx >= 0 && idx < count) {
              const off = 2 + idx * 3;
              const dim = 1.0 - (Math.abs(j) / (SPREAD + 1)) * 0.8;
              buf[off]   = Math.round(r * dim);
              buf[off+1] = Math.round(g * dim);
              buf[off+2] = Math.round(b * dim);
            }
          }
          _sendSock.send(buf, 0, buf.length, 21324, ip, ()=>{});
          // Hold this device from the mirror loop so the flash is visible
          _highlightHold.set(ip, Date.now() + 500);
        }
        return sendJSON(res, { success: true });
      }
      return sendJSON(res, { error: 'POST only' }, 405);

    // ── Per-device 2D pixel-range mapping ───────────────────────────────
    case '/mock/udp/mapping':
      if (method === 'POST' && cmd) {
        const ip = String(cmd.ip || '');
        if (ip) {
          let entry;
          if (cmd.x1 !== undefined) {
            // 2D format: { x1, y1, x2, y2, reverse, hasCurve, cpx, cpy, creases }
            const clamp = v => Math.max(0, Math.min(1, parseFloat(v) || 0));
            entry = {
              x1: clamp(cmd.x1), y1: clamp(cmd.y1 !== undefined ? cmd.y1 : 0.5),
              x2: clamp(cmd.x2), y2: clamp(cmd.y2 !== undefined ? cmd.y2 : 0.5),
              reverse:  !!cmd.reverse,
              hasCurve: !!cmd.hasCurve,
              cpx: cmd.cpx !== undefined ? clamp(cmd.cpx) : 0.5,
              cpy: cmd.cpy !== undefined ? clamp(cmd.cpy) : 0.35,
              creases: Array.isArray(cmd.creases)
                ? cmd.creases.map(c => ({ x: clamp(c.x), y: clamp(c.y), weight: c.weight !== undefined ? Math.max(0.1, Math.min(0.9, parseFloat(c.weight) || 0.5)) : 0.5 }))
                : [],
            };
          } else {
            // Legacy start/end → convert to normalized 2D (horizontal strip)
            const start = Math.max(0, Math.min(TOTAL_SIM_LEDS - 1, parseInt(cmd.start) || 0));
            const end   = Math.max(1, Math.min(TOTAL_SIM_LEDS,     parseInt(cmd.end)   || TOTAL_SIM_LEDS));
            entry = { x1: start / TOTAL_SIM_LEDS, y1: 0.5, x2: end / TOTAL_SIM_LEDS, y2: 0.5,
              reverse: !!cmd.reverse, hasCurve: false, cpx: 0.5, cpy: 0.35, creases: [] };
          }
          _deviceMappings.set(ip, entry);
          _saveMappingState();
        }
        return sendJSON(res, { success: true });
      }
      // GET — return 2D mappings with convenience start/end fields
      {
        const obj = {};
        for (const [k, v] of _deviceMappings) {
          const N  = TOTAL_SIM_LEDS;
          const x1 = v.x1 !== undefined ? v.x1 : (v.start || 0) / N;
          const x2 = v.x2 !== undefined ? v.x2 : (v.end   || N) / N;
          const y1 = v.y1 !== undefined ? v.y1 : 0.5;
          const y2 = v.y2 !== undefined ? v.y2 : 0.5;
          obj[k] = { x1, y1, x2, y2, reverse: !!v.reverse,
            hasCurve: !!v.hasCurve,
            cpx: v.cpx !== undefined ? v.cpx : (x1+x2)/2,
            cpy: v.cpy !== undefined ? v.cpy : 0.35,
            creases: Array.isArray(v.creases) ? v.creases : [],
            start: Math.round(Math.min(x1,x2)*N), end: Math.round(Math.max(x1,x2)*N) };
        }
        return sendJSON(res, { totalLeds: TOTAL_SIM_LEDS, mappings: obj });
      }
    // ── Optional / rarely-used endpoints ───────────────────────────────────
    case '/holidays.json':
      return sendJSON(res, []);

    case '/skin.css':
      return sendText(res, '/* mock server: no custom skin */', 200, 'text/css');

    case '/upload':
      return sendText(res, 'File uploaded (mock)');

    default:
      return sendJSON(res, { error: 'Not found' }, 404);
  }
}

// ─── HTTP server ─────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const parsed   = new URL(req.url, `http://${req.headers.host || HOST}`);
  const pathname = parsed.pathname;
  const query    = Object.fromEntries(parsed.searchParams);

  // Collect body for POST requests
  let body = '';
  req.on('data', chunk => (body += chunk.toString()));
  req.on('end', () => {
    // Decide: API route or static file
    const isAPI = pathname.startsWith('/json')
               || pathname.startsWith('/mock/')
               || pathname === '/presets.json'
               || pathname === '/holidays.json'
               || pathname === '/skin.css'
               || pathname === '/upload'
               || pathname === '/edit'   // version-info.json check
               || pathname.startsWith('/mock/udp/');

    if (isAPI) {
      handleAPI(req.method, pathname, query, body, res);
    } else {
      serveStatic(res, pathname);
    }
  });
});

server.listen(PORT, HOST, () => {
  const lanIP = Object.values(os.networkInterfaces()).flat().find(i => i.family === 'IPv4' && !i.internal)?.address || HOST;
  const base = `http://${lanIP}:${PORT}`;
  console.log('\n┌─────────────────────────────────────────┐');
  console.log('│         WLED Mock Dev Server            │');
  console.log('├─────────────────────────────────────────┤');
  console.log(`│  ${base}/             │`);
  console.log('├─────────────────────────────────────────┤');
  console.log(`│  Main UI     →  ${base}/        │`);
  console.log(`│  CAN Monitor →  ${base}/can.htm │`);
  console.log(`│  Settings    →  ${base}/settings│`);
  console.log('├─────────────────────────────────────────┤');
  console.log('│  Simulating: 650 LEDs, CAN bus active   │');
  console.log('│  UDP mirror: DRGB pixel-push @ ~30 fps  │');
  console.log('│  Press Ctrl+C to stop                   │');
  console.log('└─────────────────────────────────────────┘\n');
});
