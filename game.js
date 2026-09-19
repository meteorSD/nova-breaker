/* NOVA BREAKER 3D — casse-briques néon en three.js
   Physique 2D (plan XY) rendue dans une arène 3D : briques volumiques,
   balle lumineuse, débris 3D, bloom, caméra perspective + parallaxe. */
import * as THREE from 'three';
import { EffectComposer } from './vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/addons/postprocessing/OutputPass.js';

// ---------------------------------------------------------------- constantes
const AW = 30;            // largeur intérieure de l'arène  (x : -15 .. 15)
const AH = 22;            // hauteur de l'arène             (y : 0 .. 22)
const RAIL = 0.7;         // épaisseur des rails latéraux
const COLS = 12, ROWS = 8, GAP = 0.34;
const BRICK_TOP = 20.6, BRICK_BOTTOM = 11.4, BDEPTH = 1.5;
const BW = (AW - (COLS - 1) * GAP) / COLS;
const BH = (BRICK_TOP - BRICK_BOTTOM - (ROWS - 1) * GAP) / ROWS;
const BALL_R = 0.44;
const PADDLE_Y = 2.0, PADDLE_H = 0.78, PADDLE_D = 1.05;
const PADDLE_W = 4.4, PADDLE_WIDE = 6.6;
const BASE_SPEED = 15.2, SPEED_PER_BRICK = 0.3, SPEED_CAP = 27, SPEED_PER_LEVEL = 1.15;
const LEVELS = 6;
const FIXED = 1 / 120;

const HP_COLOR = { 1: 0x2ee6ff, 2: 0xff4fd8, 3: 0xffb347 };
const STEEL_COLOR = 0x8fb4ff;
const POWER_TYPES = [
  { t: 'M', c: 0xff4fd8, hex: '#ff4fd8', label: 'MULTI-BALLES !', w: 30 },
  { t: 'W', c: 0x2ee6ff, hex: '#2ee6ff', label: 'PALETTE XXL !', w: 25 },
  { t: 'S', c: 0x5dff8f, hex: '#5dff8f', label: 'RALENTI !', w: 16 },
  { t: 'F', c: 0xff8a3d, hex: '#ff8a3d', label: 'BALLE DE FEU !', w: 21 },
  { t: '+', c: 0xff5d7a, hex: '#ff5d7a', label: 'VIE +1 !', w: 8 }
];

// ---------------------------------------------------------------- niveaux
const PATTERNS = [
  (r, c) => (r >= 1 && r <= 3 && c >= 1 && c <= 10) ? ((r === 3 && c >= 3 && c <= 8) ? 2 : 1) : 0,
  (r, c) => (r >= 1 && r <= 5 && (r + c) % 2 === 0) ? (r >= 4 ? 2 : 1) : 0,
  (r, c) => {
    if (r >= 1 && r <= 5 && Math.abs(c - 5.5) < r) return r >= 4 ? 2 : 1;
    if (r === 6 && c % 3 === 1) return -1;
    return 0;
  },
  (r, c) => {
    if (r < 1 || r > 6) return 0;
    if (r === 1 || (r === 6 && (c < 4 || c > 7)) || c === 0 || c === 11) return -1;
    if (r >= 3 && r <= 4 && c >= 4 && c <= 7) return 3;
    return 2;
  },
  (r, c) => (c % 2 === 0 && r >= 1 && r <= 6) ? 1 + ((r + ((c / 2) | 0)) % 3) : 0,
  (r, c) => {
    if (r < 1 || r > 6) return 0;
    if (r === 1 && c % 4 !== 1) return -1;
    const d = Math.abs(c - 5.5) + Math.abs(r - 3.5);
    if (d <= 2) return 3;
    if (d <= 4) return 2;
    return 1;
  }
];

// ---------------------------------------------------------------- état
const G = {
  state: 'menu',            // menu | serving | playing | paused | levelclear | gameover | win
  score: 0, hi: 0, lives: 3, level: 1, combo: 0,
  balls: [], bricks: [], powerups: [], debris: [], rings: [],
  paddle: { x: 0, target: 0, w: PADDLE_W },
  wide: 0, slow: 0, fire: 0,
  shake: 0, time: 0, destroyed: 0, servedBalls: 0
};
try { G.hi = parseInt(localStorage.getItem('novaBreaker3DHi') || '0', 10) || 0; } catch (e) { }

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rnd = (a, b) => a + Math.random() * (b - a);
const mult = () => Math.min(8, 1 + Math.floor(G.combo / 4));

// ---------------------------------------------------------------- renderer
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.96;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x03050c);
scene.fog = new THREE.FogExp2(0x03050c, 0.0058);

const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.1, 400);
camera.position.set(0, 8.4, 34);
camera.lookAt(0, 10.6, 0);
const camBase = new THREE.Vector3(0, 8.4, 34);
const camTarget = new THREE.Vector3(0, 10.6, 0);

// ---------------------------------------------------------------- post-fx
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.52, 0.4);
composer.addPass(bloom);
composer.addPass(new OutputPass());
let useBloom = true;

// ---------------------------------------------------------------- lumières
scene.add(new THREE.AmbientLight(0x334466, 1.5));
const hemi = new THREE.HemisphereLight(0x3a6ea5, 0x0a0616, 1.1);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xbfe9ff, 1.5);
key.position.set(-12, 26, 22);
scene.add(key);
const rim = new THREE.DirectionalLight(0xff77dd, 0.85);
rim.position.set(14, 10, -12);
scene.add(rim);

// ---------------------------------------------------------------- textures
function gridTexture(size, step, line, bold, boldStep) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  x.fillStyle = '#04060e';
  x.fillRect(0, 0, size, size);
  x.lineWidth = 1;
  x.strokeStyle = line;
  for (let i = 0; i <= size; i += step) {
    x.beginPath(); x.moveTo(i + .5, 0); x.lineTo(i + .5, size); x.stroke();
    x.beginPath(); x.moveTo(0, i + .5); x.lineTo(size, i + .5); x.stroke();
  }
  if (boldStep) {
    x.lineWidth = 2; x.strokeStyle = bold;
    for (let i = 0; i <= size; i += boldStep) {
      x.beginPath(); x.moveTo(i, 0); x.lineTo(i, size); x.stroke();
      x.beginPath(); x.moveTo(0, i); x.lineTo(size, i); x.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function letterTexture(ch) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 128, 128);
  x.font = 'bold 82px "Segoe UI", system-ui, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineJoin = 'round';
  // contour sombre : la lettre reste lisible par-dessus le gemme lumineux
  x.lineWidth = 16; x.strokeStyle = 'rgba(2,6,14,0.95)';
  x.strokeText(ch, 64, 70);
  x.lineWidth = 7; x.strokeStyle = 'rgba(2,6,14,0.9)';
  x.strokeText(ch, 64, 70);
  x.shadowColor = 'rgba(255,255,255,0.8)'; x.shadowBlur = 10;
  x.fillStyle = '#ffffff';
  x.fillText(ch, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const TEX = {
  glow: glowTexture(),
  grid: gridTexture(512, 32, 'rgba(80,190,255,0.30)', 'rgba(140,225,255,0.52)', 128),
  floor: gridTexture(512, 32, 'rgba(110,215,255,0.40)', 'rgba(170,240,255,0.62)', 128)
};
TEX.floor.repeat.set(26, 18);
TEX.grid.repeat.set(6, 5);
const LETTERS = {};
POWER_TYPES.forEach(p => { LETTERS[p.t] = letterTexture(p.t); });

function glowSprite(color, scale, opacity) {
  const m = new THREE.SpriteMaterial({
    map: TEX.glow, color, blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false, opacity: opacity === undefined ? 1 : opacity
  });
  const s = new THREE.Sprite(m);
  s.scale.setScalar(scale);
  return s;
}

// ---------------------------------------------------------------- arène
const arena = new THREE.Group();
scene.add(arena);

// mur du fond — grille émissive pour la profondeur
const backWall = new THREE.Mesh(
  new THREE.PlaneGeometry(AW + 26, AH + 22),
  new THREE.MeshStandardMaterial({
    map: TEX.grid, emissiveMap: TEX.grid, emissive: 0x2f7fe0, emissiveIntensity: 0.5,
    color: 0x0a1226, roughness: 0.95, metalness: 0.05
  })
);
backWall.position.set(0, AH / 2 - 1, -4.2);
arena.add(backWall);

// sol — grille émissive qui file vers la caméra (repère de profondeur)
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(220, 150),
  new THREE.MeshStandardMaterial({
    map: TEX.floor, emissiveMap: TEX.floor, emissive: 0x2aa8ff, emissiveIntensity: 0.62,
    color: 0x070b18, roughness: 0.78, metalness: 0.3
  })
);
floor.rotation.x = -Math.PI / 2;
floor.position.set(0, -1.6, 26);
arena.add(floor);

// socle de l'arène : posé sur la grille (pas flottant) pour ancrer le volume
const FLOOR_Y = -1.6;
const baseMat = new THREE.MeshStandardMaterial({ color: 0x080e1e, emissive: 0x1b6cff, emissiveIntensity: 0.42, roughness: 0.35, metalness: 0.7 });
const BASE_H = 1.95;
const base = new THREE.Mesh(new THREE.BoxGeometry(AW + RAIL * 2 + 0.4, BASE_H, 2.6), baseMat);
base.position.set(0, FLOOR_Y + BASE_H / 2, 0.4);
arena.add(base);
const baseEdge = new THREE.LineSegments(
  new THREE.EdgesGeometry(base.geometry),
  new THREE.LineBasicMaterial({ color: 0x8ff2ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending })
);
baseEdge.position.copy(base.position);
arena.add(baseEdge);

// liseré lumineux sur le dessus du socle + rainures : évite l'effet « gros bloc brut »
const stripMat = new THREE.MeshStandardMaterial({ color: 0x0a1424, emissive: 0x66e8ff, emissiveIntensity: 1.5, roughness: 0.3, metalness: 0.6 });
const strip = new THREE.Mesh(new THREE.BoxGeometry(AW + RAIL * 2 + 0.44, 0.13, 2.64), stripMat);
strip.position.set(0, FLOOR_Y + BASE_H - 0.07, 0.4);
arena.add(strip);
const grooveMat = new THREE.MeshBasicMaterial({ color: 0x1d5fa8, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
for (let gx = -AW / 2; gx <= AW / 2 + 0.01; gx += 2.5) {
  const gr = new THREE.Mesh(new THREE.PlaneGeometry(0.05, BASE_H * 0.62), grooveMat);
  gr.position.set(gx, FLOOR_Y + BASE_H * 0.42, 1.72);
  arena.add(gr);
}

// faux ombrage de contact : la grille s'assombrit sous l'arène
const aoTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 10, 128, 128, 126);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const contact = new THREE.Mesh(
  new THREE.PlaneGeometry(AW + 26, 26),
  new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.NormalBlending })
);
contact.rotation.x = -Math.PI / 2;
contact.position.set(0, FLOOR_Y + 0.02, 6);
arena.add(contact);

// piliers d'angle : tubes néon volumiques (arêtes visibles) pour la parallaxe
const pillarGeo = new THREE.BoxGeometry(0.42, AH + 3.4, 0.42);
const pillarEdgeGeo = new THREE.EdgesGeometry(pillarGeo);
const pillarMatC = new THREE.MeshStandardMaterial({ color: 0x07131f, emissive: 0x2ee6ff, emissiveIntensity: 0.85, roughness: 0.3, metalness: 0.6 });
const pillarMatM = new THREE.MeshStandardMaterial({ color: 0x1a0722, emissive: 0xff4fd8, emissiveIntensity: 0.85, roughness: 0.3, metalness: 0.6 });
[[-(AW / 2 + RAIL + 1.2), pillarMatC, 0x9ff6ff], [(AW / 2 + RAIL + 1.2), pillarMatM, 0xffb3ec]].forEach(([px, pm, ec]) => {
  [[-3.0, 1.0], [3.6, 0.8]].forEach(([pz, sc]) => {
    const p = new THREE.Mesh(pillarGeo, pm);
    p.position.set(px, (AH + 3.4) / 2 - 1.6, pz);
    p.scale.set(sc, 1, sc);
    arena.add(p);
    const e = new THREE.LineSegments(pillarEdgeGeo, new THREE.LineBasicMaterial({ color: ec, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    e.position.copy(p.position);
    e.scale.copy(p.scale);
    arena.add(e);
  });
});

// brume néon à l'horizon : adoucit la jonction sol / mur du fond
const hazeTex = (() => {
  const c = document.createElement('canvas'); c.width = 8; c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(20,60,140,0)');
  g.addColorStop(0.55, 'rgba(40,120,220,0.20)');
  g.addColorStop(0.85, 'rgba(90,200,255,0.42)');
  g.addColorStop(1, 'rgba(140,230,255,0.55)');
  x.fillStyle = g; x.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const haze = new THREE.Mesh(
  new THREE.PlaneGeometry(230, 22),
  new THREE.MeshBasicMaterial({ map: hazeTex, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
);
haze.position.set(0, -1.6 + 11, -4.05);
arena.add(haze);

// rails néon — ancrés jusqu'au sol pour que l'arène « pose » dans l'espace
const railMat = new THREE.MeshStandardMaterial({ color: 0x0a1830, emissive: 0x1b6cff, emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.6 });
const railMatR = new THREE.MeshStandardMaterial({ color: 0x1a0a24, emissive: 0xff2fb0, emissiveIntensity: 0.45, roughness: 0.4, metalness: 0.6 });
function rail(w, h, d, x, y, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, -0.2);
  arena.add(m);
  const e = new THREE.LineSegments(
    new THREE.EdgesGeometry(m.geometry),
    new THREE.LineBasicMaterial({ color: mat.emissive.getHex(), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending })
  );
  e.position.copy(m.position);
  arena.add(e);
  return m;
}
const SIDE_H = (AH + RAIL) - FLOOR_Y;
const SIDE_Y = (AH + RAIL + FLOOR_Y) / 2;
rail(RAIL, SIDE_H, 1.7, -(AW / 2 + RAIL / 2), SIDE_Y, railMat);
rail(RAIL, SIDE_H, 1.7, (AW / 2 + RAIL / 2), SIDE_Y, railMatR);
rail(AW + RAIL * 2, RAIL, 1.7, 0, AH + RAIL / 2, railMat);

// joints de coin : masquent la rupture brutale entre rail cyan et rail magenta
const jointMat = new THREE.MeshStandardMaterial({ color: 0x0b1424, emissive: 0xbfe9ff, emissiveIntensity: 0.85, roughness: 0.3, metalness: 0.7 });
[-(AW / 2 + RAIL / 2), (AW / 2 + RAIL / 2)].forEach(jx => {
  const j = new THREE.Mesh(new THREE.BoxGeometry(RAIL + 0.34, RAIL + 0.34, 1.9), jointMat);
  j.position.set(jx, AH + RAIL / 2, -0.2);
  arena.add(j);
});

// ---------------------------------------------------------------- palette
const paddleGroup = new THREE.Group();
scene.add(paddleGroup);
const paddleMat = new THREE.MeshStandardMaterial({ color: 0x0d2233, emissive: 0x35e6ff, emissiveIntensity: 0.95, roughness: 0.28, metalness: 0.55 });
let paddleMesh = null, paddleEdge = null;
const paddleGlow = glowSprite(0x43e9ff, 6.2, 0.32);
const paddleLight = new THREE.PointLight(0x35e6ff, 16, 18, 2);
paddleLight.position.set(0, PADDLE_Y, 1.6);
scene.add(paddleLight);
paddleGroup.add(paddleGlow);

function buildPaddle(width) {
  if (paddleMesh) { paddleGroup.remove(paddleMesh); paddleMesh.geometry.dispose(); }
  if (paddleEdge) { paddleGroup.remove(paddleEdge); paddleEdge.geometry.dispose(); }
  const g = new THREE.CapsuleGeometry(PADDLE_H / 2, Math.max(0.2, width - PADDLE_H), 6, 20);
  g.rotateZ(Math.PI / 2);
  paddleMesh = new THREE.Mesh(g, paddleMat);
  paddleMesh.scale.z = PADDLE_D / PADDLE_H;
  paddleGroup.add(paddleMesh);
  paddleEdge = new THREE.LineSegments(
    new THREE.EdgesGeometry(g, 24),
    new THREE.LineBasicMaterial({ color: 0x9ff6ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending })
  );
  paddleEdge.scale.copy(paddleMesh.scale);
  paddleGroup.add(paddleEdge);
  paddleGlow.scale.set(width * 1.45, 2.6, 1);
}
buildPaddle(PADDLE_W);
paddleGroup.position.set(0, PADDLE_Y, 0);

// ---------------------------------------------------------------- balle
const ballGeo = new THREE.SphereGeometry(BALL_R, 26, 18);
const TRAIL_N = 16;

function makeBall(x, y, vx, vy, fire) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x0e2b33, emissive: fire ? 0xff8a3d : 0x9ff8ff,
    emissiveIntensity: 1.55, roughness: 0.2, metalness: 0.1
  });
  const mesh = new THREE.Mesh(ballGeo, mat);
  mesh.position.set(x, y, 0);
  scene.add(mesh);
  const glow = glowSprite(fire ? 0xff9a4d : 0x66f6ff, 3.0, 0.7);
  glow.position.set(x, y, 0);
  scene.add(glow);
  const light = new THREE.PointLight(fire ? 0xff9a4d : 0x66f6ff, 18, 20, 2);
  light.position.set(x, y, 1.4);
  scene.add(light);
  const trail = [];
  for (let i = 0; i < TRAIL_N; i++) {
    const s = glowSprite(fire ? 0xff9a4d : 0x4fe8ff, 1, 0);
    s.position.set(x, y, 0);
    scene.add(s);
    trail.push(s);
  }
  return { mesh, glow, light, trail, x, y, vx, vy, fire: !!fire, hist: [], alive: true, cool: 0 };
}
function killBall(b) {
  b.alive = false;
  scene.remove(b.mesh); scene.remove(b.glow); scene.remove(b.light);
  b.trail.forEach(s => scene.remove(s));
  b.mesh.material.dispose();
}

// ---------------------------------------------------------------- briques
const brickGeoCache = {};
function brickGeo() {
  const k = BW.toFixed(3) + 'x' + BH.toFixed(3);
  if (!brickGeoCache[k]) brickGeoCache[k] = new THREE.BoxGeometry(BW, BH, BDEPTH);
  return brickGeoCache[k];
}
const edgeGeoCache = {};
function edgeGeo() {
  const k = BW.toFixed(3) + 'x' + BH.toFixed(3);
  if (!edgeGeoCache[k]) edgeGeoCache[k] = new THREE.EdgesGeometry(brickGeo());
  return edgeGeoCache[k];
}
const MAT = {
  1: new THREE.MeshStandardMaterial({ color: 0x08222e, emissive: HP_COLOR[1], emissiveIntensity: 0.72, roughness: 0.34, metalness: 0.22 }),
  2: new THREE.MeshStandardMaterial({ color: 0x2a0a26, emissive: HP_COLOR[2], emissiveIntensity: 0.72, roughness: 0.34, metalness: 0.22 }),
  3: new THREE.MeshStandardMaterial({ color: 0x2e1c07, emissive: HP_COLOR[3], emissiveIntensity: 0.72, roughness: 0.34, metalness: 0.22 }),
  s: new THREE.MeshStandardMaterial({ color: 0x2b3242, emissive: STEEL_COLOR, emissiveIntensity: 0.28, roughness: 0.24, metalness: 0.95 }),
  flash: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.6, roughness: 0.2, metalness: 0.0 })
};
function edgeMat(hex, op) {
  return new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false });
}
const EDGE_MATS = { 1: edgeMat(0x9ff6ff, 0.8), 2: edgeMat(0xffb3ec, 0.8), 3: edgeMat(0xffe0a3, 0.8), s: edgeMat(0xcfe0ff, 0.45) };

function brickX(c) { return -AW / 2 + BW / 2 + c * (BW + GAP); }
function brickY(r) { return BRICK_TOP - BH / 2 - r * (BH + GAP); }

function buildBricks(level) {
  clearBricks();
  const p = PATTERNS[Math.min(level - 1, PATTERNS.length - 1)];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = p(r, c);
      if (!v) continue;
      const steel = v === -1;
      const hp = steel ? 99 : v;
      const mat = steel ? MAT.s : MAT[hp];
      const mesh = new THREE.Mesh(brickGeo(), mat);
      mesh.position.set(brickX(c), brickY(r), -BDEPTH / 2 + 0.15);
      scene.add(mesh);
      const edges = new THREE.LineSegments(edgeGeo(), steel ? EDGE_MATS.s : EDGE_MATS[hp]);
      edges.position.copy(mesh.position);
      scene.add(edges);
      G.bricks.push({ mesh, edges, x: mesh.position.x, y: mesh.position.y, w: BW, h: BH, hp, steel, alive: true, flash: 0, punch: 0 });
    }
  }
}
function clearBricks() {
  G.bricks.forEach(b => { scene.remove(b.mesh); scene.remove(b.edges); });
  G.bricks = [];
}
const aliveBreakable = () => G.bricks.filter(b => b.alive && !b.steel).length;

// ---------------------------------------------------------------- débris
const debrisGeo = new THREE.BoxGeometry(0.34, 0.34, 0.34);
const DEBRIS_MATS = {
  1: new THREE.MeshStandardMaterial({ color: 0x0d2c3a, emissive: HP_COLOR[1], emissiveIntensity: 1.5, roughness: 0.4 }),
  2: new THREE.MeshStandardMaterial({ color: 0x33102e, emissive: HP_COLOR[2], emissiveIntensity: 1.5, roughness: 0.4 }),
  3: new THREE.MeshStandardMaterial({ color: 0x3a2409, emissive: HP_COLOR[3], emissiveIntensity: 1.5, roughness: 0.4 }),
  s: new THREE.MeshStandardMaterial({ color: 0x2b3242, emissive: STEEL_COLOR, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.9 })
};
function spawnDebris(x, y, kind, n) {
  for (let i = 0; i < n; i++) {
    if (G.debris.length > 300) break;
    const m = new THREE.Mesh(debrisGeo, DEBRIS_MATS[kind] || DEBRIS_MATS[1]);
    m.position.set(x + rnd(-BW / 2, BW / 2), y + rnd(-BH / 2, BH / 2), rnd(-0.6, 0.6));
    m.rotation.set(rnd(0, 6.28), rnd(0, 6.28), rnd(0, 6.28));
    const s = rnd(0.5, 1.5);
    m.scale.setScalar(s);
    scene.add(m);
    G.debris.push({
      m, s, life: rnd(0.7, 1.25), max: 1.25,
      vx: rnd(-8, 8), vy: rnd(2, 12), vz: rnd(-5, 6),
      rx: rnd(-9, 9), ry: rnd(-9, 9), rz: rnd(-9, 9)
    });
  }
}
const ringGeo = new THREE.RingGeometry(0.55, 0.85, 32);
function spawnRing(x, y, color) {
  const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
  m.position.set(x, y, 0.4);
  scene.add(m);
  G.rings.push({ m, life: 0.42, max: 0.42 });
}

// ---------------------------------------------------------------- power-ups
const powerGeo = new THREE.OctahedronGeometry(0.78, 0);
const powerEdge = new THREE.EdgesGeometry(powerGeo);
function spawnPower(x, y) {
  let total = 0; POWER_TYPES.forEach(p => total += p.w);
  let roll = Math.random() * total, type = POWER_TYPES[0];
  for (const p of POWER_TYPES) { roll -= p.w; if (roll <= 0) { type = p; break; } }
  const mat = new THREE.MeshStandardMaterial({ color: 0x101820, emissive: type.c, emissiveIntensity: 1.15, roughness: 0.3, metalness: 0.4 });
  const mesh = new THREE.Mesh(powerGeo, mat);
  mesh.position.set(x, y, 0.2);
  scene.add(mesh);
  // arêtes nettes : le bonus reste lisible même avec le bloom
  const eg = new THREE.LineSegments(powerEdge, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  mesh.add(eg);
  // lettre blanche + contour sombre, en blending normal pour rester lisible
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: LETTERS[type.t], transparent: true, depthWrite: false, depthTest: false, blending: THREE.NormalBlending }));
  spr.scale.setScalar(2.1);
  spr.position.set(0, 0, 1.0);
  spr.renderOrder = 5;
  mesh.add(spr);
  const glow = glowSprite(type.c, 2.8, 0.34);
  mesh.add(glow);
  G.powerups.push({ mesh, type, y, x, vy: -6.6, spin: rnd(1.4, 3.2) });
}
function clearPowers() { G.powerups.forEach(p => scene.remove(p.mesh)); G.powerups = []; }

// ---------------------------------------------------------------- audio
let AC = null, muted = false;
function ac() {
  if (muted) return null;
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
  if (AC && AC.state === 'suspended') { try { AC.resume(); } catch (e) { } }
  return AC;
}
function tone(f, dur, type, vol, slide) {
  const a = ac(); if (!a) return;
  try {
    const o = a.createOscillator(), g = a.createGain(), t0 = a.currentTime;
    o.type = type || 'square';
    o.frequency.setValueAtTime(f, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t0 + dur);
    g.gain.setValueAtTime(vol || 0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(a.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  } catch (e) { }
}
function sfx(kind) {
  switch (kind) {
    case 'bounce': tone(190, 0.04, 'square', 0.08); break;
    case 'wall': tone(140, 0.03, 'square', 0.05); break;
    case 'brick1': tone(330, 0.06, 'triangle', 0.16); break;
    case 'brick2': tone(440, 0.06, 'triangle', 0.16); break;
    case 'brick3': tone(560, 0.07, 'triangle', 0.16); break;
    case 'steel': tone(120, 0.05, 'sawtooth', 0.07); break;
    case 'power': tone(523, 0.07, 'sine', 0.14); setTimeout(() => tone(784, 0.07, 'sine', 0.14), 70); setTimeout(() => tone(1046, 0.1, 'sine', 0.14), 140); break;
    case 'launch': tone(600, 0.05, 'sine', 0.1); break;
    case 'lose': tone(240, 0.5, 'sawtooth', 0.14, 60); break;
    case 'clear': [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.09, 'sine', 0.14), i * 90)); break;
    case 'over': [392, 330, 262, 196].forEach((f, i) => setTimeout(() => tone(f, 0.13, 'sawtooth', 0.1, 40), i * 130)); break;
  }
}

// ---------------------------------------------------------------- HUD
const $ = id => document.getElementById(id);
const elScore = $('score'), elHi = $('hi'), elLevel = $('level'), elLives = $('lives'), elCombo = $('combo');
const elToast = $('toast'), elOverlay = $('overlay');
let toastTimer = null;
function toast(msg, color) {
  elToast.textContent = msg;
  elToast.style.color = color || '#fff';
  elToast.classList.remove('show');
  void elToast.offsetWidth;
  elToast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elToast.classList.remove('show'), 1100);
}
function hud() {
  elScore.textContent = G.score.toLocaleString('fr-FR');
  elHi.textContent = Math.max(G.hi, G.score).toLocaleString('fr-FR');
  elLevel.textContent = G.level + '/' + LEVELS;
  elLives.innerHTML = '';
  for (let i = 0; i < G.lives; i++) {
    const s = document.createElement('span');
    s.className = 'heart';
    elLives.appendChild(s);
  }
  const m = mult();
  elCombo.textContent = m > 1 ? '×' + m : '';
  elCombo.classList.toggle('hot', m >= 4);
}
function overlay(kind, extra) {
  const T = {
    menu: { t: 'NOVA BREAKER', s: '3D', b: 'JOUER', hint: 'Cassez les 6 niveaux de briques néon.' },
    paused: { t: 'PAUSE', s: '', b: 'REPRENDRE', hint: '' },
    levelclear: { t: 'NIVEAU ' + G.level + ' TERMINÉ', s: '', b: 'NIVEAU SUIVANT', hint: 'Score : ' + G.score.toLocaleString('fr-FR') },
    gameover: { t: 'GAME OVER', s: '', b: 'REJOUER', hint: 'Score final : ' + G.score.toLocaleString('fr-FR') },
    win: { t: 'VICTOIRE !', s: '', b: 'REJOUER', hint: 'Les 6 niveaux cassés — ' + G.score.toLocaleString('fr-FR') + ' pts' }
  }[kind];
  $('ovTitle').textContent = T.t;
  $('ovSub').textContent = T.s || '';
  $('ovHint').textContent = extra || T.hint || '';
  $('ovBtn').textContent = T.b;
  $('ovBtn').dataset.action = kind;
  elOverlay.classList.add('show');
  elOverlay.setAttribute('aria-hidden', 'false');
}
function hideOverlay() {
  elOverlay.classList.remove('show');
  elOverlay.setAttribute('aria-hidden', 'true');
}

// ---------------------------------------------------------------- manches
function resetRun() {
  G.score = 0; G.lives = 3; G.level = 1; G.combo = 0; G.destroyed = 0;
  G.wide = 0; G.slow = 0; G.fire = 0;
  clearBalls(); clearPowers(); clearDebris();
  setPaddleWidth(PADDLE_W);
  buildBricks(1);
  hud();
  serve();
}
function clearBalls() { G.balls.forEach(killBall); G.balls = []; }
function clearDebris() { G.debris.forEach(d => scene.remove(d.m)); G.debris = []; G.rings.forEach(r => scene.remove(r.m)); G.rings = []; }
function setPaddleWidth(w) {
  G.paddle.w = w;
  buildPaddle(w);
  paddleMat.emissive.setHex(0x35e6ff);
}
function serve() {
  clearBalls(); clearPowers();
  const b = makeBall(G.paddle.x, PADDLE_Y + PADDLE_H / 2 + BALL_R + 0.24, 0, 0, false);
  b.stuck = true;
  G.balls.push(b);
  G.state = 'serving';
  G.servedBalls++;
  hud();
}
function launch() {
  if (G.state !== 'serving') return;
  const b = G.balls[0];
  if (!b) return;
  const sp = BASE_SPEED + (G.level - 1) * SPEED_PER_LEVEL;
  const a = rnd(-0.42, 0.42);
  b.vx = Math.sin(a) * sp; b.vy = Math.cos(a) * sp;
  b.stuck = false;
  G.state = 'playing';
  sfx('launch');
}
function nextLevel() {
  G.level++;
  clearBalls(); clearPowers(); clearDebris();
  G.wide = 0; G.fire = 0; setPaddleWidth(PADDLE_W);
  buildBricks(G.level);
  serve();
}
function loseBall() {
  G.lives--;
  G.combo = 0;
  hud();
  if (G.lives <= 0) {
    G.state = 'gameover';
    sfx('over');
    if (G.score > G.hi) { G.hi = G.score; try { localStorage.setItem('novaBreaker3DHi', String(G.hi)); } catch (e) { } }
    overlay('gameover');
  } else {
    G.wide = 0; G.fire = 0; setPaddleWidth(PADDLE_W);
    sfx('lose');
    toast('Balle perdue — ' + G.lives + ' vie' + (G.lives > 1 ? 's' : '') + ' restante' + (G.lives > 1 ? 's' : ''), '#ff5d7a');
    serve();
  }
}
function levelDone() {
  clearBalls(); clearPowers();
  G.shake = Math.max(G.shake, 0.5);
  if (G.score > G.hi) { G.hi = G.score; try { localStorage.setItem('novaBreaker3DHi', String(G.hi)); } catch (e) { } }
  if (G.level >= LEVELS) {
    G.state = 'win';
    sfx('clear');
    overlay('win');
  } else {
    G.state = 'levelclear';
    sfx('clear');
    overlay('levelclear');
  }
  hud();
}

function addScore(n, x, y) {
  G.score += n * mult();
  hud();
}

function damage(brick, ball) {
  if (brick.steel) {
    brick.flash = 1; brick.punch = 1;
    brick.mesh.material = MAT.flash;
    G.shake = Math.max(G.shake, 0.16);
    sfx('steel');
    spawnRing(brick.x, brick.y, 0xcfe0ff);
    spawnDebris(brick.x, brick.y, 's', 3);
    return false;
  }
  const before = brick.hp;
  brick.hp--;
  brick.flash = 1; brick.punch = 1;
  brick.mesh.material = MAT.flash;
  G.combo++;
  G.shake = Math.max(G.shake, 0.2);
  if (brick.hp <= 0) {
    brick.alive = false;
    scene.remove(brick.mesh); scene.remove(brick.edges);
    G.destroyed++;
    addScore(before === 3 ? 260 : before === 2 ? 175 : 100, brick.x, brick.y);
    spawnDebris(brick.x, brick.y, before, 11);
    spawnRing(brick.x, brick.y, HP_COLOR[before] || 0x2ee6ff);
    sfx('brick' + before);
    if (Math.random() < 0.2) spawnPower(brick.x, brick.y);
    if (aliveBreakable() === 0) levelDone();
    return true;
  }
  // brique encore debout : la couleur suit les pv restants
  brick.edges.material = EDGE_MATS[brick.hp];
  addScore(45, brick.x, brick.y);
  sfx('brick' + brick.hp);
  spawnDebris(brick.x, brick.y, brick.hp, 4);
  return true;
}

function applyPower(type) {
  sfx('power');
  toast(type.label, type.hex);
  if (type.t === 'M') {
    const src = G.balls.filter(b => b.alive && !b.stuck);
    const base = src[0] || G.balls[0];
    if (base) {
      for (let i = 0; i < 2; i++) {
        const sp = Math.hypot(base.vx, base.vy) || BASE_SPEED;
        const ang = Math.atan2(base.vy, base.vx) + (i === 0 ? 0.5 : -0.5);
        const b = makeBall(base.x, base.y, Math.cos(ang) * sp, Math.sin(ang) * sp, base.fire);
        G.balls.push(b);
      }
    }
  } else if (type.t === 'W') {
    G.wide = 16; setPaddleWidth(PADDLE_WIDE);
  } else if (type.t === 'S') {
    G.slow = 9;
  } else if (type.t === 'F') {
    G.fire = 11;
    G.balls.forEach(b => {
      b.fire = true;
      b.mesh.material.emissive.setHex(0xff8a3d);
      b.glow.material.color.setHex(0xff9a4d);
      b.light.color.setHex(0xff9a4d);
      b.trail.forEach(s => s.material.color.setHex(0xff9a4d));
    });
  } else if (type.t === '+') {
    G.lives = Math.min(6, G.lives + 1);
  }
  G.shake = Math.max(G.shake, 0.3);
  hud();
}

// ---------------------------------------------------------------- physique
function stepBall(b, dt) {
  if (b.stuck) {
    b.x = G.paddle.x;
    b.y = PADDLE_Y + PADDLE_H / 2 + BALL_R + 0.24;
    return;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;

  // murs
  const lim = AW / 2 - BALL_R;
  if (b.x < -lim) { b.x = -lim; b.vx = Math.abs(b.vx); sfx('wall'); G.shake = Math.max(G.shake, 0.08); }
  if (b.x > lim) { b.x = lim; b.vx = -Math.abs(b.vx); sfx('wall'); G.shake = Math.max(G.shake, 0.08); }
  if (b.y > AH - BALL_R) { b.y = AH - BALL_R; b.vy = -Math.abs(b.vy); sfx('wall'); G.shake = Math.max(G.shake, 0.08); }

  // palette
  const pw = G.paddle.w / 2;
  if (b.vy < 0 && b.y - BALL_R <= PADDLE_Y + PADDLE_H / 2 && b.y > PADDLE_Y - 1.1 &&
    Math.abs(b.x - G.paddle.x) <= pw + BALL_R * 0.9) {
    b.y = PADDLE_Y + PADDLE_H / 2 + BALL_R;
    const off = clamp((b.x - G.paddle.x) / pw, -1, 1);
    const ang = off * 1.06;
    const sp = clamp(Math.hypot(b.vx, b.vy) * 1.012, BASE_SPEED * 0.92, SPEED_CAP);
    b.vx = Math.sin(ang) * sp;
    b.vy = Math.cos(ang) * sp;
    G.combo = 0;
    G.shake = Math.max(G.shake, 0.1);
    paddleMat.emissiveIntensity = 1.7;
    sfx('bounce');
    hud();
  }

  // briques
  if (b.cool > 0) b.cool--;
  else for (let i = 0; i < G.bricks.length; i++) {
    const br = G.bricks[i];
    if (!br.alive) continue;
    const dx = b.x - br.x, dy = b.y - br.y;
    const ox = (br.w / 2 + BALL_R) - Math.abs(dx);
    const oy = (br.h / 2 + BALL_R) - Math.abs(dy);
    if (ox > 0 && oy > 0) {
      const fired = b.fire && !br.steel;
      if (!fired) {
        if (ox < oy) { b.x += (dx < 0 ? -ox : ox); b.vx = -b.vx; }
        else { b.y += (dy < 0 ? -oy : oy); b.vy = -b.vy; }
        // anti-oscillation : la balle repoussée peut chevaucher une brique
        // voisine ; sans ce délai elle rebondirait en boucle et gagnerait
        // de la vitesse à chaque sous-pas.
        b.cool = 2;
      }
      const hurt = damage(br, b);
      // accélération progressive — uniquement si la brique a vraiment pris
      if (hurt) {
        const sp = Math.hypot(b.vx, b.vy);
        const ns = clamp(sp + SPEED_PER_BRICK, 0, SPEED_CAP);
        if (sp > 0.001 && !fired) { b.vx = b.vx / sp * ns; b.vy = b.vy / sp * ns; }
      }
      if (!fired) break;
    }
  }

  // perdue
  if (b.y < -2.2) b.alive = false;
}

function stepPhysics(dt) {
  // palette
  const kx = (keys.left ? -1 : 0) + (keys.right ? 1 : 0);
  if (kx !== 0) G.paddle.target = clamp(G.paddle.target + kx * 34 * dt, -AW / 2 + G.paddle.w / 2, AW / 2 - G.paddle.w / 2);
  G.paddle.x += (G.paddle.target - G.paddle.x) * Math.min(1, dt * 22);
  G.paddle.x = clamp(G.paddle.x, -AW / 2 + G.paddle.w / 2, AW / 2 - G.paddle.w / 2);

  for (const b of G.balls) if (b.alive) stepBall(b, dt);
  const lost = G.balls.filter(b => !b.alive);
  if (lost.length) {
    lost.forEach(killBall);
    G.balls = G.balls.filter(b => b.alive);
    if (G.balls.length === 0 && (G.state === 'playing' || G.state === 'serving')) loseBall();
  }

  // power-ups
  for (let i = G.powerups.length - 1; i >= 0; i--) {
    const p = G.powerups[i];
    p.y += p.vy * dt;
    p.mesh.position.set(p.x, p.y, 0.2);
    p.mesh.rotation.x += p.spin * dt;
    p.mesh.rotation.y += p.spin * 1.3 * dt;
    if (p.y < PADDLE_Y + 0.9 && p.y > PADDLE_Y - 1.4 && Math.abs(p.x - G.paddle.x) < G.paddle.w / 2 + 0.8) {
      applyPower(p.type);
      spawnDebris(p.x, p.y, 1, 8);
      spawnRing(p.x, p.y, p.type.c);
      scene.remove(p.mesh);
      G.powerups.splice(i, 1);
      continue;
    }
    if (p.y < -2) { scene.remove(p.mesh); G.powerups.splice(i, 1); }
  }

  // décalages temporels
  if (G.wide > 0) { G.wide -= dt; if (G.wide <= 0) setPaddleWidth(PADDLE_W); }
  if (G.slow > 0) G.slow -= dt;
  if (G.fire > 0) {
    G.fire -= dt;
    if (G.fire <= 0) G.balls.forEach(b => {
      b.fire = false;
      b.mesh.material.emissive.setHex(0x9ff8ff);
      b.glow.material.color.setHex(0x66f6ff);
      b.light.color.setHex(0x66f6ff);
      b.trail.forEach(s => s.material.color.setHex(0x4fe8ff));
    });
  }
}

function stepFx(dt) {
  // briques : flash + punch
  for (const br of G.bricks) {
    if (!br.alive) continue;
    if (br.flash > 0) {
      br.flash = Math.max(0, br.flash - dt * 6);
      if (br.flash === 0) br.mesh.material = br.steel ? MAT.s : MAT[br.hp];
    }
    if (br.punch > 0) {
      br.punch = Math.max(0, br.punch - dt * 5);
      const s = 1 + br.punch * 0.14;
      br.mesh.scale.set(s, s, 1);
      br.edges.scale.set(s, s, 1);
      br.mesh.position.z = -BDEPTH / 2 + 0.15 + br.punch * 0.9;
      br.edges.position.z = br.mesh.position.z;
    } else if (br.mesh.scale.x !== 1) {
      br.mesh.scale.set(1, 1, 1); br.edges.scale.set(1, 1, 1);
      br.mesh.position.z = -BDEPTH / 2 + 0.15; br.edges.position.z = br.mesh.position.z;
    }
  }
  // débris
  for (let i = G.debris.length - 1; i >= 0; i--) {
    const d = G.debris[i];
    d.life -= dt;
    if (d.life <= 0) { scene.remove(d.m); G.debris.splice(i, 1); continue; }
    d.vy -= 27 * dt;
    d.m.position.x += d.vx * dt;
    d.m.position.y += d.vy * dt;
    d.m.position.z += d.vz * dt;
    d.m.rotation.x += d.rx * dt;
    d.m.rotation.y += d.ry * dt;
    d.m.rotation.z += d.rz * dt;
    if (d.m.position.y < -1.4) { d.m.position.y = -1.4; d.vy = Math.abs(d.vy) * 0.34; d.vx *= 0.7; d.vz *= 0.7; }
    const k = clamp(d.life / d.max, 0, 1);
    d.m.scale.setScalar(d.s * (0.35 + k * 0.65));
  }
  // anneaux
  for (let i = G.rings.length - 1; i >= 0; i--) {
    const r = G.rings[i];
    r.life -= dt;
    if (r.life <= 0) { scene.remove(r.m); r.m.material.dispose(); G.rings.splice(i, 1); continue; }
    const k = 1 - r.life / r.max;
    r.m.scale.setScalar(0.6 + k * 5.2);
    r.m.material.opacity = 0.85 * (1 - k);
  }
  // balles : rendu + traînée
  for (const b of G.balls) {
    if (!b.alive) continue;
    b.mesh.position.set(b.x, b.y, 0);
    b.glow.position.set(b.x, b.y, 0.1);
    b.light.position.set(b.x, b.y, 1.5);
    const sp = Math.hypot(b.vx, b.vy);
    // au service la balle repose sur la palette : halo réduit pour ne pas
    // fusionner visuellement avec elle
    if (b.stuck) {
      b.glow.scale.setScalar(1.9);
      b.glow.material.opacity = 0.4;
    } else {
      b.glow.scale.setScalar(2.5 + Math.min(1.6, sp * 0.06));
      b.glow.material.opacity = 0.7;
    }
    b.mesh.rotation.x += sp * dt * 0.12;
    b.mesh.rotation.y += sp * dt * 0.09;
    b.hist.unshift({ x: b.x, y: b.y });
    if (b.hist.length > TRAIL_N) b.hist.pop();
    for (let i = 0; i < b.trail.length; i++) {
      const h = b.hist[Math.min(i, b.hist.length - 1)];
      if (!h) continue;
      const s = b.trail[i];
      s.position.set(h.x, h.y, -0.05 - i * 0.02);
      const k = 1 - i / TRAIL_N;
      s.scale.setScalar(2.6 * k * k + 0.12);
      s.material.opacity = 0.5 * k * k;
    }
  }
  // palette
  paddleGroup.position.x = G.paddle.x;
  paddleGlow.position.set(0, 0, 0.5);
  paddleLight.position.set(G.paddle.x, PADDLE_Y, 1.8);
  paddleMat.emissiveIntensity += (0.95 - paddleMat.emissiveIntensity) * Math.min(1, dt * 6);

  // caméra : parallaxe + shake
  const lead = G.balls.length ? clamp(G.balls[0].x, -AW / 2, AW / 2) : 0;
  const leadY = G.balls.length ? clamp(G.balls[0].y, 0, AH) : AH / 2;
  camTarget.x = lead * 0.17;
  camTarget.y = 8.4 + leadY * 0.045;
  camera.position.x += (camTarget.x - camera.position.x) * Math.min(1, dt * 3.4);
  camera.position.y += (camTarget.y - camera.position.y) * Math.min(1, dt * 3.4);
  G.shake = Math.max(0, G.shake - dt * 2.6);
  if (G.shake > 0.001) {
    camera.position.x += rnd(-1, 1) * G.shake * 0.42;
    camera.position.y += rnd(-1, 1) * G.shake * 0.34;
  }
  camera.lookAt(lead * 0.1, 10.6, 0);
}

// ---------------------------------------------------------------- entrée
const keys = { left: false, right: false };
const raycaster = new THREE.Raycaster();
const planeZ = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const hitPt = new THREE.Vector3();
function pointerToWorldX(clientX) {
  const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, 0);
  raycaster.setFromCamera(ndc, camera);
  if (raycaster.ray.intersectPlane(planeZ, hitPt)) return clamp(hitPt.x, -AW / 2, AW / 2);
  return G.paddle.target;
}
window.addEventListener('pointermove', e => {
  if (G.state !== 'playing' && G.state !== 'serving') return;
  G.paddle.target = clamp(pointerToWorldX(e.clientX), -AW / 2 + G.paddle.w / 2, AW / 2 - G.paddle.w / 2);
}, { passive: true });
window.addEventListener('pointerdown', e => {
  if (e.target.closest && e.target.closest('.ui')) return;
  if (G.state === 'serving') launch();
  else if (G.state === 'playing') G.paddle.target = clamp(pointerToWorldX(e.clientX), -AW / 2 + G.paddle.w / 2, AW / 2 - G.paddle.w / 2);
});
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'arrowleft' || k === 'a' || k === 'q') { keys.left = true; e.preventDefault(); }
  if (k === 'arrowright' || k === 'd') { keys.right = true; e.preventDefault(); }
  if (k === ' ' || k === 'enter') {
    e.preventDefault();
    if (G.state === 'serving') launch();
    else if (G.state === 'menu' || G.state === 'gameover' || G.state === 'win') startGame();
    else if (G.state === 'levelclear') { hideOverlay(); nextLevel(); }
    else if (G.state === 'paused') togglePause();
  }
  if (k === 'p' || k === 'escape') { if (G.state === 'playing' || G.state === 'serving' || G.state === 'paused') togglePause(); }
  if (k === 'm') toggleMute();
});
window.addEventListener('keyup', e => {
  const k = e.key.toLowerCase();
  if (k === 'arrowleft' || k === 'a' || k === 'q') keys.left = false;
  if (k === 'arrowright' || k === 'd') keys.right = false;
});
function togglePause() {
  if (G.state === 'paused') { G.state = G.pausedFrom || 'playing'; hideOverlay(); }
  else if (G.state === 'playing' || G.state === 'serving') { G.pausedFrom = G.state; G.state = 'paused'; overlay('paused'); }
}
function toggleMute() {
  muted = !muted;
  const b = $('btnSound');
  if (b) { b.textContent = muted ? '🔇' : '🔊'; b.classList.toggle('off', muted); }
}
function startGame() {
  hideOverlay();
  resetRun();
}

// boutons UI
$('ovBtn').addEventListener('click', () => {
  const a = $('ovBtn').dataset.action;
  if (a === 'levelclear') { hideOverlay(); nextLevel(); }
  else startGame();
});
$('btnPlay').addEventListener('click', () => startGame());
$('btnPause').addEventListener('click', () => togglePause());
$('btnSound').addEventListener('click', () => toggleMute());
$('btnRestart').addEventListener('click', () => startGame());
$('btn2d').addEventListener('click', () => { window.location.href = './2d/'; });

// ---------------------------------------------------------------- resize
function fitCamera() {
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  camera.aspect = aspect;
  const vFov = camera.fov * Math.PI / 180;
  // en portrait (écran étroit), on rogne les marges pour que l'arène occupe
  // un maximum de la largeur disponible au lieu de flotter dans l'écran
  const portrait = aspect < 1;
  const margH = portrait ? 1.1 : 3.2;
  const margW = portrait ? 0.7 : 3.0;
  const needH = (AH / 2 + margH) / Math.tan(vFov / 2);
  const needW = (AW / 2 + margW) / (Math.tan(vFov / 2) * aspect);
  const dist = Math.max(needH, needW);
  camBase.set(0, 8.4, dist);
  camera.position.z = dist;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  composer.setSize(window.innerWidth, window.innerHeight);
  bloom.resolution.set(window.innerWidth, window.innerHeight);
  const hint = document.getElementById('rotateHint');
  if (hint) hint.classList.toggle('show', portrait && window.innerWidth < 900);
}
window.addEventListener('resize', fitCamera);
fitCamera();

// ---------------------------------------------------------------- boucle
let last = performance.now(), acc = 0, fpsAcc = 0, fpsN = 0, qualityChecked = false;
function frame(now) {
  requestAnimationFrame(frame);
  let dtReal = (now - last) / 1000;
  last = now;
  if (dtReal > 0.08) dtReal = 0.08;
  G.time += dtReal;

  // perf : coupe le bloom si la machine suit pas
  if (!qualityChecked) {
    fpsAcc += dtReal; fpsN++;
    if (fpsN >= 70) {
      const fps = fpsN / Math.max(0.0001, fpsAcc);
      if (fps < 40 && useBloom) {
        useBloom = false;
        toast('Mode performance activé', '#8fb4ff');
      }
      qualityChecked = true;
    }
  }

  const active = G.state === 'playing' || G.state === 'serving';
  if (active) {
    let dt = dtReal * (G.slow > 0 ? 0.55 : 1);
    acc += dt;
    let steps = 0;
    while (acc >= FIXED && steps < 10) { stepPhysics(FIXED); acc -= FIXED; steps++; }
    if (steps >= 10) acc = 0;
  } else {
    acc = 0;
  }
  stepFx(dtReal);

  if (useBloom) composer.render();
  else renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// onglet masqué : on met en pause plutôt que de perdre des vies hors écran
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (G.state === 'playing' || G.state === 'serving') togglePause();
  } else {
    last = performance.now();
    acc = 0;
  }
});

// ---------------------------------------------------------------- démarrage
buildBricks(1);
serve();
G.state = 'menu';
hud();
overlay('menu');

// ---------------------------------------------------------------- test hook
window.NOVA = {
  G, THREE, camera, scene, composer,
  api: {
    state: () => G.state,
    score: () => G.score,
    lives: () => G.lives,
    level: () => G.level,
    bricks: () => aliveBreakable(),
    balls: () => G.balls.filter(b => b.alive).length,
    destroyed: () => G.destroyed,
    debris: () => G.debris.length,
    powers: () => G.powerups.length,
    ballPos: () => (G.balls[0] ? { x: +G.balls[0].x.toFixed(3), y: +G.balls[0].y.toFixed(3) } : null),
    start: startGame,
    launch,
    pause: togglePause,
    mute: toggleMute,
    nextLevel: () => { hideOverlay(); nextLevel(); },
    setPaddle: x => { G.paddle.target = clamp(x, -AW / 2, AW / 2); G.paddle.x = G.paddle.target; },
    aimBall: (vx, vy) => { const b = G.balls[0]; if (b) { b.vx = vx; b.vy = vy; } },
    forcePower: t => { const p = POWER_TYPES.find(x => x.t === t); if (p) applyPower(p); return !!p; },
    // pas-à-pas déterministe (indépendant de requestAnimationFrame) :
    // sert aux tests automatisés et au rendu forcé quand l'onglet est masqué
    step: (seconds, render) => {
      const n = Math.max(1, Math.round((seconds || FIXED) / FIXED));
      for (let i = 0; i < n; i++) {
        if (G.state === 'playing' || G.state === 'serving') stepPhysics(FIXED);
        stepFx(FIXED);
      }
      if (render !== false) { if (useBloom) composer.render(); else renderer.render(scene, camera); }
      return { state: G.state, score: G.score, destroyed: G.destroyed, bricks: aliveBreakable(), lives: G.lives, balls: G.balls.filter(b => b.alive).length };
    },
    bloom: () => useBloom,
    rendererInfo: () => renderer.info.render,
    version: '3d-1.9'
  }
};
