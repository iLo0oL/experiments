'use strict';
/* أرض العجايب — المحرك: الحركة، القتال، الوحوش، الرسم، الجو، والحوت الجماعي */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const rand = (a, b) => a + Math.random() * (b - a);
const irand = (a, b) => Math.floor(rand(a, b + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return Math.abs(d); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = s => { s = Math.max(0, Math.floor(s)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

const cv = $('#game'), ctx = cv.getContext('2d');
let VW = 0, VH = 0, DPR = 1, ZOOM = 1;
const cam = { x: 0, y: 0, shake: 0 };

const G = {
  t: 0, running: false, mobs: [], drops: [], proj: [], parts: [], floats: [], rings: [], marks: [], slashes: [],
  chests: [], bubbles: [], bottles: [], others: new Map(), signs: new Map(), bottleMsgs: new Map(), muted: new Set(),
  cut: new Map(), statics: [], npcs: [], spawnT: 1, chestT: 50, bottleT: 25, presT: 0, sT: 0, saveT: 0, hudT: 0,
  weather: WEATHER[0], weatherSlot: -1, dark: 0, explored: new Uint8Array(64 * 64), pets: new Map(), hiT: 0, wxT: 0
};
let S = null;
const P = {
  x: 0, y: 0, dir: 0, face: 1, hp: 50, en: 50, atkT: 0, swing: 0, dashT: 0, dashCd: 0, dvx: 0, dvy: 0, skillCd: 0,
  inv: 0, hitT: 0, walk: 0, moving: false, fx: {}, mount: false, boat: false, dead: 0, busy: false, combatT: 9, slowT: 0,
  cactusT: 0, kx: 0, ky: 0, lastEmote: -9, buffs: {}, pet: { x: 0, y: 0 }
};
const Input = { keys: new Set(), jx: 0, jy: 0 };

/* ============ الحفظ ============ */
function newSave(name, color, hat) {
  return {
    v: 1, name, color, hat, title: 'مبتدئ', titles: ['مبتدئ'], hats: [], lvl: 1, xp: 0, gold: 15,
    inv: { hp1: 2, dates: 3 }, wpn: 'w_bread', arm: 'a_thobe', x: CENTER * T + 16, y: (CENTER + 2) * T + 16, hp: 999,
    q: {}, qd: [], won: {}, exp: '', pets: [], pet: '', stats: { kills: 0, deaths: 0, boss: 0, riddles: 0, chests: 0, signs: 0 },
    cd: {}, world: 'w1', created: Date.now(), sound: 1, music: 1, wp: null
  };
}
function saveGame() {
  if (!S || !G.running) return;
  S.x = Math.round(P.x); S.y = Math.round(P.y); S.hp = Math.round(P.hp);
  let bin = ''; for (let i = 0; i < G.explored.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b |= G.explored[i + j] << j; bin += String.fromCharCode(b); }
  S.exp = btoa(bin);
  S.fxSave = Object.fromEntries(Object.entries(P.fx).map(([k, v]) => [k, Math.round(v - G.t)]).filter(([, v]) => v > 0));
  try { localStorage.setItem('ajayib.save', JSON.stringify(S)); } catch {}
}
function loadGame() {
  try { const s = JSON.parse(localStorage.getItem('ajayib.save')); if (s && s.v === 1) return s; } catch {}
  return null;
}
function loadExplored() {
  G.explored.fill(0);
  if (!S.exp) return;
  try { const bin = atob(S.exp); for (let i = 0; i < bin.length; i++) { const b = bin.charCodeAt(i); for (let j = 0; j < 8; j++) G.explored[i * 8 + j] = (b >> j) & 1; } } catch {}
}

/* ============ الإحصائيات ============ */
const xpNeed = l => Math.floor(22 * Math.pow(l, 1.55));
const maxHP = () => 60 + (S.lvl - 1) * 14 + (ITEMS[S.arm].def || 0) * 2;
const maxEN = () => 50 + S.lvl * 3;
const defense = () => ITEMS[S.arm].def || 0;
function attackPower() {
  let a = 4 + S.lvl * 1.6 + ITEMS[S.wpn].atk;
  if (P.fx.giant) a *= 1.6; if (P.fx.tiny) a *= 0.7; if (P.buffs.moon > G.t) a *= 1.5; if (P.buffs.friend > G.t) a *= 1.15;
  return a;
}
function speed() {
  let s = 150;
  if (S.inv.boots) s *= 1.2; if (P.mount) s *= 1.7; if (P.fx.tiny) s *= 1.35; if (P.fx.giant) s *= 0.9; if (P.fx.chicken) s *= 1.4;
  if (P.slowT > 0) s *= 0.5;
  const b = World.biomeAt(Math.floor(P.x / T), Math.floor(P.y / T));
  if (b === B.SHALLOW && !P.boat) s *= 0.6; else if (b === B.SWAMP) s *= 0.85; else if (b === B.SNOW) s *= 0.92;
  return s;
}
const inTown = o => Math.hypot(o.x / T - CENTER, o.y / T - CENTER) < SAFE_R;
const mobLevelAt = (x, y) => Math.max(1, 1 + Math.floor((Math.hypot(x / T - CENTER, y / T - CENTER) - SAFE_R) / 17));

/* ============ الأغراض ============ */
const has = (it, n = 1) => (S.inv[it] || 0) >= n;
function give(it, n = 1, quiet) {
  if (it === 'pearl') { S.gold += n; if (!quiet) floatText(P.x, P.y - 40, `+${n} ⚪`, '#fff'); return; }
  const I = ITEMS[it]; if (!I) return;
  S.inv[it] = (S.inv[it] || 0) + n;
  if (!quiet) floatText(P.x, P.y - 40, `+${n} ${I.e}`, '#fde68a');
  if (I.t === 'wpn' && (I.atk || 0) > (ITEMS[S.wpn].atk || 0)) { S.wpn = it; UI.toast(`لبست ${I.e} ${I.n} 💪`); sendPresence(); }
  if (I.t === 'arm' && (I.def || 0) > (ITEMS[S.arm].def || 0)) { S.arm = it; UI.toast(`لبست ${I.e} ${I.n} 🛡️`); }
}
function take(it, n = 1) {
  if (it === 'pearl') { S.gold -= n; return; }
  S.inv[it] = (S.inv[it] || 0) - n;
  if (S.inv[it] <= 0) { delete S.inv[it]; if (S.wpn === it) S.wpn = 'w_bread'; if (S.arm === it) S.arm = 'a_thobe'; if (it === 'camel') P.mount = false; }
}
function useItem(it) {
  const I = ITEMS[it]; if (!I || !has(it)) return;
  if (I.t === 'wpn') { S.wpn = it; UI.toast(`مسكت ${I.e} ${I.n}`); sendPresence(); return; }
  if (I.t === 'arm') { S.arm = it; P.hp = Math.min(P.hp, maxHP()); UI.toast(`لبست ${I.e} ${I.n}`); return; }
  if (I.heal) {
    if (P.hp >= maxHP() && !I.fx) { UI.toast('صحتك كاملة 💚'); return; }
    P.hp = Math.min(maxHP(), P.hp + I.heal); take(it); Snd.drink();
    floatText(P.x, P.y - 40, `+${I.heal} ❤️`, '#86efac');
    burst(P.x, P.y - 16, 10, '#86efac');
    return;
  }
  if (I.fx) { take(it); Snd.drink(); applyFx(I.fx, I.dur); }
}
function applyFx(fx, dur) {
  if (fx === 'mystery') {
    const r = Math.random();
    if (r < 0.55) return applyFx(pick(['giant', 'tiny', 'chicken', 'ghost', 'rainbow', 'flip', 'backwards']), 40);
    if (r < 0.7) { P.hp = maxHP(); UI.toast('الجرعة طلعت صحة! ❤️'); return; }
    if (r < 0.82) { give('pearl', irand(10, 40)); UI.toast('طلع منها لؤلؤ! وش هالجرعة 😳'); Snd.coin(); return; }
    if (r < 0.92) { burst(P.x, P.y - 20, 40, 'rainbow'); hurtPlayer(10, true); UI.toast('بووم! 🎆 انفجرت عليك'); return; }
    teleportRandom(); UI.toast('الجرعة نقلتك لمكان عشوائي 🌀'); return;
  }
  const until = G.t + (dur || 40);
  if (fx === 'giant') delete P.fx.tiny; if (fx === 'tiny') delete P.fx.giant;
  if (fx === 'chicken' || fx === 'ghost') P.mount = false;
  P.fx[fx] = until;
  const names = { giant: 'صرت عملاق! 🦍', tiny: 'صرت صغير مثل النملة 🐜', chicken: 'صرت دجاجة 🐔 كاك!', ghost: 'صرت شبح 👻', rainbow: 'قوس قزح وراك 🌈', flip: 'انقلبت الدنيا 🙃', backwards: 'كلامك صار بالمقلوب 🔄' };
  UI.toast(names[fx] || 'شي غريب صار…');
  burst(P.x, P.y - 20, 24, 'rainbow');
  sendState(true);
}
function teleportRandom() {
  for (let k = 0; k < 400; k++) {
    const tx = irand(30, WORLD - 30), ty = irand(30, WORLD - 30), b = World.biomeAt(tx, ty);
    if (b !== B.DEEP && b !== B.SHALLOW && !solidAt(tx, ty)) { warpTo(tx * T + 16, ty * T + 16); return; }
  }
}
function warpTo(x, y) {
  burst(P.x, P.y - 16, 30, '#c4b5fd');
  P.x = x; P.y = y; cam.x = x; cam.y = y; Snd.warp();
  burst(P.x, P.y - 16, 30, '#c4b5fd');
  G.mobs = G.mobs.filter(m => dist(m, P) < 800);
  P.pet.x = x; P.pet.y = y;
  sendState(true);
}

/* ============ التصادم ============ */
function solidAt(tx, ty) {
  const d = World.decoAt(tx, ty);
  if (!d || !DECO[d].solid) return false;
  const c = G.cut.get(ty * WORLD + tx);
  return !(c && c.t > G.t);
}
function decoAlive(tx, ty) {
  const d = World.decoAt(tx, ty); if (!d) return 0;
  const c = G.cut.get(ty * WORLD + tx);
  return c && c.t > G.t ? 0 : d;
}
function blocked(x, y, r, o = {}) {
  const tx0 = Math.floor((x - r) / T), tx1 = Math.floor((x + r) / T), ty0 = Math.floor((y - r) / T), ty1 = Math.floor((y + r) / T);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    if (!World.inb(tx, ty)) return true;
    const b = World.biome[ty * WORLD + tx];
    if (b === B.DEEP && !o.boat && !o.fly) {
      const nx = clamp(x, tx * T, tx * T + T), ny = clamp(y, ty * T, ty * T + T);
      if (Math.hypot(x - nx, y - ny) < r) return true;
    }
    if (o.water && b !== B.DEEP && b !== B.SHALLOW && b !== B.BEACH) return true;
    if (!o.ghost && !o.fly && solidAt(tx, ty) && Math.hypot(x - (tx * T + 16), y - (ty * T + 20)) < r + 10) return true;
  }
  if (!o.fly) for (const s of G.statics) if (Math.abs(s.x - x) < s.r + r && Math.abs(s.y - y) < s.r + r && Math.hypot(s.x - x, s.y - y) < s.r + r) return true;
  return false;
}
function moveEnt(e, dx, dy, r, o) {
  if (dx && !blocked(e.x + dx, e.y, r, o)) e.x += dx;
  if (dy && !blocked(e.x, e.y + dy, r, o)) e.y += dy;
}

/* ============ تأثيرات بصرية ============ */
const RAINBOW = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];
function burst(x, y, n, c, sp = 140) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = rand(sp * 0.3, sp);
    G.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: rand(0.4, 0.9), max: 0.9, c: c === 'rainbow' ? pick(RAINBOW) : c, s: rand(2, 4.5), g: 220 });
  }
}
function emojiPart(x, y, e, o = {}) { G.parts.push({ x, y, vx: o.vx ?? rand(-20, 20), vy: o.vy ?? -50, life: o.life || 1.4, max: o.life || 1.4, e, s: o.s || 18, g: o.g ?? 0 }); }
function floatText(x, y, txt, c, big) { G.floats.push({ x: x + rand(-8, 8), y, txt, c, life: 1.1, big }); }

/* ============ الصوت (يتولد بالمتصفح) ============ */
const Snd = {
  ac: null, master: null,
  init() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    try { this.ac = new (window.AudioContext || window.webkitAudioContext)(); this.master = this.ac.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ac.destination); } catch {}
  },
  ok() { return this.ac && S && S.sound; },
  tone(f, d = 0.12, type = 'square', v = 0.08, slide = 0, delay = 0) {
    if (!this.ok()) return;
    const t = this.ac.currentTime + delay, o = this.ac.createOscillator(), g = this.ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + d);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + d + 0.02);
  },
  noise(d = 0.1, v = 0.1, f = 1200, delay = 0) {
    if (!this.ok()) return;
    const t = this.ac.currentTime + delay, len = Math.floor(this.ac.sampleRate * d), buf = this.ac.createBuffer(1, len, this.ac.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = this.ac.createBufferSource(), fl = this.ac.createBiquadFilter(), g = this.ac.createGain();
    s.buffer = buf; fl.type = 'bandpass'; fl.frequency.value = f; g.gain.value = v;
    s.connect(fl); fl.connect(g); g.connect(this.master); s.start(t);
  },
  swing() { this.noise(0.09, 0.12, 2500); },
  hit() { this.tone(180, 0.08, 'square', 0.07, -80); this.noise(0.05, 0.1, 800); },
  slap() { this.noise(0.08, 0.25, 1800); this.tone(300, 0.05, 'sine', 0.05); },
  hurt() { this.tone(220, 0.18, 'sawtooth', 0.06, -120); },
  pick() { this.tone(880, 0.06, 'sine', 0.06); this.tone(1320, 0.08, 'sine', 0.05, 0, 0.05); },
  coin() { this.tone(1046, 0.07, 'square', 0.04); this.tone(1568, 0.12, 'square', 0.04, 0, 0.06); },
  lvl() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.08, 0, i * 0.09)); },
  drink() { for (let i = 0; i < 3; i++) this.tone(400 + i * 120, 0.07, 'sine', 0.06, 200, i * 0.07); },
  dash() { this.noise(0.15, 0.1, 600); },
  kill() { this.tone(500, 0.12, 'square', 0.05, 400); },
  warp() { this.tone(300, 0.4, 'sine', 0.07, 900); },
  boss() { this.tone(70, 0.6, 'sawtooth', 0.1, -20); this.noise(0.4, 0.12, 300); },
  sneeze() { this.noise(0.08, 0.15, 3000); this.noise(0.35, 0.25, 1500, 0.12); },
  cluck() { this.tone(700, 0.05, 'square', 0.05, 300); this.tone(600, 0.07, 'square', 0.05, -200, 0.08); },
  pop() { this.tone(900, 0.05, 'sine', 0.07, 600); },
  note(k) { const f = [262, 294, 330, 349, 392, 440, 494, 523][k] || 262; this.tone(f, 0.9, 'triangle', 0.09); this.tone(f * 2, 0.5, 'sine', 0.03); },
  music() {
    if (!this.ok() || !S.music) return;
    const sc = G.dark > 0.3 ? [220, 247, 262, 330, 349, 440] : [262, 294, 330, 392, 440, 523, 587];
    if (Math.random() < 0.55) this.tone(pick(sc) * (Math.random() < 0.2 ? 0.5 : 1), 1.2, 'triangle', 0.018);
  }
};

/* ============ الوقت والجو (متزامن عند الكل) ============ */
function dayPhase() { return (Date.now() / 1000 % 1440) / 1440; }
function darkness() {
  const t = dayPhase();
  if (t < 0.06) return 0.62 * (1 - t / 0.06);
  if (t < 0.62) return 0;
  if (t < 0.7) return 0.62 * (t - 0.62) / 0.08;
  return 0.62;
}
function clockStr() { const h = (dayPhase() * 24 + 6) % 24; return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`; }
function weatherFor(slot) {
  const tot = WEATHER.reduce((a, w) => a + w.w, 0);
  let x = hash2(slot, 77, SEED) * tot;
  for (const w of WEATHER) if ((x -= w.w) < 0) return w;
  return WEATHER[0];
}
const isNight = () => G.dark > 0.3;

/* ============ الحوت الرملي (زعيم جماعي) ============ */
const BOSS_P = 720, BOSS_A = 240;
const Boss = { c: -1, dmg: 0, ids: new Set(), dead: false, my: 0, pend: 0, flushT: 0, bsT: 0, lastAtk: -1, hitT: 0, active: false, max: 2500, wasNear: false };
function bossClock() { const s = Date.now() / 1000, c = Math.floor(s / BOSS_P), el = s - c * BOSS_P; return { c, el, active: el < BOSS_A, next: BOSS_P - el, left: BOSS_A - el }; }
function bossDmg(base) { const w = World.wonderById.whale; return base * (1 + 0.22 * (mobLevelAt(w.x, w.y) - 1)); }
function updateBoss(dt) {
  const bc = bossClock(), w = World.wonderById.whale;
  if (bc.c !== Boss.c) Object.assign(Boss, { c: bc.c, dmg: 0, ids: new Set(), dead: false, my: 0, pend: 0, lastAtk: -1 });
  const wasActive = Boss.active;
  Boss.active = bc.active && !Boss.dead;
  Boss.max = 2500 + 1800 * Math.max(0, Boss.ids.size - 1);
  Boss.hitT -= dt;
  const d = dist(P, w);
  if (Boss.active && !wasActive && bc.el < 3) { UI.feed('🐋 الحوت الرملي صحى! روحوا له بالصحرا'); if (d < 1500) Snd.boss(); }
  if (!Boss.active && wasActive && !Boss.dead && d < 900) UI.feed('😴 الحوت رجع ينام… المرة الجاية');
  if (Boss.active && d < 720 && P.dead <= 0) {
    const k = Math.floor(bc.el / 2.4);
    if (k !== Boss.lastAtk) { Boss.lastAtk = k; if (bc.el > 2) bossAttack(k, bc.c); }
  }
  Boss.flushT -= dt; Boss.bsT -= dt;
  if (Boss.pend > 0 && Boss.flushT <= 0) { Net.pub('g', { t: 'bd', c: Boss.c, d: Math.round(Boss.pend) }); Boss.pend = 0; Boss.flushT = 0.5; }
  if (Boss.active && Boss.dmg > 0 && Boss.bsT <= 0 && d < 1200) { Net.pub('g', { t: 'bs', c: Boss.c, d: Math.round(Boss.dmg), p: [...Boss.ids].slice(0, 20) }); Boss.bsT = 3; }
  if (!Boss.dead && bc.active && Boss.dmg >= Boss.max) bossDead();
  UI.bossBar(Boss.active && d < 900 ? { hp: Math.max(0, Boss.max - Boss.dmg), max: Boss.max, n: Math.max(1, Boss.ids.size), left: bc.left } : null);
}
function bossAttack(k, c) {
  const w = World.wonderById.whale, r = hash2(c, k, 31);
  Boss.hitT = 0.3;
  if (r < 0.42) { G.rings.push({ x: w.x, y: w.y, r: 60, v: 230, max: 700, dmg: bossDmg(16), hit: false }); Snd.boss(); }
  else if (r < 0.82) {
    for (let i = 0; i < 5; i++) G.marks.push({ x: P.x + (i ? rand(-110, 110) : 0), y: P.y + (i ? rand(-110, 110) : 0), r: 40, t: 1.25, max: 1.25, dmg: bossDmg(24) });
    for (let i = 0; i < 6; i++) emojiPart(w.x + rand(-30, 30), w.y - 60, '💦', { vy: -160, g: 300, life: 1 });
  } else if (G.mobs.filter(m => m.boss).length < 6) {
    for (let i = 0; i < 2; i++) { const m = spawnMob('crab', w.x + rand(-90, 90), w.y + rand(60, 90), mobLevelAt(w.x, w.y)); m.boss = 1; m.angry = 1; }
  }
}
function damageBoss(dmg) {
  Boss.dmg += dmg; Boss.my += dmg; Boss.pend += dmg; Boss.ids.add(Net.id); Boss.hitT = 0.12;
  const w = World.wonderById.whale;
  floatText(w.x + rand(-40, 40), w.y - 90, Math.round(dmg), '#fff');
}
function bossDead() {
  Boss.dead = true; Boss.active = false;
  const w = World.wonderById.whale;
  for (let i = 0; i < 12; i++) setTimeout(() => burst(w.x + rand(-80, 80), w.y - rand(20, 100), 20, 'rainbow', 220), i * 120);
  if (Boss.my > 0) {
    UI.banner('🐋 الحوت طاح!', `شاركت مع ${Math.max(1, Boss.ids.size)} لاعب`);
    S.stats.boss++;
    addXP(250 + S.lvl * 15);
    for (let i = 0; i < 12; i++) dropItem('pearl', irand(10, 25), w.x + rand(-60, 60), w.y + rand(40, 80));
    dropItem('bone', irand(1, 2), w.x, w.y + 60);
    if (Math.random() < 0.35 || !has('w_whale') && S.stats.boss >= 3) dropItem('w_whale', 1, w.x + 20, w.y + 70);
    if (Math.random() < 0.25) dropItem('a_whale', 1, w.x - 20, w.y + 70);
    questEvent('boss');
    Net.pub('g', { t: 'an', n: S.name, k: 'boss', v: Boss.ids.size });
  } else UI.feed('🐋 اللاعبين طيحوا الحوت!');
}

/* ============ الوحوش ============ */
function spawnMob(type, x, y, lvl) {
  const d = MOBS[type], L = Math.max(1, lvl);
  const m = { type, d, x, y, lvl: L, hp: Math.round(d.hp * (1 + 0.3 * (L - 1))), atk: d.atk * (1 + 0.22 * (L - 1)), r: d.r, t: rand(0, 2), cd: rand(0.6, 1.4), hitT: 0, face: 1, kx: 0, ky: 0, ph: Math.random() * 6, hx: x, hy: y, wx: x, wy: y, st: '', wind: 0, ct: 0 };
  m.max = m.hp;
  G.mobs.push(m);
  return m;
}
function trySpawn() {
  const night = isNight(), cap = (night ? 13 : 10) + (G.weather.id === 'purple' ? 4 : 0);
  if (G.mobs.length >= cap || P.dead > 0) return;
  const a = Math.random() * Math.PI * 2, r = rand(430, 700), x = P.x + Math.cos(a) * r, y = P.y + Math.sin(a) * r;
  const tx = Math.floor(x / T), ty = Math.floor(y / T);
  if (!World.inb(tx, ty) || Math.hypot(tx - CENTER, ty - CENTER) < SAFE_R + 4) return;
  const bio = BIOMES[World.biomeAt(tx, ty)].id;
  let list = BIOME_MOBS[bio]; if (!list) return;
  let type = pick(list);
  const ufo = World.wonderById.ufo, circus = World.wonderById.circus, throne = World.wonderById.slimeking;
  if (Math.hypot(x - ufo.x, y - ufo.y) < 900 && Math.random() < 0.5) type = 'alien';
  if (Math.hypot(x - throne.x, y - throne.y) < 700 && Math.random() < 0.6) type = 'slime';
  if (night && Math.random() < (Math.hypot(x - circus.x, y - circus.y) < 900 ? 0.7 : 0.3) && bio !== 'shallow') type = pick(NIGHT_MOBS);
  if (G.weather.id === 'purple') type = 'chicken';
  const fly = MOBS[type].ai === 'fly';
  if (blocked(x, y, MOBS[type].r, { fly, water: type === 'crab' && bio === 'shallow' })) return;
  spawnMob(type, x, y, mobLevelAt(x, y));
}
function updateMob(m, dt) {
  m.t -= dt; m.cd -= dt; m.hitT -= dt; m.ph += dt;
  const d = m.d, fly = d.ai === 'fly';
  const dx = P.x - m.x, dy = P.y - m.y, dd = Math.hypot(dx, dy) || 1;
  const ignore = P.dead > 0 || P.fx.chicken || P.fx.ghost || P.busy || inTown(P);
  let vx = 0, vy = 0, sp = d.spd;
  if (m.wind > 0) {
    m.wind -= dt;
    if (m.wind <= 0) {
      if (d.ai === 'charge') { m.st = 'charge'; m.ct = 0.6; const a = Math.atan2(dy, dx); m.cx = Math.cos(a); m.cy = Math.sin(a); }
      else if (!ignore && dd < m.r + 26) hurtPlayer(m.atk);
    }
  } else if (m.st === 'charge') {
    m.ct -= dt; vx = m.cx * sp * 3.4; vy = m.cy * sp * 3.4;
    if (!ignore && dd < m.r + 16 && m.cd <= 0) { hurtPlayer(m.atk * 1.2); m.cd = 1; }
    if (m.ct <= 0) { m.st = ''; m.cd = 1.4; }
  } else if (d.ai === 'flee') {
    if (m.hitT > -4 && dd < 300) { vx = -dx / dd * sp * 1.3; vy = -dy / dd * sp * 1.3; }
    else wander();
  } else if (!ignore && (dd < 230 || (m.angry && dd < 520))) {
    m.face = dx > 0 ? 1 : -1;
    if (d.ai === 'ranged') {
      const want = dd > 230 ? 1 : dd < 130 ? -1 : 0;
      vx = dx / dd * sp * want; vy = dy / dd * sp * want;
      if (!want) { vx = -dy / dd * sp * 0.4 * Math.sin(m.ph); vy = dx / dd * sp * 0.4 * Math.sin(m.ph); }
      if (m.cd <= 0 && dd < 340) { shoot(m, Math.atan2(dy, dx)); m.cd = rand(1.6, 2.4); }
    } else if (d.ai === 'charge' && dd < 200 && m.cd <= 0) { m.wind = 0.5; m.cd = 9; }
    else {
      vx = dx / dd * sp; vy = dy / dd * sp;
      if (dd < m.r + 20 && m.cd <= 0) { m.wind = 0.28; m.cd = 1.1; }
      if (dd < m.r + 12) { vx = 0; vy = 0; }
    }
    if (fly) { vx += Math.cos(m.ph * 3) * 40; vy += Math.sin(m.ph * 2.3) * 40; }
  } else wander();
  function wander() {
    if (m.t <= 0) { m.t = rand(1.5, 4); const a = Math.random() * 7, r = rand(0, 90); m.wx = m.hx + Math.cos(a) * r; m.wy = m.hy + Math.sin(a) * r; }
    const wx = m.wx - m.x, wy = m.wy - m.y, wd = Math.hypot(wx, wy);
    if (wd > 6) { vx = wx / wd * sp * 0.35; vy = wy / wd * sp * 0.35; }
  }
  m.kx *= Math.pow(0.002, dt); m.ky *= Math.pow(0.002, dt);
  vx += m.kx; vy += m.ky;
  if (Math.abs(vx) > 3) m.face = vx > 0 ? 1 : -1;
  m.moving = Math.abs(vx) + Math.abs(vy) > 5;
  const opt = { fly, water: m.type === 'crab' && !m.boss && World.biomeAt(Math.floor(m.hx / T), Math.floor(m.hy / T)) === B.SHALLOW };
  const tx = Math.floor((m.x + vx * dt) / T), ty = Math.floor((m.y + vy * dt) / T);
  if (!m.boss && Math.hypot(tx - CENTER, ty - CENTER) < SAFE_R) { vx = -vx; vy = -vy; }
  moveEnt(m, vx * dt, vy * dt, m.r * 0.8, opt);
}
function shoot(m, a) {
  const kinds = { web: [190, 7], snow: [230, 8], spore: [170, 7], laser: [330, 5], sprinkle: [250, 5] };
  const [v, r] = kinds[m.d.shot] || [200, 6];
  G.proj.push({ x: m.x, y: m.y - 14, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 2.2, r, dmg: m.atk, from: 'm', kind: m.d.shot });
}
function hitMob(m, dmg, a, kb = 1) {
  const crit = Math.random() < 0.1;
  dmg = Math.round(dmg * rand(0.85, 1.15) * (crit ? 1.8 : 1));
  m.hp -= dmg; m.hitT = 0.15; m.angry = 1;
  m.kx = Math.cos(a) * 260 * kb; m.ky = Math.sin(a) * 260 * kb;
  floatText(m.x, m.y - 30, crit ? `${dmg}!` : dmg, crit ? '#fde047' : '#fff', crit);
  burst(m.x, m.y - 12, 6, m.d.draw === 'slime' ? '#86efac' : '#fff', 120);
  const lifesteal = ITEMS[S.wpn].lifesteal; if (lifesteal) P.hp = Math.min(maxHP(), P.hp + lifesteal);
  if (m.type === 'kingSlime' && m.hp > 0) {
    const q = Math.floor(m.hp / m.max * 4);
    if (q < (m.q ?? 4)) { m.q = q; for (let i = 0; i < 2; i++) { const s = spawnMob('slime', m.x + rand(-30, 30), m.y + rand(-30, 30), m.lvl); s.angry = 1; } }
  }
  if (m.hp <= 0) killMob(m);
}
function killMob(m) {
  m.dead = true;
  burst(m.x, m.y - 14, 18, m.d.draw === 'slime' ? '#4ade80' : '#e5e7eb', 180);
  emojiPart(m.x, m.y - 20, '💨', { vy: -30, life: 0.6, s: 24 });
  Snd.kill();
  const L = m.lvl, luck = P.buffs.luck > G.t ? 1.5 : 1;
  addXP(Math.round(m.d.xp * (1 + 0.4 * (L - 1)) * (P.buffs.friend > G.t ? 1.2 : 1)));
  const g = Math.round(irand(m.d.g[0], m.d.g[1]) * (1 + 0.18 * (L - 1)) * luck);
  for (let i = 0; i < Math.min(4, Math.ceil(g / 6)); i++) dropItem('pearl', Math.ceil(g / Math.min(4, Math.ceil(g / 6))), m.x, m.y);
  for (const [it, ch] of m.d.drops) if (Math.random() < ch * luck) dropItem(it, 1, m.x, m.y);
  if (Math.random() < 0.03) dropItem(pick(['hp1', 'pMystery', 'pRainbow']), 1, m.x, m.y);
  S.stats.kills++;
  questEvent('kill', m.type);
  if (m.type === 'kingSlime') { UI.banner('👑 هزمت ملك السلايم!', 'التاج طاح… خذه'); Net.pub('g', { t: 'an', n: S.name, k: 'king' }); }
}
function dropItem(it, n, x, y) {
  const a = Math.random() * Math.PI * 2, v = rand(30, 90);
  G.drops.push({ it, n, x, y, z: 6, vz: rand(120, 200), vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 90, ph: Math.random() * 6 });
}

/* ============ اللاعب ============ */
function hurtPlayer(dmg, raw) {
  if (P.inv > 0 || P.dead > 0) return;
  dmg = raw ? dmg : Math.max(1, Math.round(dmg * rand(0.9, 1.1) - defense() * 0.6));
  if (P.fx.giant) dmg = Math.round(dmg * 0.8);
  P.hp -= dmg; P.inv = 0.45; P.hitT = 0.2; P.combatT = 0;
  cam.shake = Math.min(10, 3 + dmg * 0.3);
  floatText(P.x, P.y - 44, `-${dmg}`, '#f87171');
  Snd.hurt();
  if (navigator.vibrate) try { navigator.vibrate(30); } catch {}
  if (P.hp <= 0) die();
}
function die() {
  P.hp = 0; P.dead = 3; P.mount = false; P.fx = {};
  S.stats.deaths++;
  const lost = Math.floor(S.gold * 0.1); S.gold -= lost;
  burst(P.x, P.y - 16, 30, '#fff');
  UI.banner('😵 طحت!', lost ? `ضاع منك ${lost} لؤلؤ… ترجع للواحة` : 'ترجع للواحة');
  sendState(true);
}
function respawn() {
  P.dead = 0; P.hp = maxHP(); P.en = maxEN(); P.inv = 2;
  warpTo(CENTER * T + 16, (CENTER + 2) * T + 16);
  G.mobs = [];
}
function addXP(n) {
  S.xp += n;
  floatText(P.x, P.y - 56, `+${n} XP`, '#a5f3fc');
  while (S.xp >= xpNeed(S.lvl)) {
    S.xp -= xpNeed(S.lvl); S.lvl++;
    P.hp = maxHP(); P.en = maxEN();
    Snd.lvl(); burst(P.x, P.y - 20, 40, 'rainbow', 220);
    UI.banner(`⬆️ لفل ${S.lvl}!`, S.lvl === 3 ? 'فتحت مهارة الدوامة 🌀' : S.lvl === 8 ? 'فتحت قبعة الخوذة 🪖' : 'صرت أقوى');
    if (S.lvl === 8) unlockHat('🪖');
    if (S.lvl === 15) addTitle('البطل');
    if (S.lvl % 5 === 0) Net.pub('g', { t: 'an', n: S.name, k: 'lvl', v: S.lvl });
    questEvent('lvl');
    sendPresence();
  }
}
function addTitle(t) {
  if (S.titles.includes(t)) return;
  S.titles.push(t); S.title = t;
  UI.banner('🏅 لقب جديد', t);
  Net.pub('g', { t: 'an', n: S.name, k: 'title', v: t });
  sendPresence();
}
function unlockHat(h) { if (!S.hats.includes(h)) { S.hats.push(h); UI.toast(`فتحت قبعة جديدة ${h} (من المراية)`); } }
function addPet(p) {
  if (S.pets.includes(p)) return false;
  S.pets.push(p); S.pet = p; P.pet.x = P.x; P.pet.y = P.y;
  UI.banner(`🐾 حيوان أليف جديد!`, `${PETS[p].e} ${PETS[p].n} صار يمشي معك`);
  sendPresence();
  return true;
}

function updatePlayer(dt) {
  if (P.dead > 0) { P.dead -= dt; if (P.dead <= 0) respawn(); return; }
  P.atkT -= dt; P.swing -= dt; P.dashCd -= dt; P.skillCd -= dt; P.inv -= dt; P.hitT -= dt; P.combatT += dt; P.slowT -= dt; P.cactusT -= dt;
  let mx = 0, my = 0;
  const k = Input.keys;
  if (k.has('KeyW') || k.has('ArrowUp')) my -= 1;
  if (k.has('KeyS') || k.has('ArrowDown')) my += 1;
  if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
  if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
  mx += Input.jx; my += Input.jy;
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; }
  if (P.busy) { mx = 0; my = 0; }
  P.boat = World.biomeAt(Math.floor(P.x / T), Math.floor(P.y / T)) === B.DEEP;
  if (P.boat && P.mount) P.mount = false;
  const opt = { boat: has('boat'), ghost: !!P.fx.ghost };
  const r = 11;
  if (P.dashT > 0) { P.dashT -= dt; moveEnt(P, P.dvx * dt, P.dvy * dt, r, opt); if (Math.random() < 0.7) G.parts.push({ x: P.x, y: P.y - 12, vx: 0, vy: 0, life: 0.3, max: 0.3, c: S.color, s: 8, g: 0 }); }
  else if (len > 0.08) {
    const sp = speed();
    moveEnt(P, mx * sp * dt, my * sp * dt, r, opt);
    P.dir = Math.atan2(my, mx);
    if (Math.abs(mx) > 0.15) P.face = mx > 0 ? 1 : -1;
    P.walk += dt * (P.mount ? 0.7 : 1);
    P.moving = true;
  } else P.moving = false;
  // دفعة الضربة
  if (Math.abs(P.kx) + Math.abs(P.ky) > 2) { moveEnt(P, P.kx * dt, P.ky * dt, r, opt); P.kx *= Math.pow(0.01, dt); P.ky *= Math.pow(0.01, dt); }
  // الصبار يوخز
  const tx = Math.floor(P.x / T), ty = Math.floor(P.y / T);
  if (P.cactusT <= 0 && !P.mount) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const d = decoAlive(tx + i, ty + j);
    if (d && DECO[d].hurt && Math.hypot(P.x - ((tx + i) * T + 16), P.y - ((ty + j) * T + 20)) < 25) { hurtPlayer(DECO[d].hurt, true); P.cactusT = 0.7; floatText(P.x, P.y - 60, 'آي! 🌵', '#fca5a5'); }
  }
  // لقط الأغراض من الأرض (صدف وحلاوة)
  const pd = decoAlive(tx, ty);
  if (pd && DECO[pd].pick) { G.cut.set(ty * WORLD + tx, { t: G.t + (DECO[pd].re || 90) }); give(DECO[pd].pick, 1); Snd.pick(); }
  // تجديد الصحة والطاقة
  const regen = (ITEMS[S.arm].regen ? 3 : 1);
  if (P.combatT > 4) P.hp = Math.min(maxHP(), P.hp + maxHP() * 0.015 * regen * dt);
  else if (regen > 1) P.hp = Math.min(maxHP(), P.hp + 0.8 * dt);
  P.en = Math.min(maxEN(), P.en + 11 * dt);
  // انتهاء التأثيرات
  for (const f in P.fx) if (P.fx[f] < G.t) { delete P.fx[f]; UI.toast('رجعت طبيعي ✨'); sendState(true); }
  cv.classList.toggle('flip', !!P.fx.flip);
  if (P.fx.rainbow && P.moving && Math.random() < 0.8) G.parts.push({ x: P.x + rand(-6, 6), y: P.y - 6, vx: 0, vy: 0, life: 1.2, max: 1.2, c: RAINBOW[Math.floor(G.t * 10) % 7], s: 6, g: 0, ground: 1 });
  // الاستكشاف
  const cx = tx >> 3, cy = ty >> 3;
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
    const x = cx + i, y = cy + j;
    if (x >= 0 && y >= 0 && x < 64 && y < 64) G.explored[y * 64 + x] = 1;
  }
  // اكتشاف العجايب
  for (const w of World.wonders) if (!S.won[w.id] && Math.hypot(P.x - w.x, P.y - w.y) < 150 + w.s * 0.4) discover(w);
  if (World.biomeAt(tx, ty) === B.MUSHROOM) unlockHat('🍄');
  // الحيوان الأليف
  if (S.pet) {
    const tx2 = P.x - P.face * 26, ty2 = P.y + 4;
    P.pet.x += (tx2 - P.pet.x) * Math.min(1, dt * 4); P.pet.y += (ty2 - P.pet.y) * Math.min(1, dt * 4);
  }
}
function discover(w) {
  S.won[w.id] = Date.now();
  Snd.lvl();
  UI.banner(`✨ اكتشفت عجيبة!`, `${w.e} ${w.n}`);
  addXP(40 + Object.keys(S.won).length * 10);
  Net.pub('g', { t: 'an', n: S.name, k: 'wonder', v: w.id });
  questEvent('wonder', w.id);
}

/* ============ الهجوم والمهارات ============ */
function nearestTarget(range) {
  let best = null, bd = range;
  for (const m of G.mobs) { const d = dist(m, P) - m.r; if (d < bd && !m.dead) { bd = d; best = m; } }
  return best;
}
function attack(aimAngle) {
  if (P.dead > 0 || P.busy || P.atkT > 0) return;
  if (P.mount) { P.mount = false; UI.toast('نزلت من الجمل'); }
  const W = ITEMS[S.wpn], chicken = !!P.fx.chicken;
  const range = W.shot ? W.rng : W.rng + 10;
  if (aimAngle !== undefined) P.dir = aimAngle;
  else {
    const t = nearestTarget(W.shot ? 280 : 130);
    const w = World.wonderById.whale;
    if (t) P.dir = Math.atan2(t.y - P.y, t.x - P.x);
    else if (Boss.active && dist(P, w) < 240) P.dir = Math.atan2(w.y - P.y, w.x - P.x);
  }
  P.face = Math.cos(P.dir) >= 0 ? 1 : -1;
  P.atkT = chicken ? 0.3 : W.cd; P.combatT = 0;
  P.swing = 0.22;
  if (chicken) { Snd.cluck(); } else Snd.swing();
  Net.pub('r', { t: 'a', k: W.shot && !chicken ? 'p' : 's', d: +P.dir.toFixed(2) });
  if (W.shot && !chicken) {
    const v = W.shot === 'laser' ? 520 : 380;
    G.proj.push({ x: P.x + Math.cos(P.dir) * 16, y: P.y - 16 + Math.sin(P.dir) * 16, vx: Math.cos(P.dir) * v, vy: Math.sin(P.dir) * v, life: W.rng / v, r: 8, dmg: attackPower(), from: 'p', kind: W.shot });
    return;
  }
  G.slashes.push({ x: P.x, y: P.y - 14, dir: P.dir, r: range * (P.fx.giant ? 1.5 : 1), t: 0.18, c: '#fff' });
  const dmg = chicken ? 1 : attackPower(), kb = W.kb || 1, reach = range * (P.fx.giant ? 1.5 : 1);
  let hitAny = false;
  for (const m of G.mobs) {
    if (m.dead) continue;
    const d = dist(m, P), a = Math.atan2(m.y - P.y, m.x - P.x);
    if (d < reach + m.r && (angDiff(a, P.dir) < 1.25 || d < m.r + 18)) { hitMob(m, dmg, a, kb); hitAny = true; }
  }
  const w = World.wonderById.whale;
  if (Boss.active && Math.hypot(P.x - w.x, P.y - (w.y - 30)) < reach + 80) { damageBoss(dmg * rand(0.85, 1.15)); hitAny = true; }
  if (hitAny) { (S.wpn === 'w_fish' ? Snd.slap() : Snd.hit()); cam.shake = Math.max(cam.shake, 2.5); }
  else hitWorld(reach);
}
function hitWorld(reach) {
  // ضرب الأشجار والصخور
  let best = null, bd = 1e9;
  const tx0 = Math.floor(P.x / T), ty0 = Math.floor(P.y / T);
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
    const tx = tx0 + i, ty = ty0 + j, d = decoAlive(tx, ty);
    if (!d || !DECO[d].hit) continue;
    const cx = tx * T + 16, cy = ty * T + 20, dd = Math.hypot(cx - P.x, cy - P.y);
    if (dd < reach + 18 && angDiff(Math.atan2(cy - P.y, cx - P.x), P.dir) < 1.4 && dd < bd) { bd = dd; best = [tx, ty, d]; }
  }
  if (best) {
    const [tx, ty, d] = best, key = ty * WORLD + tx, D = DECO[d];
    const c = G.cut.get(key) || { hp: D.hit.hp, t: 0 };
    c.hp = (c.t && c.t <= G.t) ? D.hit.hp - 1 : c.hp - 1; c.t = 0; c.shake = G.t + 0.2;
    G.cut.set(key, c);
    burst(tx * T + 16, ty * T + 8, 8, d === 9 ? '#a5f3fc' : d === 5 ? '#a8a29e' : d === 10 ? '#f9a8d4' : '#86efac', 100);
    Snd.hit();
    if (c.hp <= 0) {
      c.t = G.t + (D.re || 90); c.hp = D.hit.hp;
      dropItem(D.hit.it, 1, tx * T + 16, ty * T + 20);
      if (Math.random() < 0.4) dropItem(D.hit.it, 1, tx * T + 16, ty * T + 20);
      if (Math.random() < 0.05) dropItem('pearl', irand(3, 8), tx * T + 16, ty * T + 20);
      addXP(1);
    }
    return;
  }
  // الديناصور المجمد
  const dino = World.wonderById.dino;
  if (dist(P, dino) < reach + 40 && !(S.cd.dino > Date.now())) {
    S.cd.dinoHits = (S.cd.dinoHits || 0) + 1;
    burst(dino.x, dino.y - 30, 12, '#bae6fd', 160); Snd.hit();
    floatText(dino.x, dino.y - 80, `🧊 ${Math.max(0, 12 - S.cd.dinoHits)}`, '#bae6fd');
    if (S.cd.dinoHits >= 12) Wonders.dinoFree();
    return;
  }
  // الفقاعات
  for (const b of G.bubbles) if (dist(b, P) < reach + b.r) popBubble(b);
}
function dash() {
  if (P.dead > 0 || P.busy || P.dashCd > 0 || P.en < 15) return;
  P.en -= 15; P.dashCd = 0.8; P.dashT = 0.17; P.inv = Math.max(P.inv, 0.25);
  let a = P.dir;
  if (Math.hypot(Input.jx, Input.jy) > 0.2) a = Math.atan2(Input.jy, Input.jx);
  P.dvx = Math.cos(a) * 640; P.dvy = Math.sin(a) * 640;
  Snd.dash();
  Net.pub('r', { t: 'a', k: 'd', d: +a.toFixed(2) });
}
function skill() {
  if (P.dead > 0 || P.busy) return;
  if (S.lvl < 3) { UI.toast('الدوامة 🌀 تنفتح بلفل 3'); return; }
  if (P.skillCd > 0 || P.en < 30) { UI.toast(P.en < 30 ? 'طاقتك ما تكفي ⚡' : 'استنى شوي…'); return; }
  P.en -= 30; P.skillCd = 3; P.swing = 0.4; P.combatT = 0; P.mount = false;
  const R = 92 * (P.fx.giant ? 1.5 : 1);
  G.slashes.push({ x: P.x, y: P.y - 14, dir: 0, r: R, t: 0.35, spin: 1, c: '#c4b5fd' });
  Snd.swing(); setTimeout(() => Snd.swing(), 100);
  for (const m of G.mobs) if (!m.dead && dist(m, P) < R + m.r) hitMob(m, attackPower() * 1.5, Math.atan2(m.y - P.y, m.x - P.x), 1.6);
  const w = World.wonderById.whale;
  if (Boss.active && Math.hypot(P.x - w.x, P.y - (w.y - 30)) < R + 80) damageBoss(attackPower() * 1.5);
  for (const b of G.bubbles) if (dist(b, P) < R + b.r) popBubble(b);
  Net.pub('r', { t: 'a', k: 'w', d: 0 });
}
function quickHeal() {
  for (const it of ['hp1', 'hp2', 'honey', 'fish', 'egg', 'dates', 'candy']) if (has(it)) { useItem(it); return; }
  UI.toast('ما عندك شي ينشرب أو ينوكل 😢');
}
function toggleMount() {
  if (!has('camel')) return;
  if (P.boat || P.fx.chicken) { UI.toast('ما ينفع الحين 🐫'); return; }
  P.mount = !P.mount; Snd.cluck();
  UI.toast(P.mount ? 'ركبت الجمل 🐫 يلا!' : 'نزلت من الجمل');
  sendState(true);
}
function emote(i) {
  Net.pub('r', { t: 'e', e: i });
  G.myEmote = { e: EMOTES[i], until: G.t + 2.5 };
  if (EMOTES[i] === '🤝') P.lastEmote = G.t;
  for (const o of G.others.values()) if (EMOTES[i] === '🤝' && o.lastShake > G.t - 3 && Math.hypot(o.x - P.x, o.y - P.y) < 90) friendBuff(o);
}
function friendBuff(o) {
  if (P.buffs.friend > G.t + 60) return;
  P.buffs.friend = G.t + 180;
  UI.banner('🤝 شحنة صداقة!', `أنت و${o.name}: +20٪ خبرة و+15٪ ضرب لمدة 3 دقايق`);
  burst(P.x, P.y - 20, 30, '#f9a8d4');
}

/* ============ المقذوفات والأغراض والفقاعات ============ */
function updateProj(dt) {
  for (const p of G.proj) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    if (p.kind === 'magic' && Math.random() < 0.6) G.parts.push({ x: p.x, y: p.y, vx: rand(-20, 20), vy: rand(-20, 20), life: 0.4, max: 0.4, c: pick(['#c4b5fd', '#f0abfc', '#fff']), s: 3, g: 0 });
    const tx = Math.floor(p.x / T), ty = Math.floor(p.y / T);
    if (p.kind !== 'remote' && solidAt(tx, ty) && Math.hypot(p.x - (tx * T + 16), p.y - (ty * T + 12)) < 16) { p.life = 0; burst(p.x, p.y, 4, '#fff', 60); continue; }
    if (p.from === 'm') {
      if (P.dead <= 0 && Math.hypot(p.x - P.x, p.y - (P.y - 14)) < p.r + 12) {
        p.life = 0; hurtPlayer(p.dmg);
        if (p.kind === 'web') { P.slowT = 1.6; UI.toast('علقت بشبكة العنكبوت 🕸️'); }
      }
    } else if (p.from === 'p') {
      for (const m of G.mobs) if (!m.dead && Math.hypot(p.x - m.x, p.y - (m.y - 12)) < p.r + m.r) { hitMob(m, p.dmg, Math.atan2(p.vy, p.vx), 0.6); p.life = 0; Snd.hit(); break; }
      const w = World.wonderById.whale;
      if (p.life > 0 && Boss.active && Math.hypot(p.x - w.x, p.y - (w.y - 30)) < 70) { damageBoss(p.dmg * rand(0.85, 1.15)); p.life = 0; }
      for (const b of G.bubbles) if (p.life > 0 && Math.hypot(p.x - b.x, p.y - b.y) < b.r + p.r) { popBubble(b); p.life = 0; }
    }
  }
  G.proj = G.proj.filter(p => p.life > 0);
}
function updateDrops(dt) {
  const magnet = has('magnet') ? 150 : 0;
  for (const d of G.drops) {
    d.life -= dt; d.ph += dt;
    if (d.z > 0 || d.vz > 0) { d.vz -= 600 * dt; d.z += d.vz * dt; d.x += d.vx * dt; d.y += d.vy * dt; if (d.z <= 0) { d.z = 0; d.vz = d.big ? 0 : (Math.abs(d.vz) > 60 ? -d.vz * 0.4 : 0); if (d.star) { burst(d.x, d.y, 16, '#fde047', 160); d.star = 0; } } }
    if (d.hop && d.z <= 0 && Math.random() < dt * 0.8) { d.vz = 160; const a = Math.random() * 7; d.vx = Math.cos(a) * 50; d.vy = Math.sin(a) * 50; }
    if (P.dead > 0 || d.z > 30) continue;
    const dd = Math.hypot(d.x - P.x, d.y - P.y);
    let petNear = false;
    if (S.pet && Math.hypot(d.x - P.pet.x, d.y - P.pet.y) < 40) petNear = true;
    if (dd < 26 || petNear) { d.life = 0; give(d.it, d.n); d.it === 'pearl' ? Snd.coin() : Snd.pick(); if (d.it === 'frog' && Math.random() < 0.06) addPet('frog'); }
    else if (dd < magnet) { d.x += (P.x - d.x) / dd * 260 * dt; d.y += (P.y - d.y) / dd * 260 * dt; }
  }
  G.drops = G.drops.filter(d => d.life > 0);
}
function popBubble(b) {
  if (b.pop) return;
  b.pop = 1; Snd.pop(); burst(b.x, b.y, 10, '#bae6fd', 120);
  dropItem('pearl', irand(1, 4), b.x, b.y + 20);
}
function updateWeather(dt) {
  const slot = Math.floor(Date.now() / 300000);
  if (slot !== G.weatherSlot) {
    const first = G.weatherSlot === -1;
    G.weatherSlot = slot; G.weather = weatherFor(slot);
    if (!first && G.weather.id !== 'clear') { UI.feed(`${G.weather.e} ${G.weather.n}${G.weather.d ? ' — ' + G.weather.d : ''}`); if (G.weather.d) UI.banner(`${G.weather.e} ${G.weather.n}`, G.weather.d); }
    if (G.weather.id === 'purple') for (const m of G.mobs) if (!m.boss && m.type !== 'kingSlime' && m.type !== 'mimic') { Object.assign(m, { type: 'chicken', d: MOBS.chicken }); burst(m.x, m.y - 10, 10, '#d8b4fe'); }
  }
  G.wxT -= dt;
  const w = G.weather.id;
  if (G.wxT <= 0 && P.dead <= 0) {
    if (w === 'dates') { G.wxT = 0.7; const d = { it: 'dates', n: 1, x: P.x + rand(-260, 260), y: P.y + rand(-200, 200), z: 320, vz: 0, vx: 0, vy: 0, life: 40, ph: 0 }; G.drops.push(d); }
    else if (w === 'frogs') { G.wxT = 1.4; G.drops.push({ it: 'frog', n: 1, x: P.x + rand(-260, 260), y: P.y + rand(-200, 200), z: 320, vz: 0, vx: 0, vy: 0, life: 30, ph: 0, hop: 1 }); }
    else if (w === 'stars') { G.wxT = 2.6; G.drops.push({ it: 'star', n: 1, x: P.x + rand(-280, 280), y: P.y + rand(-220, 220), z: 420, vz: -200, vx: 0, vy: 0, life: 40, ph: 0, star: 1 }); }
    else if (w === 'bubbles') { G.wxT = 0.9; if (G.bubbles.length < 14) G.bubbles.push({ x: P.x + rand(-300, 300), y: P.y + rand(-100, 300), r: rand(12, 22), ph: Math.random() * 6, life: 12 }); }
    else G.wxT = 1;
  }
  for (const b of G.bubbles) { b.life -= dt; b.y -= 22 * dt; b.ph += dt; b.x += Math.sin(b.ph * 2) * 20 * dt; if (dist(b, P) < b.r + 12 && P.dead <= 0) popBubble(b); }
  G.bubbles = G.bubbles.filter(b => b.life > 0 && !b.pop);
}

/* ============ أشياء تطلع بالبرية: صناديق وقوارير ============ */
function updateWild(dt) {
  G.chestT -= dt; G.bottleT -= dt;
  G.chests = G.chests.filter(c => dist(c, P) < 1400);
  G.bottles = G.bottles.filter(c => dist(c, P) < 1400);
  if (G.chestT <= 0) {
    G.chestT = rand(70, 130);
    if (G.chests.length < 2 && !inTown(P)) for (let k = 0; k < 20; k++) {
      const a = Math.random() * 7, r = rand(280, 480), x = P.x + Math.cos(a) * r, y = P.y + Math.sin(a) * r;
      const b = World.biomeAt(Math.floor(x / T), Math.floor(y / T));
      if (b !== B.DEEP && b !== B.SHALLOW && !blocked(x, y, 14) && Math.hypot(x / T - CENTER, y / T - CENTER) > SAFE_R + 3) { G.chests.push({ x, y, mimic: Math.random() < 0.28 }); break; }
    }
  }
  if (G.bottleT <= 0) {
    G.bottleT = rand(40, 80);
    if (G.bottles.length < 1) for (let k = 0; k < 40; k++) {
      const x = P.x + rand(-500, 500), y = P.y + rand(-400, 400), tx = Math.floor(x / T), ty = Math.floor(y / T);
      if (World.biomeAt(tx, ty) === B.BEACH && dist({ x, y }, P) > 200) { G.bottles.push({ x: tx * T + 16, y: ty * T + 16 }); break; }
    }
  }
}
function openChest(c) {
  G.chests = G.chests.filter(o => o !== c);
  if (c.mimic) {
    const m = spawnMob('mimic', c.x, c.y, Math.max(S.lvl, mobLevelAt(c.x, c.y))); m.angry = 1;
    UI.toast('😱 الصندوق طلع عضّاض!'); Snd.boss(); cam.shake = 8;
    return;
  }
  S.stats.chests++;
  Snd.coin(); burst(c.x, c.y - 10, 20, '#fde047', 160);
  const L = mobLevelAt(c.x, c.y);
  for (let i = 0; i < 3; i++) dropItem('pearl', irand(3, 8) * L, c.x, c.y);
  dropItem(pick(['hp1', 'hp1', 'pMystery', 'pGiant', 'pTiny', 'pRainbow', 'crystal', 'star', 'honey', 'pChicken']), 1, c.x, c.y);
  UI.toast('🎁 صندوق كنز!');
}

/* ============ الشبكة ============ */
const FXBITS = { giant: 1, tiny: 2, chicken: 4, ghost: 8, rainbow: 16 };
function fxBits() {
  let b = 0; for (const k in FXBITS) if (P.fx[k]) b |= FXBITS[k];
  if (P.mount) b |= 128; if (P.boat) b |= 64; if (P.dead > 0) b |= 256;
  return b;
}
const lastSent = { x: 0, y: 0, f: -1, t: 0 };
function sendState(force) {
  if (!Net.online) return;
  const moved = Math.abs(P.x - lastSent.x) + Math.abs(P.y - lastSent.y) > 1.5, f = fxBits();
  const gap = G.t - lastSent.t;
  if (force || (moved && gap > 0.16) || f !== lastSent.f || gap > 2) {
    Net.setRegion(P.x, P.y);
    Net.pub('r', { t: 's', x: Math.round(P.x), y: Math.round(P.y), d: +P.dir.toFixed(2), m: P.moving ? 1 : 0, f, fc: P.face });
    Object.assign(lastSent, { x: P.x, y: P.y, f, t: G.t });
  }
}
function sendPresence() {
  if (!Net.online || !S) return;
  Net.pub('g', { t: 'p', n: S.name, c: S.color, h: S.hat, ti: S.title, l: S.lvl, pt: S.pet, w: S.wpn, x: Math.round(P.x), y: Math.round(P.y), won: Object.keys(S.won).length });
  G.presT = 5;
}
function cleanText(s, max) {
  s = String(s ?? '').replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, '').trim().slice(0, max);
  const norm = w => w.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase();
  return s.split(/(\s+)/).map(w => {
    const n = norm(w.replace(/[^\p{L}]/gu, ''));
    if (!n) return w;
    const bad = BAD_WORDS.has(n) || ['يال', 'وال', 'يا', 'ال', 'و'].some(p => n.startsWith(p) && BAD_WORDS.has(n.slice(p.length)));
    return bad ? '🙊' : w;
  }).join('');
}
function other(id) {
  let o = G.others.get(id);
  if (!o) {
    o = { id, name: '…', color: '#94a3b8', hat: '', title: '', lvl: 1, pet: '', wpn: 'w_bread', x: 0, y: 0, tx: 0, ty: 0, dir: 0, face: 1, m: 0, f: 0, seen: 0, sT: -99, walk: 0, swing: 0, pet2: { x: 0, y: 0 }, fresh: 1, won: 0 };
    G.others.set(id, o);
  }
  o.seen = G.t;
  return o;
}
function onNet(o, kind, retained) {
  const num = (v, lo, hi) => (typeof v === 'number' && isFinite(v)) ? clamp(v, lo, hi) : null;
  const self = o.i === Net.id;
  if (kind === 'sign' || kind === 'bottle') {
    const a = num(o.a, 0, SIGN_TPL.length - 1), b = num(o.b, 0, SIGN_WORDS.length - 1);
    if (a === null || b === null) return;
    const rec = { n: cleanText(o.n, 16) || 'مجهول', a: a | 0, b: b | 0, ts: num(o.ts, 0, Date.now() + 864e5) || 0, mine: self };
    if (kind === 'sign') {
      const x = num(o.x, 0, WORLD * T), y = num(o.y, 0, WORLD * T); if (x === null || y === null) return;
      rec.x = x; rec.y = y; rec.slot = num(o.s, 0, 99) | 0;
      G.signs.set(rec.slot, rec);
    } else G.bottleMsgs.set(num(o.s, 0, 99) | 0, rec);
    return;
  }
  if (self || G.muted.has(o.i)) return;
  switch (o.t) {
    case 'hi': if (!G.hiT || G.t - G.hiT > 3) { G.hiT = G.t; setTimeout(sendPresence, rand(200, 1500)); setTimeout(() => sendState(true), rand(100, 800)); } break;
    case 'bye': G.others.delete(o.i); break;
    case 'p': {
      const r = other(o.i);
      r.name = cleanText(o.n, 16) || 'لاعب';
      if (/^#[0-9a-f]{6}$/i.test(o.c)) r.color = o.c;
      if (HATS.some(h => h.id === o.h)) r.hat = o.h;
      r.title = TITLES_INFO[o.ti] ? o.ti : '';
      r.lvl = num(o.l, 1, 99) | 0 || 1;
      r.pet = PETS[o.pt] ? o.pt : '';
      r.wpn = ITEMS[o.w] && ITEMS[o.w].t === 'wpn' ? o.w : 'w_bread';
      r.won = num(o.won, 0, 99) | 0;
      const x = num(o.x, 0, WORLD * T), y = num(o.y, 0, WORLD * T);
      if (x !== null && G.t - r.sT > 3) { r.x = r.tx = x; r.y = r.ty = y; }
      if (r.fresh) { r.fresh = 0; UI.feed(`👋 ${r.name} دخل العالم`); r.pet2.x = r.x; r.pet2.y = r.y; }
      break;
    }
    case 's': {
      const r = other(o.i), x = num(o.x, 0, WORLD * T), y = num(o.y, 0, WORLD * T);
      if (x === null || y === null) return;
      if (Math.hypot(x - r.x, y - r.y) > 500 || G.t - r.sT > 3) { r.x = x; r.y = y; r.pet2.x = x; r.pet2.y = y; }
      r.tx = x; r.ty = y; r.dir = num(o.d, -7, 7) || 0; r.m = o.m ? 1 : 0; r.f = num(o.f, 0, 1023) | 0; r.face = o.fc === -1 ? -1 : 1; r.sT = G.t;
      break;
    }
    case 'a': {
      const r = other(o.i), d = num(o.d, -7, 7) || 0;
      if (G.t - r.sT > 3) break;
      r.dir = d; r.face = Math.cos(d) >= 0 ? 1 : -1;
      if (o.k === 's') { r.swing = 0.22; G.slashes.push({ x: r.x, y: r.y - 14, dir: d, r: 56, t: 0.18, c: '#fff' }); }
      else if (o.k === 'w') G.slashes.push({ x: r.x, y: r.y - 14, dir: 0, r: 92, t: 0.35, spin: 1, c: '#c4b5fd' });
      else if (o.k === 'p') { const W = ITEMS[r.wpn]; G.proj.push({ x: r.x, y: r.y - 16, vx: Math.cos(d) * 420, vy: Math.sin(d) * 420, life: 0.7, r: 6, from: 'x', kind: W.shot || 'magic' }); }
      else if (o.k === 'd') for (let i = 0; i < 8; i++) G.parts.push({ x: r.x - Math.cos(d) * i * 8, y: r.y - 12 - Math.sin(d) * i * 8, vx: 0, vy: 0, life: 0.3, max: 0.3, c: r.color, s: 7, g: 0 });
      break;
    }
    case 'e': {
      const r = other(o.i), i = num(o.e, 0, EMOTES.length - 1);
      if (i === null) break;
      r.emote = { e: EMOTES[i | 0], until: G.t + 2.5 };
      if (EMOTES[i | 0] === '🤝') { r.lastShake = G.t; if (P.lastEmote > G.t - 3 && Math.hypot(r.x - P.x, r.y - P.y) < 90) friendBuff(r); }
      break;
    }
    case 'c': {
      const r = other(o.i), m = cleanText(o.m, 120);
      if (!m) break;
      if (o.n && r.name === '…') r.name = cleanText(o.n, 16);
      r.bubble = { text: m, until: G.t + 6 };
      UI.chatLine(r.name, m, r.color);
      break;
    }
    case 'n': {
      const r = other(o.i), k = num(o.k, 0, 7);
      if (k === null || Math.hypot(r.x - P.x, r.y - P.y) > 700) break;
      Snd.note(k | 0); emojiPart(r.x + rand(-10, 10), r.y - 50, pick(['🎵', '🎶']), { vy: -40 });
      break;
    }
    case 'an': {
      const n = cleanText(o.n, 16) || 'لاعب';
      if (o.k === 'wonder') { const w = World.wonderById[o.v]; if (w) UI.feed(`✨ ${n} اكتشف ${w.e} ${w.n}`); }
      else if (o.k === 'lvl') UI.feed(`⬆️ ${n} وصل لفل ${num(o.v, 1, 99) | 0}`);
      else if (o.k === 'boss') UI.feed(`🐋 ${n} ساعد بتطييح الحوت!`);
      else if (o.k === 'king') UI.feed(`👑 ${n} هزم ملك السلايم!`);
      else if (o.k === 'title' && TITLES_INFO[o.v]) UI.feed(`🏅 ${n} حصل لقب «${o.v}»`);
      break;
    }
    case 'g': {
      if (o.to !== Net.id) break;
      const r = G.others.get(o.i), it = o.it, n = num(o.n, 1, 20) | 0;
      if (!r || !ITEMS[it] || !n || Math.hypot(r.x - P.x, r.y - P.y) > 400) break;
      give(it, n, true); Snd.coin();
      UI.banner('🎁 هدية!', `${r.name} أهداك ${n} ${ITEMS[it].e} ${ITEMS[it].n}`);
      break;
    }
    case 'bd': if (o.c === Boss.c && !Boss.dead) { const d = num(o.d, 0, 600); if (d) { Boss.dmg += d; Boss.ids.add(o.i); Boss.hitT = 0.1; } } break;
    case 'bs': if (o.c === Boss.c && !Boss.dead) {
      const d = num(o.d, 0, 1e6); if (d && d > Boss.dmg) Boss.dmg = d;
      if (Array.isArray(o.p)) for (const id of o.p.slice(0, 20)) if (typeof id === 'string' && id.length <= 12) Boss.ids.add(id);
      Boss.ids.add(o.i);
    } break;
  }
}
function netTick(dt) {
  G.presT -= dt;
  if (Net.online) {
    sendState(false);
    if (G.presT <= 0) sendPresence();
  }
  for (const [id, o] of G.others) if (G.t - o.seen > 16) G.others.delete(id);
  for (const o of G.others.values()) {
    const k = Math.min(1, dt * 10);
    const ox = o.x, oy = o.y;
    o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k;
    o.moving = Math.hypot(o.x - ox, o.y - oy) > 0.3 || o.m;
    if (o.moving) o.walk += dt;
    o.swing -= dt;
    if ((o.f & 16) && o.moving && Math.random() < 0.6) G.parts.push({ x: o.x + rand(-6, 6), y: o.y - 6, vx: 0, vy: 0, life: 1.2, max: 1.2, c: RAINBOW[Math.floor(G.t * 10) % 7], s: 6, g: 0, ground: 1 });
    if (o.pet) { o.pet2.x += (o.x - o.face * 26 - o.pet2.x) * Math.min(1, dt * 4); o.pet2.y += (o.y + 4 - o.pet2.y) * Math.min(1, dt * 4); }
  }
}

/* ============ الرسم ============ */
const SPR = new Map();
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';
function sprite(e, size) {
  const px = Math.max(6, Math.round(size * DPR * ZOOM));
  const key = e + '|' + px;
  let s = SPR.get(key);
  if (!s) {
    const c = document.createElement('canvas'), pad = Math.ceil(px * 0.22);
    c.width = c.height = px + pad * 2;
    const g = c.getContext('2d');
    g.font = `${px}px ${EMOJI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(e, c.width / 2, c.height / 2 + px * 0.05);
    s = { c, w: c.width / (DPR * ZOOM), h: c.height / (DPR * ZOOM) };
    SPR.set(key, s);
    if (SPR.size > 700) SPR.delete(SPR.keys().next().value);
  }
  return s;
}
/* يرسم الإيموجي وقاعدته عند (x,y) */
function drawSpr(e, x, y, size, o) {
  const s = sprite(e, size);
  if (!o) { ctx.drawImage(s.c, x - s.w / 2, y - size / 2 - s.h / 2, s.w, s.h); return; }
  ctx.save(); ctx.translate(x, y);
  if (o.a !== undefined) ctx.globalAlpha *= o.a;
  if (o.rot) ctx.rotate(o.rot);
  ctx.scale((o.flip ? -1 : 1) * (o.sx || 1), o.sy || 1);
  ctx.drawImage(s.c, -s.w / 2, (o.c ? 0 : -size / 2) - s.h / 2, s.w, s.h);
  ctx.restore();
}
function shadow(x, y, r) { ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.38, 0, 0, 7); ctx.fill(); }
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgb(${clamp(r * f, 0, 255) | 0},${clamp(g * f, 0, 255) | 0},${clamp(b * f, 0, 255) | 0})`;
}
let ghutraPat = null, whitePat = null;
function makePat(red) {
  const c = document.createElement('canvas'); c.width = c.height = 6;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 6, 6);
  if (red) { g.fillStyle = '#dc2626'; g.fillRect(0, 0, 3, 3); g.fillRect(3, 3, 3, 3); }
  else { g.fillStyle = '#e5e7eb'; g.fillRect(0, 0, 3, 3); g.fillRect(3, 3, 3, 3); }
  return ctx.createPattern(c, 'repeat');
}
function drawHat(hat, face) {
  if (!hat) return;
  if (hat === 'ghutra' || hat === 'white') {
    if (!ghutraPat) { ghutraPat = makePat(true); whitePat = makePat(false); }
    ctx.fillStyle = hat === 'ghutra' ? ghutraPat : whitePat;
    ctx.beginPath(); ctx.moveTo(-14, -12); ctx.quadraticCurveTo(-15, -33, 0, -33); ctx.quadraticCurveTo(15, -33, 14, -12);
    ctx.lineTo(16, -2); ctx.lineTo(10, -14); ctx.quadraticCurveTo(0, -24, -10, -14); ctx.lineTo(-16, -2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.ellipse(0, -27, 11, 3, 0, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, -24.5, 11.5, 3, 0, 0, 7); ctx.stroke();
    return;
  }
  drawSpr(hat, 0, -25, 19, { flip: face > 0 && hat !== '🎀' });
}
function drawChar(o) {
  const fx = o.fx || {};
  const sc = fx.giant ? 1.9 : fx.tiny ? 0.55 : 1;
  ctx.save(); ctx.translate(o.x, o.y);
  if (o.dead) { drawSpr('🪦', 0, 0, 30); ctx.restore(); return; }
  shadow(0, 0, 13 * sc);
  if (fx.ghost) ctx.globalAlpha = 0.38;
  let lift = 0;
  if (o.boat) { drawSpr('🛶', 0, 8, 48, { flip: o.face > 0 }); lift = 4 + Math.sin(G.t * 3) * 1.5; }
  else if (o.mount) { drawSpr('🐫', 0, 4, 52, { flip: o.face > 0, sy: 1 + Math.sin(o.walk * 8) * 0.03 }); lift = 30; }
  ctx.translate(0, -lift);
  ctx.scale(sc, sc);
  if (fx.chicken) { drawSpr('🐔', 0, 0, 32, { flip: o.face > 0, sy: 1 + Math.abs(Math.sin(o.walk * 14)) * 0.08 }); ctx.restore(); return; }
  const bob = o.moving ? Math.abs(Math.sin(o.walk * 10)) * 2.4 : Math.sin(G.t * 2.2 + o.x) * 0.6;
  const st = o.moving && !o.mount ? Math.sin(o.walk * 10) * 3.5 : 0;
  if (!o.mount && !o.boat) {
    ctx.fillStyle = '#3b2a20';
    ctx.beginPath(); ctx.ellipse(-5 + st, -2, 4.5, 3, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(5 - st, -2, 4.5, 3, 0, 0, 7); ctx.fill();
  }
  ctx.translate(0, -bob);
  // السلاح ورا الجسم إذا يطالع يسار
  const W = ITEMS[o.wpn] || ITEMS.w_bread;
  const swingP = o.swing > 0 ? 1 - o.swing / 0.22 : -1;
  const drawW = () => {
    const hx = o.face * 12, hy = -11;
    let rot = o.face > 0 ? 0.5 : -0.5;
    if (swingP >= 0) rot = o.dir + Math.PI / 2 + (swingP - 0.5) * 2.4 * o.face - (o.face > 0 ? 0 : 0);
    drawSpr(W.e, hx, hy, 20, { rot, flip: o.face < 0, c: 1 });
  };
  if (o.face < 0) drawW();
  ctx.fillStyle = o.hurt ? '#fff' : o.color;
  ctx.strokeStyle = shade(o.color, 0.6); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, -15, 12, 14, 0, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.beginPath(); ctx.ellipse(-3, -21, 5, 4, -0.5, 0, 7); ctx.fill();
  // العيون
  const ex = Math.cos(o.dir) * 2, ey = Math.sin(o.dir) * 1.5, blink = ((G.t + o.x * 0.01) % 4) < 0.12;
  for (const s of [-1, 1]) {
    const x = s * 4.5 + o.face * 2;
    if (blink) { ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x - 3, -17); ctx.lineTo(x + 3, -17); ctx.stroke(); continue; }
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, -17, 3.8, 0, 7); ctx.fill();
    ctx.fillStyle = '#111827'; ctx.beginPath(); ctx.arc(x + ex, -17 + ey, 1.9, 0, 7); ctx.fill();
  }
  if (o.hurt) { ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(o.face * 2, -9, 3, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
  drawHat(o.hat, o.face);
  if (o.face >= 0) drawW();
  ctx.restore();
}
function drawLabel(x, y, name, lvl, title, color) {
  ctx.font = '700 11px Tajawal, system-ui, sans-serif';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.fillStyle = color || '#fff';
  const t = lvl ? `${name} · ${lvl}` : name;
  ctx.strokeText(t, x, y); ctx.fillText(t, x, y);
  if (title && title !== 'مبتدئ') {
    ctx.font = '700 9px Tajawal, system-ui, sans-serif'; ctx.fillStyle = '#fcd34d';
    ctx.strokeText(`« ${title} »`, x, y - 12); ctx.fillText(`« ${title} »`, x, y - 12);
  }
}
function drawBubble(x, y, text) {
  ctx.font = '600 11px Tajawal, system-ui, sans-serif';
  const words = text.split(' '), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > 130 && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  const L = lines.slice(0, 4), w = Math.max(...L.map(l => ctx.measureText(l).width)) + 14, h = L.length * 14 + 8;
  ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - w / 2, y - h, w, h, 8) : ctx.rect(x - w / 2, y - h, w, h); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 6); ctx.fill();
  ctx.fillStyle = '#111827';
  L.forEach((l, i) => ctx.fillText(l, x, y - h + 15 + i * 14));
}
function drawSlime(m) {
  const big = m.d.big ? 2.6 : 1, hop = Math.abs(Math.sin(m.ph * 5)) * (m.moving ? 6 : 1.5);
  const bio = World.biomeAt(Math.floor(m.hx / T), Math.floor(m.hy / T));
  const col = m.d.big ? '#4ade80' : { [B.DESERT]: '#fb923c', [B.SNOW]: '#7dd3fc', [B.CANDY]: '#f472b6', [B.MUSHROOM]: '#c084fc', [B.SWAMP]: '#84cc16' }[bio] || '#4ade80';
  ctx.save(); ctx.translate(m.x, m.y); ctx.scale(big, big);
  shadow(0, 0, 13);
  const sq = 1 + Math.sin(m.ph * 10) * 0.06 * (m.moving ? 1 : 0.3);
  ctx.translate(0, -hop);
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = m.hitT > 0 ? '#fff' : col;
  ctx.beginPath(); ctx.moveTo(-14 * sq, 0); ctx.quadraticCurveTo(-15 * sq, -22 / sq, 0, -22 / sq); ctx.quadraticCurveTo(15 * sq, -22 / sq, 14 * sq, 0); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.ellipse(-6, -15, 3, 2, -0.5, 0, 7); ctx.fill();
  ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(-4 + m.face * 2, -10, 2, 0, 7); ctx.arc(4 + m.face * 2, -10, 2, 0, 7); ctx.fill();
  if (m.d.big) drawSpr('👑', 0, -20, 14);
  ctx.restore();
}
function drawMob(m) {
  if (m.d.draw === 'slime') drawSlime(m);
  else {
    const fly = m.d.ai === 'fly', hop = fly ? 14 + Math.sin(m.ph * 4) * 4 : (m.moving ? Math.abs(Math.sin(m.ph * 9)) * 3 : 0);
    shadow(m.x, m.y, m.r * (fly ? 0.7 : 1));
    const sq = m.hitT > 0 ? 0.8 : m.wind > 0 ? 1.15 : 1;
    if (m.type === 'mimic') {
      drawSpr('🎁', m.x, m.y - hop, m.d.s, { sy: sq, sx: 1 / sq });
      drawSpr('👄', m.x, m.y - hop - 6, 16, { sy: 1 + Math.sin(m.ph * 12) * 0.3 });
    } else drawSpr(m.d.e, m.x, m.y - hop, m.d.s, { flip: m.face > 0, sy: sq, sx: 1 / sq, a: m.hitT > 0 ? 0.6 : 1 });
    if (m.wind > 0) { ctx.fillStyle = '#ef4444'; ctx.font = '900 16px system-ui'; ctx.fillText('!', m.x, m.y - m.d.s - hop - 4); }
  }
  if (m.hp < m.max) {
    const w = m.d.big ? 60 : 28, y = m.y - (m.d.s || 26) * (m.d.big ? 2.2 : 1) - 12;
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(m.x - w / 2, y, w, 4);
    ctx.fillStyle = '#ef4444'; ctx.fillRect(m.x - w / 2, y, w * Math.max(0, m.hp / m.max), 4);
    ctx.font = '700 8px system-ui'; ctx.fillStyle = '#fff'; ctx.fillText(m.lvl, m.x - w / 2 - 6, y + 4);
  }
}
function drawWonder(w) {
  const t = G.t, s = w.s;
  switch (w.id) {
    case 'whale': {
      const awake = Boss.active;
      shadow(w.x, w.y + 6, 70);
      const bob = awake ? Math.sin(t * 3) * 4 : Math.sin(t * 0.8) * 2;
      const sh = Boss.hitT > 0 ? rand(-3, 3) : 0;
      drawSpr('🐋', w.x + sh, w.y + bob, s, { sy: awake ? 1 : 0.92 });
      if (!awake && Math.random() < 0.02) emojiPart(w.x + 40, w.y - 80, '💤', { vy: -25, vx: 10, life: 2, s: 20 });
      if (awake) { drawSpr('💢', w.x - 20, w.y - s * 0.8 + bob, 26); if (Math.random() < 0.05) emojiPart(w.x + rand(-40, 40), w.y - 100, '💦', { vy: -120, g: 260, life: 1 }); }
      return;
    }
    case 'falls': {
      ctx.save();
      for (let i = 0; i < 7; i++) { ctx.strokeStyle = RAINBOW[i]; ctx.globalAlpha = 0.55; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(w.x, w.y - 10, 50 - i * 4, Math.PI, 0); ctx.stroke(); }
      ctx.globalAlpha = 0.8; ctx.fillStyle = '#7dd3fc';
      ctx.fillRect(w.x - 14, w.y - 110, 28, 110);
      ctx.fillStyle = '#e0f2fe';
      for (let i = 0; i < 12; i++) { const yy = ((t * 90 + i * 37) % 120); ctx.fillRect(w.x - 12 + (i * 7) % 24, w.y - yy, 3, 10); }
      ctx.restore();
      ctx.fillStyle = 'rgba(56,189,248,.6)'; ctx.beginPath(); ctx.ellipse(w.x, w.y, 34, 12, 0, 0, 7); ctx.fill();
      return;
    }
    case 'hole': {
      ctx.fillStyle = '#1c1917'; ctx.beginPath(); ctx.ellipse(w.x, w.y, 34, 16, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(167,139,250,.6)'; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(w.x, w.y, 30 - i * 8, 13 - i * 3.5, t * (1 + i), 0, 4); ctx.stroke(); }
      return;
    }
    case 'dino': {
      shadow(w.x, w.y, 30);
      const freed = S.cd.dino > Date.now();
      drawSpr('🦖', w.x + (freed ? Math.sin(t) * 20 : 0), w.y, freed ? 50 : 48, { flip: freed && Math.cos(t) > 0 });
      if (!freed) {
        const hits = S.cd.dinoHits || 0;
        ctx.fillStyle = `rgba(186,230,253,${0.55 - hits * 0.03})`; ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.rect(w.x - 34, w.y - 66, 68, 68); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.7)';
        for (let i = 0; i < hits; i++) { ctx.beginPath(); ctx.moveTo(w.x - 30 + hash2(i, 1, 3) * 60, w.y - 64 + hash2(i, 2, 3) * 60); ctx.lineTo(w.x - 30 + hash2(i, 4, 3) * 60, w.y - 64 + hash2(i, 5, 3) * 60); ctx.stroke(); }
      }
      return;
    }
    case 'moon': {
      const g = ctx.createRadialGradient(w.x, w.y - 40, 10, w.x, w.y - 40, 110);
      g.addColorStop(0, 'rgba(254,249,195,.45)'); g.addColorStop(1, 'rgba(254,249,195,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(w.x, w.y - 40, 110, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(80,60,40,.35)'; ctx.beginPath(); ctx.ellipse(w.x, w.y + 4, 60, 18, 0, 0, 7); ctx.fill();
      drawSpr('🌕', w.x, w.y, s);
      return;
    }
    case 'ufo': {
      shadow(w.x, w.y + 4, 40);
      const b = Math.sin(t * 2) * 5;
      if (Math.sin(t * 5) > 0) { ctx.fillStyle = 'rgba(134,239,172,.18)'; ctx.beginPath(); ctx.moveTo(w.x - 14, w.y - 40 + b); ctx.lineTo(w.x + 14, w.y - 40 + b); ctx.lineTo(w.x + 40, w.y + 4); ctx.lineTo(w.x - 40, w.y + 4); ctx.fill(); }
      drawSpr('🛸', w.x, w.y - 30 + b, s, { rot: Math.sin(t * 1.3) * 0.2 });
      drawSpr('👽', w.x + 46, w.y, 30, { sy: 1 + Math.sin(t * 6) * 0.04 });
      return;
    }
    case 'egg': shadow(w.x, w.y, 26); drawSpr('🥚', w.x, w.y, s, { rot: Math.sin(t * 3) * 0.08 * (Math.sin(t * 0.7) > 0.6 ? 1 : 0) }); return;
    case 'sneeze': {
      shadow(w.x, w.y, 36);
      const sn = (G.sneezeAnim || 0) > G.t;
      drawSpr('🌳', w.x, w.y, s, { sx: sn ? 1.15 : 1, sy: sn ? 0.85 : 1 });
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(w.x - 10, w.y - 50, 3, 0, 7); ctx.arc(w.x + 10, w.y - 50, 3, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(w.x, w.y - 38, sn ? 7 : 4, sn ? 6 : 2, 0, 0, 7); ctx.fill();
      return;
    }
    case 'cactus': {
      shadow(w.x, w.y, 26);
      drawSpr('🌵', w.x, w.y, s);
      const happy = !!S.cd.hugged;
      ctx.fillStyle = '#052e16'; ctx.beginPath(); ctx.arc(w.x - 8, w.y - 46, 3, 0, 7); ctx.arc(w.x + 8, w.y - 46, 3, 0, 7); ctx.fill();
      ctx.strokeStyle = '#052e16'; ctx.lineWidth = 2; ctx.beginPath();
      if (happy) ctx.arc(w.x, w.y - 40, 6, 0.2, Math.PI - 0.2); else ctx.arc(w.x, w.y - 32, 6, Math.PI + 0.3, -0.3);
      ctx.stroke();
      if (!happy) { ctx.fillStyle = '#7dd3fc'; ctx.beginPath(); ctx.arc(w.x - 9, w.y - 40 + (t * 20 % 10), 2, 0, 7); ctx.fill(); }
      return;
    }
    case 'duck': { const b = Math.sin(t * 1.5) * 4; ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.beginPath(); ctx.ellipse(w.x, w.y + 2, 50, 12, 0, 0, 7); ctx.fill(); drawSpr('🦆', w.x, w.y + b, s, { rot: Math.sin(t) * 0.06 }); return; }
    case 'tv': {
      shadow(w.x, w.y, 24); drawSpr('📺', w.x, w.y, s);
      ctx.fillStyle = `hsla(${(t * 80) % 360},80%,60%,.35)`; ctx.fillRect(w.x - 15, w.y - 38, 26, 20);
      return;
    }
    case 'circus': {
      shadow(w.x, w.y, 46); drawSpr('🎪', w.x, w.y, s);
      if (isNight()) { for (let i = 0; i < 6; i++) { ctx.fillStyle = `hsl(${(t * 120 + i * 60) % 360},90%,65%)`; ctx.beginPath(); ctx.arc(w.x - 45 + i * 18, w.y - s * 0.85 + Math.sin(t * 3 + i) * 3, 3.5, 0, 7); ctx.fill(); } drawSpr('👻', w.x + 52, w.y - Math.sin(t * 2) * 6, 32); }
      return;
    }
    case 'castle': shadow(w.x, w.y, 50); drawSpr('🏰', w.x, w.y, s); drawSpr('🤴', w.x + 56, w.y, 30); return;
    case 'cat': shadow(w.x, w.y, 18); drawSpr('🐈‍⬛', w.x, w.y, s, { sy: 1 + Math.sin(t * 2) * 0.02 }); drawSpr('🔮', w.x + 28, w.y, 22); return;
    case 'slimeking': shadow(w.x, w.y, 24); drawSpr('🪑', w.x, w.y, s); if (!G.mobs.some(m => m.type === 'kingSlime')) drawSpr('👑', w.x, w.y - s + Math.sin(t * 2) * 3, 20); return;
    case 'piano': shadow(w.x, w.y, 28); drawSpr('🎹', w.x, w.y, s); drawSpr('🪧', w.x - 46, w.y, 26); return;
    case 'door': shadow(w.x, w.y, 18); drawSpr('🚪', w.x, w.y, s); if (Math.random() < 0.05) G.parts.push({ x: w.x + rand(-20, 20), y: w.y - rand(10, 50), vx: 0, vy: -20, life: 1, max: 1, c: '#fde68a', s: 2.5, g: 0 }); return;
    default: shadow(w.x, w.y, s * 0.35); drawSpr(w.e, w.x, w.y, s);
  }
}

function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  VW = innerWidth; VH = innerHeight;
  cv.width = Math.round(VW * DPR); cv.height = Math.round(VH * DPR);
  cv.style.width = VW + 'px'; cv.style.height = VH + 'px';
  ZOOM = clamp(Math.min(VW, VH) / 440, 0.8, 1.45);
  ctx.textAlign = 'center'; ctx.direction = 'rtl';
  SPR.clear(); ghutraPat = null;
  lightCv.width = Math.ceil(VW / 4); lightCv.height = Math.ceil(VH / 4);
}
const lightCv = document.createElement('canvas'), lctx = lightCv.getContext('2d');

function render() {
  const k = DPR * ZOOM, hw = VW / 2 / ZOOM, hh = VH / 2 / ZOOM;
  const sx = cam.shake > 0.3 ? rand(-cam.shake, cam.shake) : 0, sy = cam.shake > 0.3 ? rand(-cam.shake, cam.shake) : 0;
  const cx = cam.x + sx, cy = cam.y + sy;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1e5296'; ctx.fillRect(0, 0, cv.width, cv.height);
  const ox = Math.round(cv.width / 2 - cx * k), oy = Math.round(cv.height / 2 - cy * k);
  ctx.setTransform(k, 0, 0, k, ox, oy);
  ctx.textAlign = 'center';
  const x0 = cx - hw, x1 = cx + hw, y0 = cy - hh, y1 = cy + hh;
  // الأرض
  ctx.imageSmoothingEnabled = false;
  const CS = World.CH * T;
  for (let gy = Math.floor(y0 / CS); gy <= Math.floor(y1 / CS); gy++) for (let gx = Math.floor(x0 / CS); gx <= Math.floor(x1 / CS); gx++) {
    if (gx < 0 || gy < 0 || gx * World.CH >= WORLD || gy * World.CH >= WORLD) continue;
    ctx.drawImage(World.chunk(gx, gy), gx * CS, gy * CS, CS + 0.5, CS + 0.5);
  }
  ctx.imageSmoothingEnabled = true;
  // لمعة الماي
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  for (let ty = Math.floor(y0 / T); ty <= Math.floor(y1 / T); ty++) for (let tx = Math.floor(x0 / T); tx <= Math.floor(x1 / T); tx++) {
    const b = World.biomeAt(tx, ty);
    if ((b === B.DEEP || b === B.SHALLOW) && hash2(tx, ty, 9) < 0.12) { const ph = (G.t * 0.8 + hash2(tx, ty, 8) * 6) % 6; if (ph < 1) { ctx.globalAlpha = Math.sin(ph * Math.PI) * 0.5; ctx.fillRect(tx * T + 8 + ph * 8, ty * T + 14, 10, 2); } }
  }
  ctx.globalAlpha = 1;
  // أشياء على الأرض
  for (const p of G.parts) if (p.ground) { ctx.globalAlpha = Math.max(0, p.life / p.max) * 0.8; ctx.fillStyle = p.c; ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s); }
  ctx.globalAlpha = 1;
  for (const m of G.marks) {
    const f = 1 - m.t / m.max;
    ctx.fillStyle = `rgba(239,68,68,${0.15 + f * 0.25})`; ctx.strokeStyle = 'rgba(239,68,68,.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(m.x, m.y, m.r, m.r * 0.6, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(239,68,68,.5)'; ctx.beginPath(); ctx.ellipse(m.x, m.y, m.r * f, m.r * 0.6 * f, 0, 0, 7); ctx.fill();
  }
  for (const r of G.rings) {
    ctx.strokeStyle = 'rgba(217,170,90,.85)'; ctx.lineWidth = 16;
    ctx.beginPath(); ctx.ellipse(r.x, r.y, r.r, r.r * 0.62, 0, 0, 7); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,240,200,.6)'; ctx.lineWidth = 4; ctx.stroke();
  }
  if (S.wp) { ctx.strokeStyle = 'rgba(250,204,21,.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(S.wp.x, S.wp.y, 18 + Math.sin(G.t * 4) * 3, 8, 0, 0, 7); ctx.stroke(); }
  // كل اللي ينرسم مرتب حسب العمق
  const L = [];
  const inView = (x, y, m = 80) => x > x0 - m && x < x1 + m && y > y0 - m && y < y1 + m * 2;
  for (let ty = Math.floor(y0 / T) - 1; ty <= Math.floor(y1 / T) + 2; ty++) for (let tx = Math.floor(x0 / T) - 1; tx <= Math.floor(x1 / T) + 1; tx++) {
    const d = decoAlive(tx, ty); if (!d) continue;
    L.push({ y: ty * T + 24, k: 0, d, tx, ty });
  }
  for (const p of World.props) if (inView(p.x, p.y)) L.push({ y: p.y + 8, k: 1, o: p });
  for (const w of World.wonders) if (inView(w.x, w.y, 160)) L.push({ y: w.y + (w.id === 'hole' || w.id === 'falls' ? -40 : 0), k: 2, o: w });
  for (const n of G.npcs) if (inView(n.x, n.y)) L.push({ y: n.y, k: 3, o: n });
  for (const m of G.mobs) if (inView(m.x, m.y)) L.push({ y: m.y, k: 4, o: m });
  for (const o of G.others.values()) if (G.t - o.sT < 4 && inView(o.x, o.y)) { L.push({ y: o.y, k: 5, o }); if (o.pet) L.push({ y: o.pet2.y, k: 9, o: o.pet2, e: PETS[o.pet].e }); }
  L.push({ y: P.y, k: 6 });
  if (S.pet && PETS[S.pet]) L.push({ y: P.pet.y, k: 9, o: P.pet, e: PETS[S.pet].e });
  for (const d of G.drops) if (inView(d.x, d.y)) L.push({ y: d.y, k: 7, o: d });
  for (const c of G.chests) if (inView(c.x, c.y)) L.push({ y: c.y, k: 8, o: c, e: '🎁' });
  for (const c of G.bottles) if (inView(c.x, c.y)) L.push({ y: c.y, k: 8, o: c, e: '🍾' });
  for (const s of G.signs.values()) if (inView(s.x, s.y)) L.push({ y: s.y, k: 8, o: s, e: '🪧' });
  L.sort((a, b) => a.y - b.y);
  const labels = [];
  for (const it of L) {
    switch (it.k) {
      case 0: {
        const D = DECO[it.d], c = G.cut.get(it.ty * WORLD + it.tx), x = it.tx * T + 16, y = it.ty * T + 26;
        const shk = c && c.shake > G.t ? Math.sin(G.t * 60) * 2 : 0;
        if (D.solid) shadow(x, y - 2, D.s * 0.3);
        if (D.glow) { ctx.fillStyle = 'rgba(165,243,252,.15)'; ctx.beginPath(); ctx.arc(x, y - 10, 22, 0, 7); ctx.fill(); }
        const sway = (it.d === 6 || it.d === 7 || it.d === 19 || it.d === 15 || it.d === 13) ? Math.sin(G.t * 2 + it.tx) * 0.08 : 0;
        if (sway) drawSpr(D.e, x, y, D.s, { rot: sway }); else drawSpr(D.e, x + shk, y, D.s);
        break;
      }
      case 1: { const p = it.o; if (p.solid) shadow(p.x, p.y + 6, p.s * 0.32); drawSpr(p.e, p.x, p.y + 8, p.s, p.e === '🔥' ? { sy: 1 + Math.sin(G.t * 12 + p.x) * 0.08 } : undefined); break; }
      case 2: { drawWonder(it.o); const w = it.o; if (dist(w, P) < 260) labels.push([w.x, w.y - w.s - 6, S.won[w.id] ? w.n : '؟؟؟', 0, '', '#fde68a']); break; }
      case 3: {
        const n = it.o;
        if (n.id === 'door2') { shadow(n.x, n.y, 16); drawSpr('🚪', n.x, n.y, 46); }
        else if (n.id === 'mirror') { drawSpr('🪞', n.x, n.y, 44); ctx.fillStyle = `rgba(255,255,255,${0.2 + Math.sin(G.t * 3) * 0.15})`; ctx.fillRect(n.x - 8, n.y - 36, 6, 20); }
        else { shadow(n.x, n.y, 13); drawSpr(n.e, n.x, n.y - Math.abs(Math.sin(G.t * 2 + n.x)) * 1.5, 36, { flip: n.face > 0 }); }
        const qs = npcQuestState(n.id);
        if (qs) drawSpr(qs === 'ready' ? '✅' : '❗', n.x, n.y - 58 + Math.sin(G.t * 4) * 3, 18);
        labels.push([n.x, n.y - 44, n.n, 0, '', '#fde68a']);
        break;
      }
      case 4: drawMob(it.o); break;
      case 5: {
        const o = it.o, fx = { giant: o.f & 1, tiny: o.f & 2, chicken: o.f & 4, ghost: o.f & 8 };
        drawChar({ x: o.x, y: o.y, color: o.color, hat: o.hat, wpn: o.wpn, dir: o.dir, face: o.face, walk: o.walk, moving: o.moving, swing: o.swing, fx, mount: o.f & 128, boat: o.f & 64, dead: o.f & 256 });
        const sc = fx.giant ? 1.9 : fx.tiny ? 0.6 : 1;
        labels.push([o.x, o.y - 44 * sc - (o.f & 128 ? 30 : 0), o.name, o.lvl, o.title, '#e0f2fe', o]);
        break;
      }
      case 6: {
        if (P.dead > 0) { drawChar({ x: P.x, y: P.y, dead: 1 }); break; }
        const blink = P.inv > 0 && P.inv < 1.5 && Math.floor(G.t * 20) % 2;
        if (!blink) drawChar({ x: P.x, y: P.y, color: S.color, hat: S.hat, wpn: S.wpn, dir: P.dir, face: P.face, walk: P.walk, moving: P.moving, swing: P.swing, fx: P.fx, mount: P.mount, boat: P.boat, hurt: P.hitT > 0 });
        const sc = P.fx.giant ? 1.9 : P.fx.tiny ? 0.6 : 1;
        labels.push([P.x, P.y - 44 * sc - (P.mount ? 30 : 0), S.name, S.lvl, S.title, '#fff', null, 1]);
        break;
      }
      case 7: {
        const d = it.o, bob = d.z > 0 ? 0 : Math.sin(d.ph * 3) * 1.5;
        if (d.life < 8 && Math.floor(G.t * 8) % 2) break;
        shadow(d.x, d.y, d.z > 0 ? Math.max(3, 9 - d.z / 40) : 7);
        if (d.it === 'pearl') {
          const y = d.y - 6 - d.z - bob;
          ctx.fillStyle = '#f8fafc'; ctx.beginPath(); ctx.arc(d.x, y, 5 + Math.min(3, d.n / 10), 0, 7); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(d.x - 1.5, y - 1.5, 1.6, 0, 7); ctx.fill();
          ctx.strokeStyle = 'rgba(148,163,184,.8)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(d.x, y, 5 + Math.min(3, d.n / 10), 0, 7); ctx.stroke();
        } else drawSpr(ITEMS[d.it].e, d.x, d.y - d.z - bob, d.star && d.z > 0 ? 26 : 20);
        break;
      }
      case 8: shadow(it.o.x, it.o.y, 12); drawSpr(it.e, it.o.x, it.o.y - (it.e === '🍾' ? Math.abs(Math.sin(G.t * 2)) * 2 : 0), it.e === '🪧' ? 28 : 26, it.e === '🍾' ? { rot: 0.9 } : undefined); break;
      case 9: { const p = it.o, fl = ['eye', 'cloud', 'alien'].some(k => PETS[k].e === it.e); const y = p.y - (fl ? 22 + Math.sin(G.t * 3) * 4 : Math.abs(Math.sin(G.t * 6)) * 3); shadow(p.x, p.y, 8); drawSpr(it.e, p.x, y, 22); break; }
    }
  }
  // الفقاعات
  for (const b of G.bubbles) {
    ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.fillStyle = 'rgba(186,230,253,.25)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.beginPath(); ctx.arc(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.2, 0, 7); ctx.fill();
  }
  // الضربات
  for (const s of G.slashes) {
    ctx.strokeStyle = s.c; ctx.globalAlpha = Math.max(0, s.t / (s.spin ? 0.35 : 0.18)) * 0.8; ctx.lineWidth = s.spin ? 8 : 5;
    ctx.beginPath();
    if (s.spin) ctx.ellipse(s.x, s.y + 8, s.r, s.r * 0.6, 0, 0, 7);
    else ctx.arc(s.x, s.y, s.r * 0.85, s.dir - 1.0, s.dir + 1.0);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // المقذوفات
  for (const p of G.proj) {
    switch (p.kind) {
      case 'laser': ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); ctx.stroke(); break;
      case 'web': ctx.strokeStyle = '#f1f5f9'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.moveTo(p.x - p.r, p.y); ctx.lineTo(p.x + p.r, p.y); ctx.moveTo(p.x, p.y - p.r); ctx.lineTo(p.x, p.y + p.r); ctx.stroke(); break;
      case 'snow': ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); break;
      case 'spore': ctx.fillStyle = '#d8b4fe'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(p.x + Math.sin(G.t * 10 + i) * 4, p.y + Math.cos(G.t * 9 + i) * 4, 3, 0, 7); ctx.fill(); } break;
      case 'sprinkle': ctx.fillStyle = pick(RAINBOW); ctx.fillRect(p.x - 4, p.y - 1.5, 8, 3); break;
      default: { const g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, p.r * 1.6); g.addColorStop(0, '#fff'); g.addColorStop(0.4, '#c084fc'); g.addColorStop(1, 'rgba(192,132,252,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 1.6, 0, 7); ctx.fill(); }
    }
  }
  // الجزيئات
  for (const p of G.parts) {
    if (p.ground) continue;
    const a = Math.max(0, Math.min(1, p.life / p.max * 1.5));
    if (p.e) drawSpr(p.e, p.x, p.y, p.s, { a, c: 1 });
    else { ctx.globalAlpha = a; ctx.fillStyle = p.c; ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s); }
  }
  ctx.globalAlpha = 1;
  // الأسماء والفقاعات
  for (const [x, y, n, l, ti, c, o, me] of labels) {
    drawLabel(x, y, n, l, ti, c);
    const b = me ? (G.myBubble && G.myBubble.until > G.t ? G.myBubble : null) : o && o.bubble && o.bubble.until > G.t ? o.bubble : null;
    const em = me ? (G.myEmote && G.myEmote.until > G.t ? G.myEmote : null) : o && o.emote && o.emote.until > G.t ? o.emote : null;
    if (em) drawSpr(em.e, x, y - 16 + Math.sin(G.t * 8) * 2, 30);
    if (b) drawBubble(x, y - (em ? 50 : 18), b.text);
  }
  for (const f of G.floats) {
    ctx.globalAlpha = Math.min(1, f.life * 2);
    ctx.font = `900 ${f.big ? 17 : 13}px system-ui, sans-serif`;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.fillStyle = f.c;
    ctx.strokeText(f.txt, f.x, f.y); ctx.fillText(f.txt, f.x, f.y);
  }
  ctx.globalAlpha = 1;
  // سهم الوجهة
  if (S.wp) {
    const dx = S.wp.x - P.x, dy = S.wp.y - P.y, d = Math.hypot(dx, dy);
    if (d > 120) {
      const a = Math.atan2(dy, dx), r = 60;
      ctx.save(); ctx.translate(P.x + Math.cos(a) * r, P.y - 14 + Math.sin(a) * r); ctx.rotate(a);
      ctx.fillStyle = '#facc15'; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-6, -8); ctx.lineTo(-2, 0); ctx.lineTo(-6, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }
  // الجو والليل (على الشاشة)
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawWeatherFx();
  drawNight(ox / DPR, oy / DPR);
}
function drawWeatherFx() {
  const w = G.weather.id;
  if (w === 'rain' || w === 'frogs') {
    ctx.strokeStyle = 'rgba(200,220,255,.45)'; ctx.lineWidth = 1.2; ctx.beginPath();
    for (let i = 0; i < 110; i++) { const x = (hash2(i, 1, 5) * VW * 1.2 + G.t * 120) % (VW * 1.2) - VW * 0.1, y = (hash2(i, 2, 5) * VH + G.t * (650 + hash2(i, 3, 5) * 200)) % VH; ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 14); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(30,40,70,.12)'; ctx.fillRect(0, 0, VW, VH);
  } else if (w === 'snow') {
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (let i = 0; i < 90; i++) { const x = (hash2(i, 1, 6) * VW + Math.sin(G.t + i) * 20 + G.t * 15) % VW, y = (hash2(i, 2, 6) * VH + G.t * (50 + hash2(i, 3, 6) * 40)) % VH; ctx.fillRect(x, y, 3, 3); }
  } else if (w === 'purple') { ctx.fillStyle = 'rgba(147,51,234,.16)'; ctx.fillRect(0, 0, VW, VH); }
  else if (w === 'stars') {
    ctx.strokeStyle = 'rgba(253,224,71,.7)'; ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) { const ph = (G.t * 0.5 + i * 0.33) % 1, x = hash2(Math.floor(G.t * 0.5 + i * 0.33), i, 7) * VW; ctx.globalAlpha = 1 - ph; ctx.beginPath(); ctx.moveTo(x + ph * 300, ph * VH * 0.6); ctx.lineTo(x + ph * 300 - 40, ph * VH * 0.6 - 30); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
}
function drawNight(ox, oy) {
  if (G.dark <= 0.01) return;
  const W = lightCv.width, H = lightCv.height, s = ZOOM / 4;
  lctx.globalCompositeOperation = 'source-over';
  lctx.clearRect(0, 0, W, H);
  lctx.fillStyle = `rgba(12,14,48,${G.dark})`; lctx.fillRect(0, 0, W, H);
  lctx.globalCompositeOperation = 'destination-out';
  const hole = (x, y, r, a = 1) => {
    const X = (ox + x * ZOOM) / 4, Y = (oy + y * ZOOM) / 4, R = r * s;
    if (X < -R || Y < -R || X > W + R || Y > H + R) return;
    const g = lctx.createRadialGradient(X, Y, 0, X, Y, R);
    g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    lctx.fillStyle = g; lctx.beginPath(); lctx.arc(X, Y, R, 0, 7); lctx.fill();
  };
  hole(P.x, P.y - 14, has('lantern') ? 300 : 180);
  for (const o of G.others.values()) if (G.t - o.sT < 4) hole(o.x, o.y - 14, 130, 0.8);
  for (const p of World.props) if (p.light) hole(p.x, p.y, 150 + Math.sin(G.t * 9 + p.x) * 6, 0.9);
  const moon = World.wonderById.moon; hole(moon.x, moon.y - 40, 320);
  const circus = World.wonderById.circus; hole(circus.x, circus.y - 30, 200, 0.8);
  for (const p of G.proj) hole(p.x, p.y, 60, 0.7);
  const hw = VW / 2 / ZOOM, hh = VH / 2 / ZOOM;
  let n = 0;
  for (let ty = Math.floor((cam.y - hh) / T); ty <= Math.floor((cam.y + hh) / T) && n < 40; ty++) for (let tx = Math.floor((cam.x - hw) / T); tx <= Math.floor((cam.x + hw) / T) && n < 40; tx++) {
    const d = decoAlive(tx, ty);
    if (d === 9 || d === 8) { hole(tx * T + 16, ty * T + 10, d === 9 ? 70 : 50, 0.6); n++; }
  }
  ctx.drawImage(lightCv, 0, 0, VW, VH);
}

/* ============ الحلقة الرئيسية ============ */
let last = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  if (!G.running) return;
  const dt = Math.min(0.05, (ts - last) / 1000 || 0.016); last = ts;
  G.t += dt;
  G.dark = darkness();
  updatePlayer(dt);
  G.spawnT -= dt;
  if (G.spawnT <= 0) { G.spawnT = 0.5; trySpawn(); }
  for (const m of G.mobs) updateMob(m, dt);
  G.mobs = G.mobs.filter(m => !m.dead && dist(m, P) < 1300);
  for (const n of G.npcs) if (n.wander) {
    n.t = (n.t || 0) - dt;
    if (n.t <= 0) { n.t = rand(1, 3); n.wx = n.hx + rand(-60, 60); n.wy = n.hy + rand(-40, 40); }
    const dx = n.wx - n.x, dy = n.wy - n.y, d = Math.hypot(dx, dy);
    if (d > 3 && !P.busy) { n.x += dx / d * 40 * dt; n.y += dy / d * 40 * dt; n.face = dx > 0 ? 1 : -1; }
  }
  updateBoss(dt);
  updateProj(dt);
  updateDrops(dt);
  updateWeather(dt);
  updateWild(dt);
  for (const r of G.rings) {
    r.r += r.v * dt;
    const d = Math.hypot((P.x - r.x), (P.y - r.y) / 0.62);
    if (!r.hit && Math.abs(d - r.r) < 16 && P.dashT <= 0 && P.inv <= 0 && P.dead <= 0) { r.hit = true; hurtPlayer(r.dmg); P.kx = (P.x - r.x) / d * 300; P.ky = (P.y - r.y) / d * 300; }
  }
  G.rings = G.rings.filter(r => r.r < r.max);
  for (const m of G.marks) {
    m.t -= dt;
    if (m.t <= 0) { burst(m.x, m.y, 14, '#fbbf24', 200); if (Math.hypot(P.x - m.x, (P.y - m.y) / 0.6) < m.r) hurtPlayer(m.dmg); cam.shake = Math.max(cam.shake, 4); }
  }
  G.marks = G.marks.filter(m => m.t > 0);
  for (const s of G.slashes) s.t -= dt;
  G.slashes = G.slashes.filter(s => s.t > 0);
  for (const p of G.parts) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.g || 0) * dt; }
  if (G.parts.length > 600) G.parts.splice(0, G.parts.length - 600);
  G.parts = G.parts.filter(p => p.life > 0);
  for (const f of G.floats) { f.life -= dt; f.y -= 32 * dt; }
  G.floats = G.floats.filter(f => f.life > 0);
  netTick(dt);
  // الكاميرا
  cam.x += (P.x - cam.x) * Math.min(1, dt * 8); cam.y += (P.y - 10 - cam.y) * Math.min(1, dt * 8);
  cam.shake = Math.max(0, cam.shake - dt * 30);
  render();
  G.hudT -= dt;
  if (G.hudT <= 0) { G.hudT = 0.2; UI.hud(); }
  G.saveT -= dt;
  if (G.saveT <= 0) { G.saveT = 10; saveGame(); }
  G.musT = (G.musT || 0) - dt;
  if (G.musT <= 0) { G.musT = 0.55; Snd.music(); }
}

/* ============ المدخلات ============ */
function bindInput() {
  addEventListener('keydown', e => {
    if (!G.running || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (UI.isOpen()) { if (e.code === 'Escape') UI.close(); return; }
    Input.keys.add(e.code);
    switch (e.code) {
      case 'Space': case 'KeyJ': attack(); e.preventDefault(); break;
      case 'ShiftLeft': case 'ShiftRight': case 'KeyK': dash(); break;
      case 'KeyQ': case 'KeyL': skill(); break;
      case 'KeyE': UI.interact(); break;
      case 'KeyF': quickHeal(); break;
      case 'KeyR': toggleMount(); break;
      case 'KeyM': UI.openMap(); break;
      case 'KeyI': case 'KeyB': UI.openBag(); break;
      case 'KeyO': UI.openQuests(); break;
      case 'KeyP': UI.openPlayers(); break;
      case 'Enter': UI.openChat(); e.preventDefault(); break;
      default: if (/^Digit[1-8]$/.test(e.code)) emote(+e.code.slice(5) - 1);
    }
  });
  addEventListener('keyup', e => Input.keys.delete(e.code));
  addEventListener('blur', () => Input.keys.clear());
  cv.addEventListener('mousedown', e => {
    if (!G.running || e.button !== 0 || matchMedia('(pointer: coarse)').matches) return;
    const a = Math.atan2(e.clientY - VH / 2 + 10 * ZOOM, e.clientX - VW / 2);
    attack(P.fx.flip ? a + Math.PI : a);
  });
  // عصا التحكم
  const zone = $('#joyzone'), base = $('#joy'), knob = $('#knob');
  let jid = null, bx = 0, by = 0;
  zone.addEventListener('pointerdown', e => {
    if (jid !== null) return;
    jid = e.pointerId; bx = e.clientX; by = e.clientY;
    base.style.left = bx + 'px'; base.style.top = by + 'px'; base.classList.add('on');
    knob.style.transform = 'translate(-50%,-50%)';
    $('#joyhint').hidden = true;
    try { zone.setPointerCapture(e.pointerId); } catch {}
    Snd.init();
  });
  zone.addEventListener('pointermove', e => {
    if (e.pointerId !== jid) return;
    let dx = e.clientX - bx, dy = e.clientY - by; const d = Math.hypot(dx, dy), R = 50;
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    Input.jx = dx / R; Input.jy = dy / R;
    if (Math.hypot(Input.jx, Input.jy) < 0.15) Input.jx = Input.jy = 0;
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  });
  const end = e => { if (e.pointerId !== jid) return; jid = null; Input.jx = Input.jy = 0; base.classList.remove('on'); };
  zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
  const btn = (id, fn) => { const b = $(id); if (b) b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); Snd.init(); fn(); }); };
  btn('#bAtk', () => { attack(); G.holdAtk = setInterval(() => attack(), 120); });
  $('#bAtk').addEventListener('pointerup', () => clearInterval(G.holdAtk));
  $('#bAtk').addEventListener('pointerleave', () => clearInterval(G.holdAtk));
  $('#bAtk').addEventListener('pointercancel', () => clearInterval(G.holdAtk));
  btn('#bDash', dash); btn('#bSkill', skill); btn('#bHeal', quickHeal); btn('#bAct', () => UI.interact()); btn('#bMount', toggleMount);
  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { saveGame(); Input.keys.clear(); } });
  addEventListener('pagehide', saveGame);
  addEventListener('contextmenu', e => { if (e.target === cv) e.preventDefault(); });
}

/* ============ تشغيل اللعبة ============ */
function startGame(save) {
  S = save;
  for (const k of ['stats', 'cd', 'won', 'q', 'inv']) S[k] = S[k] || {};
  S.qd = S.qd || []; S.pets = S.pets || []; S.hats = S.hats || []; S.titles = S.titles || ['مبتدئ'];
  if (!ITEMS[S.wpn]) S.wpn = 'w_bread'; if (!ITEMS[S.arm]) S.arm = 'a_thobe';
  P.x = S.x; P.y = S.y;
  if (blocked(P.x, P.y, 11, { boat: true })) { P.x = CENTER * T + 16; P.y = (CENTER + 2) * T + 16; }
  P.hp = Math.min(S.hp || 999, maxHP()); if (P.hp <= 0) P.hp = maxHP();
  P.en = maxEN(); P.pet.x = P.x; P.pet.y = P.y;
  P.fx = {}; for (const [k, v] of Object.entries(S.fxSave || {})) P.fx[k] = G.t + v;
  cam.x = P.x; cam.y = P.y;
  loadExplored();
  G.running = true;
  Net.onMsg = onNet;
  Net.onStatus = s => { UI.netStatus(s); if (s === 'online') { Net.setRegion(P.x, P.y); Net.pub('g', { t: 'hi' }); sendPresence(); sendState(true); } };
  Net.setRegion(P.x, P.y);
  Net.start(S.world);
  UI.hud(); UI.netStatus('connecting');
}
function initEngine() {
  World.gen();
  for (const p of World.props) if (p.solid) G.statics.push({ x: p.x, y: p.y + 2, r: p.solid });
  for (const w of World.wonders) if (!['hole', 'falls', 'duck'].includes(w.id)) G.statics.push({ x: w.x, y: w.y - 4, r: w.id === 'whale' ? 52 : Math.max(14, w.s * 0.28) });
  for (const [id, n] of Object.entries(NPCS)) {
    const o = { id, ...n, x: (CENTER + n.dx) * T + 16, y: (CENTER + n.dy) * T + 16, face: n.dx < 0 ? 1 : -1 };
    o.hx = o.x; o.hy = o.y;
    G.npcs.push(o);
    if (!n.wander) G.statics.push({ x: o.x, y: o.y, r: 12 });
  }
  resize();
  bindInput();
  requestAnimationFrame(loop);
}
