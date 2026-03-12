'use strict';

// ─── Mutable state (modified by POST commands) ───────────────────────────────
const _state = {
  on: true,
  bri: 128,
  transition: 7,
  bs: 0,
  ps: -1,
  pl: -1,
  lor: 0,
  mainseg: 0,
  nl:   { on: false, dur: 60, tbri: 0, fade: true, mode: 0 },
  udpn: { send: false, recv: true },
  seg: [
    // 0 — LEFT_DOORS  LEDs   0–199  (200 LEDs)  center=100
    {
      id: 0, start: 0,   stop: 200, startY: 0, stopY: 1, len: 200,
      on: true, bri: 255,
      col: [[255, 160, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
      fx: 0, sx: 128, ix: 128,
      c1: 0, c2: 0, c3: 0,
      o1: false, o2: false, o3: false,
      pal: 0, sel: true, rev: false, mi: false, frz: false,
      n: 'LEFT_DOORS', grp: 1, spc: 0, of: 0, set: 0,
      lc: 1, m12: 0, bm: 0, si: 0, cct: -1,
    },
    // 1 — DASH        LEDs 200–449  (250 LEDs)  center=325
    {
      id: 1, start: 200, stop: 450, startY: 0, stopY: 1, len: 250,
      on: true, bri: 255,
      col: [[255, 160, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
      fx: 0, sx: 128, ix: 128,
      c1: 0, c2: 0, c3: 0,
      o1: false, o2: false, o3: false,
      pal: 0, sel: true, rev: false, mi: false, frz: false,
      n: 'DASH', grp: 1, spc: 0, of: 0, set: 0,
      lc: 1, m12: 0, bm: 0, si: 0, cct: -1,
    },
    // 2 — RIGHT_DOORS LEDs 450–649  (200 LEDs)  center=550
    {
      id: 2, start: 450, stop: 650, startY: 0, stopY: 1, len: 200,
      on: true, bri: 255,
      col: [[255, 160, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
      fx: 0, sx: 128, ix: 128,
      c1: 0, c2: 0, c3: 0,
      o1: false, o2: false, o3: false,
      pal: 0, sel: true, rev: false, mi: false, frz: false,
      n: 'RIGHT_DOORS', grp: 1, spc: 0, of: 0, set: 0,
      lc: 1, m12: 0, bm: 0, si: 0, cct: -1,
    },
  ],
  // CAN usermod settings embedded in state (mirrors readFromJsonState)
  can: {
    enabled: true, bitrate: 500000, listenOnly: true,
    rxPin: 4, txPin: 5, rxQueueLen: 128,
    filterEnabled: false, filterExt: false, filterId: 0, filterMask: 2047,
    uiPollRate: 1, uiEffect: 0,
    rpmCanId: 0x316, speedCanId: 0x328, throttleCanId: 0x329,
  },
};

// ─── Interactive car physics ──────────────────────────────────────────────────
// Gear ratios — index 0 = Neutral (no wheel coupling)
const GEAR_RATIOS = [0, 3.5, 2.1, 1.4, 1.0, 0.75, 0.6]; // index = gear (0=N, 1–6)
const GEAR_UPSHIFT_RPM   = 5800;
const GEAR_DOWNSHIFT_RPM = 1500;
const IDLE_RPM           = 820;
const MAX_RPM            = 7200;
const PHYSICS_INTERVAL   = 20;    // ms  (50 Hz physics tick)
// Physical drivetrain constants
const WHEEL_CIRC_M           = 2.0;
const FINAL_DRIVE            = 3.7;
const RPM_PER_KMPH_PER_RATIO = (FINAL_DRIVE * 60) / (WHEEL_CIRC_M * 3.6);
// Throttle pedal ramp: 0→100 % in 0.45 s, lift-off in 0.18 s
const THROTTLE_UP_RATE   = 100 / 0.45;
const THROTTLE_DOWN_RATE = 100 / 0.18;
// Rev limiter
const LIMITER_RPM   = 7000;  // RPM at which limiter fires
const LIMITER_DROP  = 240;   // RPM must fall this far before cycle resets
const LIMITER_DECAY = 2200;  // RPM/s drop rate during ignition cut (~9 Hz bounce)

// Start sequence phases: 'off' | 'crank' | 'flare' | 'settle' | 'run'
// Timeline (seconds from engine-on event):
//   0.00–0.35  crank   — starter motor, RPM 0 → 280 (grinding up)
//   0.35–0.75  flare   — engine fires,  RPM 280 → 1450 (cold-start overshoot)
//   0.75–1.55  settle  — RPM 1450 → IDLE (820) (thermal settle)
//   1.55+      run     — normal physics
const START_CRANK_END   = 0.35;
const START_FLARE_END   = 0.75;
const START_SETTLE_END  = 1.55;
const START_FLARE_PEAK  = 1450;

// Mutable car state
const _car = {
  rpm:          IDLE_RPM,
  speed:        0,
  throttle:     0,
  _pedalTarget: 0,
  gear:         1,
  temp:         88,
  fuel:         100,
  braking:      false,
  engineOn:     true,
  _startPhase:  'run',  // already running at server start
  _startTimer:  0,      // seconds elapsed in current start sequence
  _lastTick:    Date.now(),
  _limiterActive: false, // rev limiter cut state
};

function applyCarInput(inp) {
  if (inp.throttle !== undefined) _car._pedalTarget = Math.max(0, Math.min(100, inp.throttle));
  if (inp.braking  !== undefined) _car.braking  = !!inp.braking;
  if (inp.shiftUp   && _car.gear < 6) { _car.gear++; }
  if (inp.shiftDown && _car.gear > 0) { _car.gear--; }
  if (inp.engineOn  !== undefined) {
    const wasOn = _car.engineOn;
    _car.engineOn = !!inp.engineOn;
    if (!wasOn && _car.engineOn) {
      // Engine turned on — begin crank sequence
      _car._startPhase  = 'crank';
      _car._startTimer  = 0;
      _car.rpm          = 0;
      _car.throttle     = 0;
      _car._pedalTarget = 0;
    } else if (wasOn && !_car.engineOn) {
      // Engine turned off — immediate die
      _car._startPhase  = 'off';
      _car.throttle     = 0;
      _car._pedalTarget = 0;
    }
  }
}

function getCarState() {
  return {
    rpm:        Math.round(_car.rpm),
    speed:      Math.round(_car.speed * 10) / 10,
    throttle:   Math.round(_car.throttle),
    gear:       _car.gear,
    temp:       Math.round(_car.temp * 10) / 10,
    fuel:       Math.round(_car.fuel * 10) / 10,
    braking:      _car.braking,
    engineOn:     _car.engineOn,
    startPhase:   _car._startPhase,
    limiterActive: _car._limiterActive,
  };
}

// Physics tick — runs every PHYSICS_INTERVAL ms
function _physicsStep() {
  const now = Date.now();
  const dt  = Math.min((now - _car._lastTick) / 1000, 0.1);
  _car._lastTick = now;

  // ── ENGINE OFF ───────────────────────────────────────────────────────────
  if (_car._startPhase === 'off') {
    // RPM decays quickly (engine stops spinning)
    _car.rpm   = Math.max(0, _car.rpm - 1800 * dt);
    // Speed coasts down — friction + residual brake
    const drag  = _car.speed * _car.speed * 0.000038 * dt;
    const roll  = _car.speed * 0.008 * dt;
    const brake = _car.braking ? 25 * dt : 0;
    _car.speed  = Math.max(0, _car.speed - drag - roll - brake);
    return;
  }

  // ── ENGINE START SEQUENCE ────────────────────────────────────────────────
  if (_car._startPhase === 'crank' || _car._startPhase === 'flare' || _car._startPhase === 'settle') {
    _car._startTimer += dt;
    const t = _car._startTimer;

    if (t < START_CRANK_END) {
      // Crank: RPM climbs linearly from 0 → 280 with slight flutter
      const frac   = t / START_CRANK_END;
      const flutter = Math.sin(t * 40) * 18 * (1 - frac); // starter grind
      _car.rpm     = frac * 280 + flutter;
      _car._startPhase = 'crank';
    } else if (t < START_FLARE_END) {
      // Flare: engine catches, RPM shoots up
      const frac  = (t - START_CRANK_END) / (START_FLARE_END - START_CRANK_END);
      // Ease-out curve: fast rise then plateaus
      const ease  = 1 - Math.pow(1 - frac, 2.2);
      _car.rpm    = 280 + ease * (START_FLARE_PEAK - 280);
      _car._startPhase = 'flare';
    } else if (t < START_SETTLE_END) {
      // Settle: RPM falls from flare peak to idle with slight oscillation
      const frac    = (t - START_FLARE_END) / (START_SETTLE_END - START_FLARE_END);
      const ease    = 1 - Math.pow(1 - frac, 1.6);
      const wobble  = Math.sin(frac * Math.PI * 3) * 60 * (1 - frac); // hunting
      _car.rpm      = START_FLARE_PEAK + ease * (IDLE_RPM - START_FLARE_PEAK) + wobble;
      _car._startPhase = 'settle';
    } else {
      // Done — hand off to normal run physics
      _car._startPhase = 'run';
      _car.rpm         = IDLE_RPM;
    }

    // Speed still coasts/rolls while starting (car is stationary usually)
    const drag  = _car.speed * _car.speed * 0.000038 * dt;
    const roll  = _car.speed * 0.008 * dt;
    const brake = _car.braking ? 25 * dt : 0;
    _car.speed  = Math.max(0, _car.speed - drag - roll - brake);
    return;
  }

  // ── NORMAL RUN ───────────────────────────────────────────────────────────

  // 1. Throttle ramp
  {
    const pedal = _car._pedalTarget;
    const rate  = (pedal >= _car.throttle) ? THROTTLE_UP_RATE : THROTTLE_DOWN_RATE;
    const delta = rate * dt;
    if (Math.abs(pedal - _car.throttle) <= delta) {
      _car.throttle = pedal;
    } else {
      _car.throttle += (pedal > _car.throttle ? 1 : -1) * delta;
    }
  }
  // x^0.65: aggressive initial response, tapers at top
  const effThrottle = 100 * Math.pow(_car.throttle / 100, 0.65);

  const ratio = GEAR_RATIOS[_car.gear] || 0;

  // 2. Speed model
  const drag  = _car.speed * _car.speed * 0.000038 * dt;
  const roll  = _car.speed * 0.006 * dt;
  const brake = _car.braking ? 28 * dt : 0;

  if (_car.gear === 0) {
    // Neutral — no drive or engine braking
    _car.speed = Math.max(0, _car.speed - drag - roll - brake);
  } else {
    // Drive force — cut to zero while limiter is active (ignition cut)
    const drive = (_car._limiterActive ? 0 : (effThrottle / 100) * 9.2 * ratio * dt);

    // Engine braking: in-gear lift-off pulls the car back
    // Force scales with gear ratio (1st = strong, 6th = mild) and RPM coupling
    const throttleFrac   = effThrottle / 100;
    const engineBrakeMag = ratio * 2.2 * dt;                // max decel at zero throttle
    const engineBrake    = (1 - throttleFrac) * engineBrakeMag;
    // Only apply engine braking when the engine is actually coupled (speed > 0)
    const eb = (_car.speed > 0.5) ? engineBrake : 0;

    _car.speed = Math.max(0, Math.min(280, _car.speed + drive - drag - roll - brake - eb));
  }

  // 3. RPM coupled to speed
  if (_car.gear === 0) {
    // Free-rev in Neutral — WOT targets MAX_RPM, no artificial ceiling
    const freeTarget = IDLE_RPM + (effThrottle / 100) * (MAX_RPM - IDLE_RPM);
    const alpha = 1 - Math.exp(-dt / 0.08);
    _car.rpm += (freeTarget - _car.rpm) * alpha;
  } else {
    // RPM is physically locked to wheel speed through the gearbox.
    // coupledRpm = speed × gearRatio × drivetrain constant — this is the FLOOR.
    // Under throttle, the engine overshoots the coupling slightly (torque demand),
    // giving the sensation of the engine pulling without breaking the physical link.
    // Upshift → ratio drops → coupledRpm drops → RPM drops (correct).
    // Downshift → ratio rises → coupledRpm rises → RPM rises (correct).
    // Redline is reached when speed in a given gear is high enough:
    //   1st: ~65 km/h  2nd: ~108 km/h  3rd: ~162 km/h
    const coupledRpm = _car.speed * ratio * RPM_PER_KMPH_PER_RATIO;
    const floorRpm   = Math.max(IDLE_RPM, coupledRpm);
    // Throttle overshoot: max 18 % of RPM range above coupling (≈ 1148 RPM at WOT)
    // This makes the engine feel alive under hard acceleration without unlinking RPM
    const overshoot  = (effThrottle / 100) * (MAX_RPM - IDLE_RPM) * 0.18;
    const targetRpm  = Math.min(MAX_RPM, floorRpm + overshoot);
    const alpha = 1 - Math.exp(-dt / 0.05); // 50 ms tracking — snappy needle
    _car.rpm += (targetRpm - _car.rpm) * alpha;
  }
  // Rev limiter — bangs off LIMITER_RPM when at throttle
  // Engage: RPM reaches threshold while applying throttle (>30 % eff)
  if (!_car._limiterActive && _car.rpm >= LIMITER_RPM && effThrottle > 30) {
    _car._limiterActive = true;
  }
  if (_car._limiterActive) {
    if (_car.rpm < LIMITER_RPM - LIMITER_DROP) {
      // RPM has dropped far enough — release the cut, let it climb again
      _car._limiterActive = false;
    } else {
      // Ignition cut: forcibly decay RPM against engine inertia
      _car.rpm -= LIMITER_DECAY * dt;
    }
  }
  _car.rpm = Math.max(IDLE_RPM, Math.min(MAX_RPM, _car.rpm));

  // 4. Temperature
  const tempTarget = 88 + (_car.rpm / MAX_RPM) * 22;
  _car.temp += (tempTarget - _car.temp) * 0.002 * dt * 50;

  // 5. Fuel
  _car.fuel = Math.max(0, _car.fuel - (_car.throttle * 0.000008 + 0.000003) * dt * 50);
}

// Start physics loop immediately
setInterval(_physicsStep, PHYSICS_INTERVAL);

// ─── Device info ─────────────────────────────────────────────────────────────
const _startMs = Date.now();

function getMockInfo() {
  const upSec = Math.floor((Date.now() - _startMs) / 1000);
  const now   = new Date();
  return {
    ver: '0.16.0', vid: Math.floor(_startMs / 1000), cn: 'Mock Build',
    name: 'WLED-CAN-Mock', simplifiedui: false,
    live: false, liveseg: -1, lm: '', lip: '',
    ws: -1,  // -1 disables WebSocket; UI falls back to clean HTTP polling
    fxcount: IMPLEMENTED_FX.size, palcount: Object.keys(PALETTES).length,
    cpalcount: 0, maps: [],
    leds: {
      count: 650, pwr: 0, fps: 60, maxseg: 32, bootps: 0, mseg: 3,
      seglc: [1], gc: { r: 1, g: 1, b: 1 }, matrix: null,
    },
    str: false, ndc: 0,
    arch: 'esp32s3', core: 'v2.0.17', lwip: 2,
    freeheap: 185432, psram: 3870720,
    uptime: upSec,
    time: now.toLocaleString('en-GB', {
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }),
    opt: 128,
    mac: 'AA:BB:CC:DD:EE:FF', ip: '192.168.1.42',
    clock: 240, flash: 16,
    wifi: { bssid: 'DE:AD:BE:EF:00:01', rssi: -55, signal: 82, channel: 6 },
    fs: { u: 36, t: 1024, pmt: 1 },
    u: { 'CAN-TWAI': [1, ' mod'] },  // shows up in the Info panel
  };
}

function getMockSI() { return { state: getState(), info: getMockInfo() }; }

// ─── Presets ─────────────────────────────────────────────────────────────────
function getPresets() {
  return {
    // standard presets
    1: { n: 'Fire 2012',      on: true, bri: 200, seg: [{ id: 0, fx: 66,  pal: 35 }] },  // Fire 2012
    2: { n: 'Rainbow',        on: true, bri: 200, seg: [{ id: 0, fx: 9,   pal: 11 }] },  // Rainbow
    3: { n: 'Party',          on: true, bri: 180, seg: [{ id: 0, fx: 63,  pal: 6  }] },  // Juggle
    4: { n: 'Police',         on: true, bri: 220, seg: [{ id: 0, fx: 47,  pal: 0  }] },  // Loading (police-ish)
    5: { n: 'Breathing',      on: true, bri: 180, seg: [{ id: 0, fx: 2,   pal: 0  }] },  // Breathe
    // CAN-reactive presets
    10: { n: 'CAN RPM Pulse',   on: true, bri: 220, seg: [{ id: 0, fx: 218, pal: 35, col: [[255,60,0,0],[0,0,0,0],[255,255,0,0]] }] },
    11: { n: 'CAN Speed Color', on: true, bri: 220, seg: [{ id: 0, fx: 219, pal: 11, col: [[0,100,255,0],[0,0,0,0],[255,0,0,0]] }] },
    12: { n: 'CAN Throttle',    on: true, bri: 220, seg: [{ id: 0, fx: 220, pal: 0,  col: [[0,200,0,0],[20,0,0,0],[0,0,0,0]], ix: 85 }] },
    20: { n: 'Off',             on: false, bri: 0 },
  };
}

// ─── Nodes ───────────────────────────────────────────────────────────────────
function getNodes() { return { nodes: [] }; }

// ─── UDP Device Discovery ────────────────────────────────────────────────────
// Real network scanning and device mirroring is handled in server.js using
// Node.js built-ins (http, os, dgram). No mock data here.

// ─── Effects (index = effect ID) ─────────────────────────────────────────────
// Names match FX.h defines exactly so the UI sort/search works correctly.
const EFFECTS = [
  /* 0-9 */
  'Solid','Blink','Breathe','Wipe','Wipe Random','Random Colors','Sweep','Dynamic','Colorloop','Rainbow',
  /* 10-19 */
  'Scan','Dual Scan','Fade','Theater','Theater Rainbow','Running Lights','Saw','Twinkle','Dissolve','Dissolve Rnd',
  /* 20-29 */
  'Sparkle','Flash Sparkle','Hyper Sparkle','Strobe','Strobe Rainbow','Multi Strobe','Blink Rainbow','Android','Chase','Chase Random',
  /* 30-39 */
  'Chase Rainbow','Chase Flash','Chase Flash Rnd','Chase White','Colorful','Traffic Light','Color Sweep Rnd','Red & Blue','Aurora','Running Random',
  /* 40-49 */
  'Larson Scanner','Comet','Fireworks','Rain','Tetrix','Fire Flicker','Gradient','Loading','Rolling Balls','Fairy',
  /* 50-59 */
  'Two Dots','Fairy Twinkle','Running Dual','Image','Tricolor Chase','Tricolor Wipe','Tricolor Fade','Lightning','ICU','Multi Comet',
  /* 60-69 */
  'Scanner Dual','Random Chase','Oscillate','Pride 2015','Juggle','Palette','Fire 2012','Colorwaves','BPM','Fill Noise',
  /* 70-79 */
  'Noise 1','Noise 2','Noise 3','Noise 4','Colortwinkles','Lake','Meteor','Copy','Railway','Ripple',
  /* 80-89 */
  'Twinklefox','Twinklecat','Halloween Eyes','Static Pattern','Tri Static Pattern','Spots','Spots Fade','Glitter','Candle','Starburst',
  /* 90-99 */
  'Exploding Fireworks','Bouncing Balls','Sinelon','Sinelon Dual','Sinelon Rainbow','Popcorn','Drip','Plasma','Percent','Ripple Rainbow',
  /* 100-109 */
  'Heartbeat','Pacifica','Candle Multi','Solid Glitter','Sunrise','Phased','Twinkleup','Noisepal','Sine Wave','Phased Noise',
  /* 110-119 */
  'Flow','Chunchun','Dancing Shadows','Washing Machine','Plasma Rotozoom','Blends','TV Simulator','Dynamic Smooth','2D Spaceships','2D Crazy Bees',
  /* 120-129 */
  '2D Ghost Rider','2D Blobs','2D Scroll Text','2D Drift Rose','2D Distortion Waves','2D Soap','2D Octopus','2D Waving Cell','Pixels','Pixelwave',
  /* 130-139 */
  'Juggles','Matripix','Gravimeter','Plasmoid','Puddles','Midnoise','Noisemeter','Freqwave','Freqmatrix','2D GEQ',
  /* 140-149 */
  'Waterfall','Freqpixels','Binmap','Noisefire','Puddlepeak','Noisemove','2D Noise','Perlinmove','Ripplepeak','2D Firenoise',
  /* 150-159 */
  '2D Squared Swirl','Pacman','2D DNA','2D Matrix','2D Metaballs','Freqmap','Gravcenter','Gravcentric','Gravfreq','DJ Light',
  /* 160-169 */
  '2D Funky Plank','Shimmer','2D Pulser','Blurz','2D Drift','2D Waverly','2D Sun Radiation','2D Colored Bursts','2D Julia','RSVD',
  /* 170-179 */
  'RSVD','RSVD','2D Game of Life','2D Tartan','2D Polar Lights','2D Swirl','2D Lissajous','2D Frizzles','2D Plasma Ball','Flow Stripe',
  /* 180-189 */
  '2D Hiphotic','2D Sin Dots','2D DNA Spiral','2D Black Hole','Wavesins','Rocktaves','2D Akemi','Particle Volcano','Particle Fire','Particle Fireworks',
  /* 190-199 */
  'Particle Vortex','Particle Perlin','Particle Pit','Particle Box','Particle Attractor','Particle Impact','Particle Waterfall','Particle Spray','Particles GEQ','Particle Center GEQ',
  /* 200-209 */
  'Particle Ghost Rider','Particle Blobs','PS Drip','PS Pinball','PS Dancing Shadows','PS Fireworks 1D','PS Sparkler','PS Hourglass','PS 1D Spray','PS Balance',
  /* 210-220 */
  'PS Chase','PS Starburst','PS 1D GEQ','PS Fire 1D','PS 1D Sonic Stream','PS 1D Sonic Boom','PS 1D Springy','Particle Galaxy',
  'CAN RPM Pulse',           // 218
  'CAN Speed Color',          // 219
  'CAN Throttle',             // 220
  'CAN Speed Noise',          // 221
  'CAN Throttle Meteor',      // 222
  'CAN RPM Ignition',         // 223
  'CAN Speed Warp',           // 224
];

// IDs that have an explicit case in _renderSegLeds (all others fall to palette-scroll default)
const IMPLEMENTED_FX = new Set([
  0,   // Solid
  1,   // Blink
  2,   // Breathe
  3,   // Wipe
  9,   // Rainbow
  12,  // Fade
  15,  // Running Lights
  17,  // Twinkle
  23,  // Strobe
  40,  // Larson Scanner
  41,  // Comet
  45,  // Fire Flicker
  47,  // Loading
  48,  // Rolling Balls
  54,  // Tricolor Chase
  57,  // Lightning
  63,  // Pride 2015
  64,  // Juggle
  65,  // Palette
  66,  // Fire 2012
  67,  // Colorwaves
  76,  // Meteor
  92,  // Sinelon
  101, // Pacifica
  218, // CAN RPM Pulse
  219, // CAN Speed Color
  220, // CAN Throttle
  221, // CAN Speed Noise
  222, // CAN Throttle Meteor
  223, // CAN RPM Ignition
  224, // CAN Speed Warp
]);

// Object with string keys — only includes effects with real implementations
function getEffects() {
  const obj = {};
  EFFECTS.forEach((name, i) => {
    if (IMPLEMENTED_FX.has(i)) obj[String(i)] = name;
  });
  return obj;
}

// fxdata metadata strings. CAN effects get real metadata matching FX.cpp.
// Format: "Name@Slider1,Slider2;Color1,Color2,Color3;PaletteOverride;Flags"
function getFxData() {
  const d = EFFECTS.map(() => '');
  d[218] = 'CAN RPM Pulse@,Intensity,Pal Map,Scale;;!;1;pal=0';
  d[219] = 'CAN Speed Color@,Intensity,Pal Map;;!;1;pal=0';
  d[220] = 'CAN Throttle@,Intensity,Pal Map;;!;1;pal=0';
  d[221] = 'CAN Speed Noise@Anim,Brightness,Pal Map;;!;1;pal=0';
  d[222] = 'CAN Throttle Meteor@Vel,Trail,Smooth;Head,,Tail;!;1';
  d[223] = 'CAN RPM Ignition@Anim,,Pal Map,Fade Time;Ember,BG,Hot Tip;!;1;pal=0,c2=128';
  d[224] = 'CAN Speed Warp@Anim,Intensity,Pal Map;;!;1;pal=0';
  return d;
}

// ─── Palettes ────────────────────────────────────────────────────────────────
const PALETTES = {
  0:  'Default',
  1:  '* Color 1',
  2:  '* Colors 1&2',
  3:  '* Color 1, 2 & 3',
  4:  '* Color Gradient',
  5:  '* Colors Only',
  6:  'Party',
  7:  'Cloud',
  8:  'Lava',
  9:  'Ocean',
  10: 'Forest',
  11: 'Rainbow',
  12: 'Rainbow Bands',
  13: 'Sunset',
  14: 'Rivendell',
  15: 'Breeze',
  16: 'Red & Blue',
  17: 'Yellowout',
  18: 'Analogous',
  19: 'Splash',
  20: 'Pastel',
  21: 'Sunset 2',
  22: 'Beach',
  23: 'Vintage',
  24: 'Departure',
  25: 'Landscape',
  26: 'Beach 2',
  27: 'Sherbet',
  28: 'Hult',
  29: 'Hult 64',
  30: 'Drywet',
  31: 'Jul',
  32: 'Grintage',
  33: 'Rewhi',
  34: 'Tertiary',
  35: 'Fire',
  36: 'Icefire',
  37: 'Cyane',
  38: 'Light Pink',
  39: 'Autumn',
  40: 'Magenta',
  41: 'Magred',
  42: 'Yelmag',
  43: 'Yelblu',
  44: 'Orange & Teal',
  45: 'Tiamat',
  46: 'April Night',
  47: 'Orangery',
  48: 'C9',
  49: 'Sakura',
  50: 'Aurora',
};

function getPalettes() { return PALETTES; }

// ─── /json/palx — paginated palette colour-stop data ─────────────────────────
// Mirrors the format produced by serializePalettes() in WLED's json.cpp.
// Each entry in `p` is an array of colour stops, where each stop is either:
//   • [pos(0-255), r, g, b]   – fixed colour
//   • "r"                      – random colour
//   • "c1" / "c2" / "c3"       – segment colour slot
const _ITEMS_PER_PAGE = 8;

// Convert normalised gradient stops [[fraction, [r,g,b]], …] to WLED palx format.
function _sw(stops) {
  return stops.map(([f, [r,g,b]]) => [Math.round(f * 255), r, g, b]);
}

// Full colour-stop definitions — same colour data as _palColor, indexed by palette ID.
const _PALX = {
  0:  _sw([[0,[85,5,0]],[0.25,[255,0,0]],[0.5,[0,200,0]],[0.75,[0,0,255]],[1,[200,0,200]]]), // Party-like default
  1:  ['r','r','r','r'],
  2:  ['c1'],
  3:  ['c1','c1','c2','c2'],
  4:  ['c3','c2','c1'],
  5:  ['c1','c1','c1','c1','c1','c2','c2','c2','c2','c2','c3','c3','c3','c3','c3','c1'],
  6:  _sw([[0,[255,0,0]],[0.33,[255,200,0]],[0.66,[0,0,255]],[1,[255,0,200]]]),
  7:  _sw([[0,[0,0,139]],[0.5,[0,0,200]],[0.75,[100,149,237]],[1,[255,255,255]]]),
  8:  _sw([[0,[0,0,0]],[0.25,[128,0,0]],[0.5,[255,0,0]],[0.75,[255,128,0]],[1,[255,255,200]]]),
  9:  _sw([[0,[0,0,139]],[0.3,[0,0,205]],[0.5,[0,128,128]],[0.75,[32,178,170]],[1,[127,255,212]]]),
  10: _sw([[0,[0,100,0]],[0.3,[0,128,0]],[0.6,[34,139,34]],[0.8,[107,142,35]],[1,[154,205,50]]]),
  11: _sw([[0,[255,0,0]],[0.17,[255,200,0]],[0.33,[0,255,0]],[0.5,[0,255,200]],[0.67,[0,0,255]],[0.83,[200,0,255]],[1,[255,0,0]]]),
  12: _sw([[0,[255,0,0]],[0.12,[0,0,0]],[0.14,[255,200,0]],[0.26,[0,0,0]],[0.28,[0,255,0]],[0.4,[0,0,0]],[0.42,[0,0,255]],[0.54,[0,0,0]],[0.56,[200,0,255]],[0.68,[0,0,0]],[1,[255,0,0]]]),
  13: _sw([[0,[0,0,80]],[0.2,[60,0,120]],[0.4,[180,0,60]],[0.6,[255,80,0]],[0.8,[255,160,0]],[1,[255,220,100]]]),
  14: _sw([[0,[1,14,5]],[0.25,[16,36,14]],[0.5,[35,48,15]],[0.75,[78,100,10]],[1,[130,160,10]]]),
  15: _sw([[0,[1,6,7]],[0.25,[1,99,111]],[0.5,[144,209,255]],[0.75,[0,73,82]],[1,[1,37,41]]]),
  16: _sw([[0,[255,0,0]],[0.25,[128,0,128]],[0.5,[0,0,255]],[0.75,[128,0,128]],[1,[255,0,0]]]),
  17: _sw([[0,[255,255,0]],[0.5,[255,255,50]],[1,[255,255,0]]]),
  18: _sw([[0,[5,1,90]],[0.33,[100,0,175]],[0.66,[180,80,0]],[1,[255,180,0]]]),
  19: _sw([[0,[126,11,255]],[0.25,[197,1,22]],[0.5,[210,157,172]],[0.75,[0,255,197]],[1,[0,109,170]]]),
  20: _sw([[0,[255,170,170]],[0.25,[255,200,150]],[0.5,[200,255,150]],[0.75,[150,200,255]],[1,[200,150,255]]]),
  21: _sw([[0,[120,0,50]],[0.3,[200,20,0]],[0.6,[255,120,0]],[0.8,[255,200,0]],[1,[255,255,150]]]),
  22: _sw([[0,[0,40,140]],[0.3,[0,120,200]],[0.5,[0,200,220]],[0.7,[200,180,100]],[1,[240,220,180]]]),
  23: _sw([[0,[180,80,0]],[0.33,[120,60,20]],[0.66,[80,40,10]],[1,[200,160,50]]]),
  24: _sw([[0,[8,3,0]],[0.25,[150,5,0]],[0.5,[255,50,0]],[0.75,[255,180,40]],[1,[255,255,150]]]),
  25: _sw([[0,[0,60,0]],[0.2,[50,120,0]],[0.4,[100,80,30]],[0.6,[150,150,150]],[0.8,[255,255,255]],[1,[200,230,255]]]),
  26: _sw([[0,[0,100,190]],[0.33,[0,200,200]],[0.66,[200,200,100]],[1,[255,240,200]]]),
  27: _sw([[0,[255,100,0]],[0.33,[255,160,50]],[0.66,[255,100,100]],[1,[200,50,150]]]),
  28: _sw([[0,[0,200,200]],[0.33,[0,100,200]],[0.66,[100,0,200]],[1,[200,0,150]]]),
  29: _sw([[0,[0,200,200]],[0.5,[0,100,200]],[0.8,[100,0,200]],[1,[200,0,150]]]),
  30: _sw([[0,[47,30,2]],[0.3,[213,147,24]],[0.5,[72,142,89]],[0.7,[0,113,178]],[1,[0,56,220]]]),
  31: _sw([[0,[255,0,0]],[0.25,[180,60,0]],[0.5,[0,150,0]],[0.75,[200,160,0]],[1,[255,0,0]]]),
  32: _sw([[0,[0,100,0]],[0.33,[100,180,0]],[0.66,[200,200,50]],[1,[120,80,20]]]),
  33: _sw([[0,[255,180,180]],[0.33,[255,80,80]],[0.66,[200,0,100]],[1,[255,150,150]]]),
  34: _sw([[0,[255,0,0]],[0.33,[0,255,0]],[0.66,[0,0,255]],[1,[255,0,0]]]),
  35: _sw([[0,[0,0,0]],[0.33,[255,0,0]],[0.66,[255,165,0]],[1,[255,255,200]]]),
  36: _sw([[0,[0,0,80]],[0.5,[0,180,255]],[1,[255,255,255]]]),
  37: _sw([[0,[0,0,50]],[0.33,[0,100,255]],[0.66,[0,255,255]],[1,[255,255,255]]]),
  38: _sw([[0,[255,100,100]],[0.5,[255,200,220]],[1,[255,100,180]]]),
  39: _sw([[0,[200,80,0]],[0.33,[255,120,0]],[0.66,[200,60,0]],[1,[150,30,0]]]),
  40: _sw([[0,[0,0,100]],[0.33,[100,0,200]],[0.66,[200,0,200]],[1,[255,0,100]]]),
  41: _sw([[0,[200,0,200]],[0.5,[255,0,100]],[1,[255,0,0]]]),
  42: _sw([[0,[255,255,0]],[0.5,[255,128,0]],[1,[255,0,200]]]),
  43: _sw([[0,[255,255,0]],[0.5,[128,128,255]],[1,[0,0,255]]]),
  44: _sw([[0,[255,100,0]],[0.4,[200,80,0]],[0.6,[0,100,100]],[1,[0,200,200]]]),
  45: _sw([[0,[1,2,14]],[0.2,[2,5,35]],[0.4,[13,135,92]],[0.6,[43,255,193]],[0.8,[247,7,249]],[1,[193,17,208]]]),
  46: _sw([[0,[1,5,45]],[0.25,[5,35,80]],[0.5,[0,80,120]],[0.75,[30,0,80]],[1,[70,0,120]]]),
  47: _sw([[0,[255,60,0]],[0.33,[255,120,0]],[0.66,[255,180,50]],[1,[200,80,0]]]),
  48: [[0,255,0,0],[51,255,60,0],[102,0,160,0],[153,0,0,255],[204,255,200,0],[255,255,0,0]],
  49: _sw([[0,[255,180,200]],[0.33,[255,100,150]],[0.66,[255,200,220]],[1,[200,80,120]]]),
  50: _sw([[0,[0,40,0]],[0.5,[0,255,80]],[1,[80,0,200]]]),
};

const _PALX_MAX_PAGE = Math.floor((Object.keys(_PALX).length - 1) / _ITEMS_PER_PAGE);

function getPalx(page) {
  page = Math.max(0, Math.min(page | 0, _PALX_MAX_PAGE));
  const start = page * _ITEMS_PER_PAGE;
  const end   = Math.min(start + _ITEMS_PER_PAGE, Object.keys(_PALX).length);
  const p = {};
  for (let i = start; i < end; i++) {
    if (_PALX[i] !== undefined) p[String(i)] = _PALX[i];
  }
  return { m: _PALX_MAX_PAGE, p };
}

// ─── CAN Bus Simulation ───────────────────────────────────────────────────────
const _canStart = Date.now();
let _rxCount    = 0;

// Automotive CAN IDs representative of a generic OBD-II vehicle
const CAN_SIGNAL_DEFS = [
  { id: 0x316, ext: false, dlc: 8 }, // Engine: RPM (bytes 0–1, raw = RPM×4) + temp (byte 5)
  { id: 0x328, ext: false, dlc: 8 }, // Drivetrain: Vehicle speed km/h (byte 0)
  { id: 0x329, ext: false, dlc: 8 }, // Pedals: Throttle position 0–255 (byte 0)
  { id: 0x130, ext: false, dlc: 3 }, // Brakes: brake pressure (byte 0)
  { id: 0x153, ext: false, dlc: 6 }, // Transmission: current gear (byte 0)
  { id: 0x19B, ext: false, dlc: 4 }, // Body: fuel level 0–200 (byte 0)
  { id: 0x200, ext: true,  dlc: 8 }, // Extended: diagnostic counter frame
];

function _makeFrame(def) {
  const nowMs = Date.now() - _canStart;
  const sim   = _car;
  let data;
  switch (def.id) {
    case 0x316: {
      const raw = Math.round(sim.rpm * 4) & 0xFFFF;
      data = [(raw >> 8) & 0xFF, raw & 0xFF, 0x00, 0x00, 0x00, Math.round(sim.temp) & 0xFF, 0x00, 0x00];
      break;
    }
    case 0x328:
      data = [Math.round(sim.speed) & 0xFF, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
      break;
    case 0x329:
      data = [Math.round(sim.throttle * 2.55) & 0xFF, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
      break;
    case 0x130:
      data = [sim.braking ? 0x80 : 0x00, 0x00, 0x00];
      break;
    case 0x153:
      data = [sim.gear & 0xFF, 0x00, 0x00, 0x00, 0x00, 0x00];
      break;
    case 0x19B:
      data = [Math.round(sim.fuel * 2) & 0xFF, 0x00, 0x00, 0x00];
      break;
    case 0x200: {
      const cnt = (_rxCount / CAN_SIGNAL_DEFS.length) & 0xFFFFFFFF;
      data = [(cnt >> 24) & 0xFF, (cnt >> 16) & 0xFF, (cnt >> 8) & 0xFF, cnt & 0xFF, 0xAB, 0xCD, 0xEF, 0x42];
      break;
    }
    default:
      data = Array(def.dlc).fill(0);
  }
  return { id: def.id, ext: def.ext, rtr: false, dlc: def.dlc, t_ms: nowMs, data: data.slice(0, def.dlc) };
}

function getCanStatus() {
  _rxCount += CAN_SIGNAL_DEFS.length;
  const nowMs = Date.now() - _canStart;
  return {
    uptime: nowMs, nowMs,
    canModFound: true, usermodCount: 1,
    can: {
      enabled: true, started: true,
      bitrate: 500000, listenOnly: true,
      rxPin: 4, txPin: 5, rxQueueLen: 128,
      filterEnabled: false, filterExt: false, filterId: 0, filterMask: 2047,
      rxCount: _rxCount, txCount: 0, errors: 0, overruns: 0,
      lastFrameMs: nowMs - 5, msSinceFrame: 5,
    },
    frames: [],
  };
}

function getCanFull() {
  const lite = getCanStatus();
  lite.frames = CAN_SIGNAL_DEFS.map(def => _makeFrame(def));
  return lite;
}

// ─── Effect renderer ─────────────────────────────────────────────────────────
// Returns an array of N hex strings like "RRGGBB" for /json/live.
// Covers all standard WLED 1D effects 0–117 plus CAN 218–224.
// 2D-only slots (118-186, particle slots 187-217) fall through to palette scroll.

function _hsv(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r, g, b;
  if      (h <  60) { r=c; g=x; b=0; }
  else if (h < 120) { r=x; g=c; b=0; }
  else if (h < 180) { r=0; g=c; b=x; }
  else if (h < 240) { r=0; g=x; b=c; }
  else if (h < 300) { r=x; g=0; b=c; }
  else              { r=c; g=0; b=x; }
  return [Math.round((r+m)*255), Math.round((g+m)*255), Math.round((b+m)*255)];
}

function _toHex(r, g, b) {
  return ((_clamp(r|0,0,255) << 16) | (_clamp(g|0,0,255) << 8) | _clamp(b|0,0,255)).toString(16).padStart(6, '0');
}

function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Blend two [r,g,b] colours, t=0→a, t=1→b
function _blendRgb(a, b, t) {
  return [
    a[0] + (b[0]-a[0]) * t,
    a[1] + (b[1]-a[1]) * t,
    a[2] + (b[2]-a[2]) * t,
  ];
}

// Multi-stop gradient helper: stops = [[pos(0-1), [r,g,b]], …]
// Linearly interpolates between neighbouring stops.
function _gradPal(stops, p) {
  for (let i = 1; i < stops.length; i++) {
    if (p <= stops[i][0]) {
      const lo = stops[i - 1], hi = stops[i];
      const span = hi[0] - lo[0];
      const t = span > 0 ? (p - lo[0]) / span : 1;
      return _blendRgb(lo[1], hi[1], t);
    }
  }
  return stops[stops.length - 1][1];
}

// Full WLED palette → [r,g,b] 0-255 for normalised position p (0-1).
// col = seg.col ([[r,g,b,w] × 3]) — required for palette IDs 0-5 which use segment colours.
function _palColor(pal, p, col) {
  p = _clamp(p, 0, 1);
  const c0 = col ? [col[0][0], col[0][1], col[0][2]] : [255, 160,   0];
  const c1 = col ? [col[1][0], col[1][1], col[1][2]] : [  0,   0, 255];
  const c2 = col ? [col[2][0], col[2][1], col[2][2]] : [  0, 200,   0];

  switch (pal) {
    // ── Special: segment colour slots ────────────────────────────────────────
    case 0:  // Default  — solid Color 1
    case 1:  // * Color 1
      return [...c0];
    case 2: { // * Colors 1&2 — alternating halves
      return p < 0.5 ? [...c0] : [...c1];
    }
    case 3: { // * Color 1, 2 & 3 — three equal bands
      if (p < 0.333) return [...c0];
      if (p < 0.667) return [...c1];
      return [...c2];
    }
    case 4: { // * Color Gradient — smooth c0 → c1
      return _blendRgb(c0, c1, p);
    }
    case 5: { // * Colors Only — c0 → c1 → c2 gradient
      if (p < 0.5) return _blendRgb(c0, c1, p * 2);
      return _blendRgb(c1, c2, (p - 0.5) * 2);
    }

    // ── Named palettes ────────────────────────────────────────────────────────
    case 6: { // Party (hue sweep 0 → 300°)
      const [r,g,b] = _hsv(p * 300, 1, 1);
      return [r, g, b];
    }
    case 7: // Cloud
      return _gradPal([
        [0.00, [  0,  0, 139]],
        [0.50, [  0,  0, 200]],
        [0.75, [100,149, 237]],
        [1.00, [255,255, 255]],
      ], p);
    case 8: // Lava
      return _gradPal([
        [0.00, [  0,  0,   0]],
        [0.25, [128,  0,   0]],
        [0.50, [255,  0,   0]],
        [0.75, [255,128,   0]],
        [1.00, [255,255, 200]],
      ], p);
    case 9: // Ocean
      return _gradPal([
        [0.00, [  0,  0, 139]],
        [0.30, [  0,  0, 205]],
        [0.50, [  0,128, 128]],
        [0.75, [ 32,178, 170]],
        [1.00, [127,255, 212]],
      ], p);
    case 10: // Forest
      return _gradPal([
        [0.00, [  0,100,   0]],
        [0.30, [  0,128,   0]],
        [0.60, [ 34,139,  34]],
        [0.80, [107,142,  35]],
        [1.00, [154,205,  50]],
      ], p);
    case 11: { // Rainbow (full hue)
      const [r,g,b] = _hsv(p * 360, 1, 1);
      return [r, g, b];
    }
    case 12: { // Rainbow Bands (rainbow with dark gaps)
      if ((p * 7) % 1 < 0.35) return [0, 0, 0];
      const [r,g,b] = _hsv(p * 360, 1, 1);
      return [r, g, b];
    }
    case 13: // Sunset
      return _gradPal([
        [0.00, [  0,  0,  80]],
        [0.20, [ 60,  0, 120]],
        [0.40, [180,  0,  60]],
        [0.60, [255, 80,   0]],
        [0.80, [255,160,   0]],
        [1.00, [255,220, 100]],
      ], p);
    case 14: // Rivendell (deep forest greens)
      return _gradPal([
        [0.00, [  1, 14,   5]],
        [0.25, [ 16, 36,  14]],
        [0.50, [ 35, 48,  15]],
        [0.75, [ 78,100,  10]],
        [1.00, [130,160,  10]],
      ], p);
    case 15: // Breeze (sea teal / cyan)
      return _gradPal([
        [0.00, [  1,  6,   7]],
        [0.25, [  1, 99, 111]],
        [0.50, [144,209, 255]],
        [0.75, [  0, 73,  82]],
        [1.00, [  1, 37,  41]],
      ], p);
    case 16: // Red & Blue
      return _gradPal([
        [0.00, [255,  0,   0]],
        [0.25, [128,  0, 128]],
        [0.50, [  0,  0, 255]],
        [0.75, [128,  0, 128]],
        [1.00, [255,  0,   0]],
      ], p);
    case 17: // Yellowout
      return _gradPal([
        [0.00, [255,255,   0]],
        [0.50, [255,255,  50]],
        [1.00, [255,255,   0]],
      ], p);
    case 18: // Analogous (warm purple → gold)
      return _gradPal([
        [0.00, [  5,  1,  90]],
        [0.33, [100,  0, 175]],
        [0.66, [180, 80,   0]],
        [1.00, [255,180,   0]],
      ], p);
    case 19: // Splash
      return _gradPal([
        [0.00, [126, 11, 255]],
        [0.25, [197,  1,  22]],
        [0.50, [210,157, 172]],
        [0.75, [  0,255, 197]],
        [1.00, [  0,109, 170]],
      ], p);
    case 20: // Pastel
      return _gradPal([
        [0.00, [255,170, 170]],
        [0.25, [255,200, 150]],
        [0.50, [200,255, 150]],
        [0.75, [150,200, 255]],
        [1.00, [200,150, 255]],
      ], p);
    case 21: // Sunset 2
      return _gradPal([
        [0.00, [120,  0,  50]],
        [0.30, [200, 20,   0]],
        [0.60, [255,120,   0]],
        [0.80, [255,200,   0]],
        [1.00, [255,255, 150]],
      ], p);
    case 22: // Beach
      return _gradPal([
        [0.00, [  0, 40, 140]],
        [0.30, [  0,120, 200]],
        [0.50, [  0,200, 220]],
        [0.70, [200,180, 100]],
        [1.00, [240,220, 180]],
      ], p);
    case 23: // Vintage (warm muted browns / oranges)
      return _gradPal([
        [0.00, [180, 80,   0]],
        [0.33, [120, 60,  20]],
        [0.66, [ 80, 40,  10]],
        [1.00, [200,160,  50]],
      ], p);
    case 24: // Departure
      return _gradPal([
        [0.00, [  8,  3,   0]],
        [0.25, [150,  5,   0]],
        [0.50, [255, 50,   0]],
        [0.75, [255,180,  40]],
        [1.00, [255,255, 150]],
      ], p);
    case 25: // Landscape
      return _gradPal([
        [0.00, [  0, 60,   0]],
        [0.20, [ 50,120,   0]],
        [0.40, [100, 80,  30]],
        [0.60, [150,150, 150]],
        [0.80, [255,255, 255]],
        [1.00, [200,230, 255]],
      ], p);
    case 26: // Beach 2
      return _gradPal([
        [0.00, [  0,100, 190]],
        [0.33, [  0,200, 200]],
        [0.66, [200,200, 100]],
        [1.00, [255,240, 200]],
      ], p);
    case 27: // Sherbet
      return _gradPal([
        [0.00, [255,100,   0]],
        [0.33, [255,160,  50]],
        [0.66, [255,100, 100]],
        [1.00, [200, 50, 150]],
      ], p);
    case 28: // Hult
      return _gradPal([
        [0.00, [  0,200, 200]],
        [0.33, [  0,100, 200]],
        [0.66, [100,  0, 200]],
        [1.00, [200,  0, 150]],
      ], p);
    case 29: // Hult 64
      return _gradPal([
        [0.00, [  0,200, 200]],
        [0.50, [  0,100, 200]],
        [0.80, [100,  0, 200]],
        [1.00, [200,  0, 150]],
      ], p);
    case 30: // Drywet
      return _gradPal([
        [0.00, [ 47, 30,   2]],
        [0.30, [213,147,  24]],
        [0.50, [ 72,142,  89]],
        [0.70, [  0,113, 178]],
        [1.00, [  0, 56, 220]],
      ], p);
    case 31: // Jul (Christmas: red / green / gold)
      return _gradPal([
        [0.00, [255,  0,   0]],
        [0.25, [180, 60,   0]],
        [0.50, [  0,150,   0]],
        [0.75, [200,160,   0]],
        [1.00, [255,  0,   0]],
      ], p);
    case 32: // Grintage
      return _gradPal([
        [0.00, [  0,100,   0]],
        [0.33, [100,180,   0]],
        [0.66, [200,200,  50]],
        [1.00, [120, 80,  20]],
      ], p);
    case 33: // Rewhi
      return _gradPal([
        [0.00, [255,180, 180]],
        [0.33, [255, 80,  80]],
        [0.66, [200,  0, 100]],
        [1.00, [255,150, 150]],
      ], p);
    case 34: // Tertiary (RGB thirds)
      return _gradPal([
        [0.00, [255,  0,   0]],
        [0.33, [  0,255,   0]],
        [0.66, [  0,  0, 255]],
        [1.00, [255,  0,   0]],
      ], p);
    case 35: // Fire
      return _gradPal([
        [0.00, [  0,  0,   0]],
        [0.33, [255,  0,   0]],
        [0.66, [255,165,   0]],
        [1.00, [255,255, 200]],
      ], p);
    case 36: // Icefire
      return _gradPal([
        [0.00, [  0,  0,  80]],
        [0.50, [  0,180, 255]],
        [1.00, [255,255, 255]],
      ], p);
    case 37: // Cyane
      return _gradPal([
        [0.00, [  0,  0,  50]],
        [0.33, [  0,100, 255]],
        [0.66, [  0,255, 255]],
        [1.00, [255,255, 255]],
      ], p);
    case 38: // Light Pink
      return _gradPal([
        [0.00, [255,100, 100]],
        [0.50, [255,200, 220]],
        [1.00, [255,100, 180]],
      ], p);
    case 39: // Autumn
      return _gradPal([
        [0.00, [200, 80,   0]],
        [0.33, [255,120,   0]],
        [0.66, [200, 60,   0]],
        [1.00, [150, 30,   0]],
      ], p);
    case 40: // Magenta (blue → purple → magenta → pink)
      return _gradPal([
        [0.00, [  0,  0, 100]],
        [0.33, [100,  0, 200]],
        [0.66, [200,  0, 200]],
        [1.00, [255,  0, 100]],
      ], p);
    case 41: // Magred
      return _gradPal([
        [0.00, [200,  0, 200]],
        [0.50, [255,  0, 100]],
        [1.00, [255,  0,   0]],
      ], p);
    case 42: // Yelmag
      return _gradPal([
        [0.00, [255,255,   0]],
        [0.50, [255,128,   0]],
        [1.00, [255,  0, 200]],
      ], p);
    case 43: // Yelblu
      return _gradPal([
        [0.00, [255,255,   0]],
        [0.50, [128,128, 255]],
        [1.00, [  0,  0, 255]],
      ], p);
    case 44: // Orange & Teal
      return _gradPal([
        [0.00, [255,100,   0]],
        [0.40, [200, 80,   0]],
        [0.60, [  0,100, 100]],
        [1.00, [  0,200, 200]],
      ], p);
    case 45: // Tiamat (dark fantasy)
      return _gradPal([
        [0.00, [  1,  2,  14]],
        [0.20, [  2,  5,  35]],
        [0.40, [ 13,135,  92]],
        [0.60, [ 43,255, 193]],
        [0.80, [247,  7, 249]],
        [1.00, [193, 17, 208]],
      ], p);
    case 46: // April Night (deep navy / indigo)
      return _gradPal([
        [0.00, [  1,  5,  45]],
        [0.25, [  5, 35,  80]],
        [0.50, [  0, 80, 120]],
        [0.75, [ 30,  0,  80]],
        [1.00, [ 70,  0, 120]],
      ], p);
    case 47: // Orangery
      return _gradPal([
        [0.00, [255, 60,   0]],
        [0.33, [255,120,   0]],
        [0.66, [255,180,  50]],
        [1.00, [200, 80,   0]],
      ], p);
    case 48: { // C9 (Christmas-tree lights — 5 discrete colour bands)
      const band = Math.min(Math.floor(p * 5), 4);
      return [[255,0,0],[255,60,0],[0,160,0],[0,0,255],[255,200,0]][band];
    }
    case 49: // Sakura
      return _gradPal([
        [0.00, [255,180, 200]],
        [0.33, [255,100, 150]],
        [0.66, [255,200, 220]],
        [1.00, [200, 80, 120]],
      ], p);
    case 50: // Aurora
      return _gradPal([
        [0.00, [  0, 40,   0]],
        [0.50, [  0,255,  80]],
        [1.00, [ 80,  0, 200]],
      ], p);
    default: { // Generic smooth hue sweep (safe fallback for unknown IDs)
      const [r,g,b] = _hsv(p * 300 + (pal * 37), 0.9, 1);
      return [r, g, b];
    }
  }
}

// LED buffer — one persistent array shared between frames for effects that need history
const _ledBuf = new Float32Array(650 * 3).fill(0); // r,g,b interleaved

// Per-effect persistent state (simulates SEGENV.aux0/aux1 between frames)
const _effState = {
  222: { prevPos: null, speed: 0, trailDir: 0, frame: 0, lastMs: 0 },  // CAN Throttle Meteor
};

// ─── Strip Layout Map ─────────────────────────────────────────────────────────
// Mirrors the client-side _lm object; updated via POST /mock/layout.
// When enabled, each physical segment samples from a virtual render strip of
// `renderRes` pixels based on the segment's 2D strip position on the canvas.
let _layout = {
  enabled:   false,
  renderRes: 300,
  strips:    {},   // "segId" → { x1, y1, x2, y2 }  (normalised 0–1)
};

function getLayout()  { return _layout; }

function applyLayout(data) {
  if (data.enabled   !== undefined) _layout.enabled   = !!data.enabled;
  if (data.renderRes !== undefined) _layout.renderRes = Math.max(60, Math.min(2000, data.renderRes | 0));
  if (data.strips !== undefined) _layout.strips = data.strips;
}

// Render a single segment object → array of hex strings (seg.len entries)
function _renderSeg(seg) {
  const N    = seg.stop - seg.start;
  const OFF  = Array(N).fill('000000');
  if (!_state.on || !seg.on) return OFF;
  return _renderSegLeds(seg, N);
}

// Returns a flat 650-element array covering all three segments.
// When layout mapping is active:
//   • each segment renders its effect at `renderRes` virtual pixels
//   • each physical LED samples from the virtual strip at its canvas-space x-position
// When layout mapping is off (default):
//   • standard sequential rendering — no change to behaviour
function renderEffect() {
  const total = 650;
  const out   = Array(total).fill('000000');

  if (_layout.enabled && Object.keys(_layout.strips).length > 0) {
    // Layout-mapped render: spatial sampling
    const R = _layout.renderRes;
    for (const seg of _state.seg) {
      if (!seg.on) continue;
      const id    = String(seg.id);
      const strip = _layout.strips[id];
      // Render this segment's effect at virtual resolution R
      const virtual = _renderSegLeds(seg, R);
      const N = seg.stop - seg.start;
      if (strip) {
        // Sample virtual strip via x-position mapping.
        // strip.mir: fold at midpoint — first half sweeps t 0→1, second half 1→0,
        // so the effect mirrors within the mapped region (position preserved).
        for (let i = 0; i < N; i++) {
          let t = N > 1 ? i / (N - 1) : 0;
          if (strip.mir) {
            const h = N / 2;
            t = i < h
              ? (i / Math.max(h - 1, 1))
              : ((N - 1 - i) / Math.max(h - 1, 1));
            t = _clamp(t, 0, 1);
          }
          const px = strip.x1 + (strip.x2 - strip.x1) * t;
          const vi = _clamp(Math.round(px * (R - 1)), 0, R - 1);
          out[seg.start + i] = virtual[vi];
        }
      } else {
        // No layout for this seg → fall back to sequential
        for (let i = 0; i < N; i++) out[seg.start + i] = virtual[i] || '000000';
      }
    }
  } else {
    // Standard sequential render (default)
    for (const seg of _state.seg) {
      if (!seg.on) continue;
      const segLeds = _renderSegLeds(seg, seg.stop - seg.start);
      // WLED mirror: second half mirrors first half
      if (seg.mi) {
        const half = Math.floor(segLeds.length / 2);
        for (let i = 0; i < half; i++) segLeds[segLeds.length - 1 - i] = segLeds[i];
      }
      for (let i = 0; i < segLeds.length; i++) out[seg.start + i] = segLeds[i];
    }
  }

  return out;
}
function _renderSegLeds(seg, N) {
  if (!_state.on || !seg.on) return Array(N).fill('000000');

  const fx  = seg.fx;
  const sx  = seg.sx / 255;                           // speed  0–1
  const ix  = seg.ix / 255;                           // intensity 0–1
  const bri = (_state.bri / 255) * (seg.bri / 255);  // combined brightness 0–1
  const col = seg.col;                                // [[r,g,b,w] x3]
  const pal = seg.pal;
  const t   = Date.now() / 1000;                      // seconds

  const c0 = [col[0][0], col[0][1], col[0][2]];
  const c1 = [col[1][0], col[1][1], col[1][2]];
  const c2 = [col[2][0], col[2][1], col[2][2]];

  // Live CAN values (raw + normalised)
  const rpm       = _car.rpm;
  const speed     = _car.speed;
  const throttle  = _car.throttle;
  const rpmFrac   = _clamp(rpm / MAX_RPM, 0, 1);
  const speedFrac = _clamp(speed / 200, 0, 1);
  const thrFrac   = _clamp(throttle / 100, 0, 1);

  const leds = [];

  switch (fx) {

    // ── 0  Solid ────────────────────────────────────────────────────────────
    case 0: {
      const hex = _toHex(c0[0]*bri, c0[1]*bri, c0[2]*bri);
      for (let i = 0; i < N; i++) leds.push(hex);
      break;
    }

    // ── 1  Blink ────────────────────────────────────────────────────────────
    case 1: {
      const on  = (t * (sx * 6 + 0.5) % 1) < 0.5;
      const hex = on ? _toHex(c0[0]*bri, c0[1]*bri, c0[2]*bri) : '000000';
      for (let i = 0; i < N; i++) leds.push(hex);
      break;
    }

    // ── 2  Breathe ──────────────────────────────────────────────────────────
    case 2: {
      const k = Math.pow(Math.sin(t * Math.PI * (sx + 0.2)) * 0.5 + 0.5, 2);
      for (let i = 0; i < N; i++) {
        const [r,g,b] = _palColor(pal, i/N, col);
        leds.push(_toHex(r*k*bri, g*k*bri, b*k*bri));
      }
      break;
    }

    // ── 3  Wipe ─────────────────────────────────────────────────────────────
    case 3: {
      const pos = (t * sx * 60) % (N * 2);
      const fill = pos < N ? Math.floor(pos) : N - Math.floor(pos - N);
      for (let i = 0; i < N; i++) {
        if (i < fill) {
          const [r,g,b] = _palColor(pal, i/N, col);
          leds.push(_toHex(r*bri, g*bri, b*bri));
        } else {
          leds.push('000000');
        }
      }
      break;
    }

    // ── 9  Rainbow ──────────────────────────────────────────────────────────
    case 9: {
      const off = t * sx * 120;
      for (let i = 0; i < N; i++) {
        const [r,g,b] = _hsv((i/N*360 + off) % 360, 1, bri);
        leds.push(_toHex(r,g,b));
      }
      break;
    }

    // ── 12  Fade ────────────────────────────────────────────────────────────
    case 12: {
      const k = Math.sin(t * Math.PI * (sx + 0.2)) * 0.5 + 0.5;
      const [r,g,b] = _palColor(pal, k, col);
      const hex = _toHex(r*bri, g*bri, b*bri);
      for (let i = 0; i < N; i++) leds.push(hex);
      break;
    }

    // ── 15  Running Lights ──────────────────────────────────────────────────
    case 15: {
      const off = (t * sx * 60) % N;
      const segSize = Math.max(1, Math.round(ix * 10 + 2));
      for (let i = 0; i < N; i++) {
        const v = Math.sin(((i + off) / segSize) * Math.PI * 2) * 0.5 + 0.5;
        const [r,g,b] = _palColor(pal, i/N, col);
        leds.push(_toHex(r*v*bri, g*v*bri, b*v*bri));
      }
      break;
    }

    // ── 17  Twinkle ─────────────────────────────────────────────────────────
    case 17: {
      const seed = Math.floor(t * (sx * 8 + 1)) * 2654435761;
      for (let i = 0; i < N; i++) {
        const h = ((seed ^ (i * 2246822519)) >>> 0) / 4294967296;
        const v = h < (ix * 0.4 + 0.05) ? bri : 0;
        const [r,g,b] = _palColor(pal, (seed^i) / 4294967296, col);
        leds.push(_toHex(r*v, g*v, b*v));
      }
      break;
    }

    // ── 23  Strobe ──────────────────────────────────────────────────────────
    case 23: {
      const on = (t * (sx * 12 + 1) % 1) < 0.05;
      const hex = on ? _toHex(c0[0]*bri, c0[1]*bri, c0[2]*bri) : '000000';
      for (let i = 0; i < N; i++) leds.push(hex);
      break;
    }

    // ── 40  Larson Scanner ──────────────────────────────────────────────────
    case 40:
    case 41: { // Comet
      const pos   = (Math.sin(t * (sx * 3 + 0.5)) * 0.5 + 0.5) * N;
      const width = Math.round(ix * 20 + 5);
      for (let i = 0; i < N; i++) {
        const d = Math.abs(i - pos);
        const v = d < width ? Math.pow(1 - d/width, 2) * bri : 0;
        const [r,g,b] = _palColor(pal, i/N, col);
        leds.push(_toHex(r*v, g*v, b*v));
      }
      break;
    }

    // ── 45  Fire Flicker ────────────────────────────────────────────────────
    case 45: {
      const seed = Math.floor(t * 25);
      for (let i = 0; i < N; i++) {
        const f = ((Math.sin(i * 7.3 + seed * 1.7) * 0.5 + 0.5) *
                   (Math.sin(i * 3.1 + seed * 2.3) * 0.5 + 0.5));
        const [r,g,b] = _palColor(pal, f, col);
        const v = f * ix * bri;
        leds.push(_toHex(r*v, g*v, b*v));
      }
      break;
    }

    // ── 47  Loading (bar) ───────────────────────────────────────────────────
    case 47: {
      const fill = Math.round(((t * sx * 40) % N));
      for (let i = 0; i < N; i++) {
        const v = i <= fill ? bri : 0.06;
        const [r,g,b] = _palColor(pal, i/N, col);
        leds.push(_toHex(r*v, g*v, b*v));
      }
      break;
    }

    // ── 48  Rolling Balls (was Police) ──────────────────────────────────────
    // Keep old ID 47 mapped to police for backward-compat too:
    case 999: // unreachable alias kept for docs
    case 48: {
      const pFlash = Math.floor(t * (sx * 6 + 2)) % 4;
      for (let i = 0; i < N; i++) {
        const half = i < N / 2;
        if      (half  && pFlash < 2) leds.push(_toHex(255*bri, 0, 0));
        else if (!half && pFlash >= 2) leds.push(_toHex(0, 0, 255*bri));
        else leds.push('000000');
      }
      break;
    }

    // ── 54  Tricolor Chase ──────────────────────────────────────────────────
    case 54: {
      const off = Math.floor(t * sx * 60) % 3;
      const cols = [c0, c1, c2].map(c => _toHex(c[0]*bri, c[1]*bri, c[2]*bri));
      for (let i = 0; i < N; i++) leds.push(cols[(i + off) % 3]);
      break;
    }

    // ── 57  Lightning ───────────────────────────────────────────────────────
    case 57: {
      const seed = Math.floor(t * (sx * 3 + 0.5));
      const bolt = (((seed * 1664525 + 1013904223) >>> 0) % N);
      const len  = 10 + ((seed * 22695477) >>> 0) % 40;
      const [br,bg,bb] = _palColor(pal, 0.9, col);
      for (let i = 0; i < N; i++) {
        const inBolt = i >= bolt && i < bolt + len;
        leds.push(inBolt ? _toHex(br*bri, bg*bri, bb*bri) : '000000');
      }
      break;
    }

    // ── 63  Pride 2015 ──────────────────────────────────────────────────────
    case 63:
    case 64: { // Juggle — palette sweep with undulating brightness
      for (let i = 0; i < N; i++) {
        const p = ((i/N + t * sx * 0.08) % 1);
        const [r,g,b] = _palColor(pal, p, col);
        const dim = 0.7 + 0.3 * Math.sin(t * 2.1 + i * 0.15);
        leds.push(_toHex(r*dim*bri, g*dim*bri, b*dim*bri));
      }
      break;
    }

    // ── 65  Palette ─────────────────────────────────────────────────────────
    case 65: {
      const off = t * sx * 60;
      for (let i = 0; i < N; i++) {
        const [r,g,b] = _palColor(pal, ((i/N + off/N) % 1), col);
        leds.push(_toHex(r*bri, g*bri, b*bri));
      }
      break;
    }

    // ── 66  Fire 2012 ───────────────────────────────────────────────────────
    case 66: {
      const cooling  = _clamp(1.2 - ix * 0.8, 0.3, 1.2);
      const sparking = 0.05 + thrFrac * 0.15 + rpmFrac * 0.1;
      const seed2    = Math.floor(t * 40) * 17;
      const heat     = [];
      for (let i = 0; i < N; i++) {
        let h = Math.max(0, Math.sin(i * 0.25 + t * (sx * 4 + 1)) * 0.5 + 0.5);
        h -= (i / N) * cooling * 3;
        if (i < N * 0.15 && Math.abs(Math.sin(i * 31 + seed2)) < sparking)
          h = Math.min(1, h + 0.8);
        heat.push(_clamp(h * bri, 0, 1));
      }
      for (const h of heat) {
        const [r,g,b] = _palColor(pal, h, col);
        leds.push(_toHex(r, g, b));
      }
      break;
    }

    // ── 67  Colorwaves ──────────────────────────────────────────────────────
    case 67: {
      for (let i = 0; i < N; i++) {
        const p = (Math.sin(i/N * Math.PI * 4 + t * (sx+0.2) * 3) * 0.5 + 0.5);
        const [r,g,b] = _palColor(pal, p, col);
        leds.push(_toHex(r*bri, g*bri, b*bri));
      }
      break;
    }

    // ── 76  Meteor ──────────────────────────────────────────────────────────
    case 76: {
      const head  = ((t * sx * 80) % (N * 1.5));
      const trail = Math.round(ix * 20 + 8);
      for (let i = 0; i < N; i++) {
        const d = head - i;
        const v = (d >= 0 && d < trail) ? Math.pow(1 - d/trail, 1.5) * bri : 0;
        const [r,g,b] = _palColor(pal, i/N, col);
        leds.push(_toHex(r*v, g*v, b*v));
      }
      break;
    }

    // ── 92  Sinelon ─────────────────────────────────────────────────────────
    case 92: {
      const pos = Math.round((Math.sin(t * (sx * 4 + 0.5)) * 0.5 + 0.5) * (N - 1));
      // decay the buffer
      for (let i = 0; i < N; i++) {
        const base = i * 3;
        _ledBuf[base]   *= 0.93;
        _ledBuf[base+1] *= 0.93;
        _ledBuf[base+2] *= 0.93;
      }
      const [pr,pg,pb] = _palColor(pal, (t * sx * 0.3) % 1, col);
      _ledBuf[pos*3]   = pr * bri;
      _ledBuf[pos*3+1] = pg * bri;
      _ledBuf[pos*3+2] = pb * bri;
      for (let i = 0; i < N; i++) leds.push(_toHex(_ledBuf[i*3], _ledBuf[i*3+1], _ledBuf[i*3+2]));
      break;
    }

    // ── 101  Pacifica ───────────────────────────────────────────────────────
    case 101: {
      for (let i = 0; i < N; i++) {
        const w1 = Math.sin(i/N*Math.PI*3 + t*(sx+0.1)) * 0.5 + 0.5;
        const w2 = Math.sin(i/N*Math.PI*5 - t*(sx*1.3+0.07)) * 0.5 + 0.5;
        const v  = (w1 * 0.6 + w2 * 0.4) * bri;
        const [r,g,b] = _palColor(pal, (i/N + t * sx * 0.03) % 1, col);
        leds.push(_toHex(r*v, g*v, b*v));
      }
      break;
    }

    // ══ 218  CAN RPM Pulse ══════════════════════════════════════════════════
    // Exactly matches mode_can_rpm_pulse() in FX.cpp:
    //   hue = map(rpm, 0, 8000, 160, 0) → color_wheel(hue)
    //   litLeds = SEGLEN * rpm / 8000
    //   lit = color_fade(hueColor, intensity)
    //   unlit = color_fade(c1, 32)
    case 218: {
      const rpmFrac218  = _clamp(_car.rpm / 8000, 0, 1);
      // Intensity affects both how many LEDs are lit and the brightness
      // brightness scales with ix and optionally with RPM if scale toggle enabled
      const brightness218 = ix * bri * (seg.o1 ? rpmFrac218 : 1);
      const bgScale218  = (32 / 255) * bri;
      // c1/85 → 0=Value, 1=Bar-Gradient, 2=Strip-Gradient
      const palMode218  = Math.floor(seg.c1 / 85);

      // Intensity scales lit count (0..1)
      const litExact218 = N * rpmFrac218 * ix;
      const litFull218  = Math.floor(litExact218);
      const frac218     = litExact218 - litFull218;
      // moderate dither zone to avoid excessive striping
      const DZONE218    = 6;
      const tick218     = Math.floor(t * 40);

      // Edge palette index for dither zone
      let edgeP218;
      if      (palMode218 === 0) edgeP218 = rpmFrac218;
      else if (palMode218 === 1) edgeP218 = 1;                   // end of bar
      else                       edgeP218 = litFull218 / N;       // strip position
      const [er,eg,eb] = _palColor(pal, edgeP218, col);

      // Fade-out logic: LEDs pop in, then fade out. Duration slider via seg.c2 (0..255) maps to 0.1..2.0s
      const maxFadeMs218 = 100 + Math.floor((seg.c2 / 255) * 1900); // 100ms .. 2000ms
      const key218 = `rpm218_${seg.id}`;
      if (!_state[key218] || _state[key218].fadeEnd.length !== N) {
        _state[key218] = { fadeEnd: Array(N).fill(0), fadeDur: Array(N).fill(0), prevBar: 0, prevRpm: 0 };
      }
      const s218 = _state[key218];
      const now218 = Date.now();
      // Detect RPM direction: stronger/negative dither when RPM rising
      const up218 = _car.rpm > s218.prevRpm;
      for (let i = 0; i < N; i++) {
        if (i < litFull218) {
          let p;
          if      (palMode218 === 0) p = rpmFrac218;
          else if (palMode218 === 1) p = litFull218 > 0 ? i / litFull218 : 0;
          else                       p = i / N;
          const [pr,pg,pb] = _palColor(pal, p, col);
          // If LED just activated, set fade duration and end time
          if (i >= s218.prevBar) {
            const dur = 100 + Math.floor(Math.random() * (maxFadeMs218 - 100 + 1));
            s218.fadeDur[i] = dur;
            s218.fadeEnd[i] = now218 + dur;
          }
          // Apply dimming near the leading edge only to avoid regular striping across the bar
          let dimFactor = 1;
          if (up218) {
            const edgeDist = Math.max(0, (litFull218 - 1) - i); // 0 at leading LED
            if (edgeDist <= 2) {
              // include changing time in RNG so pattern evolves each frame
              const seed = (Math.imul(i + (now218 >> 6), 0x9E3779B1) ^ Math.imul(tick218, 0x85EBCA77)) >>> 0;
              const rng  = ((seed ^ (seed >>> 16)) >>> 24) / 255;
              // dim occasionally for a subtle negative effect
              if (rng < Math.min(0.6, 0.25 + frac218 * 0.4)) dimFactor = 0.55;
            }
          }
          leds.push(_toHex(pr * brightness218 * dimFactor, pg * brightness218 * dimFactor, pb * brightness218 * dimFactor));
        } else {
          // Fade out if timer is running
          if (s218.fadeEnd[i] > now218) {
            const dur = s218.fadeDur[i] || 100;
            const remaining = s218.fadeEnd[i] - now218;
            const fade = Math.max(0, Math.min(1, remaining / dur));
            let p;
            if      (palMode218 === 0) p = rpmFrac218;
            else if (palMode218 === 1) p = litFull218 > 0 ? i / litFull218 : 0;
            else                       p = i / N;
            const [pr,pg,pb] = _palColor(pal, p, col);
            leds.push(_toHex(pr * brightness218 * fade, pg * brightness218 * fade, pb * brightness218 * fade));
          } else {
            const ahead = i - litFull218;
            if (ahead < DZONE218) {
              const prob = Math.min(1, (frac218 * 1.8) / Math.pow(2, ahead));
              const seed = (Math.imul(i, 0x9E3779B1) ^ Math.imul(tick218, 0x85EBCA77)) >>> 0;
              const rng  = ((seed ^ (seed >>> 16)) >>> 24) / 255;
                if (rng < prob) {
                  let zoneBri = brightness218 * (DZONE218 - ahead) / DZONE218;
                  // On rising RPM, prefer darkening but less extreme to avoid holes
                  if (up218) zoneBri *= 0.45; else zoneBri *= 1.25;
                  leds.push(_toHex(er * zoneBri, eg * zoneBri, eb * zoneBri));
                } else {
                  leds.push(_toHex(c1[0] * bgScale218, c1[1] * bgScale218, c1[2] * bgScale218));
                }
            } else {
              leds.push(_toHex(c1[0] * bgScale218, c1[1] * bgScale218, c1[2] * bgScale218));
            }
          }
        }
      }
      s218.prevBar = litFull218;
      s218.prevRpm = _car.rpm;
      break;
    }

    // ══ 219  CAN Speed Color ════════════════════════════════════════════════
    // Exactly matches mode_can_speed_color() in FX.cpp:
    //   hue = map(speed, 0, 200, 160, 0) → color_wheel(hue)
    //   litLeds = SEGLEN * speed / 200
    //   lit = color_fade(hueColor, intensity)
    //   unlit = color_fade(c1, 32)
    case 219: {
      const litLeds219   = Math.round(N * speedFrac);
      const brightness219 = ix * bri;
      const bgScale219    = (32 / 255) * bri;
      const palMode219    = Math.floor(seg.c1 / 85);  // 0=Value, 1=Bar-Gradient, 2=Strip
      for (let i = 0; i < N; i++) {
        if (i < litLeds219) {
          let p;
          if      (palMode219 === 0) p = speedFrac;
          else if (palMode219 === 1) p = litLeds219 > 0 ? i / litLeds219 : 0;
          else                       p = i / N;
          const [sr,sg,sb] = _palColor(pal, p, col);
          leds.push(_toHex(sr * brightness219, sg * brightness219, sb * brightness219));
        } else {
          leds.push(_toHex(c1[0] * bgScale219, c1[1] * bgScale219, c1[2] * bgScale219));
        }
      }
      break;
    }

    // ══ 220  CAN Throttle ═══════════════════════════════════════════════════
    // Exactly matches mode_can_throttle() in FX.cpp:
    //   hue = map(throttle, 0, 100, 160, 0) → color_wheel(hue)
    //   litLeds = SEGLEN * throttle / 100
    //   lit = color_fade(hueColor, intensity)
    //   unlit = color_fade(c1, 32)
    case 220: {
      const litLeds220   = Math.round(N * thrFrac);
      const brightness220 = ix * bri;
      const bgScale220    = (32 / 255) * bri;
      const palMode220    = Math.floor(seg.c1 / 85);  // 0=Value, 1=Bar-Gradient, 2=Strip
      for (let i = 0; i < N; i++) {
        if (i < litLeds220) {
          let p;
          if      (palMode220 === 0) p = thrFrac;
          else if (palMode220 === 1) p = litLeds220 > 0 ? i / litLeds220 : 0;
          else                       p = i / N;
          const [tr,tg,tb] = _palColor(pal, p, col);
          leds.push(_toHex(tr * brightness220, tg * brightness220, tb * brightness220));
        } else {
          leds.push(_toHex(c1[0] * bgScale220, c1[1] * bgScale220, c1[2] * bgScale220));
        }
      }
      break;
    }

    // ══ 221  CAN Speed Noise ════════════════════════════════════════════════
    // Closely matches mode_can_speed_noise() in FX.cpp:
    //   baseHue  = map(speed, 0, 200, 160, 0)          (byte space)
    //   speedGain = map(speed, 0, 200, 0, intensity)   (= speedFrac * ix)
    //   noise thresholded at 90/255, quadratic shaped
    //   varHue = baseHue + (noise>>5) - 4              (±4 byte steps = ±5.6°)
    case 221: {
      const baseHueByte = 160 - speedFrac * 160;              // 0-160 wheel byte
      const speedGain221 = speedFrac * ix;                    // 0=silent, 1=full
      const step = t * (sx * 8 + 1) * 50;
      for (let i = 0; i < N; i++) {
        const n1 = Math.abs(Math.sin(i * 7.3 + step * 0.17) * Math.sin(i * 3.1 - step * 0.23));
        const n2 = Math.abs(Math.sin(i * 1.7 + step * 0.31));
        const noiseF = (n1 + n2) / 2;                        // 0-1 float
        const noiseB = noiseF * 255;                          // 0-255 equivalent

        // Match firmware threshold: noise < 90 or speedGain < 4/255 → black
        if (noiseB < 90 || speedGain221 < (4 / 255)) {
          leds.push('000000');
        } else {
          // Remap [90,255]→[0,255], quadratic shaping (matches above*above>>8)
          const above   = (noiseB - 90) * 255 / 165;         // [0,255]
          const shaped  = (above * above) / 255;              // quadratic [0,255]
          const bright  = (shaped * speedGain221) / 255 * bri;
          if (bright * 255 < 4) {
            leds.push('000000');
          } else {
            const varHueByte = ((baseHueByte + Math.floor(noiseB / 32) - 4) % 256 + 256) % 256;
            // Pal Map: 0=speed-only, 1=spatial+noise (default), 2=animated scroll
            const palMode221 = Math.floor(seg.c1 / 85);
            let palP;
            if      (palMode221 === 0) palP = (baseHueByte / 255);
            else if (palMode221 === 1) palP = varHueByte / 255;
            else                       palP = (varHueByte / 255 + t * 0.05) % 1;
            const [nr,ng,nb] = _palColor(pal, palP, col);
            leds.push(_toHex(nr * bright, ng * bright, nb * bright));
          }
        }
      }
      break;
    }

    // ══ 222  CAN Throttle Meteor ════════════════════════════════════════════
    //   Head tracks throttle position. Trail extends behind direction of travel
    //   (bidirectional). Length grows dynamically with throttle change speed.
    //   Cubic fade + white-hot tip for detail.
    case 222: {
      const st      = _effState[222];
      const headPos = Math.round((N - 1) * thrFrac);

      // Velocity tracking — time-based decay (80ms half-life = ~320ms full collapse)
      const nowMs  = Date.now();
      const dtMs   = st.lastMs ? Math.min(nowMs - st.lastMs, 200) : 0;  // cap at 200ms
      st.lastMs = nowMs;
      const rawVel = (st.prevPos === null) ? 0 : (headPos - st.prevPos);
      const absRaw = Math.abs(rawVel);
      // Fast-attack: snap to new speed instantly; time-based decay: 0.5^(dt/80ms)
      const decayFactor = Math.pow(0.5, dtMs / 80);
      st.speed = (absRaw > st.speed) ? absRaw : (st.speed * decayFactor);
      if      (rawVel > 0) st.trailDir = 0;  // moving up   → trail at lower idx
      else if (rawVel < 0) st.trailDir = 1;  // moving down → trail at higher idx
      const trailAtLower = (st.trailDir === 0);

      // Dynamic trail length: ix amplifies velocity (no base-floor, collapses fully at rest)
      const velMult  = (seg.sx / 255) * 12;                        // 0-12
      const ixScale  = 1 + Math.floor(seg.ix / 64);                // 1-4
      const velLen   = Math.round(st.speed * velMult * ixScale);
      const trailLen = Math.min(N - 1, 4 + velLen);

      // Colors
      // Colors — Pal Map: 0=Value(thr), 1=Spatial(strip pos), 2=Animated(thr+drift)
      const palMode222 = Math.floor(seg.c1 / 85);
      const pal222P    = palMode222 === 0 ? thrFrac
                       : palMode222 === 1 ? headPos / N
                       : (thrFrac + (t * 0.03)) % 1;          // mode 2: thr + slow drift
      const [hr, hg, hb] = _palColor(pal, pal222P, col);        // 0-255, palette mapped
      // Near-white hot tip: hr/hg/hb are 0-255, blend toward 255. Output stays 0-255.
      const hotR = hr + (255 - hr) * 0.63;
      const hotG = hg + (255 - hg) * 0.63;
      const hotB = hb + (255 - hb) * 0.63;
      const bgFrac = 6 / 255;

      for (let i = 0; i < N; i++) {
        if (i === headPos) {
          // hotR/G/B are 0-255; bri is 0-1. No extra *255.
          leds.push(_toHex(hotR * bri, hotG * bri, hotB * bri));
        } else {
          const dist = trailAtLower ? (headPos - i) : (i - headPos);
          if (dist > 0 && dist <= trailLen) {
            // Quadratic brightness: near-full close to head, smooth fade to black.
            // Dither density cubic so sparseness grows faster than brightness drops.
            const d       = dist / trailLen;      // 0=near head, 1=tail
            const inv     = 1 - d;
            const dens    = inv * inv * inv;       // cubic density 0–1
            const pixBri  = inv * inv * ix * bri;  // quadratic brightness, 0-1
            const framePh = Math.floor(st.frame / 4);
            const thresh  = Math.sin(i * 91.37 + framePh * 7.43) * 0.5 + 0.5;
            const adjDens = Math.min(1, dens + seg.c1 / 255);
            if (adjDens > thresh) {
              leds.push(_toHex(hr * pixBri, hg * pixBri, hb * pixBri));
            } else {
              leds.push(_toHex(seg.col[1][0] * bgFrac * bri, seg.col[1][1] * bgFrac * bri, seg.col[1][2] * bgFrac * bri));
            }
          } else {
            leds.push(_toHex(seg.col[1][0] * bgFrac * bri, seg.col[1][1] * bgFrac * bri, seg.col[1][2] * bgFrac * bri));
          }
        }
      }

      st.prevPos = headPos;
      st.frame++;
      break;
    }

    // ══ 223  CAN RPM Ignition ═══════════════════════════════════════════════
    //   Per-pixel spark hold+fade driven by RPM.  Each pixel fires when its
    //   hash crosses the RPM-derived threshold, then holds at peak brightness
    //   and fades out over time.  At spark moment color is hot (high palette
    //   position / col[2] blend); it cools toward the normal RPM color as it
    //   fades.
    case 223: {
      const now223      = Date.now();
      const rpmFrac     = Math.min(rpm / 8000, 1);         // 0-1
      const rpmF8       = rpmFrac * 255;                   // 0-255
      const nearRedline = rpmFrac > 0.85;

      // Pal Map mode (same as other effects — c1)
      const palMode223 = Math.floor(seg.c1 / 85);

      // Fade duration from c2: 200 ms (c2=0) → 3000 ms (c2=255); default c2=128 → ~1600 ms
      const maxFadeMs223 = 200 + ((seg.c2 ?? 128) / 255) * 2800;

      // Flicker tick — controls how often pixels can re-spark
      const flickDiv = Math.max(1, 8 - Math.floor(seg.sx / 32));
      const fps      = 40;
      const stepInt  = Math.floor(t * fps);
      const tick     = nearRedline ? stepInt : Math.floor(t * fps / flickDiv);

      // Spark threshold (global per frame)
      const thresh8 = nearRedline
        ? ((stepInt & 3) ? 200 : 80)
        : Math.round(255 - rpmF8 * rpmF8 / 255);

      const bgBright = rpmFrac * 24 / 255 * bri;

      // Normal (non-hot) palette position for this RPM level
      const baseHue223 = (250 - rpmFrac * 220) / 255;  // 0.98→0.12 (deep-red→yellow) in 0-1

      // Init per-pixel fade-timer arrays — keyed by segment id so different
      // segment lengths don't wipe each other's in-flight timers.
      const _sfx = `ign223_${seg.id}`;
      if (!_state[_sfx] || _state[_sfx].end.length !== N) {
        _state[_sfx] = { end: new Float64Array(N), dur: new Float64Array(N).fill(1) };
      }
      const ignEnd = _state[_sfx].end;
      const ignDur = _state[_sfx].dur;

      for (let i = 0; i < N; i++) {
        // Per-pixel xorshift hash — stationary, no directional scroll
        const seed   = (Math.imul(i, 0x9E3779B1) ^ Math.imul(tick, 0x85EBCA77)) >>> 0;
        const h1     = (seed ^ (seed >>> 16)) >>> 0;
        const h2     = Math.imul(h1, 0x45d9f3b) >>> 0;
        const noiseB = (h2 ^ (h2 >>> 16)) >>> 24;  // 0-255

        // Fire a new spark only when the pixel is not already fading
        const pixelActive = now223 < ignEnd[i];
        if (!pixelActive && noiseB >= thresh8) {
          const dur = 200 + Math.random() * maxFadeMs223;
          ignEnd[i] = now223 + dur;
          ignDur[i] = dur;
        }

        const fadeEnd = ignEnd[i];
        const fadeDur = ignDur[i];
        const isActive = now223 < fadeEnd;

        if (!isActive) {
          // Background ember — dim col[1] (hue-normalized)
          const [c1r, c1g, c1b] = seg.col[1];
          const bgMaxCh = Math.max(c1r, c1g, c1b, 1);
          leds.push(_toHex(
            (c1r / bgMaxCh) * bgBright * 255,
            (c1g / bgMaxCh) * bgBright * 255,
            (c1b / bgMaxCh) * bgBright * 255
          ));
        } else {
          // fadeFrac: 1.0 = just sparked, 0.0 = fully faded
          const fadeFrac = Math.max(0, (fadeEnd - now223) / fadeDur);

          // Spark brightness scales with RPM: 55% at idle → 85% at redline, linear
          const sparkBriPct = 0.55 + rpmFrac * 0.30;  // 0.55..0.85
          // Final pixel brightness: RPM-scaled peak, fades to zero (no intensity multiplier)
          const pixBri = fadeFrac * sparkBriPct * bri;

          // Palette position — cools from hot end toward normal as spark fades
          let normalPalPos;
          if      (palMode223 === 0) normalPalPos = rpmFrac;
          else if (palMode223 === 1) normalPalPos = baseHue223;
          else                       normalPalPos = (i / N + rpmFrac * 0.5) % 1;

          const hotPalPos = Math.min(1, normalPalPos + 0.35 + fadeFrac * 0.25);
          const palPos223 = hotPalPos * fadeFrac + normalPalPos * (1 - fadeFrac);

          // Get palette hue, then blend toward col[2] on fresh sparks
          const [er, eg, eb] = _palColor(pal, Math.min(1, palPos223), col);
          const hotBlend = fadeFrac > 0.706 ? Math.min(1, (fadeFrac - 0.706) * 4) : 0;
          const [c2r, c2g, c2b] = seg.col[2];
          const tr = er * (1 - hotBlend) + c2r * hotBlend;
          const tg = eg * (1 - hotBlend) + c2g * hotBlend;
          const tb = eb * (1 - hotBlend) + c2b * hotBlend;

          // Hue-only: normalize blended color to max channel (strip palette value,
          // keep only hue direction) then scale by pixBri
          const maxCh = Math.max(tr, tg, tb, 1);
          leds.push(_toHex(
            (tr / maxCh) * pixBri * 255,
            (tg / maxCh) * pixBri * 255,
            (tb / maxCh) * pixBri * 255
          ));
        }
      }
      break;
    }

    // ══ 224  CAN Speed Warp ═════════════════════════════════════════════════
    //   Sine waves that compress (more waves, faster) with speed.
    //   Hue shifts across strip; near-zero speed = dim slow pulse.
    case 224: {
      const spd8      = speed / 200;                         // 0-1
      const baseHueByte224 = Math.round(160 - spd8 * 160);  // blue→red
      const waveCount = 1 + Math.round(spd8 * 7);           // 1..8
      const wavePeriod = Math.max(4, N / waveCount);
      const animRate   = spd8 / 8 + sx / (255 * 8);
      const step = t * animRate * N;  // scroll in pixel-units/s
      const floor8 = spd8 * 0.25;    // minimum brightness glow at rest
      for (let i = 0; i < N; i++) {
        const phase  = ((i / wavePeriod + step / N) % 1) * 2 * Math.PI;
        const sineV  = (Math.sin(phase) + 1) * 0.5;         // 0-1
        let bright   = sineV * ix / 255 * bri;
        if (bright < floor8 * bri) bright = floor8 * bri;
        // Pal Map: 0=speed-only uniform, 1=spatial+speed (default), 2=animated scroll
        const palMode224 = Math.floor(seg.c1 / 85);
        let palP224;
        if      (palMode224 === 0) palP224 = (baseHueByte224 / 255);
        else if (palMode224 === 1) palP224 = ((baseHueByte224 / 255) + (i / N) * (24 / 255)) % 1;
        else                       palP224 = (((baseHueByte224 / 255) + (i / N) * (24 / 255)) + t * 0.05) % 1;
        const [r,g,b] = _palColor(pal, palP224, col);
        leds.push(_toHex(r * bright, g * bright, b * bright));
      }
      break;
    }

    // ── Default: palette scroll (graceful fallback for unimplemented effects) ─
    default: {
      const off = t * sx * 60;
      for (let i = 0; i < N; i++) {
        const [r,g,b] = _palColor(pal, ((i/N + off/N) % 1), col);
        leds.push(_toHex(r*bri, g*bri, b*bri));
      }
      break;
    }
  }

  return leds;
}

// ─── State / info ─────────────────────────────────────────────────────────────
function _rawHex(frame) {
  if (!frame) return '--';
  return frame.data.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

function getState() {
  // Build live CAN runtime data and merge into the state's can field so
  // the CAN monitor page (which fetches /json/state) gets frames + decoded values.
  const frames   = CAN_SIGNAL_DEFS.map(def => _makeFrame(def));
  const nowMs    = Date.now() - _canStart;
  const simRx    = Math.round(nowMs / 20) * CAN_SIGNAL_DEFS.length; // 50 Hz × 7 signals
  return {
    ..._state,
    can: {
      ..._state.can,
      started: true,
      rxCount: simRx, txCount: 0, errors: 0, overruns: 0,
      msSinceFrame: 5,
      bufferCount: frames.length, bufferSize: 128,
      rpmCanId:      _state.can.rpmCanId      || 0x316,
      speedCanId:    _state.can.speedCanId    || 0x328,
      throttleCanId: _state.can.throttleCanId || 0x329,
      activeIds:     CAN_SIGNAL_DEFS.map(d => d.id),
      recentFrames:  frames,
      calcRpm:       Math.round(_car.rpm),
      calcSpeed:     Math.round(_car.speed * 10) / 10,
      calcThrottle:  Math.round(_car.throttle),
      rawRpmFrame:      _rawHex(frames.find(f => f.id === 0x316)),
      rawSpeedFrame:    _rawHex(frames.find(f => f.id === 0x328)),
      rawThrottleFrame: _rawHex(frames.find(f => f.id === 0x329)),
    },
  };
}

function _applySegPatch(s) {
  const target = _state.seg.find(t => t.id === (s.id ?? 0));
  if (!target) return;
  const { id: _id, fxdef: _fd, col: newCol, ...rest } = s;
  Object.assign(target, rest);
  // Merge colour slots individually — setColor sends [[r,g,b,w],[],[]] where
  // un-touched slots are empty arrays []. Only overwrite a slot when it has data.
  if (Array.isArray(newCol)) {
    for (let i = 0; i < newCol.length; i++) {
      if (Array.isArray(newCol[i]) && newCol[i].length >= 3) {
        target.col[i] = newCol[i];
      }
    }
  }
}

function applyCommand(cmd) {
  if (cmd.on         !== undefined) _state.on         = cmd.on;
  if (cmd.bri        !== undefined) _state.bri        = Math.max(1, Math.min(255, cmd.bri));
  if (cmd.transition !== undefined) _state.transition = cmd.transition;
  if (cmd.bs         !== undefined) _state.bs         = cmd.bs;
  if (cmd.pl         !== undefined) _state.pl         = cmd.pl;
  // mainseg: tracks which segment drives the UI controls (color picker, fx, etc.)
  if (cmd.mainseg    !== undefined) _state.mainseg    = cmd.mainseg;
  if (cmd.nl)   Object.assign(_state.nl,   cmd.nl);
  if (cmd.udpn) Object.assign(_state.udpn, cmd.udpn);
  // CAN config updates — only allow known config keys to avoid overwriting runtime data
  if (cmd.can) {
    const cfg = cmd.can;
    const allowed = ['enabled','bitrate','listenOnly','rxPin','txPin','rxQueueLen',
                     'filterEnabled','filterExt','filterId','filterMask','uiPollRate','uiEffect',
                     'rpmCanId','speedCanId','throttleCanId'];
    for (const k of allowed) if (cfg[k] !== undefined) _state.can[k] = cfg[k];
  }
  // Handle seg as either object or array.
  // When seg is a plain object WITHOUT an id, WLED applies it to all selected segments.
  // When seg has an explicit id, or is an array element, it goes to that specific segment.
  if (cmd.seg) {
    const patches = Array.isArray(cmd.seg) ? cmd.seg : [cmd.seg];
    for (const s of patches) {
      if (s.id !== undefined) {
        // Explicit id → target that specific segment
        _applySegPatch(s);
      } else {
        // No id → broadcast to every currently-selected segment (mirrors WLED firmware)
        const targets = _state.seg.filter(t => t.sel);
        for (const t of targets) _applySegPatch({ ...s, id: t.id });
      }
    }
  }
  // Load preset (apply preset state)
  if (cmd.ps !== undefined) {
    _state.ps = cmd.ps;
    const preset = getPresets()[cmd.ps];
    if (preset) {
      if (preset.on  !== undefined) _state.on  = preset.on;
      if (preset.bri !== undefined) _state.bri = preset.bri;
      if (Array.isArray(preset.seg)) for (const s of preset.seg) _applySegPatch(s);
    }
  }
}

module.exports = {
  getMockSI, getMockInfo, getState, applyCommand,
  getPalettes, getPalx, getEffects, getFxData,
  getPresets, getNodes,
  getCanStatus, getCanFull,
  applyCarInput, getCarState,
  getLayout, applyLayout,
  renderEffect,
};
