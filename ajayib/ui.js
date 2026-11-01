'use strict';
/* أرض العجايب — الواجهة: المهمات، الحوارات، المتاجر، الشنطة، الخريطة، الدردشة، والعجايب */

/* ============ المهمات ============ */
const qDone = id => S.qd.includes(id);
const qAvail = q => !qDone(q.id) && !S.q[q.id] && (!q.req || qDone(q.req));
function qProg(q) {
  const s = S.q[q.id]; if (!s) return 0;
  switch (q.k) {
    case 'kill': case 'riddle': case 'boss': return Math.min(q.c, s.p || 0);
    case 'have': return Math.min(q.c, S.inv[q.tg] || 0);
    case 'wonder': return S.won[q.tg] ? 1 : 0;
    case 'wonders': return Math.min(q.c, Object.keys(S.won).length);
    case 'fx': return P.fx[q.tg] ? 1 : 0;
    case 'lvl': return Math.min(q.c, S.lvl);
  }
  return 0;
}
const qComplete = q => qProg(q) >= q.c;
function giverName(id) { return NPCS[id] ? NPCS[id].n : id === 'ufo' ? 'زوزو الفضائي' : '…'; }
function questEvent(kind, arg) {
  for (const q of QUESTS) {
    const s = S.q[q.id]; if (!s) continue;
    const before = qComplete(q);
    if (kind === 'kill' && q.k === 'kill' && q.tg === arg) s.p = (s.p || 0) + 1;
    if (kind === 'riddle' && q.k === 'riddle') s.p = (s.p || 0) + 1;
    if (kind === 'boss' && q.k === 'boss') s.p = 1;
    if (!before && qComplete(q) && q.k !== 'fx') { UI.toast(`✅ خلصت «${q.n}» — ارجع لـ${giverName(q.by)}`); Snd.coin(); }
  }
}
function npcQuestState(id) {
  let st = null;
  for (const q of QUESTS) if (q.by === id) { if (S.q[q.id] && qComplete(q)) return 'ready'; if (qAvail(q)) st = 'new'; }
  return st;
}
function turnIn(q) {
  if (!S.q[q.id] || !qComplete(q)) return;
  if (q.k === 'have') take(q.tg, q.c);
  delete S.q[q.id]; S.qd.push(q.id);
  const r = q.r;
  Snd.lvl();
  UI.banner('🎉 خلصت المهمة!', q.n);
  if (r.g) give('pearl', r.g);
  for (const [it, n] of r.it || []) give(it, n);
  if (r.xp) addXP(r.xp);
  if (r.title) addTitle(r.title);
  if (r.pet) addPet(r.pet);
}

/* ============ العجايب ============ */
const Wonders = {
  interact(w) { const f = this[w.id]; if (f) f.call(this, w); else UI.say(w.e, w.n, w.d); },
  door() { UI.openTravel(); },
  whale(w) {
    const bc = bossClock();
    if (Boss.active) UI.say('🐋', w.n, 'الحوت صاحي! اضربه مع اللاعبين قبل لا يرجع ينام ⚔️<br><small>انتبه من موجات الرمل (تقدر تتفاداها بالاندفاع 💨) والدواير الحمرا.</small>');
    else UI.say('🐋', w.n, `${w.d}<br><br>😴 نايم… يصحى بعد <b>${fmtTime(bc.next)}</b>`);
  },
  head(w) { UI.say('🗿', w.n, `«${pick(JOKES)}»`, [['😂 هههه', 'joke'], ['👋 خلاص', 'close']]); },
  falls(w) { UI.say('🌈', w.n, w.d, [['💧 اشرب من الشلال', 'falls'], ['👋 لا شكرًا', 'close']]); },
  cactus(w) { UI.say('🌵', w.n, S.cd.hugged ? 'الصبارة صارت مبسوطة 😊 بس تبي حضن ثاني…' : '«محد يحبني… كلهم يقولون شوك شوك 😢»', [['🤗 احضنها', 'hug'], ['🏃 أهرب', 'close']]); },
  duck(w) {
    if (!S.cd.duck) {
      S.cd.duck = 1; unlockHat('🦆'); addPet('duck'); addXP(150);
      UI.say('🦆', w.n, 'كواااك! 🦆<br>البطة تحبك وعطتك بطة صغيرة تمشي معك، وقبعة بطة!');
    } else UI.say('🦆', w.n, 'كواك. (البطة تطالعك بحب)');
  },
  tv(w) {
    const bc = bossClock(), others = [...G.others.values()];
    const top = [{ name: S.name, lvl: S.lvl }, ...others].sort((a, b) => b.lvl - a.lvl).slice(0, 5);
    const nextW = weatherFor(Math.floor(Date.now() / 300000) + 1);
    UI.say('📺', w.n, `<div class="tv"><b>📡 أخبار العالم على الهوا</b>
      <p>🔴 ${esc(pick(NEWS))}</p>
      <p>👥 المتصلين الحين: <b>${others.length + 1}</b> ${Net.online ? '' : '(أنت بدون اتصال)'}</p>
      <p>🐋 الحوت: ${Boss.active ? '<b>صاحي الحين!</b>' : `يصحى بعد <b>${fmtTime(bc.next)}</b>`}</p>
      <p>🌦️ الجو الحين: ${G.weather.e} ${G.weather.n} — الجاي: ${nextW.e} ${nextW.n}</p>
      <p>🏆 الأقوى: ${top.map(p => `${esc(p.name)} (${p.lvl})`).join('، ')}</p></div>`, [['🔄 حدّث', 'tv'], ['👋 سكّر', 'close']]);
  },
  egg(w) {
    if (S.cd.egg > Date.now()) return UI.say('🥚', w.n, `البيضة تريّح… ارجع بعد ${fmtTime((S.cd.egg - Date.now()) / 1000)}`);
    UI.say('🥚', w.n, `${w.d}<br><small>عندك ${S.inv.candy || 0} 🍬</small>`, [['🍬 أكّلها 5 حلاوة', 'egg'], ['👋 بعدين', 'close']]);
  },
  hole(w) { UI.say('🕳️', w.n, `${w.d}<br><small>عندك ${S.gold} ⚪</small>`, [['⚪ ارمي 10 لؤلؤ', 'wish10'], ['⚪ ارمي 50 لؤلؤ', 'wish50'], ['👋 لا', 'close']]); },
  dino(w) {
    if (S.cd.dino > Date.now()) UI.say('🦖', w.n, '«شكرًا يا بطل! صار لي 65 مليون سنة بالثلج 🥶» (يرقص 💃)');
    else UI.say('🦖', w.n, `${w.d}<br><br>💡 اضرب الثلج بسلاحك عشان يتكسر (${Math.max(0, 12 - (S.cd.dinoHits || 0))} ضربة باقية)`);
  },
  dinoFree() {
    S.cd.dino = Date.now() + 20 * 60e3; S.cd.dinoHits = 0;
    const w = World.wonderById.dino;
    burst(w.x, w.y - 30, 50, '#bae6fd', 260); Snd.lvl(); cam.shake = 6;
    UI.banner('🦖 حررت الديناصور!', '«شكرًا! أخيرًا أقدر أتحرك»');
    addXP(120);
    addTitle('محرر الديناصور');
    if (!S.pets.includes('dino')) addPet('dino');
  },
  moon(w) {
    if (!isNight()) return UI.say('🌕', w.n, `${w.d}<br><br>😴 القمر نايم بالنهار. تعال بالليل.`);
    P.hp = maxHP(); P.en = maxEN(); P.buffs.moon = G.t + 120;
    burst(w.x, w.y - 40, 40, '#fef9c3', 200); Snd.lvl();
    addTitle('صديق القمر');
    UI.say('🌕', w.n, '«تعال قريب… أبي أقول لك سر: أنا مو جبن.» 🌕<br><br>✨ صحتك كملت، وضربك صار أقوى 50٪ لمدة دقيقتين!');
  },
  ufo() { UI.openDialog('ufo'); },
  piano() { UI.openPiano(); },
  sneeze(w) {
    if (!this.sneezeNow(w)) UI.say('🌳', w.n, '«آآآ… آآآ…» (الشجرة تحك خشمها، ما عطست هالمرة)');
  },
  sneezeNow(w) {
    if ((S.cd.sneeze || 0) > Date.now()) return false;
    S.cd.sneeze = Date.now() + 5 * 60e3; G.sneezeAnim = G.t + 0.6;
    Snd.sneeze(); cam.shake = 7;
    floatText(w.x, w.y - 100, 'أتشووووو!! 🤧', '#fff', true);
    for (let i = 0; i < 25; i++) emojiPart(w.x + rand(-40, 40), w.y - 60, pick(['🍃', '🍂']), { vx: rand(-200, 200), vy: rand(-200, -50), g: 200, life: 1.5 });
    for (let i = 0; i < irand(6, 12); i++) dropItem('pearl', irand(2, 6), w.x + rand(-30, 30), w.y + 30);
    const a = Math.atan2(P.y - w.y, P.x - w.x); P.kx = Math.cos(a) * 500; P.ky = Math.sin(a) * 500;
    return true;
  },
  castle(w) { UI.openShop(['w_candy', 'a_candy', 'pRainbow', 'candy', 'honey', 'pTiny'], '🤴 ملك الحلاوة', '«أهلًا بالحلوين! كل شي هنا ينوكل… تقريبًا»'); },
  circus(w) {
    if (!isNight()) return UI.say('🎪', w.n, `${w.d}<br><br>☀️ مسكّر. الأشباح نايمين… تعال بالليل.`);
    UI.openShop(['pGiant', 'pTiny', 'pChicken', 'pGhost', 'pFlip', 'pBackwards', 'pMystery', 'w_umbrella', 'w_wand'], '👻 الشبح البياع', '«بووو! عندي جرعات ما تلقاها بأي مكان… ولا تسألني وش فيها»');
  },
  cat(w) {
    const today = new Date().toDateString();
    if (S.cd.fortune === today) return UI.say('🐈‍⬛', w.n, '«قريت حظك اليوم. ارجع بكرة» 🐈‍⬛😼');
    S.cd.fortune = today; P.buffs.luck = G.t + 600;
    let extra = '';
    if (Math.random() < 0.05 && !S.pets.includes('cat')) { addPet('cat'); extra = '<br><br>😺 البسة قررت تمشي معك!'; }
    UI.say('🐈‍⬛', w.n, `🔮 «${pick(FORTUNES)}»<br><br>🍀 حظك زاد: الوحوش تطيّح أغراض أكثر لمدة 10 دقايق.${extra}`);
  },
  slimeking(w) {
    if (G.mobs.some(m => m.type === 'kingSlime')) return UI.say('👑', w.n, 'الملك هنا وزعلان! 😠');
    if ((S.cd.king || 0) > Date.now()) return UI.say('🪑', w.n, `العرش فاضي… الملك راح يتمشى. ارجع بعد ${fmtTime((S.cd.king - Date.now()) / 1000)}`);
    UI.say('🪑', w.n, 'عرش فاضي ومريح… تبي تقعد عليه؟', [['🪑 اقعد على العرش', 'throne'], ['👋 لا', 'close']]);
  }
};

/* ============ الواجهة ============ */
const UI = {
  cur: null, target: null, chatLog: [], feedList: [], lastHud: '',
  isOpen() { return !!this.cur; },
  open(title, html, kind) {
    this.cur = kind || 'panel';
    $('#panel').className = '';
    $('#ptitle').innerHTML = title; $('#pbody').innerHTML = html;
    $('#panel').hidden = false; P.busy = true;
    Input.keys.clear(); Input.jx = Input.jy = 0;
    $('#pbody').scrollTop = 0;
  },
  close() {
    this.cur = null; $('#panel').hidden = true; P.busy = false;
    $('#panel').className = '';
  },
  toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(this.tt); this.tt = setTimeout(() => t.classList.remove('show'), 2600);
  },
  feed(msg) {
    const f = $('#feed'), d = document.createElement('div');
    d.textContent = msg; f.prepend(d);
    while (f.children.length > 4) f.lastChild.remove();
    setTimeout(() => d.classList.add('out'), 7000); setTimeout(() => d.remove(), 7800);
  },
  banner(t, s) {
    const b = $('#banner'); b.innerHTML = `<b>${esc(t)}</b>${s ? `<span>${esc(s)}</span>` : ''}`;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    clearTimeout(this.bt); this.bt = setTimeout(() => b.classList.remove('show'), 3000);
  },
  say(e, name, text, opts) {
    opts = opts || [['👋 تمام', 'close']];
    this.open(`${e} ${esc(name)}`, `<div class="npc"><span class="npc-e">${e}</span><div class="txt">${text}</div></div>
      <div class="opts">${opts.map(([l, a, d]) => `<button class="opt" data-act="${a}" ${d ? `data-v="${esc(d)}"` : ''}>${l}</button>`).join('')}</div>`);
  },

  /* ---------- HUD ---------- */
  hud() {
    if (!S) return;
    const mh = maxHP(), me = maxEN(), need = xpNeed(S.lvl);
    $('#hpbar').style.width = (P.hp / mh * 100) + '%';
    $('#hptx').textContent = `${Math.ceil(P.hp)}/${mh}`;
    $('#enbar').style.width = (P.en / me * 100) + '%';
    $('#xpbar').style.width = (S.xp / need * 100) + '%';
    $('#lvl').textContent = S.lvl;
    $('#gold').textContent = S.gold;
    $('#clock').textContent = `${G.dark > 0.3 ? '🌙' : '☀️'} ${clockStr()} ${G.weather.id !== 'clear' ? G.weather.e : ''}`;
    $('#online').textContent = Net.online ? `🟢 ${G.others.size + 1}` : '⚪ 1';
    // المهارات
    $('#bSkill').classList.toggle('off', S.lvl < 3 || P.skillCd > 0 || P.en < 30);
    $('#bDash').classList.toggle('off', P.dashCd > 0 || P.en < 15);
    $('#bMount').hidden = !has('camel');
    $('#bMount').classList.toggle('on', P.mount);
    const heal = ['hp1', 'hp2', 'honey', 'fish', 'egg', 'dates', 'candy'].find(it => has(it));
    $('#bHeal').innerHTML = heal ? `${ITEMS[heal].e}<small>${S.inv[heal]}</small>` : '🍽️';
    // متتبع المهمات
    const act = QUESTS.filter(q => S.q[q.id]).slice(0, 3);
    const tr = act.map(q => `<div class="${qComplete(q) ? 'done' : ''}">📜 ${esc(q.n)} <b>${q.k === 'fx' ? (qComplete(q) ? '✓' : '') : `${qProg(q)}/${q.c}`}</b></div>`).join('');
    if (tr !== this.lastTr) { $('#tracker').innerHTML = tr; this.lastTr = tr; }
    // التفاعل
    this.target = this.findTarget();
    const b = $('#bAct');
    if (this.target) { b.hidden = false; const l = this.target.label; if (b.dataset.l !== l) { b.textContent = l; b.dataset.l = l; } }
    else b.hidden = true;
    // شجرة العطاس تعطس لحالها
    const sn = World.wonderById.sneeze;
    if (dist(P, sn) < 110 && (S.cd.sneeze || 0) < Date.now() && S.won.sneeze) Wonders.sneezeNow(sn);
    // الإشعارات بالخريطة الصغيرة
    this.mini();
    const hp = P.hp / mh;
    $('#hud').classList.toggle('low', hp < 0.25 && P.dead <= 0);
  },
  netStatus(s) {
    const el = $('#online');
    if (s === 'online') { this.toast('🟢 متصل بالعالم — اللاعبين يشوفونك'); }
    if (s === 'offline' && this.wasOnline) this.toast('⚪ انقطع الاتصال… أحاول أرجع');
    this.wasOnline = s === 'online';
    el.title = s;
  },
  bossBar(o) {
    const el = $('#bossbar');
    if (!o) { if (!el.hidden) el.hidden = true; return; }
    el.hidden = false;
    const key = `${Math.round(o.hp)}|${o.n}|${Math.floor(o.left)}`;
    if (key === this.bk) return; this.bk = key;
    el.innerHTML = `<div class="bn">🐋 الحوت الرملي <small>👥 ${o.n} · ⏳ ${fmtTime(o.left)}</small></div><div class="bb"><i style="width:${o.hp / o.max * 100}%"></i><span>${Math.round(o.hp)} / ${o.max}</span></div>`;
  },
  mini() {
    const c = $('#mini'), g = c.getContext('2d'), W = c.width, R = 70;
    const tx = P.x / T, ty = P.y / T;
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#1e5296'; g.fillRect(0, 0, W, W);
    g.drawImage(World.mapCanvas, tx - R, ty - R, R * 2, R * 2, 0, 0, W, W);
    const s = W / (R * 2), to = (x, y) => [(x / T - tx + R) * s, (y / T - ty + R) * s];
    for (const w of World.wonders) if (S.won[w.id]) { const [x, y] = to(w.x, w.y); if (x > 0 && y > 0 && x < W && y < W) { g.font = '12px ' + EMOJI_FONT; g.textAlign = 'center'; g.fillText(w.e, x, y + 4); } }
    if (Boss.active) { const w = World.wonderById.whale, [x, y] = to(w.x, w.y); g.fillStyle = '#ef4444'; g.beginPath(); g.arc(clamp(x, 6, W - 6), clamp(y, 6, W - 6), 5, 0, 7); g.fill(); }
    for (const o of G.others.values()) { const [x, y] = to(o.x, o.y); if (x > 0 && y > 0 && x < W && y < W) { g.fillStyle = o.color; g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); g.stroke(); } }
    if (S.wp) { const [x, y] = to(S.wp.x, S.wp.y); g.fillStyle = '#facc15'; g.beginPath(); g.arc(clamp(x, 4, W - 4), clamp(y, 4, W - 4), 4, 0, 7); g.fill(); }
    g.save(); g.translate(W / 2, W / 2); g.rotate(P.dir);
    g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(7, 0); g.lineTo(-5, -5); g.lineTo(-3, 0); g.lineTo(-5, 5); g.closePath(); g.fill(); g.stroke();
    g.restore();
  },
  chatLine(name, msg, color, me) {
    this.chatLog.push({ name, msg, color, me, t: Date.now() });
    if (this.chatLog.length > 80) this.chatLog.shift();
    if (this.cur === 'chat') this.renderChat();
    else if (!me) { $('#bChat').classList.add('dot'); this.feed(`💬 ${name}: ${msg}`); }
  },

  /* ---------- التفاعل ---------- */
  findTarget() {
    if (P.dead > 0 || !S) return null;
    let best = null, bd = 1e9;
    const cand = (kind, o, r, label) => { const d = dist(o, P); if (d < r && d < bd) { bd = d; best = { kind, o, label }; } };
    for (const n of G.npcs) cand('npc', n, 64, `${n.e} ${n.n}`);
    for (const w of World.wonders) cand('wonder', w, 72 + w.s * 0.35, `${w.e} ${S.won[w.id] ? w.n : '؟؟؟'}`);
    for (const c of G.chests) cand('chest', c, 56, '🎁 افتح الصندوق');
    for (const c of G.bottles) cand('bottle', c, 56, '🍾 قارورة!');
    for (const s of G.signs.values()) cand('sign', s, 56, '🪧 اقرا اللوحة');
    for (const o of G.others.values()) if (G.t - o.sT < 4) cand('player', o, 56, `👤 ${o.name}`);
    return best;
  },
  interact() {
    const t = this.findTarget();
    if (!t || P.busy) return;
    Snd.init();
    switch (t.kind) {
      case 'npc': this.openDialog(t.o.id); break;
      case 'wonder': Wonders.interact(t.o); break;
      case 'chest': openChest(t.o); break;
      case 'bottle': this.readBottle(t.o); break;
      case 'sign': this.readSign(t.o); break;
      case 'player': this.playerCard(t.o); break;
    }
  },

  /* ---------- الحوار مع الشخصيات ---------- */
  openDialog(id) {
    const n = NPCS[id] || { n: 'زوزو الفضائي', e: '👽', talk: ['بيب بوب! 👽', 'كوكبي بعيد… وأبي أرجع لأمي.', 'زيب زوب؟ (يعني: عندك قطع غيار؟)'] };
    this.dlg = id;
    if (id === 'chicken' && P.fx.chicken) {
      const q = QUESTS.find(q => q.id === 'q16');
      if (S.q.q16) { turnIn(q); return this.say('🐓', n.n, '«كاك! أخيرًا أحد يفهمني! أنت دجاجة رسمية الحين 🐔🎖️»'); }
    }
    const opts = [], parts = [];
    let line = pick(n.talk);
    for (const q of QUESTS.filter(q => q.by === id)) {
      if (S.q[q.id]) {
        if (qComplete(q)) opts.push([`✅ سلّم: ${q.n}`, 'turnin', q.id]);
        else parts.push(`<div class="qline">📜 <b>${esc(q.n)}</b> — ${esc(q.d)} <span class="pr">${q.k === 'fx' ? '' : `${qProg(q)}/${q.c}`}</span></div>`);
      } else if (qAvail(q)) opts.push([`❗ عندي شغلة لك: ${q.n}`, 'offer', q.id]);
    }
    if (n.shop) opts.push(['🛒 أبي أشتري', 'shop']);
    if (id === 'merchant') opts.push(['💰 أبي أبيع', 'sell']);
    if (id === 'camel') opts.push(['🧩 عطني لغز', 'riddle']);
    if (id === 'kid') opts.push(['🗺️ وش سمعت عن العجايب؟', 'hint']);
    if (id === 'mirror') opts.unshift(['🎨 غيّر شكلي', 'wardrobe']);
    if (id === 'door2') opts.unshift(['🚪 افتح الباب', 'travel']);
    if (id === 'grandma' || id === 'nokhatha') opts.push(['💬 سولف معي', 'gossip']);
    opts.push(['👋 مع السلامة', 'close']);
    this.say(n.e, n.n, `«${esc(line)}»${parts.join('')}`, opts);
  },
  offer(qid) {
    const q = QUESTS.find(q => q.id === qid), n = NPCS[q.by] || { e: '👽', n: 'زوزو الفضائي' };
    const r = q.r, rw = [r.xp && `${r.xp} خبرة`, r.g && `${r.g} ⚪`, ...(r.it || []).map(([it, c]) => `${c}× ${ITEMS[it].e} ${ITEMS[it].n}`), r.title && `لقب «${r.title}»`, r.pet && `حيوان أليف ${PETS[r.pet].e}`].filter(Boolean).join(' · ');
    this.say(n.e, n.n, `<b>📜 ${esc(q.n)}</b><br>${esc(q.d)}<div class="rw">🎁 الجايزة: ${rw}</div>`, [['👍 أبشر!', 'accept', q.id], ['🙅 بعدين', 'close']]);
  },

  /* ---------- المتجر ---------- */
  openShop(list, title, line) {
    this.shopList = list; this.shopTitle = title; this.shopLine = line;
    this.open(title, `${line ? `<p class="muted">${line}</p>` : ''}<div class="gold">⚪ عندك <b>${S.gold}</b> لؤلؤ</div>
      <div class="shop">${list.map(it => {
        const I = ITEMS[it], owned = (I.t === 'key' || I.t === 'wpn' || I.t === 'arm') && has(it);
        const stat = I.atk ? `⚔️ ${I.atk}` : I.def ? `🛡️ ${I.def}` : I.heal ? `❤️ +${I.heal}` : '';
        return `<button class="it ${owned ? 'own' : ''}" data-act="buy" data-v="${it}" ${owned || S.gold < I.p ? 'disabled' : ''}>
          <span class="ie" style="${I.hue !== undefined ? `filter:hue-rotate(${I.hue}deg)` : ''}">${I.e}</span>
          <span class="in"><b>${I.n}</b><small>${stat} ${I.d ? esc(I.d) : ''}</small></span>
          <span class="ip">${owned ? 'عندك ✓' : `${I.p} ⚪`}</span></button>`;
      }).join('')}</div>`);
  },
  openSell() {
    const list = Object.entries(S.inv).filter(([it]) => ITEMS[it] && ['mat', 'food'].includes(ITEMS[it].t));
    this.open('💰 بيع لبو جاسم', `<div class="gold">⚪ عندك <b>${S.gold}</b> لؤلؤ</div>
      ${list.length ? `<div class="shop">${list.map(([it, n]) => { const I = ITEMS[it]; return `<div class="it"><span class="ie">${I.e}</span><span class="in"><b>${I.n} ×${n}</b><small>${I.p} ⚪ للحبة</small></span>
        <span class="row"><button class="mini-btn" data-act="sell1" data-v="${it}">بيع 1</button><button class="mini-btn" data-act="sellall" data-v="${it}">الكل</button></span></div>`; }).join('')}</div>` : '<p class="muted">ما عندك شي ينباع… روح اجمع مواد وارجع 😄</p>'}`);
  },

  /* ---------- الشنطة ---------- */
  openBag(sel) {
    const items = Object.entries(S.inv).filter(([it, n]) => ITEMS[it] && n > 0);
    const W = ITEMS[S.wpn], A = ITEMS[S.arm];
    const sI = sel && ITEMS[sel];
    this.open('🎒 الشنطة', `
      <div class="stats">
        <div>❤️ <b>${Math.ceil(P.hp)}/${maxHP()}</b></div><div>⚔️ <b>${Math.round(attackPower())}</b></div>
        <div>🛡️ <b>${defense()}</b></div><div>⚪ <b>${S.gold}</b></div>
        <div>⭐ لفل <b>${S.lvl}</b></div><div>✨ <b>${S.xp}/${xpNeed(S.lvl)}</b></div>
      </div>
      <div class="eq"><span>بيدك: ${W.e} ${W.n}</span><span>لابس: ${A.e} ${A.n}</span></div>
      ${sI ? `<div class="detail"><span class="ie big" style="${sI.hue !== undefined ? `filter:hue-rotate(${sI.hue}deg)` : ''}">${sI.e}</span><div><b>${sI.n}</b> ×${S.inv[sel]}
        <p class="muted">${sI.atk ? `⚔️ ضرب ${sI.atk} · ` : ''}${sI.def ? `🛡️ دفاع ${sI.def} · ` : ''}${sI.heal ? `❤️ يرجع ${sI.heal} صحة · ` : ''}${sI.d ? esc(sI.d) : ''}</p>
        <div class="row">${['wpn', 'arm'].includes(sI.t) ? (S.wpn === sel || S.arm === sel ? '<span class="muted">✓ لابسه</span>' : `<button class="btn" data-act="use" data-v="${sel}">البسه</button>`) : (sI.heal || sI.fx) ? `<button class="btn" data-act="use" data-v="${sel}">${sI.fx ? 'اشرب 🧪' : 'كُل 😋'}</button>` : ''}</div></div></div>` : ''}
      <div class="grid">${items.length ? items.map(([it, n]) => { const I = ITEMS[it]; return `<button class="cell ${sel === it ? 'sel' : ''} ${S.wpn === it || S.arm === it ? 'eqd' : ''}" data-act="bag" data-v="${it}">
        <span style="${I.hue !== undefined ? `filter:hue-rotate(${I.hue}deg)` : ''}">${I.e}</span><small>${n}</small></button>`; }).join('') : '<p class="muted">الشنطة فاضية</p>'}</div>
      ${S.pets.length ? `<h4>🐾 الحيوانات الأليفة</h4><div class="chips">${['', ...S.pets].map(p => `<button class="chip ${S.pet === p ? 'on' : ''}" data-act="pet" data-v="${p}">${p ? `${PETS[p].e} ${PETS[p].n}` : 'بدون'}</button>`).join('')}</div>` : ''}
      ${has('pen') ? `<button class="btn wide" data-act="writesign">🖊️ اكتب لوحة هنا للاعبين</button>` : ''}`);
  },

  /* ---------- المهمات والعجايب والألقاب ---------- */
  openQuests(tab = 'q') {
    let body = `<div class="tabs"><button class="${tab === 'q' ? 'on' : ''}" data-act="qtab" data-v="q">📜 المهمات</button><button class="${tab === 'w' ? 'on' : ''}" data-act="qtab" data-v="w">✨ العجايب ${Object.keys(S.won).length}/${WONDERS.length}</button><button class="${tab === 't' ? 'on' : ''}" data-act="qtab" data-v="t">🏅 الألقاب</button></div>`;
    if (tab === 'q') {
      const act = QUESTS.filter(q => S.q[q.id]), av = QUESTS.filter(qAvail);
      body += act.length ? act.map(q => `<div class="qcard ${qComplete(q) ? 'done' : ''}"><b>${esc(q.n)}</b> <span class="pr">${q.k === 'fx' ? '' : `${qProg(q)}/${q.c}`}</span><p>${esc(q.d)}</p><small>📍 ${esc(giverName(q.by))}${qComplete(q) ? ' — ارجع له وسلّم ✅' : ''}</small></div>`).join('') : '<p class="muted">ما عندك مهمات الحين. كلّم الناس اللي فوق راسهم ❗</p>';
      if (av.length) body += `<h4>مهمات تنتظرك</h4>` + av.map(q => `<div class="qcard dim">❗ <b>${esc(q.n)}</b><small> — عند ${esc(giverName(q.by))}</small></div>`).join('');
      body += `<p class="muted small">خلصت ${S.qd.length} من ${QUESTS.length} مهمة</p>`;
    } else if (tab === 'w') {
      body += `<div class="wonders">${World.wonders.map(w => S.won[w.id]
        ? `<div class="wcard"><span>${w.e}</span><b>${w.n}</b><small>${w.d}</small></div>`
        : `<div class="wcard dim"><span>❔</span><b>؟؟؟</b><small>يقولون إنها في ${w.bi.map(b => BIOMES[B[b.toUpperCase()]].n).join(' أو ')}</small></div>`).join('')}</div>`;
    } else {
      body += `<div class="titles">${Object.entries(TITLES_INFO).map(([t, d]) => S.titles.includes(t)
        ? `<button class="chip ${S.title === t ? 'on' : ''}" data-act="title" data-v="${t}">🏅 ${t}</button>`
        : `<span class="chip dim" title="${d}">🔒 ${t} <small>${d}</small></span>`).join('')}</div>`;
    }
    this.open('📜 سجل المغامرة', body);
  },

  /* ---------- الخريطة ---------- */
  openMap() {
    this.open('🗺️ خريطة أرض العجايب', `<div class="mapwrap"><canvas id="bigmap"></canvas></div>
      <p class="muted small">اضغط على أي مكان عشان تحط علامة 📍 ويطلع لك سهم يوديك. اضغط عليها مرة ثانية تنشال.</p>
      <div class="legend">🧍 أنت · <span style="color:#facc15">●</span> علامتك · <span style="color:#ef4444">●</span> الحوت لما يصحى · النقاط الملونة = لاعبين</div>`, 'map');
    $('#panel').className = 'wide';
    const c = $('#bigmap'), size = Math.min(innerWidth - 40, innerHeight - 200, 700);
    c.width = c.height = size * Math.min(2, devicePixelRatio || 1); c.style.width = c.style.height = size + 'px';
    this.drawMap(c);
    c.onclick = e => {
      const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * WORLD * T, y = (e.clientY - r.top) / r.height * WORLD * T;
      if (S.wp && Math.hypot(S.wp.x - x, S.wp.y - y) < 600) S.wp = null; else S.wp = { x, y };
      this.drawMap(c);
    };
  },
  drawMap(c) {
    const g = c.getContext('2d'), W = c.width, s = W / WORLD;
    g.imageSmoothingEnabled = false;
    g.drawImage(World.mapCanvas, 0, 0, W, W);
    const fog = document.createElement('canvas'); fog.width = fog.height = 64;
    const fg = fog.getContext('2d'), img = fg.createImageData(64, 64);
    for (let i = 0; i < 64 * 64; i++) { img.data[i * 4 + 3] = G.explored[i] ? 0 : 235; img.data[i * 4] = 20; img.data[i * 4 + 1] = 22; img.data[i * 4 + 2] = 40; }
    fg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true; g.drawImage(fog, 0, 0, W, W);
    g.textAlign = 'center';
    g.font = `${Math.round(W / 34)}px ${EMOJI_FONT}`;
    g.fillText('🏠', CENTER * s, CENTER * s + W / 80);
    for (const w of World.wonders) if (S.won[w.id]) g.fillText(w.e, w.tx * s, w.ty * s + W / 80);
    if (Boss.active) { const w = World.wonderById.whale; g.strokeStyle = '#ef4444'; g.lineWidth = 3; g.beginPath(); g.arc(w.tx * s, w.ty * s, W / 40, 0, 7); g.stroke(); }
    for (const o of G.others.values()) { g.fillStyle = o.color; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(o.x / T * s, o.y / T * s, W / 110, 0, 7); g.fill(); g.stroke(); }
    if (S.wp) { g.fillStyle = '#facc15'; g.strokeStyle = '#000'; g.beginPath(); g.arc(S.wp.x / T * s, S.wp.y / T * s, W / 90, 0, 7); g.fill(); g.stroke(); }
    g.font = `${Math.round(W / 28)}px ${EMOJI_FONT}`;
    g.fillText('🧍', P.x / T * s, P.y / T * s + W / 70);
  },

  /* ---------- اللاعبين ---------- */
  openPlayers() {
    const list = [...G.others.values()].sort((a, b) => dist(a, P) - dist(b, P));
    const dirName = o => { const a = Math.atan2(o.y - P.y, o.x - P.x), i = Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8; return ['⬅️', '↖️', '⬆️', '↗️', '➡️', '↘️', '⬇️', '↙️'][(i + 4) % 8]; };
    this.open(`👥 اللاعبين (${list.length + 1})`, `
      <p class="muted small">${Net.online ? `🟢 متصل بعالم «${esc(Net.world)}»` : '⚪ مو متصل — تلعب لحالك الحين'}</p>
      <div class="plist"><div class="pl me"><i style="background:${S.color}"></i><b>${esc(S.name)}</b> · ${S.lvl} <small>${S.title !== 'مبتدئ' ? '«' + esc(S.title) + '»' : ''} (أنت)</small></div>
      ${list.map(o => `<div class="pl"><i style="background:${o.color}"></i><b>${esc(o.name)}</b> · ${o.lvl} <small>${o.title ? '«' + esc(o.title) + '»' : ''} ✨${o.won}</small>
        <span class="grow"></span><small>${dirName(o)} ${Math.round(dist(o, P) / T)} خطوة</small>
        <button class="mini-btn" data-act="goto" data-v="${o.id}">📍</button><button class="mini-btn" data-act="mute" data-v="${o.id}">${G.muted.has(o.id) ? '🔊' : '🔇'}</button></div>`).join('')}</div>
      ${list.length ? '' : `<p class="muted">ما فيه أحد غيرك الحين… ادعُ ربعك! أرسل لهم رابط اللعبة 👇</p>`}
      <button class="btn wide" data-act="share">🔗 ادعُ ربعك لنفس العالم</button>`);
  },
  playerCard(o) {
    this.cardFor = o.id;
    this.say('👤', o.name, `لفل <b>${o.lvl}</b> ${o.title ? `· «${esc(o.title)}»` : ''}<br>✨ اكتشف ${o.won} عجيبة`, [
      ['👋 سلّم عليه', 'emote', '0'], ['🤝 صافحه (لو صافحك بنفس الوقت تاخذون شحنة صداقة)', 'emote', '5'],
      ['🎁 أهديه شي', 'giftmenu', o.id], [G.muted.has(o.id) ? '🔊 رجّع صوته' : '🔇 اكتمه', 'mute', o.id], ['👋 خلاص', 'close']]);
  },
  giftMenu(id) {
    const o = G.others.get(id); if (!o) return this.close();
    const items = Object.entries(S.inv).filter(([it, n]) => ITEMS[it] && ITEMS[it].t !== 'key' && S.wpn !== it && S.arm !== it && n > 0);
    this.open(`🎁 هدية لـ${esc(o.name)}`, `<p class="muted small">الهدية توصله إذا كان قريب منك.</p>
      <div class="grid">${S.gold >= 10 ? `<button class="cell" data-act="gift" data-v="pearl"><span>⚪</span><small>10</small></button>` : ''}
      ${items.map(([it, n]) => `<button class="cell" data-act="gift" data-v="${it}"><span style="${ITEMS[it].hue !== undefined ? `filter:hue-rotate(${ITEMS[it].hue}deg)` : ''}">${ITEMS[it].e}</span><small>${n}</small></button>`).join('')}</div>`);
  },

  /* ---------- الدردشة ---------- */
  openChat() {
    $('#bChat').classList.remove('dot');
    this.open('💬 دردشة العالم', `<div id="chatlog"></div>
      <div class="chips quick">${QUICK_CHAT.map(q => `<button class="chip" data-act="say" data-v="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <div class="chips quick">${EMOTES.map((e, i) => `<button class="chip em" data-act="emote" data-v="${i}">${e}</button>`).join('')}</div>
      <form id="chatform" class="row"><input id="chatin" maxlength="120" placeholder="اكتب رسالة للكل…" autocomplete="off"><button class="btn">إرسال</button></form>
      <p class="muted small">الدردشة عامة لكل اللي بنفس العالم. لا تكتب معلوماتك الشخصية 🙏</p>`, 'chat');
    this.renderChat();
    $('#chatform').onsubmit = e => { e.preventDefault(); const v = $('#chatin').value; $('#chatin').value = ''; this.sendChat(v); };
    if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => $('#chatin') && $('#chatin').focus(), 50);
  },
  renderChat() {
    const el = $('#chatlog'); if (!el) return;
    el.innerHTML = this.chatLog.length ? this.chatLog.map(c => `<div class="cl ${c.me ? 'me' : ''}"><b style="color:${c.color}">${esc(c.name)}</b> ${esc(c.msg)}</div>`).join('') : '<p class="muted">لا رسايل بعد. قل هلا 👋</p>';
    el.scrollTop = el.scrollHeight;
  },
  sendChat(v) {
    let m = cleanText(v, 120); if (!m) return;
    if (P.fx.backwards) m = [...m].reverse().join('');
    G.myBubble = { text: m, until: G.t + 6 };
    if (!Net.pub('g', { t: 'c', n: S.name, m })) this.toast('⚪ مو متصل — محد بيشوف رسالتك');
    this.chatLine(S.name, m, S.color, true);
  },

  /* ---------- الباب (تنقل سريع) ---------- */
  openTravel() {
    const dests = [['town', '🏠 واحة البداية'], ...World.wonders.filter(w => S.won[w.id]).map(w => [w.id, `${w.e} ${w.n}`])];
    this.open('🚪 وين تبي تروح؟', `<p class="muted">الباب يوديك لأي مكان زرته قبل.</p><div class="opts">${dests.map(([id, n]) => `<button class="opt" data-act="go" data-v="${id}">${n}</button>`).join('')}</div>`);
  },

  /* ---------- البيانو ---------- */
  openPiano() {
    this.piano = [];
    const names = ['دو', 'ري', 'مي', 'فا', 'صول', 'لا', 'سي', 'دو'];
    this.open('🎹 البيانو الضايع', `<p class="muted">اللاعبين اللي حولك يسمعون عزفك 🎶</p>
      <div class="piano">${names.map((n, i) => `<button class="key" data-act="note" data-v="${i}">${n}</button>`).join('')}</div>
      <p class="sign">🪧 مكتوب على لوحة جنب البيانو: «لحن السر: دو · مي · صول · دو»</p>`);
  },
  note(k) {
    Snd.note(k); Net.pub('r', { t: 'n', k });
    emojiPart(P.x + rand(-10, 10), P.y - 50, pick(['🎵', '🎶']), { vy: -40 });
    this.piano.push(k); if (this.piano.length > 4) this.piano.shift();
    if (this.piano.join() === '0,2,4,7') {
      this.piano = [];
      if (!S.cd.piano) { S.cd.piano = 1; addXP(150); give('pRainbow', 3); addTitle('عازف الثلج'); }
      else { this.toast('🎶 برافو! عزف حلو'); }
      burst(P.x, P.y - 30, 30, 'rainbow');
    }
  },

  /* ---------- اللوحات والقوارير ---------- */
  ago(ts) {
    const s = (Date.now() - ts) / 1000;
    return s < 120 ? 'الحين' : s < 3600 ? `قبل ${Math.round(s / 60)} دقيقة` : s < 86400 ? `قبل ${Math.round(s / 3600)} ساعة` : `قبل ${Math.round(s / 86400)} يوم`;
  },
  signText(r) { return SIGN_TPL[r.a].replace('{}', SIGN_WORDS[r.b]); },
  readSign(s) {
    this.say('🪧', 'لوحة', `<div class="signbox">«${esc(this.signText(s))}»</div><small class="muted">— ${esc(s.n)} · ${this.ago(s.ts)}</small>`, [['👍 حلوة', 'likesign'], ['👋 تمام', 'close']]);
  },
  readBottle(b) {
    G.bottles = G.bottles.filter(o => o !== b);
    addXP(5); Snd.pick();
    const all = [...G.bottleMsgs.values()].filter(r => !r.mine);
    const r = all.length ? pick(all) : { n: 'النوخذة', a: irand(0, SIGN_TPL.length - 1), b: irand(0, SIGN_WORDS.length - 1), ts: Date.now() - 864e5 * 30 };
    this.say('🍾', 'رسالة في قارورة', `<div class="signbox">«${esc(this.signText(r))}»</div><small class="muted">— ${esc(r.n)} · ${this.ago(r.ts)}</small>
      <p class="muted small">القوارير فيها رسايل من لاعبين حقيقيين رموها بالبحر.</p>`, [['✍️ اكتب رسالة وارميها', 'writebottle'], ['👋 تمام', 'close']]);
  },
  openWrite(kind) {
    this.writeKind = kind;
    this.open(kind === 'sign' ? '🪧 اكتب لوحة' : '🍾 رسالة في قارورة', `<p class="muted">${kind === 'sign' ? 'اللوحة تنحط مكانك والكل يقدر يقراها.' : 'القارورة تروح للبحر، ولاعب ثاني بيلقاها على شاطئ.'}</p>
      <label>القالب</label><select id="wa">${SIGN_TPL.map((t, i) => `<option value="${i}">${esc(t.replace('{}', '___'))}</option>`).join('')}</select>
      <label>الكلمة</label><select id="wb">${SIGN_WORDS.map((t, i) => `<option value="${i}">${esc(t)}</option>`).join('')}</select>
      <div class="signbox" id="wprev"></div>
      <button class="btn wide" data-act="placesign">${kind === 'sign' ? '🪧 حط اللوحة' : '🌊 ارمي القارورة'}</button>`);
    const upd = () => { $('#wprev').textContent = '«' + this.signText({ a: +$('#wa').value, b: +$('#wb').value }) + '»'; };
    $('#wa').onchange = upd; $('#wb').onchange = upd; upd();
  },

  /* ---------- المراية ---------- */
  openWardrobe() {
    const hats = HATS.filter(h => !h.lock || S.hats.includes(h.id));
    this.open('🪞 المراية السحرية', `<div class="avatar-row">${avatarHTML(S.color, S.hat, 70)}</div>
      <label>اللون</label><div class="swatches">${COLORS.map(c => `<button class="sw ${S.color === c ? 'on' : ''}" style="background:${c}" data-act="color" data-v="${c}"></button>`).join('')}</div>
      <label>القبعة</label><div class="chips">${hats.map(h => `<button class="chip ${S.hat === h.id ? 'on' : ''}" data-act="hat" data-v="${h.id}">${h.draw || !h.id ? '' : h.id} ${h.n}</button>`).join('')}</div>
      <p class="muted small">قبعات مقفلة: ${HATS.filter(h => h.lock && !S.hats.includes(h.id)).map(h => `${h.id} ${h.lock}`).join(' · ') || 'ولا وحدة! 🎉'}</p>`);
  },

  /* ---------- الإعدادات ---------- */
  openSettings() {
    this.open('⚙️ الإعدادات', `
      <div class="setrow"><span>🔊 الأصوات</span><button class="chip ${S.sound ? 'on' : ''}" data-act="tog" data-v="sound">${S.sound ? 'شغالة' : 'طافية'}</button></div>
      <div class="setrow"><span>🎵 الموسيقى</span><button class="chip ${S.music ? 'on' : ''}" data-act="tog" data-v="music">${S.music ? 'شغالة' : 'طافية'}</button></div>
      <div class="setrow"><span>🌍 العالم</span><b>${esc(S.world)}</b></div>
      <div class="chips">${['w1', 'w2', 'w3'].map(w => `<button class="chip ${S.world === w ? 'on' : ''}" data-act="world" data-v="${w}">عالم ${w.slice(1)}</button>`).join('')}<button class="chip" data-act="world" data-v="new">🔒 عالم خاص جديد</button></div>
      <button class="btn wide" data-act="share">🔗 انسخ رابط عالمي</button>
      <p class="muted small">${Net.online ? `🟢 متصل عن طريق ${esc(Net.broker.replace(/^wss?:\/\//, '').split('/')[0])}` : '⚪ مو متصل الحين'} · أرسلت ${Net.sent} واستقبلت ${Net.received}</p>
      <h4>🎮 التحكم</h4>
      <p class="muted small">الجوال: العصا يسار الشاشة للمشي، والأزرار يمين: ⚔️ ضرب (اضغط مطوّل يضرب على طول) · 💨 اندفاع · 🌀 دوامة · 🤚 تفاعل.<br>
      الكيبورد: WASD أو الأسهم · مسافة/كلك = ضرب · Shift = اندفاع · Q = دوامة · E = تفاعل · F = أكل/جرعة · R = الجمل · M خريطة · I شنطة · O مهمات · P لاعبين · Enter دردشة · 1-8 حركات</p>
      <h4>📊 إحصائياتك</h4>
      <p class="muted small">قتلت ${S.stats.kills} وحش · طحت ${S.stats.deaths} مرة · الحوت ${S.stats.boss} · صناديق ${S.stats.chests} · مهمات ${S.qd.length} · عجايب ${Object.keys(S.won).length}</p>
      <button class="btn danger wide" data-act="reset">🗑️ احذف الشخصية وابدأ من جديد</button>`);
  }
};

function avatarHTML(color, hat, size = 60) {
  const h = HATS.find(x => x.id === hat);
  const hatEl = !hat ? '' : h && h.draw ? `<i class="gh ${hat}"></i>` : `<i class="hat">${hat}</i>`;
  return `<div class="ava" style="--c:${color};--s:${size}px"><span class="body"><b></b><b></b></span>${hatEl}</div>`;
}

/* ============ الأزرار داخل اللوحات ============ */
const ACT = {
  close: () => UI.close(),
  joke: () => { addXP(2); Wonders.head(World.wonderById.head); },
  falls: () => { P.hp = maxHP(); applyFx('flip', 20); UI.close(); },
  hug: () => {
    const w = World.wonderById.cactus;
    hurtPlayer(Math.round(maxHP() * 0.3), true);
    for (let i = 0; i < 12; i++) emojiPart(w.x + rand(-20, 20), w.y - 50, '❤️', { vy: rand(-80, -30), vx: rand(-40, 40), life: 1.6 });
    if (!S.cd.hugged) { S.cd.hugged = 1; addTitle('حاضن الصبار'); give('hp2', 2); addXP(80); UI.say('🌵', w.n, '«آآآخ… قصدي شكرًا! 🥹 أول مرة أحد يحضني» <br>عطتك جرعتين كبار.'); }
    else { give('candy', 1); UI.say('🌵', w.n, '«هههه تحبني صدق 🥹»'); }
  },
  tv: () => Wonders.tv(World.wonderById.tv),
  egg: () => {
    const w = World.wonderById.egg;
    if (!has('candy', 5)) return UI.say('🥚', w.n, `البيضة تبي 5 حلاوة 🍬 وعندك ${S.inv.candy || 0}. تلقاها بأرض الحلاوة.`);
    take('candy', 5); S.cd.egg = Date.now() + 20 * 60e3;
    burst(w.x, w.y - 30, 40, 'rainbow'); Snd.lvl();
    const pool = ['chick', 'octo', 'cloud', 'eye'].filter(p => !S.pets.includes(p));
    if (pool.length) { addPet(pick(pool)); UI.close(); }
    else { give('egg', 3); addXP(40); UI.say('🥚', w.n, 'البيضة فقست… وطلع منها 3 بيض صغير 🥚🥚🥚 (ما ندري كيف)'); }
  },
  wish10: () => wish(10), wish50: () => wish(50),
  throne: () => {
    const w = World.wonderById.slimeking;
    S.cd.king = Date.now() + 10 * 60e3;
    const m = spawnMob('kingSlime', w.x, w.y + 70, Math.max(S.lvl, mobLevelAt(w.x, w.y)) + 1); m.angry = 1;
    Snd.boss(); cam.shake = 10;
    UI.close(); UI.banner('👑 ملك السلايم!', '«مين قعد على كرسيي؟!»');
  },
  turnin: v => { turnIn(QUESTS.find(q => q.id === v)); UI.openDialog(UI.dlg); },
  offer: v => UI.offer(v),
  accept: v => { S.q[v] = { p: 0 }; Snd.pick(); UI.toast('📜 مهمة جديدة!'); UI.openDialog(QUESTS.find(q => q.id === v).by); },
  shop: () => { const n = NPCS[UI.dlg]; UI.openShop(n.shop, `🛒 ${n.n}`); },
  sell: () => UI.openSell(),
  buy: v => {
    const I = ITEMS[v]; if (!I || S.gold < I.p) return;
    S.gold -= I.p; give(v, 1, true); Snd.coin();
    UI.toast(`اشتريت ${I.e} ${I.n}`);
    UI.openShop(UI.shopList, UI.shopTitle, UI.shopLine);
  },
  sell1: v => { if (!has(v)) return; take(v); S.gold += ITEMS[v].p; Snd.coin(); UI.openSell(); },
  sellall: v => { const n = S.inv[v] || 0; if (!n) return; take(v, n); S.gold += ITEMS[v].p * n; Snd.coin(); UI.toast(`بعت ${n} ${ITEMS[v].e} بـ ${ITEMS[v].p * n} ⚪`); UI.openSell(); },
  riddle: () => {
    const i = irand(0, RIDDLES.length - 1), [q, a] = RIDDLES[i];
    const order = [0, 1, 2].sort(() => Math.random() - 0.5);
    UI.say('🐫', 'الجمل الحكيم', `🧩 «${q}»`, order.map(k => [a[k], 'answer', `${i}:${k}`]));
  },
  answer: v => {
    const [i, k] = v.split(':').map(Number), ok = RIDDLES[i][2] === k;
    if (ok) { S.stats.riddles++; questEvent('riddle'); addXP(10); Snd.coin(); }
    else Snd.hurt();
    UI.say('🐫', 'الجمل الحكيم', ok ? '«صح عليك! 👏 مخك أكبر من سنامي»' : `«غلط 😏 الجواب: ${RIDDLES[i][1][RIDDLES[i][2]]}»`, [['🧩 لغز ثاني', 'riddle'], ['👋 خلاص', 'close']]);
  },
  hint: () => {
    const left = World.wonders.filter(w => !S.won[w.id]);
    if (!left.length) return UI.say('👦', 'سعود الصغير', '«ما بقى شي ما شفته! أنت أسطورة 🤩»');
    const w = left.sort((a, b) => dist(a, P) - dist(b, P))[0];
    const a = Math.atan2(w.y - P.y, w.x - P.x), dirs = ['الشرق', 'الجنوب الشرقي', 'الجنوب', 'الجنوب الغربي', 'الغرب', 'الشمال الغربي', 'الشمال', 'الشمال الشرقي'];
    const d = dirs[Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
    UI.say('👦', 'سعود الصغير', `«سمعت إن فيه شي غريب جهة <b>${d}</b>، تقريبًا ${Math.round(dist(w, P) / T)} خطوة من هنا… يقولون إنه ${esc(w.d.split('.')[0])}!»`, [['📍 حط علامة بالخريطة', 'wpw', w.id], ['👋 شكرًا', 'close']]);
  },
  wpw: v => { const w = World.wonderById[v]; S.wp = { x: w.x + rand(-300, 300), y: w.y + rand(-300, 300) }; UI.toast('📍 حطيت علامة تقريبية'); UI.close(); },
  gossip: () => UI.say(NPCS[UI.dlg].e, NPCS[UI.dlg].n, `«${esc(pick(NPC_RANDOM))}»`, [['💬 زيديني', 'gossip'], ['👋 مع السلامة', 'close']]),
  wardrobe: () => UI.openWardrobe(),
  color: v => { if (COLORS.includes(v)) { S.color = v; sendPresence(); UI.openWardrobe(); } },
  hat: v => { if (HATS.some(h => h.id === v)) { S.hat = v; sendPresence(); UI.openWardrobe(); } },
  travel: () => UI.openTravel(),
  go: v => {
    UI.close();
    if (v === 'town') return warpTo(CENTER * T + 16, (CENTER + 2) * T + 16);
    const w = World.wonderById[v]; if (!w || !S.won[v]) return;
    for (let k = 0; k < 40; k++) {
      const a = k * 0.7, r = w.s * 0.6 + 40 + k * 4, x = w.x + Math.cos(a) * r, y = w.y + Math.abs(Math.sin(a)) * r;
      if (!blocked(x, y, 12, { boat: v === 'duck' })) return warpTo(x, y);
    }
    warpTo(w.x, w.y + 80);
  },
  bag: v => UI.openBag(v),
  use: v => { useItem(v); if (has(v)) UI.openBag(v); else UI.openBag(); },
  pet: v => { S.pet = v; P.pet.x = P.x; P.pet.y = P.y; sendPresence(); UI.openBag(); },
  qtab: v => UI.openQuests(v),
  title: v => { if (S.titles.includes(v)) { S.title = v; sendPresence(); UI.openQuests('t'); } },
  note: v => UI.note(+v),
  emote: v => { emote(+v); if (UI.cur === 'chat') return; UI.close(); },
  say: v => UI.sendChat(v),
  giftmenu: v => UI.giftMenu(v),
  gift: v => {
    const o = G.others.get(UI.cardFor); if (!o) return UI.close();
    const n = v === 'pearl' ? 10 : 1;
    if (v === 'pearl' ? S.gold < 10 : !has(v)) return;
    if (!Net.pub('g', { t: 'g', to: o.id, it: v, n })) return UI.toast('⚪ لازم تكون متصل');
    take(v, n); Snd.coin(); burst(o.x, o.y - 20, 20, '#f9a8d4');
    UI.toast(`🎁 أهديت ${o.name} ${n} ${ITEMS[v].e}`); UI.giftMenu(o.id);
  },
  mute: v => { G.muted.has(v) ? G.muted.delete(v) : G.muted.add(v); UI.cur === 'panel' && $('.plist') ? UI.openPlayers() : UI.close(); },
  goto: v => { const o = G.others.get(v); if (o) { S.wp = { x: o.x, y: o.y }; UI.toast(`📍 السهم يوديك لـ${o.name}`); UI.close(); } },
  share: () => {
    const url = location.origin + location.pathname + '#w=' + encodeURIComponent(S.world);
    const txt = `تعال العب معي «أرض العجايب» 🐋✨ نفس العالم: ${url}`;
    if (navigator.share) navigator.share({ title: 'أرض العجايب', text: txt, url }).catch(() => {});
    else { navigator.clipboard && navigator.clipboard.writeText(txt).then(() => UI.toast('انتسخ الرابط ✓'), () => prompt('انسخ الرابط:', url)); }
  },
  tog: v => { S[v] = S[v] ? 0 : 1; UI.openSettings(); },
  world: v => {
    if (v === 'new') v = 'p' + Math.random().toString(36).slice(2, 8);
    if (v === S.world) return;
    S.world = v; saveGame();
    Net.stop(); G.others.clear(); G.signs.clear(); G.bottleMsgs.clear();
    Net.start(v); location.hash = 'w=' + v;
    UI.toast(`🌍 انتقلت لعالم ${v}`); UI.openSettings();
  },
  reset: () => {
    if (!confirm('أكيد تبي تحذف شخصيتك وكل تقدمك؟')) return;
    localStorage.removeItem('ajayib.save'); G.running = false; Net.stop(); location.reload();
  },
  writesign: () => {
    if (!Net.online) return UI.toast('⚪ لازم تكون متصل عشان اللوحة توصل للناس');
    if (inTown(P)) return UI.toast('ممنوع اللوحات داخل الواحة 🙅 اطلع برا');
    UI.openWrite('sign');
  },
  writebottle: () => { if (!Net.online) return UI.toast('⚪ لازم تكون متصل'); UI.openWrite('bottle'); },
  placesign: () => {
    const a = +$('#wa').value, b = +$('#wb').value, kind = UI.writeKind;
    const slot = irand(0, kind === 'sign' ? 59 : 29);
    const msg = { t: kind, n: S.name, a, b, ts: Date.now(), s: slot };
    if (kind === 'sign') { msg.x = Math.round(P.x); msg.y = Math.round(P.y + 20); }
    if (!Net.keep(kind, slot, msg)) return UI.toast('⚪ لازم تكون متصل');
    if (kind === 'sign') { G.signs.set(slot, { ...msg, mine: true }); S.stats.signs++; }
    Snd.pick(); UI.toast(kind === 'sign' ? '🪧 حطيت اللوحة!' : '🌊 رميت القارورة بالبحر…'); UI.close();
  },
  likesign: () => { UI.toast('👍'); UI.close(); }
};
function wish(n) {
  const w = World.wonderById.hole;
  if (S.gold < n) return UI.say('🕳️', w.n, 'ما عندك لؤلؤ كفاية 😅');
  S.gold -= n; Snd.coin();
  const big = n >= 50, r = Math.random();
  let msg;
  if (r < (big ? 0.15 : 0.32)) { msg = 'الحفرة تتكرع… 🤭 وما رجّعت شي.'; Snd.hurt(); }
  else if (r < (big ? 0.4 : 0.6)) { const g = Math.round(n * rand(1.3, 2.2)); give('pearl', g); msg = `طلع لك ${g} لؤلؤ! 🤑`; }
  else if (r < (big ? 0.62 : 0.8)) { const it = pick(['pGiant', 'pTiny', 'pChicken', 'pGhost', 'pRainbow', 'pFlip', 'pMystery', 'hp2']); give(it, big ? 2 : 1); msg = `طلعت لك ${ITEMS[it].e} ${ITEMS[it].n}!`; }
  else if (r < (big ? 0.82 : 0.93)) { const it = pick(['crystal', 'star', 'part', 'ice', 'honey']); give(it, big ? 4 : 2); msg = `طلع لك ${ITEMS[it].e} ${ITEMS[it].n}!`; }
  else if (r < (big ? 0.95 : 0.99)) { const it = pick(['w_fish', 'w_umbrella', 'w_wand', 'a_iron', 'magnet', 'lantern']); give(it, 1); msg = `واو! طلع لك ${ITEMS[it].e} ${ITEMS[it].n}! 😱`; }
  else { if (!addPet('eye')) give('pearl', 200); addTitle('محظوظ'); msg = 'شي نادر جدًا طلع من الحفرة… 👁️ عين تطير!'; }
  burst(w.x, w.y, 20, 'rainbow');
  UI.say('🕳️', w.n, msg, [['⚪ مرة ثانية (10)', 'wish10'], ['⚪ مرة ثانية (50)', 'wish50'], ['👋 خلاص', 'close']]);
}

/* ============ شاشة البداية ============ */
const Start = {
  color: pick(COLORS), hat: 'ghutra', world: 'w1',
  show() {
    const save = loadGame(), hw = (location.hash.match(/w=([a-z0-9]{1,16})/i) || [])[1];
    if (hw) this.world = hw.toLowerCase();
    else if (save) this.world = save.world || 'w1';
    const el = $('#start');
    el.hidden = false;
    el.innerHTML = `<div class="st">
      <div class="logo">أرض العجايب</div>
      <p class="tag">عالم مفتوح أونلاين… فيه حوت بالصحرا، وصبارة تبي حضن، ودجاجة فيلسوفة 🐋🌵🐔</p>
      ${save ? `<button class="btn primary big" id="cont">${avatarHTML(save.color, save.hat, 34)} كمّل يا ${esc(save.name)} (لفل ${save.lvl})</button><button class="btn ghost" id="newc">شخصية جديدة</button>` : ''}
      <div id="create" ${save ? 'hidden' : ''}>
        <div class="avatar-row" id="prev">${avatarHTML(this.color, this.hat, 80)}</div>
        <label>اسمك بالعالم</label><input id="nm" maxlength="16" placeholder="مثلًا: فهد" autocomplete="off">
        <label>لونك</label><div class="swatches">${COLORS.map(c => `<button class="sw ${c === this.color ? 'on' : ''}" style="background:${c}" data-c="${c}"></button>`).join('')}</div>
        <label>قبعتك</label><div class="chips">${HATS.filter(h => !h.lock).map(h => `<button class="chip ${h.id === this.hat ? 'on' : ''}" data-h="${h.id}">${h.draw || !h.id ? '' : h.id} ${h.n}</button>`).join('')}</div>
        <button class="btn primary big" id="go">ابدأ المغامرة ✨</button>
      </div>
      <label>العالم</label>
      <div class="chips" id="worlds">${['w1', 'w2', 'w3'].map(w => `<button class="chip ${this.world === w ? 'on' : ''}" data-w="${w}">🌍 عالم ${w.slice(1)}</button>`).join('')}
        <button class="chip ${/^(w1|w2|w3)$/.test(this.world) ? '' : 'on'}" data-w="private">🔒 ${/^(w1|w2|w3)$/.test(this.world) ? 'عالم خاص للربع' : 'خاص: ' + esc(this.world)}</button></div>
      <details class="how"><summary>كيف ألعب؟</summary>
        <p>🧭 تمشى بالعالم واكتشف <b>${WONDERS.length} عجيبة</b> غريبة. كلّم الناس بالواحة وخذ مهمات.<br>
        ⚔️ اضرب الوحوش وارفع لفلك. كل ما بعدت عن الواحة الوحوش تقوى.<br>
        🐋 كل 12 دقيقة الحوت الرملي يصحى، وكل اللاعبين يضربونه سوا.<br>
        🧪 جرعات عجيبة: تصير عملاق، دجاجة، شبح، أو تنقلب الدنيا.<br>
        🌦️ الجو يتغير: مطر تمر، مطر ضفادع، قمر بنفسجي يحول الوحوش دجاج.<br>
        🪧 اترك لوحات ورسايل بقوارير للاعبين الثانين.<br>
        👥 اللي بنفس العالم يشوفون بعض، يسولفون، يتصافحون، ويهدون بعض.</p></details>
      <p class="muted small">اللعبة تنحفظ بجوالك تلقائيًا. الاتصال عن طريق سيرفر عام مجاني.</p>
    </div>`;
    const sel = (attr, fn) => el.querySelectorAll(`[${attr}]`).forEach(b => b.onclick = () => { el.querySelectorAll(`[${attr}]`).forEach(x => x.classList.remove('on')); b.classList.add('on'); fn(b.getAttribute(attr)); });
    sel('data-c', c => { this.color = c; $('#prev').innerHTML = avatarHTML(this.color, this.hat, 80); });
    sel('data-h', h => { this.hat = h; $('#prev').innerHTML = avatarHTML(this.color, this.hat, 80); });
    sel('data-w', w => {
      if (w === 'private') { const code = prompt('اكتب كود العالم الخاص (أو خله فاضي عشان نسوي واحد جديد):', /^(w1|w2|w3)$/.test(this.world) ? '' : this.world); if (code === null) return; w = (code.trim().toLowerCase().replace(/[^a-z0-9]/g, '') || 'p' + Math.random().toString(36).slice(2, 8)).slice(0, 16); $('[data-w="private"]').textContent = '🔒 خاص: ' + w; }
      this.world = w;
    });
    if ($('#newc')) $('#newc').onclick = () => { if (confirm('شخصية جديدة بتمسح القديمة. متأكد؟')) { $('#create').hidden = false; $('#cont').remove(); $('#newc').remove(); } };
    if ($('#cont')) $('#cont').onclick = () => { save.world = this.world; this.launch(save); };
    $('#go').onclick = () => {
      const n = cleanText($('#nm').value, 16);
      if (!n || n.includes('🙊')) { $('#nm').focus(); $('#nm').placeholder = 'اكتب اسم حلو 🙏'; $('#nm').value = ''; return; }
      const s = newSave(n, this.color, this.hat); s.world = this.world;
      this.launch(s, true);
    };
  },
  launch(save, fresh) {
    Snd.init();
    $('#start').hidden = true;
    if (!/^(w1|w2|w3)$/.test(save.world)) location.hash = 'w=' + save.world;
    startGame(save);
    saveGame();
    if (fresh) setTimeout(() => { UI.banner('أهلًا بأرض العجايب ✨', 'كلّم أم سعيد 👵 اللي فوق راسها ❗'); }, 600);
    else UI.banner(`هلا والله ${save.name} 👋`, 'كمّل مغامرتك');
  }
};

/* ============ ربط الأزرار ============ */
function bindUI() {
  $('#panel').addEventListener('click', e => {
    if (e.target.id === 'panel') return UI.close();
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const f = ACT[b.dataset.act];
    if (f) { Snd.init(); f(b.dataset.v); }
  });
  $('#pclose').onclick = () => UI.close();
  const m = (id, fn) => $(id).addEventListener('click', () => { Snd.init(); UI.isOpen() && UI.cur !== 'panel' ? UI.close() : null; fn(); });
  m('#bBag', () => UI.openBag()); m('#bQuest', () => UI.openQuests()); m('#bMap', () => UI.openMap());
  m('#bChat', () => UI.openChat()); m('#bPlayers', () => UI.openPlayers()); m('#bSet', () => UI.openSettings());
  $('#mini').addEventListener('click', () => UI.openMap());
}

window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    try { initEngine(); } catch (e) { $('#start').hidden = false; $('#start').innerHTML = `<div class="st"><p>صار خطأ وقت تحميل العالم 😢</p><pre>${esc(e.stack || e)}</pre></div>`; throw e; }
    bindUI();
    Start.show();
  }, 30);
});
