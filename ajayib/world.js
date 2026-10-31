'use strict';
/* أرض العجايب — توليد العالم (نفس العالم عند كل اللاعبين) ورسم الأرض */

function hash2(x, y, s) {
  let h = (Math.imul(x | 0, 0x27d4eb2d) + Math.imul(y | 0, 0x165667b1) + Math.imul(s | 0, 0x9e3779b9)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s, oct) {
  let t = 0, amp = 1, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { t += vnoise(x * f, y * f, s + i * 101) * amp; norm += amp; amp *= 0.5; f *= 2; }
  return t / norm;
}
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const World = {
  biome: null, deco: null, wonders: [], props: [], mapCanvas: null, ready: false,

  gen() {
    const W = WORLD, N = W * W;
    const elev = new Float32Array(N), moist = new Float32Array(N), weird = new Float32Array(N), temp = new Float32Array(N);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, dx = (x - CENTER) / CENTER, dy = (y - CENTER) / CENTER, d = Math.sqrt(dx * dx + dy * dy);
      let e = fbm(x / 70, y / 70, SEED, 5);
      const edge = Math.max(Math.abs(dx), Math.abs(dy));
      e += -smooth(0.5, 1.0, d) * 0.5 - smooth(0.86, 0.97, edge) * 0.8 + (1 - smooth(0.02, 0.1, d)) * 0.12;
      elev[i] = e;
      moist[i] = fbm(x / 85, y / 85, SEED + 7, 4);
      weird[i] = fbm(x / 60, y / 60, SEED + 13, 3);
      temp[i] = y / W + (fbm(x / 110, y / 110, SEED + 21, 3) - 0.5) * 0.7;
    }
    const pct = (arr, ps) => {
      const s = []; for (let i = 0; i < N; i += 7) s.push(arr[i]);
      s.sort((a, b) => a - b);
      return ps.map(p => s[Math.min(s.length - 1, Math.floor(p * s.length))]);
    };
    const [eDeep, eShallow, eBeach, eRock] = pct(elev, [0.34, 0.38, 0.41, 0.955]);
    const [m50, m62, m78] = pct(moist, [0.5, 0.62, 0.78]);
    const [wTop] = pct(weird, [0.86]);
    const [t22, t33, t64] = pct(temp, [0.2, 0.4, 0.64]);

    const bio = this.biome = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const e = elev[i], m = moist[i], w = weird[i], t = temp[i];
      let b;
      if (e < eDeep) b = B.DEEP;
      else if (e < eShallow) b = B.SHALLOW;
      else if (e < eBeach) b = t < t22 ? B.SNOW : B.BEACH;
      else if (w > wTop) b = t < t33 ? B.CRYSTAL : (m > m50 ? B.MUSHROOM : B.CANDY);
      else if (e > eRock) b = t < t22 + 0.05 ? B.SNOW : B.ROCK;
      else if (t < t22) b = B.SNOW;
      else if (t > t64 && m < m62) b = B.DESERT;
      else if (m > m78 && e < eBeach + (eRock - eBeach) * 0.35) b = B.SWAMP;
      else if (m > m50) b = B.FOREST;
      else b = B.GRASS;
      bio[i] = b;
    }
    // البلدة في النص
    for (let y = CENTER - SAFE_R - 2; y <= CENTER + SAFE_R + 2; y++) for (let x = CENTER - SAFE_R - 2; x <= CENTER + SAFE_R + 2; x++) {
      const d = Math.hypot(x - CENTER, y - CENTER), i = y * W + x;
      if (d < 10.5) bio[i] = B.TOWN;
      else if (d < SAFE_R + 2 && (bio[i] === B.DEEP || bio[i] === B.SHALLOW || bio[i] === B.SWAMP)) bio[i] = B.GRASS;
    }
    this.genDeco();
    this.placeWonders();
    this.placeTown();
    this.renderMap();
    this.ready = true;
  },

  genDeco() {
    const W = WORLD, bio = this.biome, deco = this.deco = new Uint8Array(W * W);
    for (let y = 1; y < W - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, r = hash2(x, y, SEED + 99), r2 = hash2(x, y, SEED + 77);
      let d = 0;
      switch (bio[i]) {
        case B.GRASS:
          d = r < 0.035 ? 1 : r < 0.045 ? 21 : r < 0.08 ? (r2 < 0.4 ? 6 : r2 < 0.75 ? 7 : 19) : r < 0.1 ? 15 : r < 0.108 ? 5 : r < 0.111 ? 18 : 0; break;
        case B.FOREST:
          d = r < 0.2 ? (r2 < 0.6 ? 1 : 2) : r < 0.225 ? 5 : r < 0.27 ? 14 : r < 0.285 ? 18 : r < 0.3 ? 13 : 0; break;
        case B.DESERT:
          d = r < 0.022 ? 4 : r < 0.03 ? 5 : r < 0.036 ? 12 : r < 0.043 ? 3 : 0; break;
        case B.BEACH:
          d = r < 0.035 ? 3 : r < 0.075 ? 11 : 0; break;
        case B.SNOW:
          d = r < 0.11 ? 2 : r < 0.13 ? 5 : r < 0.134 ? 17 : r < 0.16 ? 22 : 0; break;
        case B.ROCK:
          d = r < 0.13 ? 5 : r < 0.16 ? 2 : r < 0.17 ? 12 : 0; break;
        case B.SWAMP:
          d = r < 0.12 ? 13 : r < 0.15 ? 1 : r < 0.18 ? 14 : r < 0.186 ? 23 : 0; break;
        case B.MUSHROOM:
          d = r < 0.17 ? 8 : r < 0.22 ? 14 : r < 0.235 ? 1 : r < 0.25 ? 23 : 0; break;
        case B.CRYSTAL:
          d = r < 0.075 ? 9 : r < 0.11 ? 5 : r < 0.12 ? 22 : 0; break;
        case B.CANDY:
          d = r < 0.07 ? 10 : r < 0.1 ? 16 : r < 0.11 ? 20 : r < 0.14 ? 21 : 0; break;
      }
      deco[i] = d;
    }
  },

  clearDeco(cx, cy, r) {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++)
      if (x >= 0 && y >= 0 && x < WORLD && y < WORLD && Math.hypot(x - cx, y - cy) <= r + 0.5) this.deco[y * WORLD + x] = 0;
  },

  placeWonders() {
    const rnd = mulberry32(SEED + 555), placed = [];
    const ok = (x, y, w, strict) => {
      const d = Math.hypot(x - CENTER, y - CENTER);
      if (d < w.min || d > w.max) return false;
      const b = BIOMES[this.biome[y * WORLD + x]].id;
      if (strict ? !w.bi.includes(b) : (w.id === 'duck' ? b !== 'deep' : (b === 'deep' || b === 'shallow'))) return false;
      if (w.id !== 'duck') for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) if (this.biome[(y + j) * WORLD + x + i] === B.DEEP) return false;
      return placed.every(p => Math.hypot(p.tx - x, p.ty - y) > 34);
    };
    for (const w of WONDERS) {
      let found = null;
      for (let pass = 0; pass < 2 && !found; pass++) for (let k = 0; k < 6000; k++) {
        const x = 4 + Math.floor(rnd() * (WORLD - 8)), y = 4 + Math.floor(rnd() * (WORLD - 8));
        if (ok(x, y, w, pass === 0)) { found = [x, y]; break; }
      }
      if (!found) found = [CENTER + 30 + placed.length * 3, CENTER];
      const o = { ...w, tx: found[0], ty: found[1], x: found[0] * T + T / 2, y: found[1] * T + T / 2 };
      placed.push(o);
      this.clearDeco(o.tx, o.ty, w.id === 'whale' ? 9 : w.id === 'slimeking' ? 6 : 3);
    }
    this.wonders = placed;
    this.wonderById = Object.fromEntries(placed.map(w => [w.id, w]));
  },

  placeTown() {
    this.clearDeco(CENTER, CENTER, SAFE_R);
    const P = (e, dx, dy, s, solid, light) => this.props.push({ e, x: (CENTER + dx) * T + T / 2, y: (CENTER + dy) * T + T / 2, s, solid, light });
    P('⛲', 0, 0, 60, 22);
    P('🏠', -9, -6, 64, 24); P('🏡', 9, -7, 64, 24); P('🏠', -10, 6, 64, 24); P('🏘️', 10, 7, 70, 26);
    P('⛺', 0, -9, 56, 20); P('🛖', -8, 3, 54, 20); P('🏪', 7, -4, 56, 22); P('⚒️', 7, 3, 30, 0);
    P('⛵', 2, 9, 50, 18);
    for (const [dx, dy] of [[-3, -3], [3, -3], [-3, 3], [3, 3], [0, 9.5], [-9, 0], [9, 0]]) P('🔥', dx, dy, 22, 9, 1);
    for (let k = 0; k < 14; k++) {
      const a = k / 14 * Math.PI * 2, r = 12 + (k % 2);
      P('🌴', Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r), 50, 12);
    }
  },

  inb(tx, ty) { return tx >= 0 && ty >= 0 && tx < WORLD && ty < WORLD; },
  biomeAt(tx, ty) { return this.inb(tx, ty) ? this.biome[ty * WORLD + tx] : B.DEEP; },
  decoAt(tx, ty) { return this.inb(tx, ty) ? this.deco[ty * WORLD + tx] : 0; },

  /* ============ رسم الأرض قطع قطع ============ */
  CH: 8,
  cache: new Map(),
  chunk(cx, cy) {
    const k = cx + ',' + cy;
    let c = this.cache.get(k);
    if (c) { this.cache.delete(k); this.cache.set(k, c); return c; }
    c = this.renderChunk(cx, cy);
    this.cache.set(k, c);
    if (this.cache.size > 90) this.cache.delete(this.cache.keys().next().value);
    return c;
  },
  renderChunk(cx, cy) {
    const CH = this.CH, cv = document.createElement('canvas');
    cv.width = cv.height = CH * T;
    const g = cv.getContext('2d');
    const col = (c, f) => `rgb(${Math.min(255, c[0] * f) | 0},${Math.min(255, c[1] * f) | 0},${Math.min(255, c[2] * f) | 0})`;
    const water = b => b === B.DEEP || b === B.SHALLOW;
    for (let j = 0; j < CH; j++) for (let i = 0; i < CH; i++) {
      const tx = cx * CH + i, ty = cy * CH + j, px = i * T, py = j * T;
      const b = this.biomeAt(tx, ty), c = BIOMES[b].c;
      const h = hash2(tx, ty, 1), patch = vnoise(tx / 5, ty / 5, SEED + 3);
      g.fillStyle = col(c, 0.95 + h * 0.05 + (patch - 0.5) * 0.12);
      g.fillRect(px, py, T, T);
      // انتقال ناعم بين الأراضي
      const nb = [[0, -1, 0, 0, T, 6], [0, 1, 0, T - 6, T, 6], [-1, 0, 0, 0, 6, T], [1, 0, T - 6, 0, 6, T]];
      for (const [ox, oy, rx, ry, rw, rh] of nb) {
        const b2 = this.biomeAt(tx + ox, ty + oy);
        if (b2 === b) continue;
        if (water(b) && !water(b2)) { g.fillStyle = 'rgba(255,255,255,.32)'; g.fillRect(px + rx, py + ry, rw, rh); continue; }
        if (!water(b) && water(b2)) { g.fillStyle = 'rgba(70,50,30,.18)'; g.fillRect(px + rx, py + ry, rw, rh); continue; }
        if (b === B.DEEP && b2 === B.SHALLOW) continue;
        const c2 = BIOMES[b2].c;
        g.fillStyle = `rgba(${c2[0]},${c2[1]},${c2[2]},.35)`;
        g.fillRect(px + rx, py + ry, rw, rh);
      }
      this.detail(g, b, tx, ty, px, py);
    }
    return cv;
  },
  detail(g, b, tx, ty, px, py) {
    const r = k => hash2(tx, ty, 50 + k);
    const dots = (n, color, w = 2, h = 2) => { g.fillStyle = color; for (let k = 0; k < n; k++) g.fillRect(px + (r(k) * (T - w)) | 0, py + (r(k + 20) * (T - h)) | 0, w, h); };
    switch (b) {
      case B.GRASS: case B.FOREST: case B.SWAMP:
        dots(3, b === B.SWAMP ? 'rgba(30,50,30,.35)' : 'rgba(30,80,20,.35)', 2, 5);
        dots(2, 'rgba(255,255,200,.18)', 2, 4);
        if (b === B.SWAMP && r(9) < 0.25) { g.fillStyle = 'rgba(40,70,60,.5)'; g.beginPath(); g.ellipse(px + 16, py + 16, 11, 7, 0, 0, 7); g.fill(); }
        break;
      case B.DESERT:
        if (r(9) < 0.35) { g.strokeStyle = 'rgba(255,240,200,.45)'; g.lineWidth = 2; g.beginPath(); g.moveTo(px + 3, py + 18); g.quadraticCurveTo(px + 16, py + 10, px + 29, py + 18); g.stroke(); }
        dots(4, 'rgba(150,110,60,.3)'); break;
      case B.BEACH: dots(5, 'rgba(160,130,80,.3)'); dots(2, 'rgba(255,255,255,.4)'); break;
      case B.SNOW: dots(2, 'rgba(150,180,220,.4)'); dots(1, '#fff', 3, 3); break;
      case B.ROCK:
        if (r(9) < 0.5) { g.strokeStyle = 'rgba(60,55,50,.35)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(px + r(1) * 32, py + r(2) * 32); g.lineTo(px + r(3) * 32, py + r(4) * 32); g.lineTo(px + r(5) * 32, py + r(6) * 32); g.stroke(); }
        dots(3, 'rgba(255,255,255,.12)', 3, 3); break;
      case B.SHALLOW: case B.DEEP:
        if (r(9) < 0.45) { g.strokeStyle = b === B.DEEP ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.22)'; g.lineWidth = 2; const x0 = px + r(1) * 18, y0 = py + 6 + r(2) * 20; g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(x0 + 6, y0 - 4, x0 + 12, y0); g.stroke(); }
        break;
      case B.TOWN:
        g.strokeStyle = 'rgba(120,90,50,.18)'; g.lineWidth = 1; g.strokeRect(px + 0.5, py + 0.5, T - 1, T - 1);
        g.beginPath(); g.moveTo(px + ((ty & 1) ? 16 : 8), py); g.lineTo(px + ((ty & 1) ? 16 : 8), py + T); g.stroke();
        dots(2, 'rgba(255,255,255,.18)'); break;
      case B.CANDY: {
        const cols = ['#fff', '#7dd3fc', '#fde047', '#a78bfa', '#f43f5e', '#4ade80'];
        for (let k = 0; k < 4; k++) { g.fillStyle = cols[(r(k + 40) * cols.length) | 0]; g.fillRect(px + r(k) * 28, py + r(k + 10) * 28, 4, 2); }
        break;
      }
      case B.CRYSTAL:
        dots(3, 'rgba(255,255,255,.35)');
        if (r(9) < 0.2) { g.fillStyle = 'rgba(200,240,255,.6)'; const x0 = px + 8 + r(1) * 16, y0 = py + 8 + r(2) * 16; g.beginPath(); g.moveTo(x0, y0 - 5); g.lineTo(x0 + 3, y0); g.lineTo(x0, y0 + 5); g.lineTo(x0 - 3, y0); g.fill(); }
        break;
      case B.MUSHROOM: dots(3, 'rgba(240,200,255,.35)', 3, 3); dots(2, 'rgba(60,20,80,.3)', 4, 3); break;
    }
  },

  /* ============ الخريطة ============ */
  renderMap() {
    const W = WORLD, cv = this.mapCanvas = document.createElement('canvas');
    cv.width = cv.height = W;
    const g = cv.getContext('2d'), img = g.createImageData(W, W), d = img.data;
    for (let i = 0; i < W * W; i++) {
      const c = BIOMES[this.biome[i]].c, dc = this.deco[i], f = dc && DECO[dc].solid ? 0.82 : 1;
      const n = 0.94 + hash2(i % W, (i / W) | 0, 2) * 0.08;
      d[i * 4] = c[0] * f * n; d[i * 4 + 1] = c[1] * f * n; d[i * 4 + 2] = c[2] * f * n; d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
};
