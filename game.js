// ════════════════════════════════════════════════════════════════
//  DIE SHRINK — 폰 내부 기판 로그라이트
//  phone shell → PCB hub → IC die (dungeon)
// ════════════════════════════════════════════════════════════════

import * as THREE from 'three';

const W = 9, H = 13;                    // dungeon grid
const RAD = Math.PI / 180;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

// camera rig — tilt is measured from straight-down, so 0 = pure top view.
// Kept as live state so the view can change later without touching anything else.
const CAM = { tilt: 26, yaw: 0, dist: 70, focus: new THREE.Vector3() };
const TILT_STEPS = [12, 26, 40];
let tiltIdx = 1;

const DUNGEON_Y = -120;                 // dungeon lives far below the board

// ───────────── rng ─────────────
let seed = (Math.random() * 1e9) | 0;
function rnd() { seed = (seed * 1664525 + 1013904223) | 0; return ((seed >>> 8) & 0xFFFFFF) / 0x1000000; }
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = a => a[Math.floor(rnd() * a.length)];
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const hash = (x, y) => { let h = (x * 73856093) ^ (y * 19349663); h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const dist = (a, b, c, d) => Math.max(Math.abs(a - c), Math.abs(b - d));

// ───────────── content ─────────────
const XP_TABLE = [5, 15, 30, 50, 75, 105, 140, 180, 225, 275, 330, 390];

// Board layout mirrors a real teardown: SoC high-center, battery dominating
// the lower half, camera stack top-left, radios along the edges.
const COMPONENTS = [
  { id:'touch',  name:'TOUCH DIGITIZER', x:  0.0, z: -5.6, w: 5.4, d: 1.5, floors: 2, gimmick:'격자가 정직하다. 기믹 없음' },
  { id:'cam',    name:'CAMERA ISP',      x: -1.9, z: -3.9, w: 2.3, d: 2.3, floors: 3, gimmick:'렌즈 왜곡 — 시야가 중앙으로 쏠린다' },
  { id:'soc',    name:'SoC / AP',        x:  0.7, z: -1.7, w: 2.6, d: 2.6, floors: 3, gimmick:'코어 구획마다 규칙이 다르다' },
  { id:'ram',    name:'LPDDR RAM',       x: -1.9, z: -1.0, w: 1.8, d: 1.8, floors: 3, gimmick:'걷힌 안개가 되돌아온다' },
  { id:'pmic',   name:'PMIC',            x:  2.1, z: -3.6, w: 1.5, d: 1.2, floors: 2, gimmick:'전압 변동 — 공격력이 요동친다' },
  { id:'nand',   name:'NAND FLASH',      x:  2.0, z:  0.3, w: 1.7, d: 1.7, floors: 3, gimmick:'배드 섹터 — 회복되지 않는 칸' },
  { id:'modem',  name:'BASEBAND',        x: -2.0, z:  1.4, w: 1.7, d: 1.4, floors: 3, gimmick:'외부에서 침입자가 들어온다' },
  { id:'audio',  name:'AUDIO CODEC',     x:  1.9, z:  2.3, w: 1.4, d: 1.2, floors: 2, gimmick:'소리가 잠든 것을 깨운다' },
  { id:'batt',   name:'BATTERY CELL',    x:  0.0, z:  4.4, w: 5.0, d: 4.4, floors: 3, gimmick:'발열 2배. 대신 처치 시 배터리 회복' },
  { id:'haptic', name:'HAPTIC ENGINE',   x: -1.8, z:  6.9, w: 2.0, d: 1.3, floors: 2, gimmick:'진동 — 모든 것이 밀려난다' },
  { id:'nfc',    name:'NFC COIL',        x:  1.9, z:  6.9, w: 2.0, d: 1.3, floors: 2, gimmick:'코일 위 칸들이 서로 연결된다' },
];

const MONSTERS = [
  { id:'zombie',  name:'ZOMBIE PROC', shape:'chip',    col:0x8B9BA8, hp:1.00, atk:1.00, def:0, note:'평범하다' },
  { id:'bitrot',  name:'BIT ROT',     shape:'diamond', col:0xC87137, hp:0.60, atk:1.45, def:0, note:'유리대포 — 약하지만 아프다' },
  { id:'esd',     name:'ESD',         shape:'hex',     col:0x7FA8C9, hp:1.35, atk:0.80, def:1, note:'방어가 높다' },
  { id:'adware',  name:'ADWARE',      shape:'blob',    col:0xB673C9, hp:0.90, atk:0.85, def:0, note:'교전하면 발열한다' },
  { id:'deadlock',name:'DEADLOCK',    shape:'chip',    col:0xFF4D5E, hp:1.10, atk:1.15, def:0, note:'선공 — 먼저 때린다', ambush:true },
];
const BOSS = { id:'panic', name:'KERNEL PANIC', shape:'boss', col:0xFF4D5E, hp:2.2, atk:1.3, def:1, note:'보스', boss:true };

// ───────────── floor contracts ─────────────
// "Clear the floor or run for the VIA" was a 2%-vs-4% coin flip, which is no
// decision at all. Two things fix that: the exit toll now scales with how many
// you leave breathing (so partial clears are a real middle ground), and every
// floor below the first draws a contract that changes what the two ends are worth.
const SECTORS = [
  { id:'clean',   name:'CLEAN ROOM',      col:'g',
    rule:'전멸하면 배터리 최대치 <b class="c">+1</b> (영구)',
    short:'전멸 → 최대치 +1' },
  { id:'thermal', name:'THERMAL RUNAWAY', col:'a',
    rule:'남기고 내려가면 잔존 1기당 다음 층 시작 열 <b class="r">+9</b>',
    short:'남기면 다음 층 열 +9/기' },
  { id:'lock',    name:'BAD BLOCK',       col:'r',
    rule:'절반 이상 처치해야 <b class="a">VIA가 열린다</b>',
    short:'절반 처치까지 VIA 봉인' },
  { id:'leak',    name:'LEAKAGE',         col:'r',
    rule:'남기고 내려가면 잔존 1기당 <b class="r">HEALTH −1</b> 추가',
    short:'남기면 수명 추가 −1/기' },
  { id:'salvage', name:'SALVAGE',         col:'g',
    rule:'전멸하면 <b class="a">부품 1개</b>를 즉시 회수한다',
    short:'전멸 → 부품 1개' },
  { id:'migrate', name:'MIGRATION',       col:'a',
    rule:'남기고 내려가면 최대 <b class="r">3기</b>가 다음 층까지 따라온다',
    short:'남기면 3기가 따라온다' },
];
const QUIET = { id:'quiet', name:'NOMINAL', col:'', rule:'특이사항 없음', short:'—' };

const ITEMS = [
  { id:'atk',   kind:'INSTALL', name:'HEATSINK PASTE', col:0x6BD98A, desc:'ATK +2 (영구)' },
  { id:'def',   kind:'INSTALL', name:'SHIELD CAN',     col:0x6BD98A, desc:'DEF +1 (영구)' },
  { id:'full',  kind:'EXEC',    name:'POWER BANK',     col:0xFFB454, desc:'배터리 완충' },
  { id:'nova',  kind:'EXEC',    name:'CAP DISCHARGE',  col:0xFFB454, desc:'인접 8칸 큰 피해' },
  { id:'cool',  kind:'EXEC',    name:'VAPOR CHAMBER',  col:0xFFB454, desc:'열 전량 방출' },
  { id:'patch', kind:'PATCH',   name:'WATCHDOG',       col:0x4DE0D0, desc:'치명 시 1회 자동 복구' },
];

const SKILLS = [
  { id:'tap',   name:'TAP',   heat:5,  cd:3, target:null,  desc:'다음 공격 ×1.5',
    long:'다음 한 번의 공격 피해가 1.5배가 된다. 강한 적을 치기 직전에 쓴다. 3턴 쿨다운.' },
  { id:'surge', name:'SURGE', heat:14, cd:0, target:'dir',
    desc:'직선 3칸 관통',
    long:'고른 방향으로 3칸을 관통해 ATK의 1.2배 피해를 준다. 반격을 받지 않는다. 벽에 막힌다.' },
  { id:'purge', name:'PURGE', heat:10, cd:0, target:null,
    desc:'배터리 25% 회복',
    long:'배터리를 최대치의 25%만큼 회복한다. 안개가 남지 않았을 때의 마지막 회복 수단.' },
  { id:'scan',  name:'SCAN',  heat:4,  cd:0, target:null,
    desc:'반경 3 정찰',
    long:'반경 3칸의 안개를 걷지 않고 들여다본다. 지형과 적은 드러나지만 배터리는 회복되지 않는다.' },
];

// ════════════════════════════════════════════════════════════════
//  three.js scaffolding
// ════════════════════════════════════════════════════════════════

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x05070A, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x05070A, 80, 210);

const cam = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 600);

const boardGroup = new THREE.Group();
const dunGroup = new THREE.Group();
dunGroup.position.y = DUNGEON_Y;
scene.add(boardGroup, dunGroup);

// lights
scene.add(new THREE.AmbientLight(0x3A5060, 2.4));
const key = new THREE.DirectionalLight(0xFFEEDD, 2.8);
key.position.set(6, 16, 8);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.near = 1; key.shadow.camera.far = 60;
key.shadow.camera.left = -12; key.shadow.camera.right = 12;
key.shadow.camera.top = 12; key.shadow.camera.bottom = -12;
key.shadow.bias = -0.002;
scene.add(key, key.target);

const rim = new THREE.DirectionalLight(0x4DE0D0, 0.7);
rim.position.set(-7, 5, -6);
scene.add(rim);

const playerLight = new THREE.PointLight(0x4DE0D0, 14, 9, 2);
scene.add(playerLight);

// ───────────── shared assets ─────────────
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
const HEXG = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
const SPH = new THREE.SphereGeometry(0.5, 12, 9);
const TOR = new THREE.TorusGeometry(0.34, 0.07, 8, 24);

const mat = (o) => new THREE.MeshStandardMaterial(o);
const M = {
  pcb:     mat({ color:0x0C2A26, roughness:0.85, metalness:0.15 }),
  pcbDark: mat({ color:0x081A18, roughness:0.9,  metalness:0.1 }),
  copper:  mat({ color:0xC87137, roughness:0.32, metalness:0.9 }),
  copperD: mat({ color:0x6E3D1C, roughness:0.5,  metalness:0.7 }),
  chipBody:mat({ color:0x2A343E, roughness:0.55, metalness:0.35 }),
  gold:    mat({ color:0xD9A441, roughness:0.3,  metalness:0.95 }),
  glass:   new THREE.MeshPhysicalMaterial({ color:0x0A0E14, roughness:0.08, metalness:0.0,
             transparent:true, opacity:1, transmission:0, clearcoat:1 }),
  frame:   mat({ color:0x2A323C, roughness:0.35, metalness:0.85 }),
  // Fog must read as a LID over the board — cool slate, matte, clearly not floor.
  fog:     mat({ color:0x1B2732, roughness:0.98, metalness:0.05 }),
  // Lit floor glows faintly: "this trace is powered".
  floor:   mat({ color:0x14453C, roughness:0.75, metalness:0.15, emissive:0x06211C, emissiveIntensity:1 }),
  floorAlt:mat({ color:0x113B34, roughness:0.75, metalness:0.15, emissive:0x051A17, emissiveIntensity:1 }),
};

const emissive = (hex, intensity = 1.1) =>
  mat({ color: hex, emissive: hex, emissiveIntensity: intensity, roughness: 0.4, metalness: 0.2 });

// level-number sprites, cached
const spriteCache = new Map();
function numSprite(n, color) {
  const k = n + '|' + color;
  if (spriteCache.has(k)) return spriteCache.get(k);
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.font = '700 42px ui-monospace, Menlo, monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 7; g.strokeStyle = '#05070A';
  g.strokeText(n, 32, 34); g.fillStyle = color; g.fillText(n, 32, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true });
  spriteCache.set(k, m);
  return m;
}

// ════════════════════════════════════════════════════════════════
//  the phone + board (hub)
// ════════════════════════════════════════════════════════════════

const PHONE_W = 7.2, PHONE_H = 15.2, PHONE_T = 0.75;
const PLATE_W = PHONE_W - 0.9, PLATE_H = PHONE_H - 1.4;
let glassMesh, boardPlate, icMeshes = [], icLabels = [];

// ════════════════════════════════════════════════════════════════
//  procedural texture
//
//  All of the "this is a real board" detail is painted, not modelled: solder mask
//  and silkscreen on the hub plate, metal-layer routing on the die floor. A phone
//  screen shows a tile at roughly 32px, so every pattern here is drawn coarse
//  enough to survive that and keyed to the same palette as the UI.
// ════════════════════════════════════════════════════════════════

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
  return t;
}

// self-contained rng so painting never disturbs the run seed
const prng = s => () => {
  s = s + 0x6D2B79F5 | 0;
  let t = Math.imul(s ^ s >>> 15, 1 | s);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

function speckle(g, w, h, n, colors, r0, r1, R) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[(R() * colors.length) | 0];
    g.globalAlpha = 0.12 + R() * 0.3;
    const s = r0 + R() * (r1 - r0);
    g.fillRect(R() * w, R() * h, s, s);
  }
  g.globalAlpha = 1;
}

// ───────────── die interior: one metal layer, seen from above ─────────────
function dieMetalTex(variant) {
  return canvasTex(128, 128, (g, w, h) => {
    const R = prng(variant * 7717 + 13);
    g.fillStyle = variant ? '#0E3A34' : '#12433B';
    g.fillRect(0, 0, w, h);

    // diffusion speckle under the metal
    speckle(g, w, h, 90, ['#0A2E29', '#175248'], 2, 5, R);

    // routing tracks on a 16px pitch, a couple of them powered
    const pitch = 16, off = variant ? 8 : 0;
    for (let i = 0; i < 8; i++) {
      const v = R() < 0.5;
      const p = off + ((i * 2 + (R() * 2 | 0)) % 8) * pitch;
      const live = R() < 0.28;
      const len = 40 + R() * 88;
      const s = R() * (128 - len * 0.4);
      g.fillStyle = live ? '#2E8877' : '#1C5B50';
      if (v) g.fillRect(p, s, 4, len); else g.fillRect(s, p, len, 4);
      g.fillStyle = live ? '#49B9A2' : '#245F55';        // lit top edge of the trace
      if (v) g.fillRect(p, s, 1, len); else g.fillRect(s, p, len, 1);
    }

    // vias where tracks stack to the layer below
    for (let i = 0; i < 7; i++) {
      const x = ((R() * 8) | 0) * pitch + off, y = ((R() * 8) | 0) * pitch;
      g.fillStyle = '#0A211E'; g.fillRect(x - 1, y - 1, 8, 8);
      g.fillStyle = '#8A6A2E'; g.fillRect(x, y, 6, 6);
      g.fillStyle = '#C89B44'; g.fillRect(x + 1, y + 1, 3, 3);
    }

    // a band of standard cells — the repetition is what reads as "die"
    g.fillStyle = '#17554B';
    const cy = ((R() * 6) | 0) * pitch + 6;
    for (let x = 4; x < 124; x += 7) g.fillRect(x, cy, 4, 12);
  });
}

// ───────────── passivation lid: what an un-etched region looks like ─────────────
function passivationTex() {
  return canvasTex(128, 128, (g, w, h) => {
    const R = prng(4211);
    g.fillStyle = '#1B2732';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 120, ['#151F28', '#22303D'], 2, 6, R);
    g.strokeStyle = '#212E3A'; g.lineWidth = 1;
    for (let p = 0; p <= 128; p += 16) {
      g.beginPath(); g.moveTo(p + .5, 0); g.lineTo(p + .5, h); g.stroke();
      g.beginPath(); g.moveTo(0, p + .5); g.lineTo(w, p + .5); g.stroke();
    }
    // dull shapes buried under the lid — you can almost see the layout
    g.fillStyle = '#1F2C37';
    for (let i = 0; i < 5; i++) g.fillRect(R() * 100, R() * 100, 12 + R() * 22, 8 + R() * 14);
  });
}

// ───────────── copper interconnect: the walls ─────────────
function copperTex(dark) {
  return canvasTex(64, 128, (g, w, h) => {
    const R = prng(dark ? 991 : 313);
    g.fillStyle = dark ? '#6E3D1C' : '#C87137';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {                       // brushed grain
      g.globalAlpha = 0.06 + R() * 0.12;
      g.fillStyle = R() < 0.5 ? '#000000' : '#FFC48A';
      g.fillRect(0, R() * h, w, 1);
    }
    g.globalAlpha = 1;
    // stacked via bands — the wall reads as several metal layers, not one block
    for (let y = 10; y < h; y += 26) {
      g.fillStyle = dark ? '#542E14' : '#9A5528'; g.fillRect(0, y, w, 4);
      g.fillStyle = dark ? '#8A5228' : '#E39456'; g.fillRect(0, y + 4, w, 1);
    }
  });
}

// ───────────── silicon substrate under the die ─────────────
function substrateTex() {
  return canvasTex(256, 256, (g, w, h) => {
    const R = prng(77);
    g.fillStyle = '#081A18';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 200, ['#06120F', '#0C2320'], 2, 7, R);
    g.strokeStyle = '#0E2A26'; g.lineWidth = 2;
    for (let i = 0; i < 26; i++) {                       // deep routing, half buried
      const v = R() < 0.5, p = R() * 256, s = R() * 200, l = 30 + R() * 120;
      g.beginPath();
      if (v) { g.moveTo(p, s); g.lineTo(p, s + l); } else { g.moveTo(s, p); g.lineTo(s + l, p); }
      g.stroke();
    }
  });
}

// ───────────── the hub board, painted from the real component layout ─────────────
const T2X = x => (x / PLATE_W + 0.5) * 1024;
const T2Y = z => (z / PLATE_H + 0.5) * 2240;

function pcbTex() {
  return canvasTex(1024, 2240, (g, w, h) => {
    const R = prng(20260807);

    g.fillStyle = '#0C2A26';                             // solder mask
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 900, ['#0A2320', '#10322C'], 3, 9, R);

    // ground pour, cross-hatched the way a thermal relief zone is
    g.strokeStyle = '#0E322C'; g.lineWidth = 3;
    for (let d = -h; d < w; d += 26) {
      g.beginPath(); g.moveTo(d, 0); g.lineTo(d + h, h); g.stroke();
    }

    // routing between the real components, Manhattan with mitred corners
    const nodes = COMPONENTS.map(c => ({ x: T2X(c.x), y: T2Y(c.z), c }));
    const trace = (x0, y0, x1, y1, wide, live) => {
      g.strokeStyle = live ? '#D0873F' : '#14413A';
      g.lineWidth = wide;
      g.lineCap = 'round'; g.lineJoin = 'round';
      const midY = y0 + (y1 - y0) * (0.35 + R() * 0.3);
      const k = Math.min(34, Math.abs(x1 - x0) * 0.5, Math.abs(midY - y0) * 0.9) * Math.sign(x1 - x0 || 1);
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x0, midY - Math.abs(k));
      g.lineTo(x0 + k, midY);                            // 45° mitre
      g.lineTo(x1 - k, midY);
      g.lineTo(x1, midY + Math.abs(k));
      g.lineTo(x1, y1);
      g.stroke();
    };
    for (let i = 0; i < nodes.length; i++) {
      for (let j = 0; j < 3; j++) {
        const a = nodes[i], b = nodes[(i + 1 + ((R() * 3) | 0)) % nodes.length];
        const sx = a.x + (R() - 0.5) * a.c.w * 120, sy = a.y + (R() - 0.5) * a.c.d * 110;
        const ex = b.x + (R() - 0.5) * b.c.w * 120, ey = b.y + (R() - 0.5) * b.c.d * 110;
        trace(sx, sy, ex, ey, 3 + R() * 5, R() < 0.16);
      }
    }
    // bus ribbons down the long axis — a phone board is mostly one big bus
    for (let i = 0; i < 22; i++) {
      const x = 60 + R() * 900;
      g.strokeStyle = '#123C35'; g.lineWidth = 2 + R() * 3;
      g.beginPath(); g.moveTo(x, R() * 400); g.lineTo(x, 400 + R() * 1700); g.stroke();
    }

    // vias: drilled hole with an annular ring
    for (let i = 0; i < 260; i++) {
      const x = R() * w, y = R() * h, r = 4 + R() * 3;
      g.fillStyle = '#C8A24A'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      g.fillStyle = '#05100E'; g.beginPath(); g.arc(x, y, r * 0.45, 0, 7); g.fill();
    }

    // per-component: exposed gold pad field + silkscreen outline + designator
    g.textAlign = 'center'; g.textBaseline = 'middle';
    COMPONENTS.forEach((c, i) => {
      const cx = T2X(c.x), cy = T2Y(c.z);
      const pw = c.w / PLATE_W * 1024, ph = c.d / PLATE_H * 2240;

      g.fillStyle = '#0A1C1A';                            // mask opening
      g.fillRect(cx - pw / 2 - 6, cy - ph / 2 - 6, pw + 12, ph + 12);
      const cols = Math.max(4, Math.round(pw / 26)), rows = Math.max(4, Math.round(ph / 26));
      for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) {
        g.fillStyle = (a + b) % 3 ? '#B98F3E' : '#D9A441';   // BGA ball field
        const px = cx - pw / 2 + (a + 0.5) * (pw / cols), py = cy - ph / 2 + (b + 0.5) * (ph / rows);
        g.beginPath(); g.arc(px, py, Math.min(7, pw / cols * 0.3), 0, 7); g.fill();
      }

      g.strokeStyle = '#9FB2AC'; g.lineWidth = 3;         // silkscreen
      g.strokeRect(cx - pw / 2 - 14, cy - ph / 2 - 14, pw + 28, ph + 28);
      g.fillStyle = '#9FB2AC';                            // pin-1 dot
      g.beginPath(); g.arc(cx - pw / 2 - 26, cy - ph / 2 - 26, 6, 0, 7); g.fill();
      g.font = '700 30px ui-monospace, Menlo, monospace';
      g.fillText('U' + (i + 1), cx, cy - ph / 2 - 36);
      g.font = '600 20px ui-monospace, Menlo, monospace';
      g.fillStyle = '#7C8E89';
      g.fillText(c.id.toUpperCase(), cx, cy + ph / 2 + 34);
    });

    // discrete passives, each with its own designator — the noise floor of a real board
    g.font = '600 15px ui-monospace, Menlo, monospace';
    for (let i = 0; i < 120; i++) {
      const x = R() * (w - 60) + 30, y = R() * (h - 60) + 30;
      const vert = R() < 0.5, L = 16 + R() * 12;
      g.fillStyle = '#C8A24A';
      if (vert) { g.fillRect(x - 6, y - L / 2, 12, 5); g.fillRect(x - 6, y + L / 2 - 5, 12, 5); }
      else { g.fillRect(x - L / 2, y - 6, 5, 12); g.fillRect(x + L / 2 - 5, y - 6, 5, 12); }
      g.fillStyle = R() < 0.5 ? '#1E2A2E' : '#3A2F1E';
      if (vert) g.fillRect(x - 6, y - L / 2 + 4, 12, L - 8);
      else g.fillRect(x - L / 2 + 4, y - 6, L - 8, 12);
      if (R() < 0.4) {
        g.fillStyle = '#7C8E89';
        g.fillText((R() < 0.5 ? 'R' : 'C') + (1 + (R() * 99 | 0)), x + (vert ? 22 : 0), y + (vert ? 0 : 18));
      }
    }

    // board edge: silkscreen frame, fiducials, and the maker's mark
    g.strokeStyle = '#7C8E89'; g.lineWidth = 4;
    g.strokeRect(14, 14, w - 28, h - 28);
    for (const [fx, fy] of [[46, 46], [w - 46, 46], [46, h - 46], [w - 46, h - 46]]) {
      g.fillStyle = '#C8A24A'; g.beginPath(); g.arc(fx, fy, 11, 0, 7); g.fill();
      g.fillStyle = '#0C2A26'; g.beginPath(); g.arc(fx, fy, 5, 0, 7); g.fill();
    }
    g.fillStyle = '#9FB2AC';
    g.font = '700 26px ui-monospace, Menlo, monospace';
    g.fillText('DIE SHRINK  MAIN LOGIC  REV.2', w / 2, 66);
    g.font = '600 18px ui-monospace, Menlo, monospace';
    g.fillStyle = '#6E807B';
    g.fillText('RoHS · 8-LAYER HDI · ENIG', w / 2, h - 58);
  });
}

// ───────────── IC package: epoxy mould with laser-etched marking ─────────────
// Drawn at the part's own aspect ratio so the marking is not stretched by the
// box scale, and marked with the component's real name — on a board this dense,
// the silkscreen is the only way to tell one chip from another.
function pkgTex(seed, name, aspect) {
  const W0 = 320, H0 = Math.round(Math.min(640, Math.max(110, W0 / aspect)));
  return canvasTex(W0, H0, (g, w, h) => {
    const R = prng(seed);
    g.fillStyle = '#1C2228';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 320, ['#161B20', '#252C33'], 3, 9, R);
    g.fillStyle = '#0000004D';                            // mould gate corner
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w * 0.14, 0); g.lineTo(0, h * 0.16); g.fill();
    const pr = Math.min(w, h) * 0.07;
    g.fillStyle = '#77838C';                              // pin-1 dimple
    g.beginPath(); g.arc(pr * 2.2, pr * 2.2, pr, 0, 7); g.fill();
    g.fillStyle = '#13181C';
    g.beginPath(); g.arc(pr * 2.2, pr * 2.2, pr * 0.52, 0, 7); g.fill();

    const s = Math.min(w, h);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#9AA6AE';
    // shrink the marking until it fits the part, the way a real laser mark is sized
    let fs = Math.round(s * 0.19);
    do {
      g.font = `700 ${fs}px ui-monospace, Menlo, monospace`;
      fs -= 2;
    } while (fs > 8 && g.measureText(name).width > w * 0.82);
    g.fillText(name, w / 2, h * 0.42);
    g.fillStyle = '#6B767E';
    g.font = `600 ${Math.round(s * 0.11)}px ui-monospace, Menlo, monospace`;
    g.fillText(`${String.fromCharCode(65 + (R() * 26 | 0))}${1000 + (R() * 8999 | 0)}-${R() * 9 | 0}A`, w / 2, h * 0.63);
    g.fillText(`KR ${24 + (R() * 3 | 0)}W${10 + (R() * 40 | 0)}`, w / 2, h * 0.78);
  });
}

// ───────────── lithium pouch: foil, crinkle, and the warning print ─────────────
function pouchTex() {
  return canvasTex(512, 512, (g, w, h) => {
    const R = prng(555);
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#2E3238'); grad.addColorStop(0.45, '#41474E');
    grad.addColorStop(0.55, '#2A2E33'); grad.addColorStop(1, '#383D43');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 150; i++) {                       // foil crinkle
      g.globalAlpha = 0.05 + R() * 0.12;
      g.strokeStyle = R() < 0.5 ? '#000' : '#C7D2DA';
      g.lineWidth = 1 + R() * 2;
      g.beginPath();
      const x = R() * w, y = R() * h;
      g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 180, y + (R() - 0.5) * 180);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.fillStyle = '#1A1D21';                              // heat-sealed border
    g.fillRect(0, 0, w, 34); g.fillRect(0, h - 34, w, 34);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#C7D2DA';
    g.font = '700 40px ui-monospace, Menlo, monospace';
    g.fillText('Li-Po  4.45V', w / 2, h * 0.4);
    g.font = '600 25px ui-monospace, Menlo, monospace';
    g.fillStyle = '#8C979F';
    g.fillText('4820mAh · 18.6Wh', w / 2, h * 0.52);
    g.fillStyle = '#B8863A';
    g.font = '700 22px ui-monospace, Menlo, monospace';
    g.fillText('⚠ DO NOT PUNCTURE', w / 2, h * 0.66);
  });
}

let painted = false;
function paintMaterials() {
  if (painted) return;
  painted = true;
  // a map replaces the base colour — leave it white or the texture gets tinted flat
  const skin = (m, map, o = {}) => {
    m.map = map; m.color.setHex(0xFFFFFF);
    Object.assign(m, o);
    m.needsUpdate = true;
  };
  skin(M.pcb, pcbTex(), { roughness: 0.62, metalness: 0.1 });
  skin(M.pcbDark, substrateTex(), { roughness: 0.9 });
  skin(M.copper, copperTex(false), { roughness: 0.36, metalness: 0.85 });
  skin(M.copperD, copperTex(true), { roughness: 0.5, metalness: 0.7 });
  skin(M.chipBody, pkgTex(31, 'DIE', 1), { roughness: 0.62, metalness: 0.28 });
  M.pouch = mat({ color:0xFFFFFF, map: pouchTex(), roughness: 0.42, metalness: 0.55 });
  skin(M.fog, passivationTex(), { roughness: 0.96 });
  const a = dieMetalTex(0), b = dieMetalTex(1);
  skin(M.floor, a, { emissiveMap: a, emissive: new THREE.Color(0x2E8877), emissiveIntensity: 0.5, roughness: 0.62, metalness: 0.3 });
  skin(M.floorAlt, b, { emissiveMap: b, emissive: new THREE.Color(0x2E8877), emissiveIntensity: 0.42, roughness: 0.62, metalness: 0.3 });
}

function buildBoard() {
  paintMaterials();
  // chassis
  const body = new THREE.Mesh(BOX, M.frame);
  body.scale.set(PHONE_W, PHONE_T, PHONE_H);
  body.position.y = -PHONE_T / 2 - 0.35;
  body.receiveShadow = true;
  boardGroup.add(body);

  // pcb plate
  boardPlate = new THREE.Mesh(BOX, M.pcb);
  boardPlate.scale.set(PHONE_W - 0.9, 0.16, PHONE_H - 1.4);
  boardPlate.position.y = -0.12;
  boardPlate.receiveShadow = true;
  boardGroup.add(boardPlate);

  // Traces live in the solder-mask texture now, so the plate only carries the
  // things that have real height: shield cans over the noisy parts, and the
  // board-to-board connector the display flex plugs into.
  // the gap the components leave between the radios and the cell
  const can = new THREE.Mesh(BOX, M.frame);
  can.scale.set(2.0, 0.2, 0.78);
  can.position.set(0, 0.1, 1.62);
  can.castShadow = true; can.receiveShadow = true;
  boardGroup.add(can);
  for (let i = 0; i < 4; i++) {                        // stamped vent slots in the lid
    const slot = new THREE.Mesh(BOX, M.pcbDark);
    slot.scale.set(1.3, 0.02, 0.05);
    slot.position.set(0, 0.21, 1.62 + (i - 1.5) * 0.16);
    boardGroup.add(slot);
  }
  // board-to-board connector at the top edge — where the display flex plugs in
  const conn = new THREE.Mesh(BOX, M.frame);
  conn.scale.set(2.2, 0.13, 0.36);
  conn.position.set(0, 0.065, -6.64);
  conn.castShadow = true;
  boardGroup.add(conn);
  for (let i = 0; i < 20; i++) {
    const pin = new THREE.Mesh(BOX, M.gold);
    pin.scale.set(0.04, 0.04, 0.44);
    pin.position.set((i - 9.5) * 0.1, 0.055, -6.64);
    boardGroup.add(pin);
  }

  // components
  COMPONENTS.forEach((c, i) => {
    const g = new THREE.Group();
    g.position.set(c.x, 0, c.z);

    const isBig = c.id === 'batt';
    // its own marking per part — the board is too dense to tell chips apart otherwise
    const pkgMat = isBig ? M.pouch : mat({
      color: 0xFFFFFF, map: pkgTex(i * 977 + 5, c.name, c.w / c.d),
      roughness: 0.62, metalness: 0.28,
    });
    const pkg = new THREE.Mesh(BOX, pkgMat);
    const hgt = isBig ? 0.34 : 0.30 + rnd() * 0.14;
    pkg.scale.set(c.w, hgt, c.d);
    pkg.position.y = hgt / 2;
    pkg.castShadow = true; pkg.receiveShadow = true;
    g.add(pkg);

    if (!isBig) {
      // gold pins down two sides — reads as an IC at a glance
      const n = Math.max(3, Math.round(c.w * 3));
      for (let s = -1; s <= 1; s += 2)
        for (let p = 0; p < n; p++) {
          const pin = new THREE.Mesh(BOX, M.gold);
          pin.scale.set(c.w / n * 0.45, 0.05, 0.12);
          pin.position.set((p - (n - 1) / 2) * (c.w / n), 0.04, s * (c.d / 2 + 0.06));
          g.add(pin);
        }
    } else {
      const strip = new THREE.Mesh(BOX, M.copperD);
      strip.scale.set(c.w * 0.8, 0.06, 0.3);
      strip.position.set(0, hgt + 0.01, -c.d / 2 + 0.35);
      g.add(strip);
    }

    // selection halo, hidden until the hub is live — kept thin so the board reads through
    const halo = new THREE.Mesh(BOX, emissive(0x4DE0D0, 1.1));
    halo.scale.set(c.w + 0.17, 0.03, c.d + 0.17);
    halo.position.y = 0.012;
    halo.visible = false;
    g.add(halo);

    g.userData = { comp: c, idx: i, halo, pkg, hgt };
    boardGroup.add(g);
    icMeshes.push(g);
  });

  // glass screen on top — this is what dissolves during boot
  glassMesh = new THREE.Mesh(BOX, M.glass);
  glassMesh.scale.set(PHONE_W - 0.35, 0.1, PHONE_H - 0.5);
  glassMesh.position.y = 0.95;
  boardGroup.add(glassMesh);

  // home-screen icon grid painted onto the glass
  const iconMat = emissive(0x2C4756, 0.75);
  const icons = new THREE.Group();
  for (let r = 0; r < 6; r++)
    for (let c2 = 0; c2 < 4; c2++) {
      const ic = new THREE.Mesh(BOX, iconMat);
      ic.scale.set(1.05, 0.04, 1.05);
      ic.position.set((c2 - 1.5) * 1.5, 1.02, (r - 2.6) * 1.75);
      icons.add(ic);
    }
  icons.userData.mat = iconMat;
  glassMesh.userData.icons = icons;
  boardGroup.add(icons);
}

// ════════════════════════════════════════════════════════════════
//  game state
// ════════════════════════════════════════════════════════════════

let G = null;
let phase = 'boot';   // boot | board | dungeon | dead

function newGame() {
  G = {
    lv:1, xp:0, atk:5, def:0,
    bat:10, health:100, heat:0, shutdown:0,
    depth:0, floor:0, comp:null, cleared:[],
    kills:0, tiles:0,
    batBonus:0,     // CLEAN ROOM payouts, permanent
    carry:[],       // monsters that followed you down from a MIGRATION floor
    nextHeat:0,     // heat a THERMAL floor charges you on arrival
    buff:0, cd:{}, watchdog:false,
    dead:false, cause:'',
    log:[], coach:new Set(),
    map:null, targeting:null,
    pending:null,   // planned action awaiting a confirming second tap
    walking:null,   // in-progress path traversal
  };
}

const maxBat = () => Math.max(1, Math.floor(10 * G.lv * G.health / 100) + G.batBonus);
function heatState() {
  if (G.shutdown > 0) return 'shutdown';
  if (G.heat >= 90) return 'throttle';
  if (G.heat >= 70) return 'warm';
  return 'nominal';
}
const heatCost = c => heatState() === 'warm' ? Math.round(c * 1.5) : c;
function effAtk() {
  let a = G.atk;
  if (heatState() === 'throttle') a = Math.floor(a * 0.75);
  if (G.buff > 0) a = Math.floor(a * 1.5);
  return Math.max(1, a);
}

// ───────────── map generation ─────────────
function genMap(depth) {
  let wall, px, py, tries = 0;
  do {
    tries++;
    wall = Array.from({ length: H }, () => new Array(W).fill(0));
    for (let i = 0, runs = ri(5, 8); i < runs; i++) {
      const horiz = rnd() < 0.5;
      let x = ri(0, W - 1), y = ri(0, H - 1);
      for (let j = 0, len = ri(2, horiz ? 5 : 6); j < len; j++) {
        if (x >= 0 && x < W && y >= 0 && y < H) wall[y][x] = 1;
        if (horiz) x++; else y++;
        if (rnd() < 0.22) { if (horiz) y += rnd() < .5 ? 1 : -1; else x += rnd() < .5 ? 1 : -1; }
      }
    }
    for (let i = 0, pads = ri(2, 4); i < pads; i++) {
      const x = ri(0, W - 2), y = ri(0, H - 2);
      wall[y][x] = wall[y][x + 1] = wall[y + 1][x] = wall[y + 1][x + 1] = 1;
    }
    px = 4; py = H - 2;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = px + dx, y = py + dy;
      if (x >= 0 && x < W && y >= 0 && y < H) wall[y][x] = 0;
    }
  } while (reachCount(wall, px, py) < 70 && tries < 40);

  const open = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if (!wall[y][x] && dist(x, y, px, py) > 2) open.push({ x, y });

  open.sort((a, b) => dist(b.x, b.y, px, py) - dist(a.x, a.y, px, py));
  const via = open.shift();
  shuffle(open);

  const mons = [];
  // whatever you refused to kill upstairs shows up here first, at full health
  for (const c of G.carry) {
    if (!open.length) break;
    const p = open.shift();
    mons.push({ ...c, x:p.x, y:p.y, hp:c.max, halt:0, dead:false, wasHit:false, migrated:true });
  }
  const count = Math.min(11, 6 + Math.floor(depth / 2)) - mons.length;
  const base = 1 + Math.floor(depth * 0.72);
  for (let i = 0; i < count && open.length; i++) {
    const p = open.shift();
    const boss = depth % 4 === 0 && i === 0;
    const t = boss ? BOSS : pick(MONSTERS);
    const lv = Math.max(1, boss ? base + 2 : base + ri(-1, 2));
    // 8, not 11. At 11 an equal-level ZOMBIE cost exactly one full battery — that
    // is death, so clearing a floor was never on the table and every floor ended
    // the same way. At 8 four of the five types are worth meleeing and DEADLOCK
    // stays the one you answer with SURGE.
    const hp = Math.max(1, Math.round(8 * lv * t.hp));
    mons.push({ x:p.x, y:p.y, t, lv, hp, max:hp,
      atk: Math.max(1, Math.round(5 * lv * t.atk)), def: Math.round(t.def * lv),
      halt:0, dead:false, wasHit:false });
  }
  G.carry = [];

  const items = [];
  for (let i = 0, n = ri(2, 3); i < n && open.length; i++) {
    const p = open.shift();
    items.push({ x:p.x, y:p.y, t:pick(ITEMS), taken:false });
  }

  const fog = Array.from({ length: H }, () => new Array(W).fill(1));
  // the first floor of a run stays plain — one new rule at a time
  const sector = depth <= 1 ? QUIET : pick(SECTORS);
  const m = { wall, mons, items, via, fog, px, py, sector };
  revealFog(m, px, py, 1);
  return m;
}

function reachCount(wall, sx, sy) {
  const seen = Array.from({ length: H }, () => new Array(W).fill(false));
  const q = [[sx, sy]]; seen[sy][sx] = true; let n = 1;
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H || seen[ny][nx] || wall[ny][nx]) continue;
      seen[ny][nx] = true; n++; q.push([nx, ny]);
    }
  }
  return n;
}

function revealFog(m, cx, cy, r) {
  let n = 0;
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      if (m.fog[y][x] === 1) { m.fog[y][x] = 0; n++; }
      else if (m.fog[y][x] === 2) { m.fog[y][x] = 0; n++; }
    }
  return n;
}

// ════════════════════════════════════════════════════════════════
//  dungeon meshes
// ════════════════════════════════════════════════════════════════

const TILE = 1;
const FOG_H = 0.5;
const gx2w = x => (x - (W - 1) / 2) * TILE;
const gy2w = y => (y - (H - 1) / 2) * TILE;

let tileMesh = [], fogMesh = [], wallMesh = [], monObj = [], itemObj = [], viaObj = null, playerObj = null;
let pickGrid = [], pickMesh = [], ghostObjs = [];
let fogAnims = [], floaters = [];

// Taps resolve against an invisible column per cell, never against the real meshes.
// The column's top face rides on whatever that cell currently shows — bare floor,
// fog lid, copper wall, a token — because the camera is tilted: the top of a block
// draws well above its own footprint, so a grid pinned at floor level answers a tap
// on a fog lid or a wall with the cell *behind* it, always up-screen. Matching the
// silhouette keeps "what the finger covered" and "what got selected" the same cell.
const PICK_MAT = new THREE.MeshBasicMaterial({ visible: false });
const PLAYER_PICK_H = 0.95;   // the shell tops out at 0.94
const MON_PICK_H = 0.75;      // body top — the level badge above it lands on this face

function setPickTop(pk, top) {
  const h = Math.max(0.02, top);
  pk.scale.y = h;
  pk.position.y = h / 2;
}

// an invisible column standing on a cell, tagged so a hit resolves back to a token
function makePick(w, h) {
  const pk = new THREE.Mesh(BOX, PICK_MAT);
  pk.scale.set(w, h, w);
  pk.position.y = h / 2;
  return pk;
}

function clearDungeon() {
  while (dunGroup.children.length) {
    const c = dunGroup.children.pop();
    c.traverse(o => { if (o.isMesh && o.userData.own) o.geometry?.dispose?.(); });
    dunGroup.remove(c);
  }
  tileMesh = []; fogMesh = []; wallMesh = []; monObj = []; itemObj = [];
  viaObj = null; playerObj = null; pickGrid = []; pickMesh = []; ghostObjs = [];
  fogAnims = []; floaters = [];
}

// The playfield is a die, so it gets what a die has at its border: a seal ring
// keeping the moisture out, a row of bond pads, and corner alignment marks.
function buildDieEdge() {
  const HW = W / 2 + 0.6, HH = H / 2 + 0.6;

  for (const [i, r] of [[0, 0.10], [1, 0.24]].entries()) {
    const ring = new THREE.Group();
    for (const [sx, sz, lx, lz] of [
      [0, -HH + r, HW * 2, r * 2], [0, HH - r, HW * 2, r * 2],
      [-HW + r, 0, r * 2, HH * 2], [HW - r, 0, r * 2, HH * 2],
    ]) {
      const b = new THREE.Mesh(BOX, i ? M.copperD : M.copper);
      b.scale.set(lx, 0.16 + i * 0.06, lz);
      b.position.set(sx, 0.02 + i * 0.03, sz);
      ring.add(b);
    }
    dunGroup.add(ring);
  }

  // bond pads just inside the seal ring, wire-bonded out of the die
  for (let i = 0; i < 22; i++) {
    const t = (i + 0.5) / 22;
    for (const s of [-1, 1]) {
      const pad = new THREE.Mesh(BOX, M.gold);
      pad.scale.set(0.14, 0.05, 0.3);
      pad.position.set(s * (HW - 0.44), 0.05, (t - 0.5) * H * 0.98);
      dunGroup.add(pad);
    }
  }
  for (let i = 0; i < 13; i++) {
    const t = (i + 0.5) / 13;
    for (const s of [-1, 1]) {
      const pad = new THREE.Mesh(BOX, M.gold);
      pad.scale.set(0.3, 0.05, 0.14);
      pad.position.set((t - 0.5) * W * 0.98, 0.05, s * (HH - 0.44));
      dunGroup.add(pad);
    }
  }

  // corner alignment crosses — the marks a stepper lines the reticle up with
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    for (const [w2, d2] of [[0.4, 0.07], [0.07, 0.4]]) {
      const c = new THREE.Mesh(BOX, emissive(0x2E6E78, 0.5));
      c.scale.set(w2, 0.04, d2);
      c.position.set(sx * (HW - 0.95), 0.04, sz * (HH - 0.95));
      dunGroup.add(c);
    }
  }
}

function buildDungeon() {
  clearDungeon();
  const m = G.map;

  // substrate slab under everything
  const slab = new THREE.Mesh(BOX, M.pcbDark);
  slab.scale.set(W + 1.2, 0.5, H + 1.2);
  slab.position.y = -0.55;
  slab.receiveShadow = true;
  dunGroup.add(slab);

  buildDieEdge();

  for (let y = 0; y < H; y++) {
    tileMesh[y] = []; fogMesh[y] = []; wallMesh[y] = []; pickMesh[y] = [];
    for (let x = 0; x < W; x++) {
      const wx = gx2w(x), wz = gy2w(y);

      if (m.wall[y][x]) {
        // copper walls: tall enough to read as solid, short enough not to hide the row behind
        const h = 0.78 + hash(x, y) * 0.14;
        const wl = new THREE.Mesh(BOX, hash(x, y) > 0.5 ? M.copper : M.copperD);
        wl.scale.set(0.92, h, 0.92);
        wl.position.set(wx, h / 2, wz);
        wl.castShadow = true; wl.receiveShadow = true;
        wl.userData = { gx:x, gy:y };
        dunGroup.add(wl); wallMesh[y][x] = wl;
      } else {
        const fl = new THREE.Mesh(BOX, (x + y) % 2 ? M.floor : M.floorAlt);
        fl.scale.set(0.92, 0.14, 0.92);
        fl.position.set(wx, -0.07, wz);
        fl.receiveShadow = true;
        fl.userData = { gx:x, gy:y };
        dunGroup.add(fl); tileMesh[y][x] = fl;
      }

      const pk = makePick(1, 0.02);
      pk.position.x = wx; pk.position.z = wz;
      pk.userData = { gx:x, gy:y };
      dunGroup.add(pk); pickGrid.push(pk); pickMesh[y][x] = pk;

      // fog block sits above the tile and sinks away when lit
      const fg = new THREE.Mesh(BOX, M.fog);
      fg.scale.set(0.97, FOG_H, 0.97);
      fg.position.set(wx, FOG_H / 2, wz);
      // no shadows on fog: the blocks tile edge-to-edge and would shade each other
      // into a uniform black mass, destroying the "lid over the board" read
      fg.castShadow = false; fg.receiveShadow = false;
      fg.userData = { gx:x, gy:y };
      dunGroup.add(fg); fogMesh[y][x] = fg;
      fg.visible = m.fog[y][x] !== 0;
      if (m.fog[y][x] === 2) { fg.material = M.fog.clone(); fg.material.transparent = true; fg.material.opacity = 0.35; }
    }
  }

  // VIA — the way down
  const vg = new THREE.Group();
  vg.position.set(gx2w(m.via.x), 0.02, gy2w(m.via.y));
  const hole = new THREE.Mesh(CYL, new THREE.MeshStandardMaterial({ color:0x000000, roughness:1 }));
  hole.scale.set(0.62, 0.3, 0.62); hole.position.y = -0.1;
  const ring = new THREE.Mesh(TOR, emissive(0xC87137, 1.5));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.06;
  ring.userData.spin = true;
  vg.add(hole, ring);
  vg.userData = { gx:m.via.x, gy:m.via.y, ring };
  dunGroup.add(vg); viaObj = vg;

  m.mons.forEach(mo => monObj.push(makeMonster(mo)));
  m.items.forEach(it => itemObj.push(makeItem(it)));

  // player
  playerObj = new THREE.Group();
  const core = new THREE.Mesh(BOX, emissive(0x4DE0D0, 2.6));
  core.scale.set(0.52, 0.52, 0.52);
  core.castShadow = true;
  const shell = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({
    color:0x4DE0D0, emissive:0x4DE0D0, emissiveIntensity:0.5,
    transparent:true, opacity:0.24, roughness:0.2 }));
  shell.scale.set(0.78, 0.78, 0.78);
  // the token floats at y=0.55 and bobs; its own column keeps a tap on it from
  // sliding onto the tile the token is drawn in front of
  const pkP = makePick(0.86, PLAYER_PICK_H);
  pkP.position.y = PLAYER_PICK_H / 2 - 0.55;
  playerObj.add(core, shell, pkP);
  playerObj.userData = { core, shell, pick: pkP };
  dunGroup.add(playerObj);

  syncMeshes();
  placePlayer(true);
}

function makeMonster(mo) {
  const g = new THREE.Group();
  const col = mo.t.col;
  const body = new THREE.Mesh(BOX, M.chipBody);
  const em = emissive(col, 1.8);
  let top;

  switch (mo.t.shape) {
    case 'chip':
      body.scale.set(0.62, 0.3, 0.5); body.position.y = 0.28;
      top = new THREE.Mesh(BOX, em); top.scale.set(0.34, 0.07, 0.24); top.position.y = 0.46;
      for (let s = -1; s <= 1; s += 2) for (let p = -1; p <= 1; p++) {
        const pin = new THREE.Mesh(BOX, M.gold);
        pin.scale.set(0.1, 0.05, 0.1);
        pin.position.set(p * 0.2, 0.16, s * 0.3);
        g.add(pin);
      }
      break;
    case 'diamond':
      body.scale.set(0.44, 0.5, 0.44); body.position.y = 0.34; body.rotation.y = Math.PI / 4;
      top = new THREE.Mesh(BOX, em); top.scale.set(0.2, 0.2, 0.2);
      top.position.y = 0.62; top.rotation.y = Math.PI / 4;
      break;
    case 'hex': {
      const hx = new THREE.Mesh(HEXG, M.chipBody);
      hx.scale.set(0.62, 0.46, 0.62); hx.position.y = 0.23;
      g.add(hx);
      body.visible = false;
      top = new THREE.Mesh(HEXG, em); top.scale.set(0.38, 0.1, 0.38); top.position.y = 0.5;
      break;
    }
    case 'blob': {
      const sp = new THREE.Mesh(SPH, M.chipBody);
      sp.scale.set(0.58, 0.46, 0.58); sp.position.y = 0.26;
      g.add(sp); body.visible = false;
      top = new THREE.Mesh(SPH, em); top.scale.set(0.3, 0.22, 0.3); top.position.y = 0.42;
      break;
    }
    case 'boss':
      body.scale.set(0.82, 0.42, 0.82); body.position.y = 0.32;
      top = new THREE.Mesh(BOX, em); top.scale.set(0.5, 0.1, 0.5); top.position.y = 0.56;
      for (let i = -2; i <= 2; i++) {
        const fin = new THREE.Mesh(BOX, M.copperD);
        fin.scale.set(0.06, 0.3, 0.7);
        fin.position.set(i * 0.16, 0.7, 0);
        g.add(fin);
      }
      break;
  }
  body.castShadow = true;
  if (top) { top.castShadow = true; }
  g.add(body); if (top) g.add(top);

  // threat ring on the floor — the primary "something lives here" signal
  const ring = new THREE.Mesh(TOR, emissive(col, 2.4));
  ring.rotation.x = Math.PI / 2;
  ring.scale.set(1.42, 1.42, 1.42);
  ring.position.y = 0.04;
  g.add(ring);

  const spr = new THREE.Sprite(numSprite(mo.lv, '#FFFFFF'));
  spr.scale.set(0.62, 0.62, 1);
  spr.position.y = 1.0;
  g.add(spr);

  // hp pip bar
  const bar = new THREE.Mesh(BOX, emissive(0x6BD98A, 2.0));
  bar.scale.set(0.66, 0.06, 0.09);
  bar.position.y = 0.8;
  g.add(bar);

  // column matching the chip's silhouette, so a tap on the body or the level
  // badge above it hits the monster's own cell instead of the row behind
  const pk = makePick(0.9, MON_PICK_H);
  g.add(pk);

  g.position.set(gx2w(mo.x), 0, gy2w(mo.y));
  g.userData = { gx:mo.x, gy:mo.y, mo, em, ring, spr, bar, top, pick: pk };
  dunGroup.add(g);
  return g;
}

function makeItem(it) {
  const g = new THREE.Group();
  const em = emissive(it.t.col, 1.6);
  let body;
  if (it.t.kind === 'INSTALL') {          // resistor
    body = new THREE.Mesh(CYL, em);
    body.scale.set(0.16, 0.44, 0.16);
    body.rotation.z = Math.PI / 2;
    body.position.y = 0.26;
  } else if (it.t.kind === 'EXEC') {      // capacitor
    body = new THREE.Mesh(CYL, em);
    body.scale.set(0.3, 0.46, 0.3);
    body.position.y = 0.3;
  } else {                                 // small IC
    body = new THREE.Mesh(BOX, em);
    body.scale.set(0.36, 0.18, 0.36);
    body.position.y = 0.22;
  }
  body.castShadow = true;
  const ring = new THREE.Mesh(TOR, emissive(it.t.col, 1.0));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.03; ring.scale.set(1.1, 1.1, 1.1);
  g.add(body, ring);
  g.position.set(gx2w(it.x), 0, gy2w(it.y));
  g.userData = { gx:it.x, gy:it.y, it, body };
  dunGroup.add(g);
  return g;
}

function placePlayer(instant) {
  const m = G.map;
  const tx = gx2w(m.px), tz = gy2w(m.py);
  if (instant) playerObj.position.set(tx, 0.55, tz);
  else playerObj.userData.target = new THREE.Vector3(tx, 0.55, tz);
  playerLight.position.set(tx, DUNGEON_Y + 2.2, tz);
}

function syncMeshes() {
  const m = G.map;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const f = m.fog[y][x], fg = fogMesh[y][x];
    // an unlit tile shows nothing but the fog lid — no peeking at walls behind it
    if (wallMesh[y][x]) wallMesh[y][x].visible = f !== 1;
    if (tileMesh[y][x]) tileMesh[y][x].visible = f !== 1;

    // raise the pick column to whatever surface this cell now presents
    if (pickMesh[y][x]) {
      const wl = wallMesh[y][x];
      let top = 0.02;                                        // bare floor
      if (f === 1) top = FOG_H;                              // the lid hides everything
      else {
        if (f === 2) top = FOG_H * 0.45;                     // dimmed lid, half sunk
        if (wl) top = Math.max(top, wl.scale.y);
      }
      setPickTop(pickMesh[y][x], top);
    }

    if (!fg) continue;
    if (f === 0 && fg.visible && !fg.userData.sinking) {
      fg.userData.sinking = true;
      fogAnims.push({ mesh: fg, t: 0 });
    } else if (f === 2 && fg.visible) {
      if (fg.material === M.fog) { fg.material = M.fog.clone(); fg.material.transparent = true; }
      fg.material.opacity = 0.32;
      fg.scale.y = FOG_H * 0.45; fg.position.y = FOG_H * 0.225;
    }
  }
  monObj.forEach(g => {
    const mo = g.userData.mo;
    g.visible = !mo.dead && m.fog[mo.y][mo.x] !== 1;
    if (!g.visible) return;
    const danger = mo.lv > G.lv;
    const c = danger ? 0xFF4D5E : mo.t.col;
    g.userData.em.emissive.setHex(c);
    g.userData.ring.material.emissive.setHex(c);
    g.userData.ring.material.color.setHex(c);
    g.userData.spr.material = numSprite(mo.lv, danger ? '#FF8A94' : '#DCE6EE');
    const r = Math.max(0.02, mo.hp / mo.max);
    g.userData.bar.scale.x = 0.62 * r;
    g.userData.bar.material.emissive.setHex(r > 0.5 ? 0x6BD98A : r > 0.25 ? 0xFFB454 : 0xFF4D5E);
  });
  itemObj.forEach(g => { g.visible = !g.userData.it.taken && m.fog[g.userData.it.y][g.userData.it.x] !== 1; });
  if (viaObj) {
    viaObj.visible = m.fog[m.via.y][m.via.x] !== 1;
    // a sealed VIA glows red — the state has to be readable from the board, not
    // just the HUD, because the whole floor is planned around whether it is open
    const sealed = viaLocked();
    viaObj.userData.ring.material.emissive.setHex(sealed ? 0xFF4D5E : 0xC87137);
    viaObj.userData.ring.material.color.setHex(sealed ? 0xFF4D5E : 0xC87137);
  }
}

// ════════════════════════════════════════════════════════════════
//  rules
// ════════════════════════════════════════════════════════════════

function enterComponent(comp) {
  G.comp = comp;
  G.floor = 0;
  nextFloor(true);
}

// what leaving this floor costs right now, and why — the same numbers the
// inspector previews before you commit to stepping on the VIA
function exitQuote() {
  const m = G.map;
  const left = m.mons.filter(o => !o.dead).length;
  const s = m.sector;
  const locked = viaLocked();
  // A wiped floor costs nothing and hands the battery back: clearing has to be
  // worth the fog and battery it burns, or "run for the VIA" wins every time.
  let loss = left === 0 ? 0 : Math.min(10, 2 + left);
  if (s.id === 'leak') loss += left;
  // a sealed VIA can always be forced — a floor you cannot clear must never be
  // a floor you cannot leave, or the run just stops instead of ending
  if (locked) loss += 10;
  return { left, cleared: left === 0, loss: Math.min(24, loss), sector: s, locked };
}

// charge the toll and settle the floor's contract
function payExit() {
  const q = exitQuote(), s = q.sector, m = G.map;
  G.health = Math.max(10, G.health - q.loss);

  const notes = [];
  if (q.cleared) {
    G.heat = 0; G.shutdown = 0;                    // a cleared core runs cool
    G.bat = maxBat();
    notes.push('전멸 — <b class="g">완충 · 열 0 · 수명 유지</b>');
    if (s.id === 'clean') { G.batBonus++; notes.push('<b class="c">배터리 최대치 +1</b>'); }
    if (s.id === 'salvage') G.salvage = pick(ITEMS);
  } else {
    if (s.id === 'thermal') {
      G.nextHeat = q.left * 9;
      notes.push(`<b class="r">다음 층 시작 열 +${G.nextHeat}</b>`);
    }
    if (s.id === 'leak') notes.push(`<b class="r">누설 −${q.left}%</b>`);
    if (s.id === 'migrate') {
      G.carry = m.mons.filter(o => !o.dead).slice(0, 3)
        .map(o => ({ t:o.t, lv:o.lv, max:o.max, atk:o.atk, def:o.def }));
      notes.push(`<b class="r">${G.carry.length}기가 따라온다</b>`);
    }
  }
  G.bat = Math.min(G.bat, maxBat());
  say(`VIA 통과 — 잔존 <b class="${q.left ? 'a' : 'g'}">${q.left}</b>기 · ` +
      `<b class="${q.loss > 4 ? 'r' : 'a'}">HEALTH −${q.loss}%</b>` +
      (notes.length ? ' · ' + notes.join(' · ') : ''));
}

function nextFloor(first) {
  if (!first) payExit();
  G.floor++; G.depth++;
  G.pending = null; G.walking = null; G.targeting = null;
  G.map = genMap(G.depth);
  buildDungeon();
  if (G.nextHeat) { addHeat(G.nextHeat); G.nextHeat = 0; }
  if (G.salvage) { applyItem(G.salvage); G.salvage = null; }
  say(`<b class="${G.map.sector.col}">${G.map.sector.name}</b> — ${G.map.sector.rule}`);
  sync();
}

function gainFromFog(n) {
  if (n <= 0) return;
  const before = G.bat;
  G.bat = Math.min(maxBat(), G.bat + n * G.lv);
  G.heat = Math.max(0, G.heat - n * 2);
  const got = G.bat - before;
  if (got > 0) floatText(G.map.px, G.map.py, '+' + got, '#4DE0D0');
  coach('fog');
}

function tickTurn() {
  if (G.buff > 0) G.buff--;
  for (const k in G.cd) if (G.cd[k] > 0) G.cd[k]--;
  for (const m of G.map.mons) if (m.halt > 0) m.halt--;
  if (G.shutdown > 0 && --G.shutdown === 0) {
    G.heat = Math.min(G.heat, 88);
    say('<b class="g">복구 완료</b> — 시스템 재가동');
  }
}

function addHeat(v) {
  G.heat = Math.min(100, G.heat + v);
  if (G.heat >= 100 && G.shutdown === 0) {
    G.shutdown = 3;
    say('<b class="r">THERMAL SHUTDOWN</b> — 3턴간 공격·스킬 불가');
    shake(0.5);
  }
}

function moveTo(x, y) {
  const m = G.map;
  m.px = x; m.py = y;
  G.tiles++;
  gainFromFog(revealFog(m, x, y, 1));
  tickTurn();
  placePlayer(false);
  syncMeshes();
  stepOn(x, y);
}

function stepOn(x, y) {
  const m = G.map;
  const it = m.items.find(i => !i.taken && i.x === x && i.y === y);
  if (it) { it.taken = true; applyItem(it.t); syncMeshes(); }
  if (m.via.x === x && m.via.y === y) {
    if (m.mons.some(o => !o.dead && dist(o.x, o.y, x, y) <= 1)) {
      say('교전 중에는 VIA를 통과할 수 없다');
    } else if (viaLocked()) {
      showExitInspect();
      say(`<b class="r">BAD BLOCK</b> — 봉인됐다. ${killsNeeded()}기를 더 처치하거나, ` +
          `발밑을 <b class="a">한 번 더 탭</b>해 강제로 뚫어라`);
    } else {
      descend();
    }
  }
}

function descend() {
  if (G.floor >= G.comp.floors) completeComponent();
  else nextFloor(false);
}

// BAD BLOCK floors seal the exit until half the sector is cleared
const killsNeeded = () => {
  const m = G.map;
  return Math.max(0, Math.ceil(m.mons.length / 2) - m.mons.filter(o => o.dead).length);
};
const viaLocked = () => G.map.sector.id === 'lock' && killsNeeded() > 0;

function applyItem(t) {
  switch (t.id) {
    case 'atk': G.atk += 2; say(`<b class="g">${t.name}</b> — ATK +2`); break;
    case 'def': G.def += 1; say(`<b class="g">${t.name}</b> — DEF +1`); break;
    case 'full': G.bat = maxBat(); floatText(G.map.px, G.map.py, 'FULL', '#FFB454'); say(`<b class="a">${t.name}</b> — 배터리 완충`); break;
    case 'cool': G.heat = 0; G.shutdown = 0; say(`<b class="a">${t.name}</b> — 열 전량 방출`); break;
    case 'patch': G.watchdog = true; say(`<b class="c">${t.name}</b> 상주 — 치명 시 1회 복구`); break;
    case 'nova': {
      const dmg = 12 * G.lv; let n = 0;
      for (const mo of G.map.mons) {
        if (mo.dead || dist(mo.x, mo.y, G.map.px, G.map.py) > 1) continue;
        hurt(mo, dmg); n++;
      }
      say(`<b class="a">${t.name}</b> — 인접 ${n}기에 ${dmg} 피해`);
      shake(0.4);
      break;
    }
  }
}

function hurt(mo, dmg) {
  mo.hp -= dmg;
  floatText(mo.x, mo.y, '-' + dmg, '#FF9AA4');
  const g = monObj.find(o => o.userData.mo === mo);
  if (g) g.userData.flash = 1;
  if (mo.hp <= 0) {
    mo.dead = true; G.kills++;
    G.xp += xpFor(mo.lv);
    checkLevel();
  }
}

function xpFor(l) {
  const d = l - G.lv;
  return d <= -2 ? 0 : d === -1 ? 1 : d === 0 ? 2 : d === 1 ? 4 : d === 2 ? 7 : 11;
}

function checkLevel() {
  let need = XP_TABLE[G.lv - 1] ?? 9999;
  while (G.xp >= need && G.lv < 12) {
    G.xp -= need; G.lv++; G.atk += 5;
    G.bat = maxBat(); G.heat = 0; G.shutdown = 0;   // the signature move
    say(`<b class="c">LEVEL ${G.lv}</b> — 최적화 완료. 배터리 완충, 열 0`);
    floatText(G.map.px, G.map.py, 'LV' + G.lv, '#4DE0D0');
    need = XP_TABLE[G.lv - 1] ?? 9999;
  }
}

function attack(mo) {
  if (G.shutdown > 0) { say('셧다운 중 — 이동해서 <b class="c">냉각</b>하라'); return; }
  const my = Math.max(1, effAtk() - mo.def);
  if (mo.t.ambush && !mo.wasHit) { takeHit(mo, '기습'); if (G.dead) return; }
  mo.wasHit = true;
  hurt(mo, my);
  if (G.buff > 0) G.buff = 0;
  if (!mo.dead) {
    if (mo.halt > 0) say(`${mo.t.name} 정지 중 — 반격 없음`);
    else {
      takeHit(mo, '');
      if (mo.t.id === 'adware') { addHeat(8); say('<b class="a">ADWARE</b> — 교전 발열 +8'); }
    }
  } else say(`<b class="c">${mo.t.name} Lv${mo.lv}</b> 처치 — XP +${xpFor(mo.lv)}`);
  tickTurn();
  syncMeshes();
  coach('skill');
}

function takeHit(mo, tag) {
  const dmg = Math.max(1, mo.atk - G.def);
  G.bat -= dmg;
  floatText(G.map.px, G.map.py, '-' + dmg, '#FF4D5E');
  shake(Math.min(0.6, 0.15 + dmg / 90));
  if (tag) say(`<b class="r">${tag}</b> — ${mo.t.name}에게 ${dmg} 피해`);
  if (G.bat <= 0) {
    if (G.watchdog) {
      G.watchdog = false;
      G.bat = Math.floor(maxBat() * 0.4);
      say('<b class="c">WATCHDOG</b> 발동 — 강제 복구');
      floatText(G.map.px, G.map.py, 'RESET', '#4DE0D0');
    } else {
      G.bat = 0; G.dead = true;
      G.cause = `${mo.t.name} (lv${mo.lv})`;
      showDead();
    }
  }
}

// NOTE: there is deliberately no "attack of opportunity". Monsters are static and
// only ever strike back when the player explicitly attacks them. Walking past a
// monster is free — that is what makes "leave the dangerous one, go clear fog"
// a real strategy, and it is how Desktop Dungeons works.

// 8-way A* over LIT tiles only: the player cannot route through fog they have not
// seen. Item and VIA tiles are avoided unless they ARE the destination, because
// stepping on one fires it immediately (§6.5).
const DIRS8 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];

function findPath(sx, sy, tx, ty) {
  const m = G.map;
  const goal = ty * W + tx;

  const passable = (x, y, isGoal) => {
    if (x < 0 || x >= W || y < 0 || y >= H) return false;
    if (m.wall[y][x]) return false;
    if (m.fog[y][x] === 1 && !isGoal) return false;   // fog is only ever a final step
    if (monAt(x, y) && !isGoal) return false;
    if (!isGoal) {
      if (m.items.some(i => !i.taken && i.x === x && i.y === y)) return false;
      if (m.via.x === x && m.via.y === y) return false;
    }
    return true;
  };
  if (!passable(tx, ty, true)) return null;

  const gS = new Map([[sy * W + sx, 0]]);
  const came = new Map();
  const open = [{ x:sx, y:sy, f:0 }];
  const closed = new Set();
  const h = (x, y) => Math.max(Math.abs(x - tx), Math.abs(y - ty));

  while (open.length) {
    open.sort((a, b) => a.f - b.f);
    const cur = open.shift();
    const ck = cur.y * W + cur.x;
    if (closed.has(ck)) continue;
    closed.add(ck);

    if (ck === goal) {
      const path = [];
      let k = ck;
      while (came.has(k)) { path.push({ x: k % W, y: (k / W) | 0 }); k = came.get(k); }
      return path.reverse();
    }

    for (const [dx, dy] of DIRS8) {
      const nx = cur.x + dx, ny = cur.y + dy, nk = ny * W + nx;
      if (closed.has(nk)) continue;
      if (!passable(nx, ny, nk === goal)) continue;
      // no slipping diagonally between two walls
      if (dx && dy && (m.wall[cur.y]?.[nx] || m.wall[ny]?.[cur.x])) continue;
      const ng = gS.get(ck) + (dx && dy ? 1.414 : 1);
      if (ng < (gS.get(nk) ?? Infinity)) {
        gS.set(nk, ng); came.set(nk, ck);
        open.push({ x:nx, y:ny, f: ng + h(nx, ny) });
      }
    }
  }
  return null;
}

// closest walkable tile next to a target, measured by actual path length
function approachTile(tx, ty) {
  const m = G.map;
  let best = null, bestLen = Infinity;
  for (const [dx, dy] of DIRS8) {
    const x = tx + dx, y = ty + dy;
    if (x < 0 || x >= W || y < 0 || y >= H) continue;
    if (m.wall[y][x] || m.fog[y][x] === 1 || monAt(x, y)) continue;
    if (x === m.px && y === m.py) return { x, y, path: [] };
    const p = findPath(m.px, m.py, x, y);
    if (p && p.length < bestLen) { best = { x, y, path: p }; bestLen = p.length; }
  }
  return best;
}

// ───────────── skills ─────────────
function skillBlock(s) {
  if (G.shutdown > 0) return '셧다운';
  if (heatState() === 'throttle') return '과열';
  if ((G.cd[s.id] || 0) > 0) return `쿨 ${G.cd[s.id]}`;
  if (G.heat + heatCost(s.heat) > 100) return '열 초과';
  return null;
}

function useSkill(s, arg) {
  const bad = skillBlock(s);
  if (bad) { say(`${s.name} 사용 불가 — ${bad}`); return; }
  const cost = heatCost(s.heat);
  const m = G.map;

  switch (s.id) {
    case 'tap':
      G.buff = 2; say('<b class="c">TAP</b> — 다음 공격 ×1.5'); break;
    case 'purge': {
      const h = Math.floor(maxBat() * 0.25);
      G.bat = Math.min(maxBat(), G.bat + h);
      floatText(m.px, m.py, '+' + h, '#4DE0D0');
      say(`<b class="c">PURGE</b> — 배터리 +${h}`); break;
    }
    case 'scan':
      for (let y = m.py - 3; y <= m.py + 3; y++)
        for (let x = m.px - 3; x <= m.px + 3; x++)
          if (x >= 0 && x < W && y >= 0 && y < H && m.fog[y][x] === 1) m.fog[y][x] = 2;
      say('<b class="c">SCAN</b> — 반경 3 정찰 (회복 없음)');
      break;
    case 'surge': {
      const [dx, dy] = arg;
      const dmg = Math.max(1, Math.floor(effAtk() * 1.2));
      let n = 0;
      for (let i = 1; i <= 3; i++) {
        const x = m.px + dx * i, y = m.py + dy * i;
        if (x < 0 || x >= W || y < 0 || y >= H || m.wall[y][x]) break;
        const mo = m.mons.find(o => !o.dead && o.x === x && o.y === y);
        if (mo) { hurt(mo, dmg); n++; }
        boltAt(x, y);
      }
      say(n ? `<b class="c">SURGE</b> — ${n}기에 ${dmg} 관통` : '<b class="c">SURGE</b> — 빗나감');
      shake(0.3);
      break;
    }
  }
  addHeat(cost);
  if (s.cd) G.cd[s.id] = s.cd + 1;
  tickTurn();
  syncMeshes();
}

// ════════════════════════════════════════════════════════════════
//  feedback
// ════════════════════════════════════════════════════════════════

const logEl = document.getElementById('log');
function say(html) {
  G.log.push(html);
  if (G.log.length > 20) G.log.shift();
  const last = G.log.slice(-2);
  logEl.innerHTML = last.map((l, i) => `<div class="${i === last.length - 1 ? 'fresh' : ''}">› ${l}</div>`).join('');
}

let shakeAmt = 0;
function shake(v) { if (!REDUCED) shakeAmt = Math.max(shakeAmt, v); }

function floatText(gx, gy, text, color) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.font = '700 40px ui-monospace, Menlo, monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 7; g.strokeStyle = '#05070A';
  g.strokeText(text, 64, 34); g.fillStyle = color; g.fillText(text, 64, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map:t, depthTest:false, transparent:true }));
  sp.scale.set(1.5, 0.75, 1);
  sp.position.set(gx2w(gx), 1.2, gy2w(gy));
  dunGroup.add(sp);
  floaters.push({ sp, t:0 });
}

// ── ghost preview for a planned action ──

function clearGhost() {
  for (const o of ghostObjs) { dunGroup.remove(o); o.material?.dispose?.(); }
  ghostObjs = [];
}

function ghostMark(x, y, color, size, h) {
  const mk = new THREE.Mesh(BOX, emissive(color, 2.2));
  mk.material.transparent = true;
  mk.material.opacity = 0.85;
  mk.scale.set(size, 0.05, size);
  mk.position.set(gx2w(x), h ?? 0.1, gy2w(y));
  dunGroup.add(mk); ghostObjs.push(mk);
  return mk;
}

function drawGhost() {
  clearGhost();
  const p = G.pending;
  if (!p) return;
  const atk = p.kind === 'attack';
  // stepping stones along the route
  p.path.forEach((s, i) => {
    const last = i === p.path.length - 1;
    ghostMark(s.x, s.y, 0x4DE0D0, last && !atk ? 0.5 : 0.26);
  });
  // destination ring — red when it ends in a fight
  const ring = new THREE.Mesh(TOR, emissive(atk ? 0xFF4D5E : 0x4DE0D0, 3.0));
  ring.rotation.x = Math.PI / 2;
  ring.scale.set(1.5, 1.5, 1.5);
  ring.position.set(gx2w(p.x), 0.12, gy2w(p.y));
  ring.userData.pulse = true;
  dunGroup.add(ring); ghostObjs.push(ring);
}

function drawSurgeGhost(dx, dy) {
  clearGhost();
  const m = G.map;
  for (let i = 1; i <= 3; i++) {
    const x = m.px + dx * i, y = m.py + dy * i;
    if (x < 0 || x >= W || y < 0 || y >= H || m.wall[y][x]) break;
    ghostMark(x, y, 0xFFB454, 0.7, 0.14);
  }
}

function boltAt(x, y) {
  const b = new THREE.Mesh(BOX, emissive(0x9FF0E6, 2.2));
  b.scale.set(0.5, 0.5, 0.5);
  b.position.set(gx2w(x), 0.5, gy2w(y));
  dunGroup.add(b);
  floaters.push({ sp:b, t:0, spin:true });
}

// ════════════════════════════════════════════════════════════════
//  camera
// ════════════════════════════════════════════════════════════════

function applyCamera() {
  const t = CAM.tilt * RAD, y = CAM.yaw * RAD;
  cam.position.set(
    CAM.focus.x + CAM.dist * Math.sin(t) * Math.sin(y),
    CAM.focus.y + CAM.dist * Math.cos(t),
    CAM.focus.z + CAM.dist * Math.sin(t) * Math.cos(y)
  );
  cam.lookAt(CAM.focus);
  key.target.position.copy(CAM.focus);
  key.position.set(CAM.focus.x + 6, CAM.focus.y + 16, CAM.focus.z + 8);
}

let viewSpan = 15;
let sizedW = 0, sizedH = 0, sizedDpr = 0;
function resize() {
  const w = innerWidth, h = innerHeight, dpr = Math.min(2, devicePixelRatio);
  // reallocating the drawing buffer flickers, and visualViewport fires on every
  // URL-bar frame — only resize when the box actually changed
  if (w !== sizedW || h !== sizedH || dpr !== sizedDpr) {
    sizedW = w; sizedH = h; sizedDpr = dpr;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h);
  }
  const aspect = w / h;
  // fit the play area, leaving vertical room for the HUD band and the log band
  const inDun = phase === 'dungeon' || phase === 'zoom';
  const needW = inDun ? W + 2.2 : PHONE_W + 2.4;
  const needH = (inDun ? H + 1.5 : PHONE_H + 1.2) * Math.cos(CAM.tilt * RAD)
              + (inDun ? 6.0 : 3.2);
  let fw, fh;
  if (aspect < needW / needH) { fw = needW; fh = needW / aspect; }
  else { fh = needH; fw = needH * aspect; }
  viewSpan = fh;
  cam.left = -fw / 2; cam.right = fw / 2;
  cam.top = fh / 2; cam.bottom = -fh / 2;
  cam.updateProjectionMatrix();
}

// ════════════════════════════════════════════════════════════════
//  input
// ════════════════════════════════════════════════════════════════

const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
let press = null, longTimer = null;

// Aim at the canvas box, not at the window. On a phone the visual viewport and the
// laid-out canvas drift apart while the URL bar slides, and every pixel of drift is
// a pixel the tap lands off — vertically, since that is the axis that moves.
function aim(ev) {
  const r = canvas.getBoundingClientRect();
  ptr.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  ptr.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  ray.setFromCamera(ptr, cam);
}

// nearest column wins, exactly as the nearest surface wins on screen
const pickTargets = () => {
  const t = pickGrid.slice();
  if (playerObj) t.push(playerObj.userData.pick);
  for (const g of monObj) if (g.visible) t.push(g.userData.pick);
  return t;
};

function pickTile(ev) {
  aim(ev);
  const hits = ray.intersectObjects(pickTargets(), false);
  if (!hits.length) return null;
  const o = hits[0].object, u = o.userData;
  if (u.gx !== undefined) return { x:u.gx, y:u.gy };          // a cell column
  const g = o.parent;                                          // a token column
  if (g === playerObj) return { x:G.map.px, y:G.map.py };
  const mo = g.userData.mo;
  return { x:mo.x, y:mo.y };
}

function pickComponent(ev) {
  aim(ev);
  for (const g of icMeshes) {
    const hits = ray.intersectObject(g, true);
    if (hits.length) return g;
  }
  return null;
}

canvas.addEventListener('pointerdown', ev => {
  if (phase === 'board') { const g = pickComponent(ev); if (g) selectComponent(g); return; }
  if (phase !== 'dungeon' || G.dead) return;
  const t = pickTile(ev);
  press = { t, x:ev.clientX, y:ev.clientY };
});

// hover only previews when nothing is planned — a pending plan owns the inspector
canvas.addEventListener('pointermove', ev => {
  if (phase !== 'dungeon' || press || !G || G.pending || G.walking || G.dead) return;
  const t = pickTile(ev);
  const mo = t && G.map.fog[t.y][t.x] !== 1 ? monAt(t.x, t.y) : null;
  if (mo) showInspect(mo); else hideInspect();
});

addEventListener('pointerup', ev => {
  clearTimeout(longTimer);
  if (!press) return;
  const p = press; press = null;
  if (phase !== 'dungeon' || G.dead) return;
  if (Math.abs(ev.clientX - p.x) > 14 || Math.abs(ev.clientY - p.y) > 14) return;
  if (p.t) tapTile(p.t.x, p.t.y);
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

const monAt = (x, y) => G.map.mons.find(m => !m.dead && m.x === x && m.y === y);

// ── two-step commit: first tap plans and shows a ghost, second tap executes ──

function clearPending() {
  G.pending = null;
  clearGhost();
  hideInspect();
}

function tapTile(x, y) {
  const m = G.map;
  if (G.walking) return;                      // ignore input mid-traversal

  // directional skill targeting runs through the same confirm flow
  if (G.targeting) {
    const dx = Math.sign(x - m.px), dy = Math.sign(y - m.py);
    const straight = (dx === 0) !== (dy === 0);
    if (!straight || dist(x, y, m.px, m.py) > 3) {
      G.targeting = null; clearGhost(); say('대상 취소'); sync(); return;
    }
    if (G.targeting.dir && G.targeting.dir[0] === dx && G.targeting.dir[1] === dy) {
      const s = SKILLS.find(k => k.id === G.targeting.skill);
      G.targeting = null; clearGhost();
      useSkill(s, [dx, dy]); sync(); return;
    }
    G.targeting.dir = [dx, dy];
    drawSurgeGhost(dx, dy);
    say('한 번 더 탭하면 <b class="c">발동</b>');
    return;
  }

  if (x === m.px && y === m.py) {
    clearPending();
    // standing on a sealed VIA, your own tile becomes the "force it" button
    if (m.via.x === x && m.via.y === y && viaLocked()) {
      if (G.forcing) { G.forcing = false; descend(); return; }
      G.forcing = true;
      showExitInspect();
      say(`한 번 더 탭하면 봉인을 <b class="r">강제로 뚫는다</b> — ${exitQuote().loss}%를 지불한다`);
      return;
    }
    G.forcing = false;
    say(`LV${G.lv} · ATK ${effAtk()} · 배터리 ${G.bat}/${maxBat()} — 스킬은 <b class="c">아래 슬롯</b>`);
    coach('skill');
    return;
  }
  G.forcing = false;

  // second tap on the same target = confirm
  if (G.pending && G.pending.x === x && G.pending.y === y) { commitPending(); return; }

  planTo(x, y);
}

function planTo(x, y) {
  const m = G.map;
  clearGhost();
  const lit = m.fog[y][x] !== 1;

  if (lit && m.wall[y][x]) { G.pending = null; say('구리 벽 — 지나갈 수 없다'); return; }

  const mo = lit ? monAt(x, y) : null;
  if (mo) {
    const app = dist(x, y, m.px, m.py) === 1
      ? { x:m.px, y:m.py, path: [] }
      : approachTile(x, y);
    if (!app) { G.pending = null; say('접근할 수 없다'); return; }
    G.pending = { kind:'attack', x, y, mon:mo, path:app.path };
    showInspect(mo);
    say(app.path.length
      ? `${app.path.length}칸 이동 후 <b class="r">교전</b> — 한 번 더 탭하면 실행`
      : '한 번 더 탭하면 <b class="r">교전</b>');
  } else {
    const path = findPath(m.px, m.py, x, y);
    if (!path || !path.length) {
      G.pending = null;
      // distinguish "no route" from "you haven't seen a route yet"
      say(m.fog[y][x] === 1
        ? '아직 안개 너머라 <b class="a">길을 모른다</b> — 안개를 먼저 걷어라'
        : '경로가 막혀 있다');
      return;
    }
    G.pending = { kind:'move', x, y, path };
    const onVia = m.via.x === x && m.via.y === y;
    if (onVia) showExitInspect(); else hideInspect();
    const it = m.items.find(i => !i.taken && i.x === x && i.y === y);
    say(it ? `${path.length}칸 이동 — <b class="a">${it.t.name}</b>을 밟는다. 한 번 더 탭`
           : onVia
             ? `${path.length}칸 이동 — <b class="a">VIA로 하강</b>한다. 한 번 더 탭`
             : `${path.length}칸 이동 — 한 번 더 탭하면 실행`);
  }
  drawGhost();
  coach('confirm');
}

function commitPending() {
  const p = G.pending;
  if (!p) return;
  clearGhost();
  G.pending = null;
  hideInspect();
  if (p.path.length) {
    G.walking = { path: p.path, i: 0, t: 0, then: p.kind === 'attack' ? p.mon : null };
  } else if (p.kind === 'attack') {
    attack(p.mon); sync();
  }
  coach('move');
}

// advance one tile per tick; stop early if something new shows up
function stepWalk(dt) {
  const wk = G.walking;
  if (!wk) return;
  wk.t += dt;
  if (wk.t < 0.1) return;
  wk.t = 0;

  const mapRef = G.map;
  const before = mapRef.mons.filter(o => !o.dead && mapRef.fog[o.y][o.x] !== 1).length;
  const s = wk.path[wk.i++];
  moveTo(s.x, s.y);
  sync();

  if (G.dead) { G.walking = null; return; }
  // moveTo can swap the map out (VIA / floor change) — abandon the stale path
  if (G.map !== mapRef) { G.walking = null; return; }

  const after = G.map.mons.filter(o => !o.dead && G.map.fog[o.y][o.x] !== 1).length;
  if (wk.i >= wk.path.length) {
    const mon = wk.then;
    G.walking = null;
    if (mon && !mon.dead) { attack(mon); sync(); }
  } else if (after > before) {
    G.walking = null;
    say('새로운 적을 발견해 <b class="a">멈췄다</b>');
  }
}

addEventListener('keydown', e => {
  if (phase !== 'dungeon' || !G || G.dead) return;
  const k = { ArrowUp:[0,-1], ArrowDown:[0,1], ArrowLeft:[-1,0], ArrowRight:[1,0],
              w:[0,-1], s:[0,1], a:[-1,0], d:[1,0] }[e.key];
  if (k) { e.preventDefault(); tapTile(G.map.px + k[0], G.map.py + k[1]); }
  // 1..4 fire the dock slots directly, same as tapping them
  const n = '1234'.indexOf(e.key);
  if (n >= 0 && SKILLS[n]) { e.preventDefault(); fireSkill(SKILLS[n]); }
});

// ════════════════════════════════════════════════════════════════
//  skill dock — one slot per skill, always on screen, fires on tap
// ════════════════════════════════════════════════════════════════

// Every other action in this game asks for a confirming second tap. Skills do not:
// the slot itself is the confirmation, because it carries the cost and the cooldown
// on its face. Press-and-hold reads the long description instead of firing.
const dockEl = document.getElementById('skills');
const slotEls = new Map();

function buildDock() {
  dockEl.innerHTML = '';
  slotEls.clear();
  for (const s of SKILLS) {
    const el = document.createElement('div');
    el.className = 'sk';
    el.innerHTML = `<span class="nm">${s.name}</span>` +
                   `<span class="ef">${s.desc}</span>` +
                   `<span class="cost"></span>`;
    let held = false, timer = null;
    el.addEventListener('pointerdown', ev => {
      ev.preventDefault(); ev.stopPropagation();
      held = false;
      timer = setTimeout(() => { held = true; showSkillDetail(s); }, 420);
    });
    el.addEventListener('pointerup', ev => {
      ev.preventDefault(); ev.stopPropagation();
      clearTimeout(timer);
      if (!held) fireSkill(s);
    });
    el.addEventListener('pointerleave', () => clearTimeout(timer));
    el.addEventListener('contextmenu', ev => ev.preventDefault());
    dockEl.appendChild(el);
    slotEls.set(s.id, el);
  }
}

function syncDock() {
  const live = phase === 'dungeon' && G && !G.dead;
  dockEl.classList.toggle('on', !!live);
  logEl.classList.toggle('docked', !!live);
  if (!live) return;
  for (const s of SKILLS) {
    const el = slotEls.get(s.id);
    const bad = skillBlock(s);
    const cd = G.cd[s.id] || 0;
    const armed = G.targeting && G.targeting.skill === s.id;
    el.className = 'sk' + (armed ? ' armed' : bad ? ' off' : ' ready');
    el.querySelector('.cost').textContent =
      armed ? '방향 선택' : bad && !cd ? bad : '열 +' + heatCost(s.heat);
    let veil = el.querySelector('.cd');
    if (cd > 0) {
      if (!veil) { veil = document.createElement('span'); veil.className = 'cd'; el.appendChild(veil); }
      veil.textContent = cd;
      veil.style.setProperty('--f', Math.round(100 * cd / (s.cd + 1)) + '%');
    } else if (veil) veil.remove();
  }
}

function showSkillDetail(s) {
  const bad = skillBlock(s);
  insEl.className = 'on';
  insEl.innerHTML =
    `<span class="nm">${s.name}</span> <span class="dt">열 +${heatCost(s.heat)}` +
    (heatState() === 'warm' ? ' <b class="r">(과열 1.5배)</b>' : '') +
    (s.cd ? ` · 쿨 ${s.cd}턴` : '') + `</span><br>` +
    `<span class="dt">${s.long}</span>` +
    (bad ? `<br><b class="r">사용 불가 — ${bad}</b>` : '');
  clearTimeout(detailTimer);
  detailTimer = setTimeout(hideInspect, 4200);
}
let detailTimer = null;

function fireSkill(s) {
  if (phase !== 'dungeon' || !G || G.dead || G.walking) return;
  // tapping the armed slot again backs out of targeting
  if (G.targeting && G.targeting.skill === s.id) {
    G.targeting = null; clearGhost(); say('대상 취소'); sync(); return;
  }
  const bad = skillBlock(s);
  if (bad) { say(`${s.name} 사용 불가 — ${bad}`); return; }
  clearPending();
  if (s.target === 'dir') {
    G.targeting = { skill: s.id, dir: null };
    say(`<b class="c">${s.name}</b> — 방향을 탭해 조준하라`);
    sync(); return;
  }
  useSkill(s);
  sync();
}

// ════════════════════════════════════════════════════════════════
//  inspector / coach
// ════════════════════════════════════════════════════════════════

const insEl = document.getElementById('inspect');
function showInspect(mo) {
  const my = Math.max(1, effAtk() - mo.def);
  const kills = my >= mo.hp;
  const ambush = mo.t.ambush && !mo.wasHit ? Math.max(1, mo.atk - G.def) : 0;
  const back = kills ? 0 : Math.max(1, mo.atk - G.def);
  const after = G.bat - back - ambush;
  const lethal = after <= 0 && !G.watchdog;
  insEl.className = 'on' + (lethal ? ' lethal' : '');
  insEl.innerHTML =
    `<span class="nm">${mo.t.name}</span> <span class="dt">Lv${mo.lv} · ${mo.hp}/${mo.max}${mo.def ? ' · DEF ' + mo.def : ''}</span><br>` +
    `<span class="dt">내 피해 <b class="c">${my}</b>` +
    (kills ? ' · <b class="g">한 방에 처치</b>' : ` · 반격 <b class="r">${back}</b>`) +
    (ambush ? ` · 기습 <b class="r">${ambush}</b>` : '') +
    ` · 교환 후 배터리 <b class="${lethal ? 'r' : 'c'}">${Math.max(0, after)}</b>` +
    (lethal ? ' <b class="r">치명</b>' : '') + `</span><br>` +
    `<span class="dt">${mo.t.note}</span>`;
  coach('mon');
}
// the whole clear-or-run decision, priced out before you step on the VIA
function showExitInspect() {
  const q = exitQuote(), s = q.sector;
  const locked = viaLocked();
  const after = Math.max(10, G.health - q.loss);
  insEl.className = 'on' + (locked || q.loss >= 8 ? ' lethal' : '');
  insEl.innerHTML =
    `<span class="nm">VIA</span> <span class="dt">잔존 <b class="${q.left ? 'a' : 'g'}">${q.left}</b>기` +
    ` · HEALTH ${G.health}% → <b class="${q.loss > 4 ? 'r' : 'c'}">${after}%</b>` +
    ` · 배터리 최대 ${Math.max(1, Math.floor(10 * G.lv * after / 100) + G.batBonus)}</span><br>` +
    (locked
      ? `<span class="dt"><b class="r">봉인</b> — ${killsNeeded()}기를 더 처치하면 열린다` +
        `<br>지금 뚫으면 <b class="r">+10%</b>를 더 문다</span>`
      : q.cleared
        ? `<span class="dt"><b class="g">전멸</b> — 배터리 완충 · 열 0 · 수명 손실 없음` +
          (s.id === 'clean' ? ' · <b class="c">배터리 최대치 +1</b>' : '') +
          (s.id === 'salvage' ? ' · <b class="a">부품 1개 회수</b>' : '') + `</span>`
        : `<span class="dt">지금 내려가면 — ${s.id === 'quiet' ? '잔존만큼 수명이 깎인다' : s.short}` +
          `<br>남은 ${q.left}기를 정리하면 <b class="g">손실 0 · 완충</b>으로 끝난다</span>`);
}

function hideInspect() { insEl.className = ''; }

const coachEl = document.getElementById('coach');
const COACH = {
  confirm: '칸을 <b>한 번 탭</b>하면 경로가 보이고, <b>한 번 더 탭</b>하면 실행된다',
  move: '멀리 있는 칸도 탭하면 <b>자동으로 길을 찾아</b> 간다',
  fog:  '어두운 블록이 <b>안개</b>다. 걷을 때마다 배터리가 회복되지만 — 안개는 <b>유한하다</b>',
  mon:  '붉게 빛나면 나보다 강한 적이다. 적을 탭하면 <b>교환 결과</b>가 위에 뜬다',
  skill:'화면 아래 <b>스킬 슬롯</b>을 누르면 그 자리에서 발동한다. 길게 누르면 설명',
  via:  '구리 링이 <b>VIA</b>다. 밟기 전에 탭하면 <b>내려가는 대가</b>가 위에 뜬다 — 적을 남길수록 비싸진다',
};
let coachTimer = null;
function coach(id) {
  if (!G || G.coach.has(id) || !COACH[id]) return;
  G.coach.add(id);
  coachEl.innerHTML = COACH[id];
  coachEl.classList.add('on');
  clearTimeout(coachTimer);
  coachTimer = setTimeout(() => coachEl.classList.remove('on'), 5200);
}

// ════════════════════════════════════════════════════════════════
//  hud
// ════════════════════════════════════════════════════════════════

const $ = id => document.getElementById(id);
function sync() {
  if (!G || !G.map) return;
  const mb = maxBat();
  $('depth').textContent = String(G.depth).padStart(2, '0');
  $('comp').textContent = G.comp ? `${G.comp.name} · ${G.floor}/${G.comp.floors}F` : '—';
  $('health').textContent = G.health;
  $('batFill').style.width = Math.max(0, G.bat / mb * 100) + '%';
  $('batCap').style.left = G.health + '%';
  $('batVal').textContent = `${Math.max(0, G.bat)}/${mb}`;
  const st = heatState();
  $('heatFill').style.width = G.heat + '%';
  $('heatFill').className = 'fill ' + st;
  $('heatVal').textContent = G.heat;
  $('stt').className = 'st ' + st;
  $('stt').textContent = st.toUpperCase() + (st === 'shutdown' ? ' ' + G.shutdown : '');
  $('lv').textContent = G.lv;
  $('atk').textContent = effAtk();
  $('xp').textContent = `${G.xp}/${XP_TABLE[G.lv - 1] ?? '—'}`;
  const q = exitQuote();
  $('sector').innerHTML = `<b class="${q.sector.col}">${q.sector.name}</b> · ${q.sector.short}`;
  $('left').innerHTML = `잔존 <b>${q.left}</b> · 통과 ` +
    `<b class="${q.loss > 4 ? 'r' : 'a'}">−${q.loss}%</b>${q.locked ? ' <b class="r">봉인</b>' : ''}`;
  syncDock();

  if (viaObj && viaObj.visible) coach('via');
}

// ════════════════════════════════════════════════════════════════
//  overlays
// ════════════════════════════════════════════════════════════════

const overEl = $('over'), cardEl = $('overCard');
function showOver(html) { cardEl.innerHTML = html; overEl.classList.add('on'); }
function hideOver() { overEl.classList.remove('on'); }

function showHelp() {
  showOver(`
    <h1>DIE SHRINK</h1>
    <div class="sub">읽는 법</div>
    <div class="legend">
      <div class="lg"><span class="sw" style="--c:#0B1017"></span><span><b>안개 블록</b> — 걷으면 배터리 +레벨, 열 −2. 이 던전의 유일한 회복원이고 <b>유한하다</b></span></div>
      <div class="lg"><span class="sw tall" style="--c:#C87137"></span><span><b>구리 벽</b> — 높이 솟은 것. 지나갈 수 없다</span></div>
      <div class="lg"><span class="sw" style="--c:#FF4D5E"></span><span><b>몬스터</b> — 붉으면 나보다 높은 레벨. 숫자가 레벨이다. 움직이지 않는다</span></div>
      <div class="lg"><span class="sw" style="--c:#4DE0D0"></span><span><b>나</b> — 시안 큐브. 스킬은 화면 <b>아래 슬롯</b>에서 바로 쓴다</span></div>
      <div class="lg"><span class="sw ring" style="--c:#C87137"></span><span><b>VIA</b> — 아래층으로 내려가는 구멍. <b>전멸하고 내려가면 완충·손실 0</b>, 적을 남기면 남긴 수만큼 수명이 깎인다</span></div>
      <div class="lg"><span class="sw" style="--c:#FFB454"></span><span><b>구역 규칙</b> — 층마다 다르다. HUD 맨 아랫줄에 그 층에서 <b>다 잡을 값어치</b>가 적혀 있다</span></div>
      <div class="lg"><span class="sw" style="--c:#6BD98A"></span><span><b>부품</b> — 밟는 즉시 발동한다. 인벤토리는 없다</span></div>
    </div>
    <p>레벨업하면 <b class="c">배터리가 완충되고 열이 0</b>이 된다. 죽기 직전에 레벨업을 맞추는 것이 이 게임의 핵심이다.</p>
    <button id="ok">내려간다</button>`);
  $('ok').onclick = () => { hideOver(); sync(); };
  $('ok').focus();
}

function showDead() {
  phase = 'dead';
  syncDock();
  showOver(`
    <h1 class="dead">SYSTEM HALTED</h1>
    <div class="sub">crash.log</div>
    <p style="font-family:var(--mono);font-size:11px;letter-spacing:.05em;color:var(--red)">
      killed by ${G.cause}<br>at ${G.comp.name} ${G.floor}F · HEAT ${G.heat}</p>
    <div class="stats">
      <span>도달 깊이</span><span>${G.depth}층</span>
      <span>최종 레벨</span><span>${G.lv}</span>
      <span>처치</span><span>${G.kills}</span>
      <span>배터리 수명</span><span>${G.health}%</span>
      <span>이동</span><span>${G.tiles}칸</span>
    </div>
    <button id="again">다시 시작</button>`);
  $('again').onclick = () => { hideOver(); restart(); };
  $('again').focus();
}

function completeComponent() {
  payExit();                                  // the last floor is charged too
  if (G.salvage) { applyItem(G.salvage); G.salvage = null; }
  G.cleared.push(G.comp.id);
  say(`<b class="g">${G.comp.name} 클리어</b>`);
  showOver(`
    <h1>${G.comp.name}</h1>
    <div class="sub">COMPONENT CLEARED</div>
    <p>이 소자를 장악했다. 기판으로 돌아가 다음 소자를 고른다.</p>
    <div class="stats">
      <span>배터리</span><span>${G.bat}/${maxBat()}</span>
      <span>레벨</span><span>${G.lv}</span>
      <span>배터리 수명</span><span>${G.health}%</span>
    </div>
    <button id="up">기판으로</button>`);
  $('up').onclick = () => { hideOver(); toBoard(); };
  $('up').focus();
}

// ════════════════════════════════════════════════════════════════
//  phase transitions
// ════════════════════════════════════════════════════════════════

let tween = null;
function tweenTo(props, ms, done) {
  const from = { y: CAM.focus.y, dist: CAM.dist };
  tween = { from, to: props, t: 0, ms, done };
}

function toBoard() {
  phase = 'board';
  $('hud').classList.remove('on');
  $('log').classList.remove('on');
  syncDock();
  boardGroup.visible = true;
  hideInspect();
  resize();
  tweenTo({ y: 0, dist: 70 }, 1100, () => {
    say('소자를 선택하라');
    updateBoardHalos();
  });
  updateBoardHalos();
}

function updateBoardHalos() {
  icMeshes.forEach(g => {
    const c = g.userData.comp;
    const done = G.cleared.includes(c.id);
    g.userData.halo.visible = !done && phase === 'board';
    // a taken part goes dark but keeps its own marking — swapping the material
    // out would erase the one thing that tells the chips apart
    g.userData.pkg.material.color.setHex(done ? 0x33383E : 0xFFFFFF);
  });
}

function selectComponent(g) {
  const c = g.userData.comp;
  if (G.cleared.includes(c.id)) { say('이미 장악한 소자다'); return; }
  phase = 'zoom';
  icMeshes.forEach(o => o.userData.halo.visible = false);
  enterComponent(c);
  dunGroup.visible = true;
  resize();
  tweenTo({ y: DUNGEON_Y, dist: 40 }, 1200, () => {
    phase = 'dungeon';
    boardGroup.visible = false;
    $('hud').classList.add('on');
    $('log').classList.add('on');
    resize();
    sync();                       // the dock only appears once the phase is live
    say(`<b class="c">${c.name}</b> 진입 — ${c.gimmick}`);
    coach('move');
  });
}

function restart() {
  newGame();
  clearDungeon();
  boardGroup.visible = true;
  dunGroup.visible = false;
  CAM.focus.y = 0; CAM.dist = 70;
  phase = 'board';
  updateBoardHalos();
  toBoard();
  say('시스템 재시작');
}

// ════════════════════════════════════════════════════════════════
//  boot sequence
// ════════════════════════════════════════════════════════════════

const bootText = $('bootText');
const skipBtn = $('skip');
let bootT = 0, booting = true;

const BOOT_LINES = [
  [0.06, 'user@device:~$ _', false],
  [0.26, 'GLASS LAYER · DISSOLVING', false],
  [0.52, '전자 괴물이 검출되었다', false],
  [0.74, 'DIE SHRINK', true],
];

function bootStep(dt) {
  if (!booting) return;
  bootT += dt * (REDUCED ? 0.6 : 0.13);

  // glass fades, icon grid dies first
  const gp = Math.min(1, Math.max(0, (bootT - 0.12) / 0.42));
  M.glass.opacity = 1 - gp;
  glassMesh.visible = gp < 1;
  const icons = glassMesh.userData.icons;
  icons.visible = gp < 0.85;
  icons.userData.mat.emissiveIntensity = 0.75 * (1 - gp / 0.85);

  // camera drifts down toward the board
  CAM.dist = 118 - 48 * Math.min(1, bootT / 0.9);
  CAM.tilt = 20 + 14 * Math.min(1, bootT / 0.9);

  let line = null;
  for (const [at, txt, big] of BOOT_LINES) if (bootT >= at) line = [txt, big];
  if (line) {
    bootText.textContent = line[0];
    bootText.classList.toggle('big', line[1]);
    bootText.style.opacity = '1';
  }
  if (bootT > 0.92) bootText.style.opacity = String(Math.max(0, 1 - (bootT - 0.92) / 0.1));

  if (bootT >= 1.04) endBoot();
}

function endBoot() {
  if (!booting) return;
  booting = false;
  bootText.style.opacity = '0';
  skipBtn.classList.add('gone');
  M.glass.opacity = 0; glassMesh.visible = false;
  glassMesh.userData.icons.visible = false;
  CAM.tilt = TILT_STEPS[tiltIdx]; CAM.dist = 70;
  $('tools').classList.add('on');
  phase = 'board';
  updateBoardHalos();
  resize();
  showHelp();
  $('log').classList.add('on');
  say('기판이 드러났다. <b class="c">소자를 탭</b>해 내려가라');
}
skipBtn.onclick = endBoot;

// ════════════════════════════════════════════════════════════════
//  main loop
// ════════════════════════════════════════════════════════════════

$('helpBtn').onclick = showHelp;
$('camBtn').onclick = () => {
  tiltIdx = (tiltIdx + 1) % TILT_STEPS.length;
  CAM.tilt = TILT_STEPS[tiltIdx];
  resize();
  say(`시점 ${CAM.tilt}°`);
};

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;

  bootStep(dt);
  if (phase === 'dungeon' && G && !G.dead) stepWalk(dt);

  // ghost pulse
  for (const o of ghostObjs) {
    if (o.userData.pulse) o.material.emissiveIntensity = 2.2 + Math.sin(t * 6) * 1.2;
    else o.material.opacity = 0.55 + Math.sin(t * 5) * 0.3;
  }

  // camera tween
  if (tween) {
    tween.t += dt * 1000;
    const k = Math.min(1, tween.t / tween.ms);
    const e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    if (tween.to.y !== undefined) CAM.focus.y = tween.from.y + (tween.to.y - tween.from.y) * e;
    if (tween.to.dist !== undefined) CAM.dist = tween.from.dist + (tween.to.dist - tween.from.dist) * e;
    if (k >= 1) { const d = tween.done; tween = null; d && d(); }
  }

  // player bob + move
  if (playerObj && phase === 'dungeon') {
    const tp = playerObj.userData.target;
    if (tp) {
      playerObj.position.lerp(tp, 1 - Math.pow(0.001, dt));
      if (playerObj.position.distanceTo(tp) < 0.01) playerObj.userData.target = null;
    }
    playerObj.position.y = 0.55 + Math.sin(t * 2.4) * 0.06;
    playerObj.rotation.y = t * 0.7;
    playerObj.userData.shell.rotation.y = -t * 1.1;
    // hold the pick column square to the grid: spinning it would sweep a wider
    // diagonal and let the token steal taps aimed at the tile behind it
    playerObj.userData.pick.rotation.y = -playerObj.rotation.y;
    playerLight.position.set(playerObj.position.x, DUNGEON_Y + 2.4, playerObj.position.z);
    const st = heatState();
    const hc = st === 'throttle' || st === 'shutdown' ? 0xFF4D5E : st === 'warm' ? 0xFFB454 : 0x4DE0D0;
    playerObj.userData.core.material.emissive.setHex(hc);
    playerLight.color.setHex(hc);
  }

  // fog sinking
  for (let i = fogAnims.length - 1; i >= 0; i--) {
    const a = fogAnims[i];
    a.t += dt * 3.4;
    const k = Math.min(1, a.t);
    a.mesh.scale.y = FOG_H * (1 - k);
    a.mesh.position.y = FOG_H / 2 * (1 - k) - k * 0.3;
    // the lid is still on screen while it sinks — let the pick column ride it down
    const u = a.mesh.userData, pk = pickMesh[u.gy]?.[u.gx];
    if (pk) setPickTop(pk, Math.max(wallMesh[u.gy][u.gx]?.scale.y ?? 0, FOG_H * (1 - k)));
    if (k >= 1) { a.mesh.visible = false; fogAnims.splice(i, 1); }
  }

  // floaters
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.t += dt * (f.spin ? 3.2 : 1.1);
    if (f.spin) { f.sp.rotation.y += dt * 9; f.sp.scale.setScalar(0.5 * (1 - f.t)); }
    else { f.sp.position.y += dt * 1.1; f.sp.material.opacity = Math.max(0, 1 - f.t * f.t); }
    if (f.t >= 1) { dunGroup.remove(f.sp); f.sp.material.map?.dispose?.(); f.sp.material.dispose(); floaters.splice(i, 1); }
  }

  // monster idle + hit flash
  monObj.forEach((g, i) => {
    if (!g.visible) return;
    g.userData.ring.rotation.z = t * 0.6 + i;
    g.position.y = Math.sin(t * 1.6 + i * 1.3) * 0.025;
    if (g.userData.flash > 0) {
      g.userData.flash -= dt * 4;
      g.userData.em.emissiveIntensity = 1.8 + Math.max(0, g.userData.flash) * 4.0;
    }
  });
  itemObj.forEach((g, i) => { if (g.visible) { g.rotation.y = t * 1.3 + i; g.children[0].position.y = (g.children[0].userData.baseY ?? 0.26) + Math.sin(t * 2 + i) * 0.05; } });
  if (viaObj) viaObj.userData.ring.rotation.z = t * 1.4;

  // board idle
  if (phase === 'board' || phase === 'boot' || booting) {
    icMeshes.forEach((g, i) => {
      const h = g.userData.halo;
      if (h.visible) h.material.emissiveIntensity = 1.0 + Math.sin(t * 2.6 + i * 0.7) * 0.7;
    });
  }

  applyCamera();
  if (shakeAmt > 0.001) {
    cam.position.x += (Math.random() - .5) * shakeAmt;
    cam.position.y += (Math.random() - .5) * shakeAmt;
    shakeAmt *= 0.86;
  }

  renderer.render(scene, cam);
  requestAnimationFrame(frame);
}

// ════════════════════════════════════════════════════════════════
//  go
// ════════════════════════════════════════════════════════════════

buildBoard();
buildDock();
newGame();
dunGroup.visible = false;
CAM.tilt = 20; CAM.dist = 118;
addEventListener('resize', resize);
addEventListener('orientationchange', resize);
// a phone hides its URL bar without always firing window resize; the canvas would
// keep the stale height and every tap would read off by that difference
visualViewport?.addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);
