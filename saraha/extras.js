'use strict';
/*
  إضافات صراحة:
  • الإعدادات الاختيارية (Firebase للجلسات الطويلة، والذكاء الاصطناعي لإعادة الصياغة). لو ما تفعّلت ما يتغير شي.
  • الأصوات والاهتزاز، كود QR، شاشة العرض للتلفزيون، صور النتائج.
  • المظهر (فاتح/داكن)، البحث والمفضلة، المواسم، والتثبيت كتطبيق.
  الملف يتحمّل قبل app.js، والدوال هنا تستخدم أدوات app.js وقت التشغيل بس.
*/

/* ============ الإعدادات الاختيارية ============ */
const CONF = (() => {
  const c = window.SARAHA_CONFIG || {};
  const ok = u => /^https:\/\/[^\s]+$/.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/[^\s]*)?$/.test(u) ? u : '';
  const pick = (k, v) => {
    let x = '';
    try { x = localStorage.getItem('saraha.' + k) || ''; } catch {}
    return ok(String(x || v || '').trim().replace(/\/+$/, ''));
  };
  return { fb: pick('fb', c.firebaseUrl), ai: pick('ai', c.aiUrl) };
})();
const isFb = topic => typeof topic === 'string' && topic.startsWith('fb_');
const keepText = () => CONF.fb ? 'والجلسات تبقى محفوظة' : `والجلسات تبقى ${KEEP_HOURS} ساعة`;

/* ============ النقل عبر Firebase (اختياري) ============ */
// كل جلسة = مسار /t/<topic> وكل رسالة = عنصر جديد فيه. الرسائل نفسها مشفرة مثل ntfy بالضبط.
const FbRelay = {
  url: topic => `${CONF.fb}/t/${topic}.json`,
  async post(topic, env) {
    if (!CONF.fb) throw Object.assign(new Error('firebase off'), { fatal: true });
    const message = JSON.stringify(env);
    let wait = 1500;
    for (let i = 0; i < 4; i++) {
      try {
        const r = await fetch(FbRelay.url(topic), { method: 'POST', body: JSON.stringify({ m: message, t: { '.sv': 'timestamp' } }) });
        if (r.ok) {
          const j = await r.json();
          if (j && typeof j.name === 'string') return { id: j.name, time: Math.floor(Date.now() / 1000), event: 'message', message };
        }
        if (r.status !== 429 && r.status < 500) throw Object.assign(new Error('HTTP ' + r.status), { fatal: true });
      } catch (e) { if (e.fatal) throw e; }
      await sleep(wait); wait *= 2;
    }
    throw new Error('network');
  },
  subscribe(topic, onMsg, onStatus) {
    let es = null, timer = null, closed = false, tries = 0;
    const seen = new Set();
    const emit = (id, v) => {
      if (!v || typeof v.m !== 'string' || seen.has(id)) return;
      seen.add(id);
      onMsg({ id, time: Math.floor((+v.t || Date.now()) / 1000), event: 'message', message: v.m });
    };
    const onData = e => {
      let d; try { d = JSON.parse(e.data); } catch { return; }
      if (!d || typeof d.path !== 'string') return;
      const parts = d.path.split('/').filter(Boolean);
      if (!parts.length) { if (d.data && typeof d.data === 'object') Object.keys(d.data).sort().forEach(k => emit(k, d.data[k])); }
      else if (parts.length === 1) emit(parts[0], d.data);
    };
    const connect = () => {
      if (closed || !CONF.fb) return;
      clearTimeout(timer);
      try { es && es.close(); } catch {}
      es = new EventSource(FbRelay.url(topic));
      es.onopen = () => { tries = 0; onStatus(true); };
      es.addEventListener('put', onData);
      es.addEventListener('patch', onData);
      es.addEventListener('cancel', () => { onStatus(false); try { es.close(); } catch {} });
      es.onerror = () => {
        onStatus(false);
        if (es.readyState === 2) timer = setTimeout(connect, Math.min(30000, 2000 * 2 ** tries++));
      };
    };
    const wake = () => { if (!closed && document.visibilityState === 'visible' && (!es || es.readyState === 2)) connect(); };
    document.addEventListener('visibilitychange', wake);
    addEventListener('online', wake);
    connect();
    return () => {
      closed = true; clearTimeout(timer);
      try { es && es.close(); } catch {}
      document.removeEventListener('visibilitychange', wake);
      removeEventListener('online', wake);
    };
  }
};

/* ============ إعادة الصياغة بالذكاء الاصطناعي (اختياري) ============ */
const AI = {
  ready: () => !!CONF.ai,
  on: my => !!(CONF.ai && my && my.cfg && my.cfg.ai),
  // يرجّع النص الجديد، أو null لو ما ضبط (ووقتها يُستخدم التصحيح العادي)
  async rewrite(text, ms = 9000) {
    if (!CONF.ai) return null;
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(CONF.ai, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: ctl.signal });
      if (!r.ok) return null;
      const j = await r.json();
      const out = j && typeof j.text === 'string' ? j.text.trim() : '';
      return out.length >= 2 && !Polish.isRude(out) ? out : null;
    } catch { return null; }
    finally { clearTimeout(t); }
  }
};

/* ============ الأصوات والاهتزاز ============ */
const Sound = {
  ctx: null,
  on: () => store.kv('sound') !== '0',
  vib: () => store.kv('vibe') !== '0',
  tones: {
    pop: [[660, .07]], tick: [[1000, .04]], ok: [[660, .1], [990, .2]], bad: [[330, .15], [220, .28]],
    alarm: [[880, .14], [660, .14], [880, .14], [660, .32]], reveal: [[523, .09], [659, .09], [784, .09], [1047, .32]],
    win: [[523, .1], [659, .1], [784, .1], [1047, .12], [784, .08], [1047, .42]], roll: [[300, .03], [420, .03], [360, .03], [480, .03], [560, .09]]
  },
  buzz: { pop: 15, ok: [30, 40, 30], bad: [90, 50, 90], alarm: [200, 100, 200, 100, 300], reveal: 40, win: [60, 40, 60, 40, 140], roll: 20 },
  unlock() {
    try {
      if (!Sound.ctx) { const A = window.AudioContext || window.webkitAudioContext; if (A) Sound.ctx = new A(); }
      if (Sound.ctx && Sound.ctx.state === 'suspended') Sound.ctx.resume();
    } catch {}
  },
  play(name) {
    try { if (Sound.vib() && navigator.vibrate && Sound.buzz[name]) navigator.vibrate(Sound.buzz[name]); } catch {}
    if (!Sound.on() || !Sound.tones[name]) return;
    try {
      Sound.unlock();
      const c = Sound.ctx; if (!c) return;
      let t = c.currentTime + 0.01;
      for (const [f, d] of Sound.tones[name]) {
        const o = c.createOscillator(), g = c.createGain();
        o.type = name === 'bad' ? 'square' : 'triangle';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(name === 'bad' ? 0.06 : 0.16, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g); g.connect(c.destination);
        o.start(t); o.stop(t + d + 0.03);
        t += d * 0.92;
      }
    } catch {}
  }
};
addEventListener('pointerdown', () => { if (Sound.on()) Sound.unlock(); }, { once: true, capture: true });

/* ============ كود QR ============ */
function qrSvg(text) {
  try {
    const q = qrcode(0, 'M');
    q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch (e) { console.error(e); return ''; }
}
function qrSheet(link, title, hint) {
  const { m, close } = openSheet(`<h3>📱 ${title}</h3><p class="muted small">${hint || 'خلّهم يصوّرون الكود بكاميرا الجوال ويدخلون على طول.'}</p>
    <div class="qrbig">${qrSvg(link)}</div>
    <div class="row"><button class="btn grow" id="qrCp">نسخ الرابط</button><button class="btn ghost grow" id="qrX">إغلاق</button></div>`);
  $('#qrCp', m).onclick = () => copyText(link);
  $('#qrX', m).onclick = close;
}

/* ============ شاشة العرض (تلفزيون أو لابتوب) ============ */
const tvLink = (my = S) => `${baseUrl()}#tv=${my.topic}.${my.key}`;
const tvOk = my => !!(my && my.M && !['board', 'santa', 'offline'].includes(my.M.kind) && my.mode !== 'santa');
function tvSheet(my) {
  const link = tvLink(my);
  const { m, close } = openSheet(`<h3>📺 شاشة العرض</h3>
    <p class="muted">افتح هذا الرابط على التلفزيون أو اللابتوب اللي على الشاشة. يطلع فيها كود QR للدخول، والأسئلة والنتائج بخط كبير يشوفه الكل.</p>
    <p class="muted small">شاشة العرض ما تشارك ولا تشوف أي شي سري، تعرض بس اللي يشوفه أي مشارك.</p>
    <div class="linkbox" dir="ltr" style="margin-top:10px">${esc(link)}</div>
    <div class="row multi"><button class="btn" id="tvCp">نسخ الرابط</button><a class="btn" id="tvOpen" href="${esc(link)}" target="_blank" rel="noopener">فتح في تبويب جديد</a>
    <a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('📺 شاشة العرض: ' + link)}">واتساب</a></div>
    <button class="btn ghost big" id="tvX">إغلاق</button>`);
  $('#tvCp', m).onclick = () => copyText(link);
  $('#tvX', m).onclick = close;
}

const TV = {
  topic: null,
  render() {
    const my = S;
    document.title = `📺 ${my.setup.title} · صراحة`;
    app.innerHTML = `<div class="tvgrid">
      <div class="tvmain"><div class="tvtitle">${my.M.icon} ${esc(my.setup.title)}</div>${my.setup.title !== my.M.name ? `<div class="mchip">${esc(my.M.name)}</div>` : ''}<div id="tvarea"></div></div>
      <aside class="tvside"><div class="qrbig">${qrSvg(inviteLink(my))}</div><b>صوّر الكود وادخل 📱</b>
        <div class="live"><span class="dot" id="dot"></span><span id="conn">يتصل…</span></div><div id="tvcount" class="muted"></div>
        <button class="btn ghost sm" id="tvFull">⛶ ملء الشاشة</button></aside>
    </div>`;
    $('#tvFull').onclick = () => { try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); } catch {} };
    my.tvkey = null;
    TV.update();
  },
  key(my) {
    const st = my.state;
    return [st ? `${st.s}.${st.i ?? ''}.${st.r ?? ''}` : 'lobby', my.qs ? 'q' : '', my.M.kind === 'movie' && !st ? (my.sugg || []).length : '',
      my.M.kind === 'story' ? (my.lines || []).length : ''].join('|');
  },
  update() {
    const my = S;
    if (!my || !my.tv || my.phase !== 'open' || !$('#tvarea')) return;
    const c = $('#tvcount');
    if (c) c.innerHTML = TV.countText(my);
    TV.tick();
    const k = TV.key(my);
    if (k === my.tvkey) return;
    const first = my.tvkey === null;
    my.tvkey = k;
    TV.draw(my, first);
  },
  countText(my) {
    const K = my.M.kind;
    if (['quiz', 'abc', 'funny', 'guess', 'auction'].includes(K)) return '';
    if (K === 'movie') return `<b>${(my.sugg || []).length}</b> اقتراح`;
    if (K === 'story') return `<b>${(my.lines || []).length}</b> جملة`;
    return `وصل <b>${my.msgs.length}</b> ${my.M.unit || 'مشاركة'}`;
  },
  timer(total, since) {
    clearInterval(quizTimer);
    const tick = () => { const b = $('#qbar'); if (!b) return clearInterval(quizTimer); b.style.width = Math.max(0, 1 - (Date.now() - since) / total) * 100 + '%'; };
    tick(); quizTimer = setInterval(tick, 200);
  },
  lobby(icon, title, text) {
    return `<div class="card center tvlobby"><div class="big-ic">${icon}</div><h3>${title}</h3>${text ? `<p class="muted">${text}</p>` : ''}</div>`;
  },
  draw(my, first) {
    clearInterval(quizTimer);
    const A = $('#tvarea'), st = my.state, K = my.M.kind;
    const sound = s => { if (!first) Sound.play(s); };
    const join = 'صوّروا الكود وادخلوا بأسمائكم، ولما تجهزون المشرف يبدأ.';
    let h = '', timer = null;
    if (K === 'quiz') {
      if (my.M.fromFacts && !my.qs) h = TV.lobby('🧠', 'المرحلة الأولى: المعلومات', 'كل واحد يكتب معلومات عن نفسه من جواله، وبعدها تبدأ المسابقة.');
      else if (!st) h = TV.lobby('🎮', 'جاهزين؟', join);
      else if (st.s === 'ask') {
        const q = Quiz.qs(my)[st.i];
        h = Quiz.qCard(my, st.i, `<div class="qbar"><i id="qbar"></i></div>${q.opts.map((o, k) => `<div class="qopt" style="--c:${QCOL[k]}"><span>${QSYM[k]}</span>${esc(o)}</div>`).join('')}`);
        timer = QTIME; sound('pop');
      } else if (st.s === 'show') { h = Quiz.showHtml(my, st); sound('reveal'); }
    } else if (K === 'abc') {
      if (!st) h = TV.lobby('🔤', 'جاهزين؟', `${join}<br>الخانات: ${my.cfg.cats.map(esc).join('، ')}`);
      else if (st.s === 'ask') { h = `<div class="card center">${Abc.bigLetter(st.r, st.l)}<div class="qbar"><i id="qbar"></i></div><div class="chips" style="justify-content:center">${my.cfg.cats.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</div></div>`; timer = ABC_TIME; sound('pop'); }
      else if (st.s === 'stop') { h = `<div class="card center">${Abc.bigLetter(st.r, st.l)}<h3>⏹️ انتهت الجولة</h3><p class="muted">المشرف يصحّح الأجوبة…</p></div>`; sound('alarm'); }
      else if (st.s === 'show') { h = Abc.showHtml(my, st); sound('reveal'); }
    } else if (K === 'funny') {
      if (!st) h = TV.lobby('😂', 'جاهزين؟', join);
      else if (st.s === 'ask') { h = Funny.qCard(my, st.i, '<p class="muted center">✍️ كمّلوا الجملة من جوالاتكم… بدون أسماء</p>'); sound('pop'); }
      else if (st.s === 'vote') { h = Funny.qCard(my, st.i, `${st.opts.map(o => `<div class="msg">${esc(o.text)}</div>`).join('')}<p class="muted center">🗳️ صوّتوا لأضحك جواب من جوالاتكم</p>`); sound('pop'); }
      else if (st.s === 'show') { h = Funny.showHtml(my, st); sound('reveal'); }
    } else if (K === 'guess') {
      if (!st) h = TV.lobby('🎯', 'جاهزين؟', join);
      else if (st.s === 'ask') { h = Guess.qCard(my, st.i, '<p class="muted center">🎯 خمّنوا الرقم من جوالاتكم</p>'); sound('pop'); }
      else if (st.s === 'show') { h = Guess.showHtml(my, st); sound('reveal'); }
    } else if (K === 'auction') {
      if (!st) h = TV.lobby('🔨', 'جاهزين؟', `كل واحد معه ${BUDGET} ريال وهمي. ${join}`);
      else if (st.s === 'ask') { h = Auction.itemCard(my, st.i, '<p class="muted">🔨 زايدوا بالسر من جوالاتكم</p>'); sound('pop'); }
      else if (st.s === 'show') { h = Auction.showHtml(my, st); sound('reveal'); }
    } else if (K === 'movie') {
      if (!st) h = `${TV.lobby('🍿', 'اقترحوا من جوالاتكم', 'فيلم، مسلسل، مطعم، أو أي خيار. بعدين نصوّت.')}<section class="card"><h3>📋 الاقتراحات</h3>${Movie.suggHtml(my)}</section>`;
      else if (st.s === 'round') {
        h = `<div class="card"><div class="qhead">الجولة ${st.r + 1} · باقي ${st.alive.length}</div>${st.out && st.out.length ? `<p class="muted">طلع: ${st.out.map(esc).join('، ')}</p>` : ''}
          ${st.alive.map(t => `<div class="brow"><span>🎬 ${esc(t)}</span></div>`).join('')}<p class="muted center">🗳️ صوّتوا من جوالاتكم</p></div>`;
        sound('pop');
      }
    } else if (K === 'story') {
      const last = (my.lines || [])[my.lines ? my.lines.length - 1 : 0];
      h = `<div class="card"><small class="pink">${last ? 'آخر جملة' : 'بداية القصة'}</small><div class="prompt">${esc(last ? last.text : my.cfg.prompt)}</div>
        <p class="muted center" style="margin-top:12px">✍️ كمّلوا القصة من جوالاتكم، والقصة كاملة تنكشف في الأخير</p></div>`;
      if (last) sound('pop');
    } else {
      h = `${TV.lobby(my.M.icon, my.M.name, 'صوّروا الكود وشاركوا من جوالاتكم 🤫')}${my.cfg.prompt ? `<div class="prompt">${esc(my.cfg.prompt)}</div>` : ''}
        <div class="card center"><div class="tvbig" id="tvn">${my.msgs.length}</div><p class="muted">${my.M.unit || 'مشاركة'} وصلت لين الحين</p></div>`;
    }
    A.innerHTML = h || TV.lobby('⏳', 'لحظة…', '');
    if (timer) {
      my.tvSeen = my.tvSeen || {};
      const k = my.tvkey;
      if (!my.tvSeen[k]) my.tvSeen[k] = Date.now();
      TV.timer(timer, my.tvSeen[k]);
    }
  },
  tick() { const n = $('#tvn'); if (n && S) n.textContent = S.msgs.length; }
};

/* ============ صور النتائج ============ */
function resultTexts(my) {
  const R = my.results, M = my.M, cfg = my.cfg || {};
  if (!R) return null;
  const board = b => (b || []).slice(0, 12).map(([n, s], k) => `${medal(k)} ${n}: ${s}`).join('\n');
  if (my.mode === 'santa') return R.pairs && R.pairs.length ? R.pairs.map(([a, b]) => `🎁 ${a} ← ${b}`) : null;
  if (Array.isArray(R.board)) return R.board.length ? [board(R.board)] : null;
  if (M.reveal === 'votes' && R.voters) return cfg.questions.map((q, qi) => {
    const c = R.tally[qi], total = c.reduce((a, b) => a + b, 0), opts = optsOf(q, cfg);
    const top = opts.map((o, i) => [o, c[i]]).filter(x => x[1]).sort((a, b) => b[1] - a[1]).slice(0, 3);
    return `${qText(q, my.mode)}\n${top.length ? top.map(([o, n], k) => `${k ? '▫️' : '👑'} ${o} (${Math.round(n * 100 / total)}%)`).join('\n') : 'محد صوّت'}`;
  });
  if (M.reveal === 'rank' && R.voters) return cfg.questions.map((q, qi) => `${q.q}\n${R.tally[qi].slice(0, 5).map(([ni], k) => `${medal(k)} ${cfg.names[ni]}`).join('\n') || 'محد رتّب'}`);
  if (M.reveal === 'know' && R.players && R.players.length) return [`مين يعرف ${cfg.subject} أكثر؟\n` + R.players.slice(0, 12).map((p, k) => `${medal(k)} ${p.by}: ${p.score} من ${cfg.questions.length}`).join('\n')];
  if (Array.isArray(R.owned) && R.owned.length) return R.owned.slice(0, 12).map(([n, items, left]) => `${n}: ${items.length ? items.join('، ') : 'ما اشترى شي'} (💰 ${left})`);
  if (typeof R.winner === 'string' && R.winner) return [`🎬 ${R.winner}`];
  if (my.mode === 'when' && Number.isInteger(R.pick) && cfg.days) return [`📅 ${fmtDay(cfg.days[R.pick])}`];
  if (Array.isArray(R.lines)) return [cfg.prompt, ...R.lines].filter(Boolean);
  if (M.reveal === 'list' && R.items && R.items.length) return R.items.map(x => x.text);
  return null;
}
function addResultImage() {
  const my = S;
  if (!my || !my.results || $('#resImg')) return;
  const texts = resultTexts(my);
  if (!texts || !texts.length) return;
  const anchors = $$('#app a.btn.primary.big[href="#"]'), at = anchors[anchors.length - 1];
  const b = document.createElement('button');
  b.className = 'btn big'; b.id = 'resImg'; b.textContent = '📸 شارك النتيجة كصورة';
  at ? at.before(b) : app.appendChild(b);
  b.onclick = async () => {
    b.disabled = true;
    try {
      const R = my.results, M = my.M;
      const blob = await cardImage(`${M.icon} ${R.title}`, R.title === M.name ? 'النتيجة' : M.name, resultTexts(my));
      await shareImage(blob, `${R.title}.png`);
    } catch (e) { console.error(e); toast('ما قدرنا نسوي الصورة', true); }
    finally { b.disabled = false; }
  };
}

/* ============ المظهر ============ */
const Theme = {
  get: () => store.kv('theme') || 'dark',
  resolve: t => t === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t,
  apply() {
    const t = Theme.resolve(Theme.get());
    document.documentElement.dataset.theme = t;
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = t === 'light' ? '#f6f3ff' : '#0f0c1a';
  },
  set(t) { store.kv('theme', t); Theme.apply(); }
};
try { matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (Theme.get() === 'auto') Theme.apply(); }); } catch {}

/* ============ المفضلة والبحث ============ */
const Favs = {
  list() { try { const a = JSON.parse(store.kv('favs')); return Array.isArray(a) ? a.filter(id => MODES[id]) : []; } catch { return []; } },
  has: id => Favs.list().includes(id),
  toggle(id) {
    const l = Favs.list(), i = l.indexOf(id);
    i >= 0 ? l.splice(i, 1) : l.unshift(id);
    store.kv('favs', JSON.stringify(l));
    return i < 0;
  }
};
const normAr = s => String(s || '').toLowerCase().normalize('NFKC').replace(/[ً-ٰٟـ]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
const SEARCH_EXTRA = { quiz: 'رمضان العيد اليوم الوطني يوم التأسيس مسابقة', tod: 'رمضان', daily: 'رمضان', wheel: 'العيد عيديات', deep: 'سوالف' };
const modeHay = (id, M) => normAr([M.name, M.tag, M.desc, (GROUPS.find(g => g.id === M.group) || {}).title, id,
  M.kind === 'offline' ? 'بدون نت اوفلاين' : 'كل واحد من جواله', SEARCH_EXTRA[id] || ''].join(' '));
// الألعاب اللي فيها كتابة حرة تمر على المصحح (وتقدر تمر على الذكاء الاصطناعي لو تفعّل)
const aiable = M => !['vote', 'know', 'rank', 'santa', 'offline', 'board'].includes(M.kind) && !(KINDS[M.kind] && KINDS[M.kind].open) && M.fields !== 'three';

/* ============ المواسم ============ */
const Season = {
  hijri(d = new Date()) {
    try {
      const p = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { month: 'numeric', day: 'numeric' }).formatToParts(d);
      return { m: +p.find(x => x.type === 'month').value, d: +p.find(x => x.type === 'day').value };
    } catch { return { m: 0, d: 0 }; }
  },
  current(now = new Date()) {
    const h = Season.hijri(now), gm = now.getMonth() + 1, gd = now.getDate();
    if (h.m === 9) return { icon: '🌙', title: 'رمضان كريم', text: 'جرّبوا «سؤال اليوم» بأسئلة رمضان، وأسئلة رمضانية في «سباق الأسئلة» و«صراحة ولا جرأة».', href: '#new/daily' };
    if ((h.m === 10 && h.d <= 5) || (h.m === 12 && h.d >= 9 && h.d <= 14)) return { icon: '🎉', title: 'عيدكم مبارك', text: 'جمعة العيد تحلى بـ«سباق الأسئلة» (باقة رمضان والعيد) و«عجلة الحظ» للعيديات.', href: '#new/quiz' };
    if (gm === 9 && gd >= 15) return { icon: '🇸🇦', title: 'اليوم الوطني', text: 'جرّبوا باقة «اليوم الوطني السعودي» في سباق الأسئلة.', href: '#new/quiz' };
    if (gm === 2 && gd >= 15 && gd <= 23) return { icon: '🇸🇦', title: 'يوم التأسيس', text: 'جرّبوا باقة «اليوم الوطني السعودي» في سباق الأسئلة.', href: '#new/quiz' };
    return null;
  }
};

/* ============ التثبيت كتطبيق ============ */
const Install = {
  evt: null,
  standalone: () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
  ios: () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  async prompt() {
    if (Install.evt) {
      Install.evt.prompt();
      try { await Install.evt.userChoice; } catch {}
      Install.evt = null;
      return true;
    }
    return false;
  }
};
addEventListener('beforeinstallprompt', e => { e.preventDefault(); Install.evt = e; const b = $('#instBtn'); if (b) b.hidden = false; });
addEventListener('appinstalled', () => { Install.evt = null; toast('تم التثبيت ✓'); });
if ('serviceWorker' in navigator && /^https:|^http:\/\/localhost/.test(location.href) && !localStorage.getItem('saraha.nosw')) {
  addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}

/* ============ الإعدادات ============ */
function viewSettings() {
  document.title = 'الإعدادات · صراحة';
  const th = Theme.get(), standalone = Install.standalone();
  const opt = (id, v, label) => `<button class="chip${th === v ? ' on' : ''}" data-th="${v}">${label}</button>`;
  const sw = (id, on, label, hint) => `<label class="qrow"><input type="checkbox" id="${id}"${on ? ' checked' : ''}><span>${label}${hint ? `<br><small class="muted">${hint}</small>` : ''}</span></label>`;
  app.innerHTML = `${backLink()}
    <header class="mhead"><div class="big-ic">⚙️</div><h2 class="ttl">الإعدادات</h2></header>
    <section class="card"><h3>🎨 المظهر</h3><div class="chips" id="th">${opt('', 'dark', '🌙 داكن')}${opt('', 'light', '☀️ فاتح')}${opt('', 'auto', '🌓 حسب الجوال')}</div></section>
    <section class="card"><h3>🔊 الأصوات</h3>
      ${sw('snd', Sound.on(), 'أصوات الألعاب', 'نهاية الوقت، الإجابة الصح والغلط، الكشف، العجلة والنرد')}
      ${sw('vib', Sound.vib(), 'الاهتزاز', 'يشتغل على أغلب جوالات أندرويد. الآيفون ما يدعمه من المتصفح.')}
      <button class="btn ghost" id="sndTest" style="margin-top:10px">🔔 جرّب الصوت</button></section>
    <section class="card"><h3>📲 التطبيق</h3>
      ${standalone ? '<p class="muted">✓ صراحة مثبّتة كتطبيق على هذا الجهاز.</p>'
        : `<p class="muted">ثبّتها على الشاشة الرئيسية وتفتح مثل التطبيق، وألعاب «جوال واحد» تشتغل حتى بدون نت.</p>
          <button class="btn primary big" id="instBtn"${Install.evt ? '' : ' hidden'}>📲 ثبّتها كتطبيق</button>
          <div class="hint" id="instHelp">${Install.ios()
            ? 'على الآيفون: افتح الصفحة في سفاري، اضغط زر المشاركة <b>⬆️</b>، وبعدين «إضافة إلى الشاشة الرئيسية».'
            : 'لو ما طلع زر التثبيت: افتح قائمة المتصفح <b>⋮</b> واختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».'}</div>`}
    </section>
    <section class="card"><h3>🧩 الإضافات الاختيارية</h3>
      <p>${CONF.fb ? '🟢' : '⚪️'} <b>الجلسات الطويلة</b>: ${CONF.fb ? 'مفعّلة. الجلسات الجديدة تبقى محفوظة أكثر من 12 ساعة.' : `غير مفعّلة. الجلسات تبقى ${KEEP_HOURS} ساعة.`}</p>
      <p style="margin-top:8px">${CONF.ai ? '🟢' : '⚪️'} <b>إعادة الصياغة بالذكاء الاصطناعي</b>: ${CONF.ai ? 'متوفرة. المشرف يقدر يفعّلها وقت إنشاء الجلسة.' : 'غير مفعّلة. الكتابات تتصحح بالمصحح العادي داخل الجوال.'}</p>
      <p class="muted small" style="margin-top:8px">صاحب الموقع يفعّلها من ملف config.js، والخطوات في SETUP.md.</p>
    </section>
    <section class="card"><h3>🗂️ بياناتك</h3><p class="muted small">جلساتك ومفضلتك محفوظة في هذا المتصفح بس.</p>
      <button class="btn ghost" id="clrFav" style="margin-top:8px">مسح المفضلة</button></section>`;
  $('#th').onclick = e => {
    const b = e.target.closest('[data-th]'); if (!b) return;
    Theme.set(b.dataset.th);
    $$('#th .chip').forEach(c => c.classList.toggle('on', c === b));
  };
  $('#snd').onchange = e => { store.kv('sound', e.target.checked ? '1' : '0'); if (e.target.checked) Sound.play('ok'); };
  $('#vib').onchange = e => { store.kv('vibe', e.target.checked ? '1' : '0'); if (e.target.checked) Sound.play('pop'); };
  $('#sndTest').onclick = () => Sound.play('win');
  const ib = $('#instBtn');
  if (ib) ib.onclick = async () => { if (!(await Install.prompt())) toast('استخدم قائمة المتصفح للتثبيت', true); ib.hidden = !Install.evt; };
  $('#clrFav').onclick = () => { store.kv('favs', '[]'); toast('تم مسح المفضلة'); };
}
