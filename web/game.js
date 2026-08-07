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
// Laid out the way an actual opened phone is laid out: camera plateau top-left,
// the logic board a shielded column down the right, the cell dominating the left,
// coil on the cell, taptic and speaker flanking the bottom.
const COMPONENTS = [
  { id:'touch',  name:'TOUCH DIGITIZER', x:  1.55, z: -6.45, w: 2.9, d: 0.9, floors: 2, gimmick:'격자가 정직하다. 기믹 없음' },
  { id:'cam',    name:'CAMERA ISP',      x: -1.75, z: -5.35, w: 2.6, d: 2.6, floors: 3, gimmick:'렌즈 왜곡 — 시야가 중앙 쪽으로 한 칸 더 쏠린다' },
  { id:'soc',    name:'SoC / AP',        x:  1.80, z: -4.60, w: 2.6, d: 2.0, floors: 3, gimmick:'코어 구획마다 규칙이 다르다' },
  { id:'ram',    name:'LPDDR RAM',       x:  1.80, z: -3.05, w: 2.6, d: 1.2, floors: 3, gimmick:'걷힌 안개가 되돌아온다' },
  { id:'pmic',   name:'PMIC',            x:  1.80, z: -1.85, w: 2.6, d: 1.2, floors: 2, gimmick:'전압 변동 — 공격력이 요동친다' },
  { id:'nand',   name:'NAND FLASH',      x:  1.80, z: -0.65, w: 2.6, d: 1.2, floors: 3, gimmick:'배드 섹터 — 회복되지 않는 칸' },
  { id:'modem',  name:'BASEBAND',        x:  1.80, z:  0.55, w: 2.6, d: 1.2, floors: 3, gimmick:'외부에서 침입자가 들어온다' },
  { id:'batt',   name:'BATTERY CELL',    x: -1.35, z: -0.55, w: 3.4, d: 7.2, floors: 3, gimmick:'발열 2배. 대신 처치 시 배터리 회복' },
  { id:'nfc',    name:'NFC COIL',        x: -1.35, z:  0.30, w: 2.2, d: 2.2, floors: 2, gimmick:'코일 위 칸들이 서로 연결된다' },
  { id:'haptic', name:'HAPTIC ENGINE',   x:  1.85, z:  4.80, w: 2.6, d: 1.7, floors: 2, gimmick:'진동 — 모든 것이 밀려난다' },
  { id:'audio',  name:'AUDIO CODEC',     x: -2.05, z:  4.80, w: 2.1, d: 1.6, floors: 2, gimmick:'소리가 잠든 것을 깨운다' },
];

const MONSTERS = [
  { id:'zombie',  name:'ZOMBIE PROC', shape:'chip',    col:0x8B9BA8, hp:1.00, atk:1.00, def:0, note:'평범하다' },
  { id:'bitrot',  name:'BIT ROT',     shape:'res', col:0xC87137, hp:0.60, atk:1.45, def:0, note:'유리대포 — 약하지만 아프다' },
  { id:'esd',     name:'ESD',         shape:'cap',     col:0x7FA8C9, hp:1.35, atk:0.80, def:1, note:'방어가 높다' },
  { id:'adware',  name:'ADWARE',      shape:'ind',    col:0xB673C9, hp:0.90, atk:0.85, def:0, note:'교전하면 발열한다' },
  { id:'deadlock',name:'DEADLOCK',    shape:'diode',   col:0xFF4D5E, hp:1.10, atk:1.15, def:0, note:'선공 — 첫 교전에서 내가 치기 전에 한 대 먼저 때린다', ambush:true },
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
  // one upgrade pickup, and the build decision happens when you step on it
  { id:'trim',  kind:'INSTALL', name:'TRIM MODULE',    col:0x6BD98A, desc:'강화 — 셋 중 하나를 고른다' },
  { id:'full',  kind:'EXEC',    name:'POWER BANK',     col:0xFFB454, desc:'배터리 완충' },
  { id:'nova',  kind:'EXEC',    name:'CAP DISCHARGE',  col:0xFFB454, desc:'인접 8칸 큰 피해' },
  { id:'emp',   kind:'EXEC',    name:'EMP BURST',      col:0xFF7A5C, desc:'반경 2 모든 적 감전' },
  { id:'spark', kind:'EXEC',    name:'ARC FLASH',      col:0xFF7A5C, desc:'가장 가까운 적 방전' },
  { id:'cool',  kind:'EXEC',    name:'VAPOR CHAMBER',  col:0xFFB454, desc:'열 전량 방출' },
];

// The build. Three of these are offered per module and you keep one, so a run is
// a chain of 공/방/체 decisions instead of whatever the floor happened to drop.
const UPGRADES = [
  { id:'atk',  axis:'공', name:'CLOCK UP',    col:'r',
    desc:'ATK <b class="r">+2</b>', note:'교환 횟수를 줄인다. 반격을 덜 맞는 가장 직접적인 길',
    at: () => `ATK ${G.atk}`,           go: () => { G.atk += 2; } },
  { id:'def',  axis:'방', name:'SHIELD CAN',  col:'g',
    desc:'DEF <b class="g">+1</b>', note:'맞는 모든 피해에서 1씩 깎는다. 교환이 길수록 이득',
    at: () => `DEF ${G.def}`,           go: () => { G.def += 1; } },
  { id:'cap',  axis:'체', name:'CELL TRIM',   col:'c',
    desc:'배터리 최대치 <b class="c">+3</b>', note:'버틸 수 있는 교환의 총량이 늘어난다',
    at: () => `최대 ${maxBat()}`,        go: () => { G.batBonus += 3; G.bat += 3; } },
  { id:'fog',  axis:'체', name:'FOG TAP',     col:'c',
    desc:'안개 1칸당 배터리 <b class="c">+1</b> 추가', note:'탐색이 곧 회복이 된다. 넓은 층에서 강하다',
    at: () => `안개 +${G.lv + G.fogBonus}/칸`, go: () => { G.fogBonus += 1; } },
  { id:'vent', axis:'방', name:'VAPOR PATH',  col:'a',
    desc:'처치할 때마다 열 <b class="a">−8</b>', note:'스킬을 계속 쓰고 싶다면 이것부터',
    at: () => `처치 냉각 ${G.killCool}`, go: () => { G.killCool += 8; } },
  { id:'dog',  axis:'방', name:'WATCHDOG',    col:'c', once: () => G.watchdog,
    desc:'치명 시 <b class="c">1회 자동 복구</b>', note:'한 번의 오판을 되돌린다',
    at: () => '미보유',                  go: () => { G.watchdog = true; } },
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
const topEl = document.getElementById('top');
const stageEl = document.getElementById('stage');
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

// ───────────── depth tiers ─────────────
// The board is only the surface. Go deep enough and you are inside the die, and
// deeper still inside a cell — each tier repaints floor, pour and lid.
const TIERS = [
  { at: 0,  id:'board', name:'BOARD SURFACE', note:'솔더마스크 위 — 구리 푸어가 벽이다',
    pal: { base:'#12423A', base2:'#113E37', speck:['#0D332E', '#164C43'],
           trace:'#1A564C', live:'#2E8877', hi:'#215A50', hiLive:'#49B9A2',
           seam:'#0C312B', pour:'#B4652F', pourHi:'#C27743', pourLo:'#8E4F26',
           lid:'#1B2732', lidSpeck:['#161F27', '#1F2B36'], lidGrid:'#1D2833',
           sub:'#081A18', subSpeck:['#06120F', '#0C2320'], subLine:'#0E2A26' } },
  { at: 5,  id:'die',   name:'DIE INTERIOR',  note:'패키지를 뚫고 실리콘 안으로',
    pal: { base:'#1B2A38', base2:'#192736', speck:['#141F2A', '#233648'],
           trace:'#2B4358', live:'#3E7FB0', hi:'#365068', hiLive:'#63B4E4',
           seam:'#131E29', pour:'#93A0AC', pourHi:'#B6C2CC', pourLo:'#6B7783',
           lid:'#141A22', lidSpeck:['#101519', '#1A222C'], lidGrid:'#1A2029',
           sub:'#0A1017', subSpeck:['#070B10', '#111A24'], subLine:'#16202B' } },
  { at: 10, id:'cell',  name:'ELECTROLYTE',   note:'전해질 속 — 포일과 세퍼레이터 사이',
    pal: { base:'#3A2716', base2:'#372414', speck:['#2B1C0F', '#4C351D'],
           trace:'#573A1E', live:'#B8813A', hi:'#6B4926', hiLive:'#E8B769',
           seam:'#241708', pour:'#A9A296', pourHi:'#C9C3B7', pourLo:'#7D766A',
           lid:'#20160D', lidSpeck:['#1A1109', '#2A1E12'], lidGrid:'#2A1E12',
           sub:'#150E07', subSpeck:['#100A05', '#221708'], subLine:'#2A1C0C' } },
];
const tierOf = d => TIERS.reduce((a, t) => d >= t.at ? t : a, TIERS[0]);

// Boards are not all green. Each floor of the board tier is fabbed in one of these
// mask colours — one colourway per floor, so a floor stays coherent while the run
// keeps changing shirts.
const MASKS = [
  { id:'green',  base:'#12423A', base2:'#113E37', speck:['#0D332E','#164C43'],
    trace:'#1A564C', live:'#2E8877', hi:'#215A50', hiLive:'#49B9A2', seam:'#0C312B' },
  { id:'blue',   base:'#123049', base2:'#112C44', speck:['#0D2438','#173F5C'],
    trace:'#1B4467', live:'#2E6E9C', hi:'#22507A', hiLive:'#4FA3D6', seam:'#0B2135' },
  { id:'black',  base:'#1B1D21', base2:'#181A1E', speck:['#131519','#232629'],
    trace:'#2B2E33', live:'#8A6A3E', hi:'#35393F', hiLive:'#D9A441', seam:'#0F1113' },
  { id:'red',    base:'#3B1A22', base2:'#37171F', speck:['#2C1219','#4E262F'],
    trace:'#5A2530', live:'#A8434F', hi:'#6B2E3A', hiLive:'#E0707D', seam:'#260F15' },
  { id:'purple', base:'#271A3A', base2:'#241736', speck:['#1D122C','#33224A'],
    trace:'#3A2757', live:'#7A4FB0', hi:'#46315F', hiLive:'#B98BE8', seam:'#160D22' },
];
const maskFor = d => MASKS[(d * 5 + 3) % MASKS.length];

// ───────────── die interior: one metal layer, seen from above ─────────────
// Every cell shows this whole texture, so anything that reads as a self-contained
// motif turns the floor into a tray of tiles. Tracks therefore run the full width
// or height at a fixed pitch: they meet across the seam and the field reads as one
// continuous metal layer that happens to be walked on in grid steps.
function dieMetalTex(variant, P) {
  return canvasTex(128, 128, (g, w, h) => {
    const R = prng(variant * 7717 + 13);
    g.fillStyle = (variant % 2) ? P.base2 : P.base;      // near-identical: no checkerboard
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 70, P.speck, 2, 5, R);

    const pitch = 16, off = (variant % 2) ? 8 : 0;
    const kind = variant % 3;                            // routing / pads / vias
    for (let i = 0; i < 8; i++) {
      const p = (off + i * pitch) % 128;
      if (R() < (kind === 0 ? 0.34 : 0.62)) continue;    // not every lane is routed
      const live = R() < 0.22;
      const vert = ((i + variant) % 2) === 0;
      g.fillStyle = live ? P.live : P.trace;
      if (vert) g.fillRect(p, 0, 4, h); else g.fillRect(0, p, w, 4);
      g.fillStyle = live ? P.hiLive : P.hi;
      if (vert) g.fillRect(p, 0, 1, h); else g.fillRect(0, p, w, 1);
    }

    if (kind === 1) {                                    // a field of exposed pads
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
        if (R() < 0.3) continue;
        const x = 16 + a * 32, y = 16 + b * 32;
        g.fillStyle = P.seam;     g.fillRect(x - 7, y - 5, 18, 12);
        g.fillStyle = '#B98F3E';  g.fillRect(x - 6, y - 4, 16, 10);
        g.fillStyle = '#D9A441';  g.fillRect(x - 6, y - 4, 16, 3);
      }
    } else {                                             // vias, parked on the lanes
      for (let i = 0; i < (kind === 2 ? 9 : 5); i++) {
        const x = ((R() * 8) | 0) * pitch + off, y = ((R() * 8) | 0) * pitch;
        g.fillStyle = P.seam; g.fillRect(x - 1, y - 1, 8, 8);
        g.fillStyle = '#8A6A2E'; g.fillRect(x, y, 6, 6);
        g.fillStyle = '#C89B44'; g.fillRect(x + 1, y + 1, 3, 3);
      }
    }

    if (variant >= 4) {                                  // silkscreen designator
      g.strokeStyle = '#8C9A94'; g.lineWidth = 2;
      g.strokeRect(10.5, 10.5, 46, 30);
      g.fillStyle = '#8C9A94';
      g.font = '700 13px ui-monospace, Menlo, monospace';
      g.fillText(['TP','R','C','L','D','U'][variant % 6] + (1 + (R() * 60 | 0)), 15, 57);
    }

    // the faintest seam, so a grid step is still legible without drawing a box
    g.fillStyle = P.seam;
    g.fillRect(0, 0, w, 1); g.fillRect(0, 0, 1, h);
  });
}

// ───────────── electrolyte: wound foil and separator, not routing ─────────────
function electrolyteTex(variant, P) {
  return canvasTex(128, 128, (g, w, h) => {
    const R = prng(variant * 313 + 91);
    g.fillStyle = variant ? P.base2 : P.base;
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 110, P.speck, 3, 9, R);
    // the winding: soaked separator layers running edge to edge, gently waved
    for (let i = 0; i < 9; i++) {
      const y0 = i * 16 + (variant ? 8 : 0);
      const lit = i % 3 === 0;
      g.strokeStyle = lit ? P.live : P.trace; g.lineWidth = 3;
      g.beginPath();
      for (let x = 0; x <= 128; x += 8) g.lineTo(x, y0 + Math.sin((x / 128 + i) * 3.1) * 3);
      g.stroke();
      g.strokeStyle = lit ? P.hiLive : P.hi; g.lineWidth = 1;
      g.beginPath();
      for (let x = 0; x <= 128; x += 8) g.lineTo(x, y0 - 2 + Math.sin((x / 128 + i) * 3.1) * 3);
      g.stroke();
    }
    // gas trapped between the layers
    for (let i = 0; i < 7; i++) {
      g.fillStyle = P.hiLive; g.globalAlpha = 0.25 + R() * 0.3;
      g.beginPath(); g.arc(R() * 128, R() * 128, 1.5 + R() * 3, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
    g.fillStyle = P.seam;
    g.fillRect(0, 0, w, 1); g.fillRect(0, 0, 1, h);
  });
}

// ───────────── copper pour: the walls, flooded flat like a ground plane ─────────────
function copperPourTex(P) {
  return canvasTex(128, 128, (g, w, h) => {
    const R = prng(6151);
    g.fillStyle = P.pour;
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 130, [P.pourLo, P.pourHi], 3, 8, R);
    // thermal-relief hatch, running corner to corner so runs of pour join up
    g.strokeStyle = P.pourLo; g.lineWidth = 2;
    for (let d = -128; d < 256; d += 14) {
      g.beginPath(); g.moveTo(d, 0); g.lineTo(d + 128, 128); g.stroke();
    }
    g.strokeStyle = P.pourHi; g.lineWidth = 1;
    for (let d = -128; d < 256; d += 14) {
      g.beginPath(); g.moveTo(d + 1, 0); g.lineTo(d + 129, 128); g.stroke();
    }
    g.fillStyle = P.pourHi + '55';                        // faint oxidised sheen
    g.fillRect(0, 0, w, 2);
  });
}

// ───────────── passivation lid: what an un-etched region looks like ─────────────
function passivationTex(P) {
  return canvasTex(128, 128, (g, w, h) => {
    const R = prng(4211);
    g.fillStyle = P.lid;
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 120, P.lidSpeck, 2, 6, R);
    // barely-there lattice: the lid should read as an unbroken sheet, not a grid
    g.strokeStyle = P.lidGrid; g.lineWidth = 1;
    for (let p = 0; p <= 128; p += 32) {
      g.beginPath(); g.moveTo(p + .5, 0); g.lineTo(p + .5, h); g.stroke();
      g.beginPath(); g.moveTo(0, p + .5); g.lineTo(w, p + .5); g.stroke();
    }
    // dull shapes buried under the lid — you can almost see the layout
    g.fillStyle = P.lidGrid;
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
function substrateTex(P) {
  return canvasTex(256, 256, (g, w, h) => {
    const R = prng(77);
    g.fillStyle = P.sub;
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 200, P.subSpeck, 2, 7, R);
    g.strokeStyle = P.subLine; g.lineWidth = 2;
    for (let i = 0; i < 26; i++) {                       // deep routing, half buried
      const v = R() < 0.5, p = R() * 256, s2 = R() * 200, l = 30 + R() * 120;
      g.beginPath();
      if (v) { g.moveTo(p, s2); g.lineTo(p, s2 + l); } else { g.moveTo(s2, p); g.lineTo(s2 + l, p); }
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

    // dark interior floor, everything else is parts
    g.fillStyle = '#141619';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 420, ['#0E1013', '#1C1F24'], 2, 6, R);

    // blue anodized rail, machined lip inside it — the photo's frame colour
    g.strokeStyle = '#3C4A5C'; g.lineWidth = 34; g.strokeRect(17, 17, w - 34, h - 34);
    g.strokeStyle = '#556880'; g.lineWidth = 4;  g.strokeRect(36, 36, w - 72, h - 72);
    g.strokeStyle = '#232B36'; g.lineWidth = 3;  g.strokeRect(47, 47, w - 94, h - 94);

    // antenna breaks in the rail
    g.fillStyle = '#8A97A8';
    for (const fy of [0.08, 0.46, 0.9]) { g.fillRect(0, h * fy, 34, 6); g.fillRect(w - 34, h * fy, 34, 6); }
    for (const fx of [0.2, 0.8]) { g.fillRect(w * fx, 0, 6, 34); g.fillRect(w * fx, h - 34, 6, 34); }

    // pocket recesses milled where the parts sit
    for (const c of COMPONENTS) {
      const x = T2X(c.x), y = T2Y(c.z);
      const pw2 = c.w / PLATE_W * 1024, ph2 = c.d / PLATE_H * 2240;
      g.fillStyle = '#101215'; g.fillRect(x - pw2 / 2 - 6, y - ph2 / 2 - 6, pw2 + 12, ph2 + 12);
      g.strokeStyle = '#0A0B0E'; g.lineWidth = 3;
      g.strokeRect(x - pw2 / 2 - 6, y - ph2 / 2 - 6, pw2 + 12, ph2 + 12);
    }

    // flex ribbons with silver connector heads, the photo's connective tissue
    const flex = (x0, y0, x1, y1, wd) => {
      g.strokeStyle = '#0C0D0F'; g.lineWidth = wd; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + 26, x1, y1); g.stroke();
      g.strokeStyle = '#22242A'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x0, y0 - wd * 0.26); g.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + 26 - wd * 0.26, x1, y1 - wd * 0.26); g.stroke();
      for (const [ex, ey] of [[x0, y0], [x1, y1]]) {
        g.fillStyle = '#B9BEC4'; g.fillRect(ex - 20, ey - 12, 40, 24);
        g.fillStyle = '#7E848B'; g.fillRect(ex - 20, ey - 12, 40, 6);
      }
    };
    flex(T2X(0.0), T2Y(-6.5), T2X(0.9), T2Y(-5.6), 40);       // display → board
    flex(T2X(-0.6), T2Y(-3.9), T2X(0.5), T2Y(-4.3), 26);      // camera → board
    flex(T2X(-1.2), T2Y(3.35), T2X(0.8), T2Y(4.0), 32);       // cell tail
    flex(T2X(-0.2), T2Y(5.6), T2X(0.6), T2Y(4.6), 24);        // bottom cluster

    // small silver modules crowding the top and bottom strips, like the photo
    const module = (x, y, mw, mh) => {
      g.fillStyle = '#C3C8CD'; g.fillRect(x, y, mw, mh);
      g.fillStyle = '#8E939A'; g.fillRect(x, y, mw, 5);
      g.strokeStyle = '#6E737A'; g.lineWidth = 2; g.strokeRect(x, y, mw, mh);
    };
    for (let i = 0; i < 4; i++) module(70 + i * 240, 64, 150 + (i % 2) * 60, 52);
    for (let i = 0; i < 3; i++) module(90 + i * 300, h - 130, 190, 64);
    module(w * 0.42, h - 210, 170, 60);                        // bottom connector block

    // coax antenna runs — the white cables a teardown always shows hugging the rail
    const coax = (pts, tone) => {
      g.strokeStyle = tone; g.lineWidth = 7; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.stroke();
      g.strokeStyle = '#00000055'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1] + 3);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1] + 3);
      g.stroke();
      // u.FL connector nubs at both ends
      for (const [ex, ey] of [pts[0], pts.at(-1)]) {
        g.fillStyle = '#B9BEC4'; g.beginPath(); g.arc(ex, ey, 8, 0, 7); g.fill();
        g.fillStyle = '#3A3E45'; g.beginPath(); g.arc(ex, ey, 3.5, 0, 7); g.fill();
      }
    };
    coax([[80, h * 0.075], [64, h * 0.2], [64, h * 0.52], [78, h * 0.585]], '#E8E4DC');
    coax([[w - 78, h * 0.36], [w - 62, h * 0.44], [w - 62, h * 0.72], [w - 84, h * 0.8]], '#3E668F');

    // silkscreen touches on the exposed strips
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = '#4A5058'; g.font = '600 15px ui-monospace, Menlo, monospace';
    g.fillText('J9700', 84, 148);  g.fillText('BT/WLAN', w * 0.62, 132);
    g.fillText('J4100', 96, h - 148); g.fillText('MIC2', w * 0.56, h - 90);
    g.save(); g.translate(70, h * 0.42); g.rotate(-Math.PI / 2);
    g.fillText('621-02786-A', 0, 0); g.restore();

    // gold test pad clusters in the milled gaps
    for (const [gx0, gy0, cols, rows] of [[w * 0.52, h * 0.045, 6, 2], [w * 0.08, h * 0.53, 2, 6],
                                          [w * 0.72, h * 0.955, 5, 2], [w * 0.9, h * 0.09, 2, 4]]) {
      g.fillStyle = '#C9A34C';
      for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) {
        g.beginPath(); g.arc(gx0 + a * 18, gy0 + b * 18, 5.5, 0, 7); g.fill();
      }
    }

    // stray passives — the dust of tiny resistors along every free edge
    for (let i = 0; i < 90; i++) {
      const px = 70 + R() * (w - 140), py = R() < 0.5 ? 60 + R() * 140 : h - 60 - R() * 190;
      const vert = R() < 0.5, pw3 = vert ? 7 : 15, ph3 = vert ? 15 : 7;
      g.fillStyle = ['#2B2117', '#3A3F45', '#4E3527', '#23282E'][(R() * 4) | 0];
      g.fillRect(px, py, pw3, ph3);
      g.fillStyle = '#B9BEC4';
      if (vert) { g.fillRect(px, py, pw3, 3); g.fillRect(px, py + ph3 - 3, pw3, 3); }
      else { g.fillRect(px, py, 3, ph3); g.fillRect(px + pw3 - 3, py, 3, ph3); }
    }

    // speaker mesh strip along the bottom edge, sim tray slot on the left rail
    g.fillStyle = '#0A0C0E';
    for (let x = w * 0.16; x < w * 0.5; x += 14) {
      g.beginPath(); g.arc(x, h - 56, 4, 0, 7); g.fill();
      g.beginPath(); g.arc(x + 7, h - 42, 4, 0, 7); g.fill();
    }
    g.fillStyle = '#2B333E'; g.fillRect(2, h * 0.685, 30, 170);
    g.strokeStyle = '#556880'; g.lineWidth = 2; g.strokeRect(2, h * 0.685, 30, 170);
    g.fillStyle = '#8A97A8'; g.beginPath(); g.arc(17, h * 0.685 + 150, 5, 0, 7); g.fill();

    // screws — bright silver philips, everywhere a real frame has them
    const screw = (x, y) => {
      g.fillStyle = '#0C0E11'; g.beginPath(); g.arc(x, y, 12, 0, 7); g.fill();
      g.fillStyle = '#C9CED3'; g.beginPath(); g.arc(x, y, 8, 0, 7); g.fill();
      g.strokeStyle = '#575D64'; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(x - 5, y); g.lineTo(x + 5, y); g.moveTo(x, y - 5); g.lineTo(x, y + 5); g.stroke();
    };
    for (const [fx, fy] of [[0.07,0.04],[0.93,0.04],[0.07,0.96],[0.93,0.96],
                            [0.07,0.31],[0.93,0.31],[0.07,0.62],[0.93,0.62],
                            [0.45,0.585],[0.58,0.955],[0.36,0.045],[0.68,0.5]])
      screw(w * fx, h * fy);
  });
}

// ───────────── IC package: epoxy mould with laser-etched marking ─────────────
// Still used by the dungeon monsters (the SOIC chip body) — not by the hub board.
function pkgTex(seed, name, aspect) {
  const W0 = 320, H0 = Math.round(Math.min(640, Math.max(110, W0 / aspect)));
  return canvasTex(W0, H0, (g, w, h) => {
    const R = prng(seed);
    g.fillStyle = '#1C2228';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 320, ['#161B20', '#252C33'], 3, 9, R);
    g.fillStyle = '#0000004D';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w * 0.14, 0); g.lineTo(0, h * 0.16); g.fill();
    const pr = Math.min(w, h) * 0.07;
    g.fillStyle = '#77838C';
    g.beginPath(); g.arc(pr * 2.2, pr * 2.2, pr, 0, 7); g.fill();
    g.fillStyle = '#13181C';
    g.beginPath(); g.arc(pr * 2.2, pr * 2.2, pr * 0.52, 0, 7); g.fill();

    const s2 = Math.min(w, h);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#9AA6AE';
    let fs = Math.round(s2 * 0.19);
    do {
      g.font = `700 ${fs}px ui-monospace, Menlo, monospace`;
      fs -= 2;
    } while (fs > 8 && g.measureText(name).width > w * 0.82);
    g.fillText(name, w / 2, h * 0.42);
    g.fillStyle = '#6B767E';
    g.font = `600 ${Math.round(s2 * 0.11)}px ui-monospace, Menlo, monospace`;
    g.fillText(`${String.fromCharCode(65 + (R() * 26 | 0))}${1000 + (R() * 8999 | 0)}-${R() * 9 | 0}A`, w / 2, h * 0.63);
    g.fillText(`KR ${24 + (R() * 3 | 0)}W${10 + (R() * 40 | 0)}`, w / 2, h * 0.78);
  });
}

// ───────────── lithium pouch: foil, crinkle, and the warning print ─────────────
function pouchTex() {
  return canvasTex(512, 1024, (g, w, h) => {
    const R = prng(555);
    // glossy black cell with a soft diagonal sheen
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#141518'); grad.addColorStop(0.35, '#0A0B0D');
    grad.addColorStop(0.6, '#101114'); grad.addColorStop(1, '#0A0B0D');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    g.fillStyle = '#FFFFFF08';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w * 0.5, 0); g.lineTo(0, h * 0.62); g.fill();
    // foil crinkle — faint diagonal creases the wrap always shows
    for (let i = 0; i < 26; i++) {
      g.globalAlpha = 0.03 + R() * 0.05;
      g.strokeStyle = R() < 0.5 ? '#FFFFFF' : '#000000';
      g.lineWidth = 1 + R() * 1.6;
      const cx0 = R() * w, cy0 = R() * h, len = 40 + R() * 160, an = (R() - 0.5) * 1.2;
      g.beginPath(); g.moveTo(cx0, cy0);
      g.lineTo(cx0 + Math.cos(an) * len, cy0 + Math.sin(an) * len); g.stroke();
    }
    g.globalAlpha = 1;
    g.strokeStyle = '#26282C'; g.lineWidth = 6;             // sealed edge
    g.strokeRect(6, 6, w - 12, h - 12);

    // maker's mark, quiet, upper third
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#3A3D42';
    g.font = '700 64px ui-monospace, Menlo, monospace';
    g.fillText('▣', w / 2, h * 0.3);

    // service barcode strip + data-matrix, mid-cell, like every pull-tab label
    g.fillStyle = '#17181B'; g.fillRect(w * 0.16, h * 0.44, w * 0.68, 66);
    g.strokeStyle = '#26282C'; g.lineWidth = 2; g.strokeRect(w * 0.16, h * 0.44, w * 0.68, 66);
    for (let x = w * 0.2; x < w * 0.62; x += 3) {
      if (R() < 0.62) { g.fillStyle = '#8A9096'; g.fillRect(x, h * 0.44 + 12, R() < 0.3 ? 3 : 1.5, 34); }
    }
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = '#6E747B'; g.font = '500 12px ui-monospace, Menlo, monospace';
    g.fillText(`SN F8${(R() * 10 | 0)}K${1000 + (R() * 8999 | 0)}PLJK`, w * 0.2, h * 0.44 + 60);
    const qs = 4.6, qx0 = w * 0.66, qy0 = h * 0.44 + 10;
    for (let a = 0; a < 10; a++) for (let b = 0; b < 10; b++)
      if ((a + b) % 2 === 0 || R() < 0.4) { g.fillStyle = '#7C828A'; g.fillRect(qx0 + a * qs, qy0 + b * qs, qs, qs); }

    // certification glyph row — boxes and crossed-out bin, drawn dumb on purpose
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const gy = h * 0.585;
    g.strokeStyle = '#5E646B'; g.lineWidth = 2;
    g.font = '700 20px ui-sans-serif, system-ui, sans-serif'; g.fillStyle = '#5E646B';
    g.fillText('CE', w * 0.3, gy); g.strokeRect(w * 0.3 - 22, gy - 15, 44, 30);
    g.fillText('UK', w * 0.44, gy); g.strokeRect(w * 0.44 - 22, gy - 15, 44, 30);
    g.strokeRect(w * 0.58 - 13, gy - 13, 26, 20);            // the little wheelie bin
    g.beginPath(); g.moveTo(w * 0.58 - 18, gy + 13); g.lineTo(w * 0.58 + 18, gy - 15); g.stroke();
    g.beginPath(); g.arc(w * 0.7, gy, 14, 0, 7); g.stroke(); // loop mark
    g.beginPath(); g.arc(w * 0.7, gy, 7, 0, 7); g.stroke();

    // the fine print block every cell carries, at the foot
    g.fillStyle = '#8A9096';
    g.font = '600 19px ui-sans-serif, system-ui, sans-serif';
    g.fillText('Rechargeable Li-ion Battery  Model DS-11', w / 2, h * 0.80);
    g.font = '500 15px ui-sans-serif, system-ui, sans-serif';
    g.fillStyle = '#5E646B';
    g.fillText('WARNING: Authorized Service Provider Only.', w / 2, h * 0.835);
    g.fillText('Potential for fire or burning. Do not disassemble,', w / 2, h * 0.862);
    g.fillText('crush, heat, puncture, or burn.', w / 2, h * 0.889);
    g.fillStyle = '#4A5057';
    g.font = '500 14px ui-monospace, Menlo, monospace';
    g.fillText('4820mAh · 18.6Wh · 4.45V', w / 2, h * 0.925);
  });
}

// stamped EMI shield lid — brushed steel, tiny etched name, no shouting
function shieldTex(seed, name, aspect) {
  const W0 = 360, H0 = Math.round(Math.min(720, Math.max(120, W0 / aspect)));
  return canvasTex(W0, H0, (g, w, h) => {
    const R = prng(seed * 131 + 7);
    g.fillStyle = '#C3C8CD';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 130; i++) {                     // brushing
      g.globalAlpha = 0.05 + R() * 0.08;
      g.fillStyle = R() < 0.5 ? '#9AA0A6' : '#E9EDF0';
      g.fillRect(0, R() * h, w, 1 + R() * 2);
    }
    // mottled heat-stain blotches a drawn can picks up
    for (let i = 0; i < 12; i++) {
      g.globalAlpha = 0.04 + R() * 0.05;
      g.fillStyle = R() < 0.5 ? '#8E959C' : '#D6DBDF';
      g.beginPath(); g.arc(R() * w, R() * h, 14 + R() * 30, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
    g.strokeStyle = '#A6ABB1'; g.lineWidth = 6;          // stamped step edge
    g.strokeRect(9, 9, w - 18, h - 18);
    g.strokeStyle = '#DDE1E5'; g.lineWidth = 2;
    g.strokeRect(15.5, 15.5, w - 31, h - 31);
    // a can is several cans — pressed seams split it into bays
    const bays = 1 + ((seed + w) % 3);
    for (let i = 1; i <= bays; i++) {
      const sx = (w - 30) * i / (bays + 1) + 15 + (R() - 0.5) * 20;
      g.strokeStyle = '#A6ABB1'; g.lineWidth = 3; g.beginPath();
      g.moveTo(sx, 12); g.lineTo(sx, h - 12); g.stroke();
      g.strokeStyle = '#DDE1E5'; g.lineWidth = 1; g.beginPath();
      g.moveTo(sx + 2.5, 14); g.lineTo(sx + 2.5, h - 14); g.stroke();
    }
    // spot-weld dimples all the way round the rim
    g.fillStyle = '#92969C';
    for (let x = 30; x < w - 16; x += 34) {
      g.beginPath(); g.arc(x, 22, 4.5, 0, 7); g.fill();
      g.beginPath(); g.arc(x, h - 22, 4.5, 0, 7); g.fill();
    }
    for (let y = 52; y < h - 40; y += 34) {
      g.beginPath(); g.arc(22, y, 4.5, 0, 7); g.fill();
      g.beginPath(); g.arc(w - 22, y, 4.5, 0, 7); g.fill();
    }
    // laser-etched compliance block in a corner — unreadable, but present
    const R2 = prng(seed * 977 + 5);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = '#9DA3A9';
    g.font = '600 11px ui-monospace, Menlo, monospace';
    const lot = `${String.fromCharCode(65 + (R2() * 26 | 0))}${String.fromCharCode(65 + (R2() * 26 | 0))}${100 + (R2() * 899 | 0)}`;
    g.fillText(`339S0${1000 + (R2() * 8999 | 0)}`, 26, h - 44);
    g.font = '500 9px ui-monospace, Menlo, monospace';
    g.fillStyle = '#A8ADB3';
    g.fillText(`${lot} · H1D ${23 + (R2() * 4 | 0)}${10 + (R2() * 42 | 0)}`, 26, h - 32);
    // 이름은 유령 에칭 — 사진의 실드에는 글씨가 없다
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ADB2B8';
    g.font = `700 ${Math.round(Math.min(h * 0.24, w * 0.075))}px ui-monospace, Menlo, monospace`;
    g.fillText(name, w / 2, h * 0.5);
  });
}

// 검정 패키지 위 흰 레이저 각인 — 사진의 A15 BIONIC이 이 문법이다
function blackChipTex(name, sub, aspect) {
  const W0 = 420, H0 = Math.round(Math.min(640, Math.max(160, W0 / aspect)));
  return canvasTex(W0, H0, (g, w, h) => {
    const R = prng(97);
    g.fillStyle = '#0D0E11';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 160, ['#08090B', '#17181C'], 2, 6, R);
    g.fillStyle = '#FFFFFF07';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w * 0.4, 0); g.lineTo(0, h * 0.5); g.fill();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#E8EAED';
    g.font = `700 ${Math.round(Math.min(h * 0.3, w * 0.13))}px ui-sans-serif, system-ui, sans-serif`;
    g.fillText(name, w / 2, h * (sub ? 0.42 : 0.5));
    if (sub) {
      g.fillStyle = '#9AA0A6';
      g.font = `600 ${Math.round(Math.min(h * 0.17, w * 0.07))}px ui-sans-serif, system-ui, sans-serif`;
      g.fillText(sub, w / 2, h * 0.62);
    }
    // lot and origin rows in laser grey, the way the photo's AP is marked
    g.fillStyle = '#6E747B';
    g.font = `500 ${Math.round(Math.min(h * 0.09, w * 0.04))}px ui-monospace, Menlo, monospace`;
    g.fillText(`339S0${5000 + (R() * 4999 | 0)}  ${String.fromCharCode(65 + (R() * 26 | 0))}${100 + (R() * 899 | 0)}${String.fromCharCode(65 + (R() * 26 | 0))}`, w / 2, h * 0.8);
    g.fillText(`H1D${20 + (R() * 8 | 0)}${10 + (R() * 42 | 0)} · KOREA`, w / 2, h * 0.895);
    // pin-1 index, laser dot
    g.fillStyle = '#B9BEC4';
    g.beginPath(); g.arc(w * 0.09, h * 0.12, Math.min(w, h) * 0.022, 0, 7); g.fill();
    // data-matrix stamp in the free corner
    const R3 = prng(423), q = Math.min(w, h) * 0.015, qx = w * 0.86, qy = h * 0.1;
    for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++)
      if (R3() < 0.5) { g.fillStyle = '#7C828A'; g.fillRect(qx + a * q, qy + b * q, q, q); }
  });
}

function speakerTex() {
  return canvasTex(320, 220, (g, w, h) => {
    const R = prng(808);
    g.fillStyle = '#1B1E22';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 90, ['#15181B', '#23272C'], 2, 5, R);
    // rubber acoustic gasket ring inside the box edge
    g.strokeStyle = '#0E1013'; g.lineWidth = 8; g.strokeRect(10, 10, w - 20, h - 20);
    g.strokeStyle = '#2C3036'; g.lineWidth = 3; g.strokeRect(6.5, 6.5, w - 13, h - 13);
    g.fillStyle = '#0C0E11';
    for (let a = 0; a < 12; a++) for (let b = 0; b < 7; b++) {
      g.beginPath(); g.arc(34 + a * 23, 40 + b * 21, 5, 0, 7); g.fill();
    }
    // grille dots catch light on one side
    g.fillStyle = '#33383E';
    for (let a = 0; a < 12; a++) for (let b = 0; b < 7; b++) {
      g.beginPath(); g.arc(34 + a * 23 - 1.5, 40 + b * 21 - 1.5, 1.6, 0, 7); g.fill();
    }
    // kapton service strip across a corner
    g.globalAlpha = 0.85; g.fillStyle = '#B98A2E';
    g.save(); g.translate(w * 0.8, h * 0.16); g.rotate(-0.32);
    g.fillRect(-52, -11, 104, 22); g.restore();
    g.globalAlpha = 1;
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = '#565C63'; g.font = '600 11px ui-monospace, Menlo, monospace';
    g.fillText('AUDIO CODEC · CS42L84', 16, h - 14);
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
  skin(M.copperD, copperTex(true), { roughness: 0.5, metalness: 0.7 });
  skin(M.chipBody, pkgTex(31, 'DIE', 1), { roughness: 0.62, metalness: 0.28 });
  M.pouch = mat({ color:0xFFFFFF, map: pouchTex(), roughness: 0.42, metalness: 0.55 });
  for (const t of TIERS) {
    if (t.id === 'board') for (const mk of MASKS) TIER_MAT['board:' + mk.id] = buildTierMats(t, mk);
    else TIER_MAT[t.id] = buildTierMats(t, t.pal);
  }
  applyTier(TIERS[0], 1);
}

// ───────────── one material set per tier, built once ─────────────
const TIER_MAT = {};
const VARIANTS = 6;
function buildTierMats(t, P) {
  const floorTex = t.id === 'cell' ? electrolyteTex : dieMetalTex;
  const glow = new THREE.Color(P.hiLive);
  const skin = (map, o) => mat(Object.assign({ color: 0xFFFFFF, map }, o));
  const floors = [];
  for (let v = 0; v < VARIANTS; v++) {
    const tx = floorTex(v, P);
    floors.push(skin(tx, { emissiveMap: tx, emissive: glow,
      emissiveIntensity: 0.5 - (v % 2) * 0.08, roughness: 0.62, metalness: 0.3 }));
  }
  return {
    floors,
    pour:     skin(copperPourTex(t.pal), { roughness: t.id === 'board' ? 0.42 : 0.3, metalness: 0.85 }),
    lid:      skin(passivationTex(t.pal), { roughness: 0.96 }),
    sub:      skin(substrateTex(t.pal), { roughness: 0.9 }),
  };
}

// swap the dungeon palette wholesale — the tier is what "how deep am I" looks like
let tier = TIERS[0], tierFloors = null, maskName = 'green';
function applyTier(t, depth) {
  tier = t;
  const mk = t.id === 'board' ? maskFor(depth) : null;
  maskName = mk ? mk.id : t.id;
  const s = TIER_MAT[mk ? 'board:' + mk.id : t.id];
  tierFloors = s.floors;
  M.floor = s.floors[0]; M.floorAlt = s.floors[1];
  M.copper = s.pour; M.fog = s.lid; M.pcbDark = s.sub;
}
// which of the six patterns this cell was fabbed with — stable per cell and floor
const floorMat = (x, y) => tierFloors[Math.floor(hash(x, y) * VARIANTS) % VARIANTS];

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

  // the board-to-board connector the display flex plugs into, top centre
  const conn = new THREE.Mesh(BOX, M.frame);
  conn.scale.set(1.8, 0.13, 0.36);
  conn.position.set(-0.4, 0.065, -6.85);
  conn.castShadow = true;
  boardGroup.add(conn);

  // components — what a teardown actually shows: shields, a cell, modules
  COMPONENTS.forEach((c, i) => {
    const g = new THREE.Group();
    g.position.set(c.x, 0, c.z);
    let pkg;                                   // the mesh that dims once conquered

    switch (c.id) {
      // the application processor sits exposed — black package, white marking
      case 'soc': {
        pkg = new THREE.Mesh(BOX, mat({ color:0xFFFFFF, map: blackChipTex('SoC / AP', 'DS11 BIONIC', c.w / c.d),
          roughness: 0.45, metalness: 0.35 }));
        pkg.scale.set(c.w, 0.22, c.d);
        pkg.position.y = 0.11;
        break;
      }
      // the rest of the logic column lives under stamped steel
      case 'ram': case 'pmic': case 'nand': case 'modem': {
        pkg = new THREE.Mesh(BOX, mat({ color:0xFFFFFF, map: shieldTex(i, c.name, c.w / c.d),
          roughness: 0.34, metalness: 0.85 }));
        pkg.scale.set(c.w, 0.26, c.d);
        pkg.position.y = 0.13;
        break;
      }
      case 'touch': {                          // display flex, gold fingers
        pkg = new THREE.Mesh(BOX, mat({ color:0x17191D, roughness:0.5, metalness:0.3 }));
        pkg.scale.set(c.w, 0.08, c.d);
        pkg.position.y = 0.04;
        for (let f = 0; f < 12; f++) {
          const fin = new THREE.Mesh(BOX, M.gold);
          fin.scale.set(c.w / 16, 0.03, 0.16);
          fin.position.set((f - 5.5) * (c.w / 14), 0.09, -c.d / 2 + 0.1);
          g.add(fin);
        }
        break;
      }
      case 'cam': {                            // silver bracket plate, one big lens one small
        pkg = new THREE.Mesh(BOX, mat({ color:0xFFFFFF, map: shieldTex(97, '', 1),
          roughness: 0.35, metalness: 0.85 }));
        pkg.scale.set(c.w, 0.42, c.d);
        pkg.position.y = 0.21;
        for (const [lx, lz, r] of [[0.25, 0.15, 0.72], [-0.75, -0.75, 0.34]]) {
          const barrel = new THREE.Mesh(CYL, mat({ color:0x0C0D10, roughness:0.35, metalness:0.6 }));
          barrel.scale.set(r, 0.18, r); barrel.position.set(lx, 0.5, lz);
          const ring = new THREE.Mesh(TOR, mat({ color:0x3A3E45, roughness:0.3, metalness:0.8 }));
          ring.rotation.x = Math.PI / 2;
          ring.scale.set(r * 2.2, r * 2.2, 1.1); ring.position.set(lx, 0.6, lz);
          const lens = new THREE.Mesh(CYL, mat({ color:0x14213A, roughness:0.05, metalness:0.3 }));
          lens.scale.set(r * 0.55, 0.02, r * 0.55); lens.position.set(lx, 0.6, lz);
          // sapphire glint off-centre — lenses read flat without one
          const glint = new THREE.Mesh(CYL, mat({ color:0x8FB6D9, roughness:0.1, metalness:0.2,
            emissive:0x35506B, emissiveIntensity:0.5 }));
          glint.scale.set(r * 0.13, 0.015, r * 0.13); glint.position.set(lx - r * 0.22, 0.62, lz - r * 0.22);
          g.add(barrel, ring, lens, glint);
        }
        // bracket philips screws + the flash window beside the lenses
        for (const [sx2, sz2] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const sc = new THREE.Mesh(CYL, mat({ color:0xC9CED3, roughness:0.3, metalness:0.9 }));
          sc.scale.set(0.09, 0.04, 0.09);
          sc.position.set(sx2 * (c.w / 2 - 0.22), 0.44, sz2 * (c.d / 2 - 0.22));
          g.add(sc);
        }
        const flash = new THREE.Mesh(BOX, mat({ color:0xE8D9A8, roughness:0.25,
          emissive:0xB99A4A, emissiveIntensity:0.45 }));
        flash.scale.set(0.34, 0.03, 0.34); flash.position.set(0.85, 0.44, -0.85);
        g.add(flash);
        break;
      }
      case 'batt': {                           // the pouch, with pull tabs
        pkg = new THREE.Mesh(BOX, M.pouch.clone());
        pkg.scale.set(c.w, 0.3, c.d);
        pkg.position.y = 0.15;
        for (const tx of [-1.1, 0, 1.1]) {
          const tab = new THREE.Mesh(BOX, mat({ color:0xD8DCE0, roughness:0.85 }));
          tab.scale.set(0.34, 0.02, 0.5);
          tab.position.set(tx, 0.02, c.d / 2 + 0.12);
          g.add(tab);
        }
        break;
      }
      case 'nfc': {                            // charging coil wound flat on the cell
        const film = new THREE.Mesh(CYL, mat({ color:0x1A1B1E, roughness:0.8, metalness:0.1 }));
        film.scale.set(c.w * 0.58, 0.015, c.w * 0.58);
        film.position.y = 0.32;
        g.add(film);
        // concentric windings out to the film's edge — reads as a wound pancake
        pkg = new THREE.Mesh(TOR, mat({ color:0x6E4A28, roughness:0.5, metalness:0.6 }));
        pkg.rotation.x = Math.PI / 2;
        pkg.scale.set(2.9, 2.9, 0.75);
        pkg.position.y = 0.34;
        for (const [r, tone] of [[2.35, 0x64431F], [1.8, 0x59391B], [1.25, 0x4E3018]]) {
          const wind = new THREE.Mesh(TOR, mat({ color: tone, roughness:0.4, metalness:0.8 }));
          wind.rotation.x = Math.PI / 2;
          wind.scale.set(r, r, 0.6);
          wind.position.y = 0.34;
          g.add(wind);
        }
        break;
      }
      case 'haptic': {                         // the TAPTIC-style block: black, white marking
        pkg = new THREE.Mesh(BOX, mat({ color:0xFFFFFF, map: blackChipTex('HAPTIC', 'ENGINE', c.w / c.d),
          roughness: 0.5, metalness: 0.3 }));
        pkg.scale.set(c.w, 0.3, c.d);
        pkg.position.y = 0.15;
        for (const sx of [-1, 1]) {
          const sc = new THREE.Mesh(CYL, mat({ color:0xC3C8CD, roughness:0.35, metalness:0.9 }));
          sc.scale.set(0.09, 0.05, 0.09);
          sc.position.set(sx * (c.w / 2 - 0.2), 0.32, -c.d / 2 + 0.22);
          g.add(sc);
        }
        break;
      }
      case 'audio': {                          // speaker box, dot grille
        pkg = new THREE.Mesh(BOX, mat({ color:0xFFFFFF, map: speakerTex(), roughness:0.6, metalness:0.3 }));
        pkg.scale.set(c.w, 0.3, c.d);
        pkg.position.y = 0.15;
        break;
      }
    }
    pkg.castShadow = pkg.receiveShadow = true;
    pkg.userData.baseColor = pkg.material.color.getHex();
    g.add(pkg);

    // selection halo, hidden until the hub is live — kept thin so the board reads through
    const halo = new THREE.Mesh(BOX, emissive(0x4DE0D0, 0.75));
    halo.scale.set(c.w + 0.12, 0.02, c.d + 0.12);
    halo.position.y = 0.012;
    halo.visible = false;
    g.add(halo);

    g.userData = { comp: c, idx: i, halo, pkg, hgt: 0.3 };
    boardGroup.add(g);
    icMeshes.push(g);
  });

  // ── surface-mount dust ──
  // A real frame is never empty: the strips the big parts leave open are
  // carpeted in passives, connectors and tape. All decorative, none pickable.
  const R = prng(41);
  const passiveMats = [0x2B2117, 0x3A3F45, 0x4E3527, 0x23282E]
    .map(cl => mat({ color: cl, roughness: 0.55, metalness: 0.3 }));
  const capMat = mat({ color: 0xB9BEC4, roughness: 0.35, metalness: 0.85 });
  const dust = (x0, z0, x1, z1, n) => {
    for (let i = 0; i < n; i++) {
      const p = new THREE.Mesh(BOX, passiveMats[(R() * passiveMats.length) | 0]);
      const vert = R() < 0.5, s = 0.07 + R() * 0.08;
      p.scale.set(vert ? s : s * 2.1, 0.05, vert ? s * 2.1 : s);
      p.position.set(x0 + R() * (x1 - x0), 0.025, z0 + R() * (z1 - z0));
      p.castShadow = true;
      boardGroup.add(p);
      if (R() < 0.3) {                       // some are silver MLCC cans
        const t = new THREE.Mesh(BOX, capMat);
        t.scale.copy(p.scale).multiplyScalar(0.9); t.scale.y = 0.055;
        t.position.copy(p.position);
        boardGroup.add(t); boardGroup.remove(p);
      }
    }
  };
  dust(0.6, 1.4, 3.0, 3.8, 26);              // right mid-field, under the logic column
  dust(-2.95, 3.15, 0.3, 3.85, 20);          // the strip below the cell
  dust(-2.9, -6.8, 0.0, -6.15, 12);          // top edge beside the display flex
  dust(0.45, -6.85, 3.0, -6.55, 8);          // above the touch flex

  // board-to-board connectors along the logic island's flank
  for (const [bx, bz] of [[0.42, -3.3], [0.42, -1.2], [1.0, 1.55], [2.4, 1.55]]) {
    const bb = new THREE.Mesh(BOX, mat({ color: 0xB9BEC4, roughness: 0.3, metalness: 0.85 }));
    bb.scale.set(0.5, 0.09, 0.2); bb.position.set(bx, 0.045, bz);
    const key = new THREE.Mesh(BOX, mat({ color: 0x17191D, roughness: 0.6 }));
    key.scale.set(0.4, 0.04, 0.1); key.position.set(bx, 0.1, bz);
    bb.castShadow = true;
    boardGroup.add(bb, key);
  }

  // kapton service tape, half-transparent amber, thrown over the seams
  const tapeMat = mat({ color: 0xC08A2E, roughness: 0.5, metalness: 0.15,
    transparent: true, opacity: 0.5 });
  for (const [tx2, tz2, tw2, td2, ta] of [[0.42, -5.75, 0.55, 0.32, 0.35], [-0.9, 3.5, 1.0, 0.34, -0.1],
                                          [2.55, 2.2, 0.34, 0.8, 0.06]]) {
    const tape = new THREE.Mesh(BOX, tapeMat);
    tape.scale.set(tw2, 0.012, td2);
    tape.position.set(tx2, 0.06, tz2);
    tape.rotation.y = ta;
    boardGroup.add(tape);
  }

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
let phase = 'board';   // board | dungeon | dead — the home screen sits over the board

function newGame() {
  G = {
    lv:1, xp:0, atk:1, def:0,
    bat:5, health:100, heat:0, shutdown:0,
    depth:0, floor:0, comp:null, cleared:[],
    kills:0, tiles:0,
    batBonus:0,     // CLEAN ROOM payouts and CELL TRIM, permanent
    fogBonus:0,     // FOG TAP: extra battery per tile of fog lifted
    killCool:0,     // VAPOR PATH: heat shed on every kill
    carry:[],       // monsters that followed you down from a MIGRATION floor
    nextHeat:0,     // heat a THERMAL floor charges you on arrival
    skills:[],      // circuits ripped from beaten components — the only skills you have
    buff:0, cd:{}, watchdog:false,
    dead:false, cause:'',
    log:[], coach:new Set(),
    map:null, targeting:null,
    pending:null,   // planned action awaiting a confirming second tap
    walking:null,   // in-progress path traversal
  };
}

const maxBat = () => Math.max(1, Math.floor(5 * G.lv * G.health / 100) + G.batBonus);
function heatState() {
  if (G.shutdown > 0) return 'shutdown';
  if (G.heat >= 90) return 'throttle';
  if (G.heat >= 70) return 'warm';
  return 'nominal';
}
const heatCost = c => {
  const gm = gim();
  let v = heatState() === 'warm' ? Math.round(c * 1.5) : c;
  v *= gm?.heatMul || 1;
  v *= gm?.zone?.()?.heatMul || 1;
  return Math.round(v);
};
function effAtk() {
  const gm = gim();
  let a = G.atk + (gm?.atk?.() || 0) + (gm?.zone?.()?.atk || 0);
  if (heatState() === 'throttle') a = Math.floor(a * 0.75);
  if (G.buff > 0) a = Math.floor(a * 1.5);
  return Math.max(1, a);
}

// ════════════════════════════════════════════════════════════════
//  component gimmicks
//
//  Until now the gimmick line on each component was flavour text and every
//  soldered part played identically. Each one is now a rule that hooks the turn
//  loop, so choosing where to go on the board is choosing what game to play.
// ════════════════════════════════════════════════════════════════

const SOC_ZONES = [
  { id:'hot',  name:'열 구획',   note:'스킬 열 2배',        heatMul: 2 },
  { id:'cool', name:'냉각 구획', note:'안개 냉각 2배',      coolMul: 2 },
  { id:'fast', name:'가속 구획', note:'ATK +3',             atk: 3 },
  { id:'weak', name:'감압 구획', note:'반격 피해 +2',       back: 2 },
];

const GIM = {
  // 렌즈 왜곡 — the base 8 around you always open (anything else reads as a bug);
  // the lens ADDS a second reveal box pulled one cell toward the die centre.
  cam: {
    extraAt(x, y) {
      const cx = (W - 1) / 2, cy = (H - 1) / 2;
      return [x + Math.sign(cx - x), y + Math.sign(cy - y)];
    },
  },

  // 코어 구획마다 규칙이 다르다 — four quadrants, four contracts
  soc: {
    onGen(m) { m.zones = shuffle(SOC_ZONES.slice()); },
    zone() {
      const m = G.map;
      if (!m.zones) return null;
      return m.zones[(m.py < H / 2 ? 0 : 2) + (m.px < W / 2 ? 0 : 1)];
    },
    onMove() {
      const z = GIM.soc.zone();
      if (z && z !== G.zone) { G.zone = z; say(`<b class="a">${z.name}</b> — ${z.note}`); }
    },
  },

  // 걷힌 안개가 되돌아온다 — refresh. What comes back is the map, not the charge:
  // a re-fogged cell is marked spent, or the floor would be an endless battery farm.
  ram: {
    onGen(m) { m.bad = Array.from({ length: H }, () => new Array(W).fill(0)); },
    onTurn() {
      if (G.tiles % 4) return;
      const m = G.map, back = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
        if (!m.fog[y][x] && !m.wall[y][x] && dist(x, y, m.px, m.py) > 3) back.push({ x, y });
      shuffle(back).slice(0, 3).forEach(p => { m.fog[p.y][p.x] = 1; m.bad[p.y][p.x] = 1; });
      if (back.length) syncMeshes();
    },
    fogGain(n) { return G.map.bad?.[G.map.py]?.[G.map.px] ? 0 : n; },
  },

  // 전압 변동 — ATK swings every turn
  pmic: {
    onTurn() { G.volt = ri(-1, 2); },
    atk() { return G.volt || 0; },
  },

  // 배드 섹터 — cells that give nothing back
  nand: {
    onGen(m) {
      m.bad = Array.from({ length: H }, () => new Array(W).fill(0));
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
        if (!m.wall[y][x] && rnd() < 0.28) m.bad[y][x] = 1;
      m.bad[m.py][m.px] = 0;
    },
    fogGain(n) { return G.map.bad?.[G.map.py]?.[G.map.px] ? 0 : n; },
  },

  // 외부에서 침입자가 들어온다 — the edge keeps letting things in
  modem: {
    onTurn() {
      const m = G.map;
      if (G.tiles % 5 || m.mons.filter(o => !o.dead).length >= 14) return;
      const edge = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (m.wall[y][x] || monAt(x, y)) continue;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge.push({ x, y });
      }
      if (!edge.length) return;
      const p = pick(edge), t = pick(MONSTERS);
      const lv = Math.max(1, 1 + Math.floor(G.depth * 0.72) + ri(-1, 1));
      const hp = Math.max(1, Math.round(2.5 * lv * t.hp));
      m.mons.push({ x:p.x, y:p.y, t, lv, hp, max:hp,
        atk: Math.max(1, Math.round(1.2 * lv * t.atk)), def: Math.round(t.def * lv * 0.5),
        halt:0, dead:false, wasHit:false, intruder:true });
      monObj.push(makeMonster(m.mons[m.mons.length - 1]));
      syncMeshes();
      say('<b class="r">침입</b> — 외부에서 무언가 들어왔다');
    },
  },

  // 소리가 잠든 것을 깨운다 — noise wakes the neighbours, and the woken ones bite
  // as you pass. This is the one floor where walking past is not free.
  audio: {
    onNoise(x, y) {
      let n = 0;
      for (const mo of G.map.mons)
        if (!mo.dead && !mo.awake && dist(mo.x, mo.y, x, y) <= 3) { mo.awake = true; n++; }
      if (n) { say(`<b class="a">${n}기가 깨어났다</b> — 지나가면 물린다`); syncMeshes(); }
    },
    onMove(x, y) {
      for (const mo of G.map.mons) {
        if (mo.dead || !mo.awake || dist(mo.x, mo.y, x, y) > 1) continue;
        takeHit(mo, '기회공격');
        if (G.dead) return;
      }
    },
  },

  // 발열 2배, 대신 처치가 곧 충전
  batt: {
    heatMul: 2,
    onKill(mo) {
      const got = Math.min(maxBat() - G.bat, mo.lv);
      if (got > 0) { G.bat += got; floatText(mo.x, mo.y, '+' + got, '#4DE0D0'); }
    },
  },

  // 진동 — everything gets shoved
  haptic: {
    onTurn() {
      if (G.tiles % 3) return;
      const m = G.map;
      let moved = 0;
      for (const mo of m.mons) {
        if (mo.dead) continue;
        const [dx, dy] = pick(DIRS8);
        const nx = mo.x + dx, ny = mo.y + dy;
        if (!inB(nx, ny) || m.wall[ny][nx] || monAt(nx, ny)) continue;
        if (nx === m.px && ny === m.py) continue;
        mo.x = nx; mo.y = ny; moved++;
      }
      if (moved) { syncMeshes(); say('<b class="a">진동</b> — 배치가 흔들렸다'); }
    },
  },

  // 코일 위 칸들이 서로 연결된다
  nfc: {
    onGen(m) {
      const free = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
        if (!m.wall[y][x] && dist(x, y, m.px, m.py) > 2) free.push({ x, y });
      shuffle(free);
      m.coils = [];
      for (let i = 0; i + 1 < free.length && m.coils.length < 3; i += 2)
        m.coils.push([free[i], free[i + 1]]);
    },
    onStep(x, y) {
      const m = G.map;
      for (const [a, b] of m.coils || []) {
        const to = (a.x === x && a.y === y) ? b : (b.x === x && b.y === y) ? a : null;
        if (!to) continue;
        // a camped twin refuses the jump — say so, or the pad reads as broken
        if (monAt(to.x, to.y)) { say('<b class="r">반대편 코일이 점유됐다</b> — 결합 불가'); return false; }
        m.px = to.x; m.py = to.y;
        G.walking = null;                    // the planned path started somewhere else
        gainFromFog(revealFog(m, to.x, to.y, 1));
        placePlayer(true); syncMeshes();
        say('<b class="c">코일 결합</b> — 반대편으로 넘어갔다. 다시 밟으면 돌아온다');
        return true;
      }
      return false;
    },
  },
};

const gim = () => (G.comp && GIM[G.comp.id]) || null;

// ───────────── map generation ─────────────
function genMap(depth) {
  const px = 4, py = H - 2;
  let wall, reach, tries = 0;
  do {
    tries++;
    wall = Array.from({ length: H }, () => new Array(W).fill(1));   // solid pour

    // pads: the wide spots. Everything else is a run between them.
    const pads = [{ x: px, y: py }];
    for (let i = 0, n = ri(3, 5); i < n; i++) pads.push({ x: ri(1, W - 2), y: ri(2, H - 3) });
    pads.push({ x: ri(1, W - 2), y: ri(0, 1) });                    // a landing up top
    for (const p of pads) cut(wall, p.x, p.y, rnd() < 0.45 ? 1 : 0);
    cut(wall, px, py, 1);

    // nearest-neighbour chain, so the layout reads as one net rather than noise
    const left = pads.slice(1);
    let cur = pads[0];
    while (left.length) {
      left.sort((a, b) => dist(a.x, a.y, cur.x, cur.y) - dist(b.x, b.y, cur.x, cur.y));
      const nxt = left.shift();
      trace(wall, cur.x, cur.y, nxt.x, nxt.y, rnd() < 0.22 ? 1 : 0);
      cur = nxt;
    }
    // spare runs: a corridor plugged by a monster should not orphan a whole region
    for (let i = 0; i < 3; i++) {
      const a = pick(pads), b = pick(pads);
      trace(wall, a.x, a.y, b.x, b.y);
    }
    if (rnd() < 0.7) meander(wall, ri(1, 3), ri(1, H - 7), ri(3, 5), ri(2, 3), 2);
    if (rnd() < 0.6) bus(wall, ri(0, 3), ri(1, 4), ri(6, H - 2), ri(3, 4), 2);

    reach = reachSet(wall, px, py);
  } while (reach.size < 46 && tries < 60);

  const open = [];
  for (const k of reach) {
    const x = k % W, y = (k / W) | 0;
    if (dist(x, y, px, py) > 2) open.push({ x, y });
  }

  open.sort((a, b) => dist(b.x, b.y, px, py) - dist(a.x, a.y, px, py));
  const via = open.shift() || { x: px, y: Math.max(0, py - 3) };
  shuffle(open);

  const mons = [];
  // whatever you refused to kill upstairs shows up here first, at full health
  for (const c of G.carry) {
    if (!open.length) break;
    const p = open.shift();
    mons.push({ ...c, x:p.x, y:p.y, hp:c.max, halt:0, dead:false, wasHit:false, migrated:true });
  }
  const count = Math.min(11, 4 + Math.floor(depth / 2)) - mons.length;   // 초반은 4기부터
  const base = 1 + Math.floor(depth * 0.72);
  for (let i = 0; i < count && open.length; i++) {
    const p = open.shift();
    const boss = depth % 4 === 0 && i === 0;
    const t = boss ? BOSS : pick(MONSTERS);
    const lv = Math.max(1, boss ? base + 2 : base + ri(-1, 2));
    // Player scale is now ATK 1 / BAT 5. An equal-level ZOMBIE (hp ≈ 2.5L,
    // atk ≈ 1.2L) dies in ~3 swings and bills ~2 counters — winnable from turn
    // one, and the ratios hold as both sides grow.
    const hp = Math.max(1, Math.round(2.5 * lv * t.hp));
    mons.push({ x:p.x, y:p.y, t, lv, hp, max:hp,
      atk: Math.max(1, Math.round(1.2 * lv * t.atk)), def: Math.round(t.def * lv * 0.5),
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
  gim()?.onGen?.(m);
  revealFog(m, px, py, 1);
  return m;
}

// everything actually walkable from the start, 8-way like movement itself —
// content is only ever placed inside this set, so nothing can spawn walled off
function reachSet(wall, sx, sy) {
  const seen = new Set([sy * W + sx]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of DIRS8) {
      const nx = x + dx, ny = y + dy, k = ny * W + nx;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H || seen.has(k) || wall[ny][nx]) continue;
      if (dx && dy && (wall[y][nx] && wall[ny][x])) continue;   // no diagonal squeeze
      seen.add(k); q.push([nx, ny]);
    }
  }
  return seen;
}

// ───────────── routing primitives ─────────────
// A board is not a cave. Copper pour is the wall and the traces are the corridors,
// so a floor gets read the way a layout is read: pads joined by runs, a meander
// where a length had to be matched, a bus where several signals travel together.
const inB = (x, y) => x >= 0 && x < W && y >= 0 && y < H;

function cut(wall, x, y, r = 0) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
    if (inB(x + dx, y + dy)) wall[y + dy][x + dx] = 0;
}

// break out at 45° until aligned, then run straight — how a router leaves a pad
function trace(wall, ax, ay, bx, by, r = 0) {
  let x = ax, y = ay, guard = 0;
  cut(wall, x, y, r);
  while ((x !== bx || y !== by) && guard++ < 64) {
    const dx = Math.sign(bx - x), dy = Math.sign(by - y);
    if (dx && dy) { x += dx; y += dy; } else if (dx) x += dx; else y += dy;
    cut(wall, x, y, r);
  }
}

// serpentine delay line: the length-matching squiggle every board has
function meander(wall, x0, y0, span, rows, pitch) {
  let dir = 1, x = x0;
  for (let r = 0; r < rows; r++) {
    const y = y0 + r * pitch;
    if (y >= H) break;
    for (let i = 0; i < span; i++) { cut(wall, x, y); x = Math.max(0, Math.min(W - 1, x + dir)); }
    for (let j = 0; j <= pitch && y + j < H; j++) cut(wall, x, y + j);
    dir = -dir;
  }
}

// a bundle of parallel runs, joined at one end like a fan-out
function bus(wall, x0, y0, y1, lanes, gap) {
  const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
  for (let i = 0; i < lanes; i++) {
    const x = x0 + i * gap;
    if (!inB(x, lo)) continue;
    for (let y = lo; y <= hi; y++) cut(wall, x, y);
  }
  for (let i = 0; i < lanes; i++) cut(wall, x0 + i * gap, hi);
  for (let x = x0; x < x0 + lanes * gap; x++) cut(wall, x, hi);
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
const FOG_H = 0.38;
// Copper is a pour, not masonry: one uniform low height, cells butted edge to edge
// so a run of wall reads as a single flooded plane the way a ground fill does.
const WALL_H = 0.17;
const gx2w = x => (x - (W - 1) / 2) * TILE;
const gy2w = y => (y - (H - 1) / 2) * TILE;

let tileMesh = [], fogMesh = [], wallMesh = [], monObj = [], itemObj = [], coilObj = [], viaObj = null, playerObj = null;
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
  tileMesh = []; fogMesh = []; wallMesh = []; monObj = []; itemObj = []; coilObj = [];
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
  applyTier(tierOf(G.depth), G.depth);   // palette follows depth, before anything is built
  const m = G.map;

  // substrate slab under everything
  const slab = new THREE.Mesh(BOX, M.pcbDark);
  slab.scale.set(W + 1.2, 0.5, H + 1.2);
  slab.position.y = -0.55;
  slab.receiveShadow = true;
  dunGroup.add(slab);

  buildDieEdge();

  // NAND bad blocks are drawn burnt-out — you must be able to see the dead cells
  const badMat = m.bad ? M.floor.clone() : null;
  if (badMat) { badMat.color.setHex(0x4A4650); badMat.emissiveIntensity = 0.08; }

  for (let y = 0; y < H; y++) {
    tileMesh[y] = []; fogMesh[y] = []; wallMesh[y] = []; pickMesh[y] = [];
    for (let x = 0; x < W; x++) {
      const wx = gx2w(x), wz = gy2w(y);

      if (m.wall[y][x]) {
        const wl = new THREE.Mesh(BOX, M.copper);
        wl.scale.set(0.999, WALL_H, 0.999);
        wl.position.set(wx, WALL_H / 2, wz);
        wl.castShadow = true; wl.receiveShadow = true;
        wl.userData = { gx:x, gy:y };
        dunGroup.add(wl); wallMesh[y][x] = wl;
      } else {
        // butted edge to edge: the metal layer is one surface, not a tray of tiles
        const bad = m.bad?.[y]?.[x];
        const fl = new THREE.Mesh(BOX, bad ? badMat : floorMat(x, y));
        fl.scale.set(0.999, 0.14, 0.999);
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
      fg.scale.set(0.999, FOG_H, 0.999);
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

  // A coil is a pair, so draw it as one: flat windings in the metal its twin
  // shares. Etched into the board, not lying on it — items glow, the floor
  // doesn't, so the pad stays matte copper and only the hue names its twin.
  (m.coils || []).forEach(([a, b2], i) => {
    const col = [0xA9622E, 0x8F949C, 0x7A6B3E][i % 3];   // copper / tin / brass
    for (const c of [a, b2]) {
      const g2 = new THREE.Group();
      for (const r of [1.15, 0.85, 0.55]) {
        const w2 = new THREE.Mesh(TOR, mat({ color: col, roughness: 0.4, metalness: 0.85,
          emissive: col, emissiveIntensity: 0.22 }));
        w2.rotation.x = Math.PI / 2;
        w2.scale.set(r, r, 0.5);
        w2.position.y = 0.03;
        g2.add(w2);
      }
      const slug = new THREE.Mesh(CYL, mat({ color: 0x2A2C30, roughness: 0.7, metalness: 0.4,
        emissive: col, emissiveIntensity: 0.12 }));
      slug.scale.set(0.2, 0.05, 0.2); slug.position.y = 0.03;
      g2.add(slug);
      g2.position.set(gx2w(c.x), 0, gy2w(c.y));
      g2.userData = { coil: c };
      dunGroup.add(g2); coilObj.push(g2);
    }
  });

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
  // watchdog rides as a ring around the token and vanishes when it is spent
  const dog = new THREE.Mesh(TOR, emissive(0x4DE0D0, 2.2));
  dog.rotation.x = Math.PI / 2;
  dog.scale.set(1.5, 1.5, 1.5);
  dog.visible = false;
  playerObj.add(core, shell, pkP, dog);
  playerObj.userData = { core, shell, pick: pkP, dog };
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

  // Every enemy is a part you would find on the board. The silhouette carries the
  // rule: a can is armoured, an axial body is fragile, a diode only conducts one way.
  const lead = (x, z, lx, lz) => {                       // tinned wire off the body
    const l = new THREE.Mesh(BOX, M.gold);
    l.scale.set(lx, 0.05, lz);
    l.position.set(x, 0.09, z);
    g.add(l);
  };

  switch (mo.t.shape) {
    // ── SOIC微chip: the ordinary process ──
    case 'chip':
      body.scale.set(0.58, 0.24, 0.44); body.position.y = 0.22;
      top = new THREE.Mesh(BOX, em); top.scale.set(0.3, 0.06, 0.2); top.position.y = 0.36;
      for (let side = -1; side <= 1; side += 2) for (let p = -1; p <= 1; p++) {
        const pin = new THREE.Mesh(BOX, M.gold);
        pin.scale.set(0.08, 0.04, 0.14);
        pin.position.set(p * 0.19, 0.12, side * 0.28);
        g.add(pin);
      }
      break;

    // ── axial resistor: thin body, colour bands, snaps under load ──
    case 'res': {
      const rb = new THREE.Mesh(CYL, mat({ color:0xC9B48A, roughness:0.7, metalness:0.1 }));
      rb.rotation.z = Math.PI / 2;
      rb.scale.set(0.19, 0.44, 0.19); rb.position.y = 0.19;
      g.add(rb); body.visible = false;
      const bandCols = [0x9A5528, 0x1A1A1A, col];
      bandCols.forEach((c, i) => {
        const bd = new THREE.Mesh(CYL, i === 2 ? em : mat({ color:c, roughness:0.6 }));
        bd.rotation.z = Math.PI / 2;
        bd.scale.set(0.205, 0.055, 0.205);
        bd.position.set((i - 1) * 0.12, 0.19, 0);
        g.add(bd);
        if (i === 2) top = bd;
      });
      lead(-0.32, 0, 0.2, 0.05); lead(0.32, 0, 0.2, 0.05);
      break;
    }

    // ── electrolytic can: the armour is literally a metal sleeve ──
    case 'cap': {
      const can = new THREE.Mesh(CYL, mat({ color:0x2B3A46, roughness:0.35, metalness:0.75 }));
      can.scale.set(0.46, 0.5, 0.46); can.position.y = 0.25;
      g.add(can); body.visible = false;
      const stripe = new THREE.Mesh(BOX, mat({ color:0xC6D3DD, roughness:0.6 }));
      stripe.scale.set(0.13, 0.44, 0.02);
      stripe.position.set(-0.15, 0.25, 0.235);
      g.add(stripe);
      for (const r of [0, Math.PI / 2]) {                // the scored vent cross on top
        const v = new THREE.Mesh(BOX, mat({ color:0x18222B, roughness:0.5, metalness:0.6 }));
        v.scale.set(0.42, 0.02, 0.05); v.position.y = 0.51; v.rotation.y = r;
        g.add(v);
      }
      top = new THREE.Mesh(CYL, em); top.scale.set(0.3, 0.05, 0.3); top.position.y = 0.53;
      break;
    }

    // ── toroid inductor: a wound core, and winding is what makes it run hot ──
    case 'ind': {
      const core = new THREE.Mesh(TOR, mat({ color:0x2A2A2E, roughness:0.75 }));
      core.rotation.x = Math.PI / 2;
      core.scale.set(1.15, 1.15, 1.15); core.position.y = 0.16;
      g.add(core); body.visible = false;
      for (let i = 0; i < 8; i++) {                      // copper turns over the core
        const a2 = i / 8 * Math.PI * 2;
        const t2 = new THREE.Mesh(BOX, M.copperD);
        t2.scale.set(0.07, 0.19, 0.2);
        t2.position.set(Math.cos(a2) * 0.28, 0.16, Math.sin(a2) * 0.28);
        t2.rotation.y = -a2;
        g.add(t2);
      }
      top = new THREE.Mesh(TOR, em);
      top.rotation.x = Math.PI / 2;
      top.scale.set(0.62, 0.62, 0.62); top.position.y = 0.3;
      break;
    }

    // ── axial diode: glass body, cathode band, conducts one way and strikes first ──
    case 'diode': {
      const gb = new THREE.Mesh(CYL, mat({ color:0x14181C, roughness:0.25, metalness:0.4 }));
      gb.rotation.z = Math.PI / 2;
      gb.scale.set(0.2, 0.4, 0.2); gb.position.y = 0.2;
      g.add(gb); body.visible = false;
      const band = new THREE.Mesh(CYL, em);
      band.rotation.z = Math.PI / 2;
      band.scale.set(0.215, 0.09, 0.215);
      band.position.set(0.13, 0.2, 0);
      g.add(band); top = band;
      lead(-0.3, 0, 0.2, 0.05); lead(0.3, 0, 0.2, 0.05);
      break;
    }

    // ── the big QFP that runs the show ──
    case 'boss':
      body.scale.set(0.8, 0.34, 0.8); body.position.y = 0.24;
      top = new THREE.Mesh(BOX, em); top.scale.set(0.46, 0.08, 0.46); top.position.y = 0.44;
      for (let side = 0; side < 4; side++) {             // leads on all four sides
        for (let p = -2; p <= 2; p++) {
          const pin = new THREE.Mesh(BOX, M.gold);
          const along = p * 0.15, out = 0.47;
          pin.scale.set(side % 2 ? 0.16 : 0.07, 0.04, side % 2 ? 0.07 : 0.16);
          pin.position.set(side % 2 ? (side === 1 ? out : -out) : along, 0.1,
                           side % 2 ? along : (side === 0 ? out : -out));
          g.add(pin);
        }
      }
      for (let i = -1; i <= 1; i++) {                    // heatsink fins
        const fin = new THREE.Mesh(BOX, M.copperD);
        fin.scale.set(0.07, 0.26, 0.62);
        fin.position.set(i * 0.24, 0.55, 0);
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
  ring.scale.set(1.24, 1.24, 1.24);   // tight enough to leave the part readable
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
  syncPlayerFx();
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
    const rc = mo.awake ? 0xFFB454 : c;                  // awake: it will bite in passing
    g.userData.em.emissive.setHex(c);
    g.userData.ring.material.emissive.setHex(rc);
    g.userData.ring.material.color.setHex(rc);
    g.userData.ring.material.emissiveIntensity = mo.awake ? 3.4 : 2.4;
    g.userData.spr.material = numSprite(mo.lv, danger ? '#FF8A94' : '#DCE6EE');
    const r = Math.max(0.02, mo.hp / mo.max);
    g.userData.bar.scale.x = 0.62 * r;
    g.userData.bar.material.emissive.setHex(r > 0.5 ? 0x6BD98A : r > 0.25 ? 0xFFB454 : 0xFF4D5E);
  });
  itemObj.forEach(g => { g.visible = !g.userData.it.taken && m.fog[g.userData.it.y][g.userData.it.x] !== 1; });
  coilObj.forEach(g => { const c = g.userData.coil; g.visible = m.fog[c.y][c.x] !== 1; });
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
  const was = tier;
  G.map = genMap(G.depth);
  buildDungeon();
  if (tier !== was) say(`<b class="a">${tier.name}</b> — ${tier.note}`);
  if (G.nextHeat) { addHeat(G.nextHeat); G.nextHeat = 0; }
  if (G.salvage) { applyItem(G.salvage); G.salvage = null; }
  say(`<b class="${G.map.sector.col}">${G.map.sector.name}</b> — ${G.map.sector.rule}`);
  sync();
}

function gainFromFog(n) {
  if (n <= 0) return;
  const before = G.bat;
  G.bat = Math.min(maxBat(), G.bat + n * (G.lv + G.fogBonus));
  G.heat = Math.max(0, G.heat - n * 2 * (gim()?.zone?.()?.coolMul || 1));
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
  gim()?.onTurn?.();
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
  const gm = gim();
  m.px = x; m.py = y;
  G.tiles++;
  let got = revealFog(m, x, y, 1);
  if (gm?.extraAt) { const [rx, ry] = gm.extraAt(x, y); got += revealFog(m, rx, ry, 1); }
  if (gm?.fogGain) got = gm.fogGain(got);
  gainFromFog(got);
  tickTurn();
  placePlayer(false);
  syncMeshes();
  gm?.onMove?.(x, y);
  if (G.dead) return;
  if (gm?.onStep?.(x, y)) return;          // a coil moved us; the step is spent
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
  if (G.floor >= G.comp.floors) { completeComponent(); return; }
  phase = 'zoom';
  const m = G.map;
  warpAtWorld(gx2w(m.via.x), DUNGEON_Y + 0.2, gy2w(m.via.y), () => {
    nextFloor(false);
    phase = 'dungeon';
    resize();
    sync();
  });
}

// BAD BLOCK floors seal the exit until half the sector is cleared
const killsNeeded = () => {
  const m = G.map;
  return Math.max(0, Math.ceil(m.mons.length / 2) - m.mons.filter(o => o.dead).length);
};
const viaLocked = () => G.map.sector.id === 'lock' && killsNeeded() > 0;

function applyItem(t) {
  switch (t.id) {
    case 'trim': offerUpgrade(); break;
    case 'full': G.bat = maxBat(); floatText(G.map.px, G.map.py, 'FULL', '#FFB454'); say(`<b class="a">${t.name}</b> — 배터리 완충`); break;
    case 'cool': G.heat = 0; G.shutdown = 0; say(`<b class="a">${t.name}</b> — 열 전량 방출`); break;
    case 'nova': {
      const dmg = 4 * G.lv; let n = 0;
      for (const mo of G.map.mons) {
        if (mo.dead || dist(mo.x, mo.y, G.map.px, G.map.py) > 1) continue;
        hurt(mo, dmg); n++;
      }
      say(`<b class="a">${t.name}</b> — 인접 ${n}기에 ${dmg} 피해`);
      shake(0.4);
      break;
    }
    case 'emp': {
      const dmg = 3 * G.lv; let n = 0;
      for (const mo of G.map.mons) {
        if (mo.dead || dist(mo.x, mo.y, G.map.px, G.map.py) > 2) continue;
        hurt(mo, dmg); boltAt(mo.x, mo.y); n++;
      }
      say(`<b class="a">${t.name}</b> — 반경 2, ${n}기에 ${dmg} 피해`);
      shake(0.4);
      break;
    }
    case 'spark': {
      let best = null;
      for (const mo of G.map.mons) {
        if (mo.dead || G.map.fog[mo.y][mo.x] === 1) continue;
        const d = dist(mo.x, mo.y, G.map.px, G.map.py);
        if (!best || d < best.d) best = { mo, d };
      }
      if (best) {
        const dmg = 5 * G.lv;
        hurt(best.mo, dmg); boltAt(best.mo.x, best.mo.y);
        say(`<b class="a">${t.name}</b> — ${best.mo.t.name}에게 ${dmg} 방전`);
        shake(0.3);
      } else say(`<b class="a">${t.name}</b> — 방전할 대상이 없다`);
      break;
    }
  }
}

// Three draws from the pool, one kept. Pathfinding never routes *through* an item
// tile, so a module is always the last step of a walk and this can safely stop
// the world: nothing is mid-move behind the card.
function offerUpgrade() {
  const pool = shuffle(UPGRADES.filter(u => !(u.once && u.once()))).slice(0, 3);
  showOver(`
    <h1>TRIM</h1>
    <div class="sub">강화 모듈 · 하나를 고른다</div>
    <div class="picks">${pool.map((u, i) => `
      <button class="pick ${u.col}" data-i="${i}">
        <span class="ax">${u.axis}</span>
        <span class="bd"><span class="pn">${u.name}</span>
        <span class="pd">${u.desc}</span>
        <span class="pnote">${u.note}</span></span>
        <span class="cur">${u.at()}</span>
      </button>`).join('')}</div>`);
  cardEl.querySelectorAll('.pick').forEach(el => {
    el.onclick = () => {
      const u = pool[+el.dataset.i];
      u.go();
      hideOver();
      say(`<b class="${u.col}">${u.name}</b> 설치 — ${u.desc.replace(/<[^>]+>/g, '')}`);
      floatText(G.map.px, G.map.py, u.axis, '#4DE0D0');
      syncPlayerFx();
      sync();
    };
  });
  cardEl.querySelector('.pick')?.focus();
}

function hurt(mo, dmg) {
  mo.hp -= dmg;
  floatText(mo.x, mo.y, '-' + dmg, '#FF9AA4');
  const g = monObj.find(o => o.userData.mo === mo);
  if (g) g.userData.flash = 1;
  if (mo.hp <= 0) {
    mo.dead = true; G.kills++;
    gim()?.onKill?.(mo);
    if (G.killCool) {                                  // VAPOR PATH
      const c = Math.min(G.heat, G.killCool);
      if (c > 0) { G.heat -= c; floatText(mo.x, mo.y, `열 −${c}`, '#FFB454'); }
    }
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
    G.xp -= need; G.lv++; G.atk += 2;
    G.bat = maxBat(); G.heat = 0; G.shutdown = 0;   // the signature move
    say(`<b class="c">LEVEL ${G.lv}</b> — 최적화 완료. 배터리 완충, 열 0`);
    floatText(G.map.px, G.map.py, 'LV' + G.lv, '#4DE0D0');
    need = XP_TABLE[G.lv - 1] ?? 9999;
  }
}

function attack(mo) {
  if (G.shutdown > 0) { say('셧다운 중 — 이동해서 <b class="c">냉각</b>하라'); return; }
  const my = Math.max(1, effAtk() - mo.def);
  if (mo.t.ambush && !mo.wasHit) { takeHit(mo, '선공'); if (G.dead) return; }
  mo.wasHit = true;
  gim()?.onNoise?.(G.map.px, G.map.py);
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
  const dmg = Math.max(1, mo.atk - G.def + (gim()?.zone?.()?.back || 0));
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
      syncPlayerFx();
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
      // coils fling on contact, so a route never crosses one by accident —
      // jumping is something you tap, not something that happens to you
      if ((m.coils || []).some(([a, b]) => (a.x === x && a.y === y) || (b.x === x && b.y === y)))
        return false;
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
  gim()?.onNoise?.(m.px, m.py);
  if (s.cd) G.cd[s.id] = s.cd + 1;
  tickTurn();
  syncMeshes();
}

// ════════════════════════════════════════════════════════════════
//  feedback
// ════════════════════════════════════════════════════════════════

const logEl = document.getElementById('log');
let logFadeT = null;
function say(html) {
  G.log.push(html);
  if (G.log.length > 20) G.log.shift();
  const last = G.log.slice(-2);
  logEl.innerHTML = last.map((l, i) => `<div class="${i === last.length - 1 ? 'fresh' : ''}">› ${l}</div>`).join('');
  // in the hub a message is a toast in the strict sense: it says its line and leaves
  clearTimeout(logFadeT);
  logEl.classList.remove('faded');
  if (phase !== 'dungeon') logFadeT = setTimeout(() => logEl.classList.add('faded'), 3000);
  placeToasts();
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
  // the stage is the screen: full viewport on a phone, the mockup's display on desktop
  const w = stageEl.clientWidth, h = stageEl.clientHeight, dpr = Math.min(2, devicePixelRatio);
  // reallocating the drawing buffer flickers, and visualViewport fires on every
  // URL-bar frame — only resize when the box actually changed
  if (w !== sizedW || h !== sizedH || dpr !== sizedDpr) {
    sizedW = w; sizedH = h; sizedDpr = dpr;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h);
  }
  const inDun = phase === 'dungeon' || phase === 'zoom';

  if (!inDun) {
    // Hub: this IS the inside of the phone, not a diagram of one. Fit the board
    // plate to the full stage width and let the chassis crop at the edges — the
    // glass went transparent, you are looking straight down into the device.
    const fw = PLATE_W + 0.5;
    const fh = fw * h / w;
    viewSpan = fh;
    cam.left = -fw / 2; cam.right = fw / 2;
    cam.top = fh / 2; cam.bottom = -fh / 2;
    cam.updateProjectionMatrix();
    placeToasts();
    return;
  }

  // Dungeon: the readouts are a real object with a real height. Measure them, fit
  // the play area into what is left, then bias the ortho window so the board sits
  // in that band — otherwise the panels sit on the tiles you are trying to tap.
  const topH = $('hud').classList.contains('on') ? topEl.offsetHeight || 0 : 0;
  const dockH = dockEl.classList.contains('on') ? dockEl.offsetHeight || 0 : 0;
  const availH = Math.max(160, h - topH - dockH - 10);

  const needW = W + 2.2;
  const needH = (H + 1.5) * Math.cos(CAM.tilt * RAD) + 1.2;

  const aspect = w / availH;
  let fw, fh;
  if (aspect < needW / needH) { fw = needW; fh = needW / aspect; }
  else { fh = needH; fw = needH * aspect; }

  const unitsPerPx = fh / availH;              // same scale, stretched to the whole screen
  const fhFull = h * unitsPerPx;
  const shift = (topH - dockH) / 2 * unitsPerPx;
  viewSpan = fhFull;
  cam.left = -fw / 2; cam.right = fw / 2;
  cam.top = fhFull / 2 + shift; cam.bottom = -fhFull / 2 + shift;
  cam.updateProjectionMatrix();
  placeToasts();
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
  let best = null;
  for (const g of icMeshes) {
    const hits = ray.intersectObject(g, true);
    if (hits.length && (!best || hits[0].distance < best.d)) best = { g, d: hits[0].distance };
  }
  return best ? best.g : null;
}

canvas.addEventListener('pointerdown', ev => {
  if (phase === 'board') {
    const g = pickComponent(ev);
    if (g) tapComponent(g); else cancelBoardSel();   // empty space backs out
    return;
  }
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
    say(`LV${G.lv} · ATK ${effAtk()} · 배터리 ${G.bat}/${maxBat()}`);
    return;
  }
  G.forcing = false;

  // second tap on the same target = confirm
  if (G.pending && G.pending.x === x && G.pending.y === y) { commitPending(); return; }

  planTo(x, y);
}

// What walking this path is worth, before you commit to it: the fog each step
// will lift, priced with the same rules the walk itself uses — lens distortion,
// dead cells, cool zones, FOG TAP. The same numbers, just read out in advance.
function previewWalk(path) {
  const m = G.map, gm = gim();
  const seen = new Set();
  let n = 0;
  for (const st of path) {
    let k = 0;
    const boxes = [[st.x, st.y]];
    if (gm?.extraAt) boxes.push(gm.extraAt(st.x, st.y));
    for (const [rx, ry] of boxes)
      for (let y = ry - 1; y <= ry + 1; y++) for (let x = rx - 1; x <= rx + 1; x++) {
        if (x < 0 || x >= W || y < 0 || y >= H) continue;
        const key = y * W + x;
        if (seen.has(key)) continue;
        seen.add(key);
        if (m.fog[y][x] !== 0) k++;
      }
    if (gm?.fogGain && m.bad?.[st.y]?.[st.x]) k = 0;   // a dead cell pays nothing
    n += k;
  }
  return {
    bat: Math.max(0, Math.min(maxBat() - G.bat, n * (G.lv + G.fogBonus))),
    heat: Math.min(G.heat, n * 2 * (gim()?.zone?.()?.coolMul || 1)),
  };
}

// the "N칸 이동" prefix, with what the walk pays baked in
function walkNote(path) {
  const pv = previewWalk(path);
  return `${path.length}칸 이동` +
    (pv.bat > 0 ? ` · 배터리 <b class="c">+${pv.bat}</b>` : '') +
    (pv.heat > 0 ? ` · 열 <b class="a">−${pv.heat}</b>` : '');
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
      ? `${walkNote(app.path)} 후 <b class="r">교전</b> — 한 번 더 탭하면 실행`
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
    const onCoil = (m.coils || []).some(([a, b]) => (a.x === x && a.y === y) || (b.x === x && b.y === y));
    const note = walkNote(path);
    say(it ? `${note} — <b class="a">${it.t.name}</b>을 밟는다. 한 번 더 탭`
           : onVia
             ? `${note} — <b class="a">VIA로 하강</b>한다. 한 번 더 탭`
             : onCoil
               ? `${note} — <b class="c">코일 결합</b>, 반대편으로 점프한다. 한 번 더 탭`
               : `${note} — 한 번 더 탭하면 실행`);
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
  // HAPTIC shoves parts around and BASEBAND drops new ones in, so a cell that was
  // clear when the path was planned may not be clear when we get there
  const blocker = monAt(s.x, s.y);
  if (blocker) { G.walking = null; say('길이 막혔다 — 경로를 다시 잡아라'); sync(); return; }
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
  const owned = ownedSkills();
  if (n >= 0 && owned[n]) { e.preventDefault(); fireSkill(owned[n]); }
});

// ════════════════════════════════════════════════════════════════
//  skill dock — one slot per skill, always on screen, fires on tap
// ════════════════════════════════════════════════════════════════

// Every other action in this game asks for a confirming second tap. Skills do not:
// the slot itself is the confirmation, because it carries the cost and the cooldown
// on its face. Press-and-hold reads the long description instead of firing.
const dockEl = document.getElementById('skills');
const slotEls = new Map();

let dockKey = null;
function ownedSkills() { return G ? SKILLS.filter(s => G.skills.includes(s.id)) : []; }
function buildDock() {
  const owned = ownedSkills();
  dockKey = owned.map(s => s.id).join();
  dockEl.innerHTML = '';
  slotEls.clear();
  for (const s of owned) {
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
  if (G && dockKey !== G.skills.join()) buildDock();
  const live = phase === 'dungeon' && G && !G.dead && G.skills.length > 0;
  dockEl.classList.toggle('on', !!live);
  if (!live) return;
  for (const s of ownedSkills()) {
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
const toastsEl = document.getElementById('toasts');

// park the explanations on whichever half of the screen the player is not
function placeToasts() {
  const h = stageEl.clientHeight;
  if (phase !== 'dungeon') {
    // hub: everything on screen is a part now — hug the bottom rail and get out
    toastsEl.style.top = 'auto';
    toastsEl.style.bottom = '14px';
    return;
  }
  let low = false;                                // toasts at the top by default
  if (phase === 'dungeon' && G && G.map) {
    // the logical cell, not the animated token — correct the moment a move commits
    const v = new THREE.Vector3(gx2w(G.map.px), DUNGEON_Y + 0.5, gy2w(G.map.py));
    v.project(cam);
    const sy = (1 - (v.y * 0.5 + 0.5)) * h;
    low = sy <= h * 0.52;                         // player high on screen → drop low
  }
  if (low) {
    toastsEl.style.top = 'auto';
    toastsEl.style.bottom = ((dockEl.classList.contains('on') ? dockEl.offsetHeight : 0) + 10) + 'px';
  } else {
    const topH = document.getElementById('hud').classList.contains('on') ? topEl.offsetHeight : 46;
    toastsEl.style.top = (topH + 8) + 'px';
    toastsEl.style.bottom = 'auto';
  }
}
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
    (ambush ? `<br><span class="dt"><b class="r">선공</b> — 내가 치기 전에 <b class="r">${ambush}</b> 피해를 먼저 맞는다</span>` : '') +
    ` · 교환 후 배터리 <b class="${lethal ? 'r' : 'c'}">${Math.max(0, after)}</b>` +
    (lethal ? ' <b class="r">치명</b>' : '') + `</span><br>` +
    `<span class="dt">${mo.t.note}</span>`;
  coach('mon');
}
// Everything you are carrying, as cards. A run's build is invisible otherwise —
// DEF and WATCHDOG never appeared anywhere until the moment they saved you.
const buffsEl = document.getElementById('buffs');   // $ is declared further down
function syncBuffs() {
  const cards = [];
  const card = (cls, label, value, pulse) =>
    cards.push(`<span class="bf ${cls}${pulse ? ' pulse' : ''}">${label}<span class="v">${value}</span></span>`);

  if (G.buff > 0) card('r', 'TAP', '×1.5', true);
  if (G.def > 0) card('g', 'SHIELD', 'DEF ' + G.def);
  if (G.atk > 2 * G.lv - 1) card('r', 'CLOCK', '+' + (G.atk - (2 * G.lv - 1)));
  if (G.batBonus > 0) card('c', 'CELL', '+' + G.batBonus);
  if (G.fogBonus > 0) card('c', 'FOG', '+' + G.fogBonus + '/칸');
  if (G.killCool > 0) card('a', 'VENT', '−' + G.killCool);
  const gm = gim();
  const v = gm?.atk?.();
  if (v) card(v > 0 ? 'g' : 'r', 'VOLT', (v > 0 ? '+' : '') + v, true);
  const z = gm?.zone?.();
  if (z) card('a', z.name, z.note);
  if (G.watchdog) card('c', 'WATCHDOG', '대기', true);
  if (G.shutdown > 0) card('r', 'SHUTDOWN', G.shutdown + '턴', true);

  buffsEl.innerHTML = cards.join('');
}

// the same state, but on the token — a shell that thickens with DEF and a
// watchdog ring that is visibly spent the moment it fires
function syncPlayerFx() {
  if (!playerObj) return;
  const u = playerObj.userData;
  const s = 0.78 + Math.min(4, G.def) * 0.07;
  u.shell.scale.set(s, s, s);
  u.shell.material.opacity = 0.24 + Math.min(4, G.def) * 0.11;
  u.shell.material.emissiveIntensity = 0.5 + Math.min(4, G.def) * 0.35;
  u.shell.material.color.setHex(G.def > 0 ? 0x6BD98A : 0x4DE0D0);
  u.shell.material.emissive.setHex(G.def > 0 ? 0x6BD98A : 0x4DE0D0);
  u.dog.visible = !!G.watchdog;
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
    ` · 배터리 최대 ${Math.max(1, Math.floor(5 * G.lv * after / 100) + G.batBonus)}</span><br>` +
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
const COACH = {};   // 친절은 접는다 — 규칙은 ?와 첫 탭 미리보기가 말해준다
let coachTimer = null;
function coach(id) {
  if (!G || G.coach.has(id) || !COACH[id]) return;
  G.coach.add(id);
  coachEl.innerHTML = COACH[id];
  coachEl.classList.add('on');
  placeToasts();
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
  $('batFill').style.width = Math.max(0, G.bat / mb * G.health) + '%';
  $('batDead').style.width = (100 - G.health) + '%';
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
  syncBuffs();
  const q = exitQuote();
  $('sector').innerHTML = `<b class="${q.sector.col}">${q.sector.name}</b> · ${q.sector.short}`;
  $('left').innerHTML = `잔존 <b>${q.left}</b> · 통과 ` +
    `<b class="${q.loss > 4 ? 'r' : 'a'}">−${q.loss}%</b>${q.locked ? ' <b class="r">봉인</b>' : ''}`;
  syncDock();

  if (viaObj && viaObj.visible) coach('via');
  placeToasts();
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
      <div class="lg"><span class="sw" style="--c:#4DE0D0"></span><span><b>나</b> — 시안 큐브. 스킬은 처음엔 없다 — <b>소자를 격파할 때마다 하나씩</b> 뜯어와 아래 슬롯에 장착된다</span></div>
      <div class="lg"><span class="sw ring" style="--c:#C87137"></span><span><b>VIA</b> — 아래층으로 내려가는 구멍. <b>전멸하고 내려가면 완충·손실 0</b>, 적을 남기면 남긴 수만큼 수명이 깎인다</span></div>
      <div class="lg"><span class="sw" style="--c:#FFB454"></span><span><b>구역 규칙</b> — 층마다 다르다. HUD 맨 아랫줄에 그 층에서 <b>다 잡을 값어치</b>가 적혀 있다</span></div>
      <div class="lg"><span class="sw" style="--c:#6BD98A"></span><span><b>강화 모듈</b> — 밟으면 <b>공·방·체</b> 셋 중 하나를 고른다. 무엇을 키울지가 이 판의 빌드다</span></div>
      <div class="lg"><span class="sw" style="--c:#FFB454"></span><span><b>소모품</b> — 밟는 즉시 발동한다. 인벤토리는 없다</span></div>
    </div>
    <p>레벨업하면 <b class="c">배터리가 완충되고 열이 0</b>이 된다. 죽기 직전에 레벨업을 맞추는 것이 이 게임의 핵심이다.</p>
    <button id="ok">내려간다</button>`);
  $('ok').onclick = () => { hideOver(); sync(); };
  $('ok').focus();
}

// eleven components taken. Until now this state existed and nothing happened.
function showWin() {
  phase = 'dead';
  syncDock();
  showOver(`
    <h1>DIE SHRINK</h1>
    <div class="sub">ALL COMPONENTS OWNED</div>
    <p>기판 위의 <b>열한 개 소자</b>를 전부 장악했다.<br>
       이 폰은 이제 당신의 것이다.</p>
    <div class="stats">
      <span>최종 깊이</span><span>${G.depth}</span>
      <span>레벨</span><span>${G.lv}</span>
      <span>처치</span><span>${G.kills}</span>
      <span>걸은 칸</span><span>${G.tiles}</span>
      <span>배터리 수명</span><span>${G.health}%</span>
    </div>
    <button id="again">다시 시작</button>`);
  $('again').onclick = () => { hideOver(); restart(); };
  $('again').focus();
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
  G.cleared.push(G.comp.id);
  say(`<b class="g">${G.comp.name} 클리어</b>`);
  if (G.cleared.length >= COMPONENTS.length) return showWin();
  // skills are loot: each beaten component yields one circuit of your choice
  const offers = SKILLS.filter(s => !G.skills.includes(s.id));
  showOver(`
    <h1>${G.comp.name}</h1>
    <div class="sub">COMPONENT CLEARED</div>
    ${offers.length
      ? `<p>전리품 — 이 소자의 <b class="c">회로 하나</b>를 뜯어간다</p>
         <div class="picks">${offers.map((s, i) => `
           <button class="pick c" data-i="${i}">
             <span class="ax">칩</span>
             <span class="bd"><span class="pn">${s.name}</span>
             <span class="pd">${s.desc} · 열 +${s.heat}${s.cd ? ` · 쿨 ${s.cd}턴` : ''}</span>
             <span class="pnote">${s.long}</span></span>
           </button>`).join('')}</div>`
      : '<p>이 소자를 장악했다. 기판으로 돌아가 다음 소자를 고른다.</p>'}
    <div class="stats">
      <span>배터리</span><span>${G.bat}/${maxBat()}</span>
      <span>레벨</span><span>${G.lv}</span>
      <span>배터리 수명</span><span>${G.health}%</span>
    </div>
    ${offers.length ? '' : '<button id="up">기판으로</button>'}`);
  // a salvaged module opens its own card, so it has to wait for this one to close
  const done = () => {
    hideOver();
    toBoard();
    if (G.salvage) { const s = G.salvage; G.salvage = null; applyItem(s); }
  };
  if (offers.length) {
    cardEl.querySelectorAll('.pick').forEach(el => {
      el.onclick = () => {
        const s = offers[+el.dataset.i];
        G.skills.push(s.id);
        say(`<b class="c">${s.name}</b> 회로 확보 — 하단 슬롯에 장착됐다`);
        done();
      };
    });
    cardEl.querySelector('.pick')?.focus();
  } else {
    $('up').onclick = done;
    $('up').focus();
  }
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
  phase = 'zoom';
  cancelBoardSel();
  hideInspect();
  const back = G.comp ? [G.comp.x, 0.3, G.comp.z] : null;
  warpAtWorld(CAM.focus.x, DUNGEON_Y, CAM.focus.z, () => {
    phase = 'board';
    $('hud').classList.remove('on');
    dunGroup.visible = false;
    boardGroup.visible = true;
    CAM.focus.set(0, 0, 0);
    CAM.dist = 70;
    syncDock();
    resize();
    updateBoardHalos();
    say('소자를 선택하라');
  }, 'out', back);
}

function updateBoardHalos() {
  icMeshes.forEach(g => {
    const c = g.userData.comp;
    const done = G.cleared.includes(c.id);
    g.userData.halo.visible = !done && phase === 'board';
    // a taken part goes dark but keeps its own look
    const base = g.userData.pkg.userData.baseColor ?? 0xFFFFFF;
    g.userData.pkg.material.color.setHex(done ? 0x30343A : base);
  });
}

// Now that every part plays by its own rule, choosing one blind is not a choice.
// First tap reads the datasheet, second tap commits — same contract as the board.
// First tap: a popover right next to the part, with its datasheet and an ✕.
// Second tap on the same part enters; empty space or the ✕ backs out.
let boardSel = null;
const popEl = document.getElementById('popover');

function cancelBoardSel() {
  boardSel = null;
  popEl.classList.remove('on');
  icMeshes.forEach(o => o.userData.halo.material.emissiveIntensity = 0.75);
}

function tapComponent(g) {
  const c = g.userData.comp;
  if (G.cleared.includes(c.id)) { cancelBoardSel(); say('이미 장악한 소자다'); return; }
  if (boardSel === c.id) { cancelBoardSel(); selectComponent(g); return; }
  boardSel = c.id;
  icMeshes.forEach(o => o.userData.halo.material.emissiveIntensity = o === g ? 2.6 : 0.75);

  popEl.innerHTML =
    `<button id="popX" aria-label="닫기">✕</button>` +
    `<div class="nm">${c.name}</div>` +
    `<div class="dt">${c.floors}개 층 · ${c.gimmick}</div>` +
    `<div class="go">한 번 더 탭하면 진입</div>`;
  popEl.classList.add('on');
  // anchor next to the part, flipped to whichever side has room
  const v = new THREE.Vector3(c.x, 0.4, c.z).project(cam);
  const w = stageEl.clientWidth, h = stageEl.clientHeight;
  const sx = (v.x * 0.5 + 0.5) * w, sy = (1 - (v.y * 0.5 + 0.5)) * h;
  const pw = popEl.offsetWidth, ph = popEl.offsetHeight;
  popEl.style.left = Math.max(8, Math.min(w - pw - 8, sx - pw / 2)) + 'px';
  popEl.style.top = (sy < h * 0.55 ? sy + 22 : sy - ph - 22) + 'px';
  $('popX').onpointerdown = e => { e.stopPropagation(); cancelBoardSel(); };
}

// Hyperdrive dive. The canvas itself is scaled toward the tapped part while it
// blurs out; at the peak the scene is swapped in one frame; then it decompresses.
// No camera travel between worlds — there is nothing to scroll past.
let warpT1 = null, warpT2 = null;
const ZOOM_CLS = ['zin', 'zout', 'zinB', 'zoutB'];
// dir 'in': the frame magnifies into the tap point until it dissolves, and the new
// scene arrives still expanding — one continuous fall inward. dir 'out' reverses
// both halves: the world shrinks away, and the board arrives oversized and settles.
function warpAtWorld(x, y, z, cut, dir = 'in', backAt = null) {
  const v = new THREE.Vector3(x, y, z).project(cam);
  canvas.style.transformOrigin =
    `${(v.x * 0.5 + 0.5) * 100}% ${(1 - (v.y * 0.5 + 0.5)) * 100}%`;
  canvas.classList.remove(...ZOOM_CLS);
  void canvas.offsetWidth;
  canvas.classList.add(dir === 'in' ? 'zin' : 'zout');
  tweenTo({ dist: dir === 'in' ? Math.max(24, CAM.dist * 0.45) : CAM.dist * 1.7 }, 440);
  clearTimeout(warpT1); clearTimeout(warpT2);
  warpT1 = setTimeout(() => {
    tween = null;                                          // the rush must not outlive the cut
    cut();
    let origin = '50% 50%';
    if (backAt) {
      const b = new THREE.Vector3(backAt[0], backAt[1], backAt[2]).project(cam);
      origin = `${(b.x * 0.5 + 0.5) * 100}% ${(1 - (b.y * 0.5 + 0.5)) * 100}%`;
    }
    canvas.style.transformOrigin = origin;
    canvas.classList.remove(...ZOOM_CLS);
    void canvas.offsetWidth;
    canvas.classList.add(dir === 'in' ? 'zinB' : 'zoutB');
    warpT2 = setTimeout(() => {
      canvas.classList.remove(...ZOOM_CLS);
      canvas.style.transformOrigin = '50% 50%';
    }, 560);
  }, 450);
}

function selectComponent(g) {
  const c = g.userData.comp;
  if (G.cleared.includes(c.id)) { say('이미 장악한 소자다'); return; }
  phase = 'zoom';
  icMeshes.forEach(o => o.userData.halo.visible = false);
  enterComponent(c);                       // built now, revealed at the cut
  warpAtWorld(c.x, 0.3, c.z, () => {
    boardGroup.visible = false;
    dunGroup.visible = true;
    CAM.focus.set(0, DUNGEON_Y, 0);
    CAM.dist = 40;
    phase = 'dungeon';
    $('hud').classList.add('on');
    $('log').classList.add('on');
    resize();
    sync();                                // the dock only appears once the phase is live
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
//  opening — no boot cutscene: the home screen glitches out and the
//  board was under it the whole time
// ════════════════════════════════════════════════════════════════

const skipBtn = $('skip');

// ───────────── home screen: the outside of the phone ─────────────
const homeEl = $('home');
{
  const APPS = [
    ['📷','카메라','#3A4250'], ['🖼','사진','#4E3A2E'], ['💬','메시지','#2E7D4F'], ['🎵','뮤직','#B03A48'],
    ['🗺','지도','#2E5E4E'], ['☁️','날씨','#2E5578'], ['🕐','시계','#22262E'], ['📈','주식','#20242C'],
    ['GAME','DIE SHRINK',''], ['🧮','계산기','#3A3E46'], ['📝','메모','#8A7A3A'], ['⚙️','설정','#3C424C'],
  ];
  const DOCK = [['📞','통화','#2E9E52'], ['✉️','메일','#2E6ED8'], ['🌐','웹','#2E5578'], ['🎧','팟캐스트','#7A4FB0']];
  const mk = ([glyph, name, bg]) => {
    const el = document.createElement('div');
    const game = glyph === 'GAME';
    el.className = 'app' + (game ? ' game' : '');
    el.innerHTML = `<span class="ic" style="--bg:${bg}">${game ? '' : glyph}</span><span class="lb">${name}</span>`;
    el.onpointerdown = () => {
      if (game) return launchGame();
      el.classList.remove('deny'); void el.offsetWidth;   // restart the wiggle
      el.classList.add('deny');
    };
    return el;
  };
  APPS.forEach(a => $('apps').appendChild(mk(a)));
  DOCK.forEach(a => $('dock').appendChild(mk(a)));
  const t = new Date();
  $('stTime').textContent = t.getHours() + ':' + String(t.getMinutes()).padStart(2, '0');
  $('hbuild').textContent = 'BUILD ' + (window.__BUILD || 'dev');
}

let homeDone = false;
function launchGame() {
  if (homeDone) return;
  homeDone = true;
  homeEl.classList.add('gone');   // 지지직 — the screen gives out; the board is under it
  setTimeout(enterBoard, 650);
}

function enterBoard() {
  homeEl.style.display = 'none';
  skipBtn.classList.add('gone');
  $('tools').classList.add('on');
  $('log').classList.add('on');
  updateBoardHalos();
  resize();
  say('기판이 드러났다 · 도움말 <b class="c">?</b>');
}
skipBtn.onclick = launchGame;

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
    const dog = playerObj.userData.dog;
    if (dog.visible) { dog.rotation.z = -t * 1.6; dog.material.emissiveIntensity = 1.7 + Math.sin(t * 3) * 0.6; }
    playerLight.position.set(playerObj.position.x, DUNGEON_Y + 2.4, playerObj.position.z);
    const st = heatState();
    const hc = st === 'throttle' || st === 'shutdown' ? 0xFF4D5E : st === 'warm' ? 0xFFB454 : 0x4DE0D0;
    playerObj.userData.core.material.emissive.setHex(hc);
    // TAP is armed: the core runs hot until it is spent
    playerObj.userData.core.material.emissiveIntensity = G && G.buff > 0 ? 4.2 + Math.sin(t * 9) * 1.2 : 2.6;
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
  if (phase === 'board') {
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

document.getElementById('build').textContent = 'BUILD ' + (window.__BUILD || 'dev');

buildBoard();
M.glass.opacity = 0; glassMesh.visible = false;
glassMesh.userData.icons.visible = false;
buildDock();
newGame();
dunGroup.visible = false;
CAM.tilt = TILT_STEPS[tiltIdx]; CAM.dist = 70;
updateBoardHalos();
addEventListener('resize', resize);
// the top stack grows and shrinks as panels open — refit when its transitions land
topEl.addEventListener('transitionend', resize);
addEventListener('orientationchange', resize);
// a phone hides its URL bar without always firing window resize; the canvas would
// keep the stale height and every tap would read off by that difference
visualViewport?.addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);
