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
  SlideSync.set(my, true); // لما يعرض المشرف النتائج شريحة شريحة، الشاشة تمشي معه
  const { m, close } = openSheet(`<h3>📺 شاشة العرض</h3>
    <p class="muted">افتح هذا الرابط على التلفزيون أو اللابتوب اللي على الشاشة. يطلع فيها كود QR للدخول، والأسئلة والنتائج بخط كبير يشوفه الكل.</p>
    <p class="muted small">شاشة العرض ما تشارك ولا تشوف أي شي سري، تعرض بس اللي يشوفه أي مشارك. ولما تعرض النتائج شريحة شريحة من جوالك، الشاشة تمشي معك.</p>
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
    ${backupCard()}
    <section class="card"><h3>🗂️ بياناتك</h3><p class="muted small">جلساتك ومفضلتك وباقاتك محفوظة في هذا المتصفح بس.</p>
      <div class="row multi"><a class="btn" href="#champs">🏆 سجل الأبطال</a><button class="btn ghost" id="clrFav">مسح المفضلة</button></div></section>`;
  bindBackup();
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

/* ============ شاشة العرض تمشي مع المشرف ============ */
// المشرف لما يعرض النتائج شريحة شريحة، يرسل رقم الشريحة (مشفر بمفتاح الجلسة) وشاشة العرض تعرض نفسها
const SlideSync = {
  on: my => !!my && store.kv('tvsync.' + my.topic) === '1',
  set: (my, on) => store.kv('tvsync.' + my.topic, on ? '1' : '0')
};
TV.follow = async my => {
  if (!my.tv || !my.reveal) return;
  let last = null;
  for (const r of my.raws) if (r.env.k === 'v' && r.idx > my.reveal.idx && (!last || r.idx > last.idx)) last = r;
  if (!last || last.id === my.vlast) return;
  my.vlast = last.id;
  const x = await roomOpen(my, last);
  if (S !== my || !x || typeof x !== 'object' || Date.now() - (+x.at || 0) > 6 * 3600e3) return;
  if (!x.open) { if (my.follow) { my.follow.close(); my.follow = null; } return; }
  if (!my.slides) return;
  const f = typeof x.f === 'string' ? x.f.slice(0, NAME_LEN) : '';
  if (!my.follow || my.followF !== f || !document.body.contains(my.follow.el)) {
    if (my.follow) my.follow.close();
    const sl = my.slides(f);
    if (!sl || !sl.length) return;
    my.follow = present(sl, null, true); my.followF = f;
  }
  my.follow.go(+x.i || 0, !!x.shown);
};

/* ============ سجل أبطال الشلة ============ */
// من نتائج الجلسات المحفوظة في هذا الجوال
function champData() {
  const wins = [], seen = new Map();
  const add = (name, place, s) => {
    name = String(name || '').trim(); if (!name) return;
    const k = name;
    if (!seen.has(k)) seen.set(k, { name, wins: 0, pods: 0, games: 0 });
    const c = seen.get(k);
    c.games++; if (place < 3) c.pods++;
    if (place === 0) { c.wins++; wins.push({ name, mode: s.mode, title: s.title || (MODES[s.mode] || {}).name, at: s.results.at || s.created || 0 }); }
  };
  for (const s of store.list()) {
    const R = s.results; if (!R || !MODES[s.mode]) continue;
    if (Array.isArray(R.board) && R.board.length) {
      const b = R.board.filter(x => Array.isArray(x) && typeof x[0] === 'string'), top = b.length ? b[0][1] : 0;
      // المتعادلين بالمركز الأول كلهم فايزين
      let place = 0;
      b.forEach(([n, sc], k) => { if (k && sc < b[k - 1][1]) place = k; add(n, sc === top && top > 0 ? 0 : Math.max(1, place), s); });
    } else if (Array.isArray(R.owned) && R.owned.length) {
      const most = Math.max(...R.owned.map(o => o[1].length));
      R.owned.forEach(([n, items], k) => add(n, items.length === most && most > 0 ? 0 : k + 1, s));
    } else if (Array.isArray(R.players) && R.players.length) {
      const top = R.players[0].score;
      R.players.forEach((p, k) => add(p.by, p.score === top && top > 0 ? 0 : k + 1, s));
    }
  }
  const board = [...seen.values()].sort((a, b) => b.wins - a.wins || b.pods - a.pods || b.games - a.games);
  return { board, wins: wins.sort((a, b) => b.at - a.at) };
}
function viewChamps() {
  document.title = 'سجل الأبطال · صراحة';
  const { board, wins } = champData();
  app.innerHTML = `${backLink()}
    <header class="mhead"><div class="big-ic">🏆</div><h2 class="ttl">سجل أبطال الشلة</h2><p class="muted">من نتائج الألعاب اللي لعبتوها على هذا الجوال</p></header>
    ${board.length ? `${board.length >= 2 ? `<div class="podium">${[1, 0, 2].filter(k => board[k]).map(k => `<div class="pod p${k}"><div class="big-ic">${medal(k)}</div><b>${esc(board[k].name)}</b><small>${board[k].wins} فوز</small></div>`).join('')}</div>` : ''}
      <section class="card"><h3>📊 الترتيب</h3>${board.map((c, k) => `<div class="brow"><span>${medal(k)} <b>${esc(c.name)}</b></span><small class="muted">🥇 ${c.wins} · 🏅 ${c.pods} · 🎮 ${c.games}</small></div>`).join('')}
        <p class="hint">🥇 فوز · 🏅 من أول ثلاثة · 🎮 لعب</p></section>
      <section class="card"><h3>🕘 آخر الفايزين</h3>${wins.slice(0, 20).map(w => `<div class="brow"><span>🏆 ${esc(w.name)}</span><small class="muted">${(MODES[w.mode] || {}).icon || ''} ${esc(w.title)}${w.at ? ` · ${esc(fmtDay(isoDay(new Date(w.at)), { day: 'numeric', month: 'short' }))}` : ''}</small></div>`).join('') || '<p class="muted">ما فيه فايزين للحين</p>'}</section>
      <button class="btn big" id="chImg">📸 شارك السجل كصورة</button>`
    : `<div class="card center"><div class="big-ic">🎮</div><h3>ما فيه نتائج للحين</h3><p class="muted">العبوا «سباق الأسئلة» أو «اسم حيوان جماد» أو «أضحك جواب» أو «أقرب تخمين» أو «المزاد»، والفايزين يُسجَّلون هنا تلقائيًا.</p></div>`}
    <p class="fine">الأسماء تُجمع إذا كُتبت بنفس الطريقة في كل لعبة.</p>`;
  const b = $('#chImg');
  if (b) b.onclick = async () => {
    b.disabled = true;
    try { await shareImage(await cardImage('🏆 أبطال الشلة', 'سجل صراحة', [board.slice(0, 12).map((c, k) => `${medal(k)} ${c.name}: ${c.wins} فوز`).join('\n')]), 'أبطال الشلة.png'); }
    catch (e) { console.error(e); toast('ما قدرنا نسوي الصورة', true); }
    finally { b.disabled = false; }
  };
}

/* ============ نقل البيانات لجوال ثاني ============ */
const SKIP_KEYS = new Set(['saraha.server', 'saraha.fb', 'saraha.ai', 'saraha.nosw']);
async function pwKey(pw, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function saveFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('تم حفظ الملف ✓');
}
const Backup = {
  dump() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('saraha.') && !SKIP_KEYS.has(k)) data[k] = localStorage.getItem(k);
    }
    return data;
  },
  async make(pw) {
    const data = Backup.dump(), out = { app: 'saraha', v: 1, at: Date.now() };
    if (pw) {
      const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await pwKey(pw, salt), enc.encode(JSON.stringify(data)));
      out.enc = { salt: b64u(salt), iv: b64u(iv), ct: b64u(ct) };
    } else out.data = data;
    return new Blob([JSON.stringify(out)], { type: 'application/json' });
  },
  async read(text, pw) {
    let j; try { j = JSON.parse(text); } catch { throw new Error('bad'); }
    if (!j || j.app !== 'saraha') throw new Error('bad');
    if (j.enc) {
      if (!pw) throw new Error('pw');
      try {
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(j.enc.iv) }, await pwKey(pw, unb64u(j.enc.salt)), unb64u(j.enc.ct));
        return JSON.parse(dec.decode(pt));
      } catch { throw new Error('wrongpw'); }
    }
    if (!j.data || typeof j.data !== 'object') throw new Error('bad');
    return j.data;
  },
  // الدمج: الجلسات تُضاف للقائمة، والمفضلة والباقات تُدمج، والباقي يُحفظ لو مو موجود
  merge(data) {
    let n = 0;
    for (const [k, v] of Object.entries(data)) {
      if (typeof k !== 'string' || !k.startsWith('saraha.') || SKIP_KEYS.has(k) || typeof v !== 'string') continue;
      if (k === 'saraha.sessions') {
        let list = []; try { list = JSON.parse(v); } catch {}
        if (Array.isArray(list)) for (const rec of list.slice().reverse()) if (rec && typeof rec.topic === 'string') { store.upsert(rec); n++; }
      } else if (k === 'saraha.favs' || k === 'saraha.packs') {
        let a = [], b = [];
        try { a = JSON.parse(localStorage.getItem(k)) || []; b = JSON.parse(v) || []; } catch {}
        const key = x => k === 'saraha.packs' ? x && x.id : x;
        const have = new Set(a.map(key));
        localStorage.setItem(k, JSON.stringify([...a, ...b.filter(x => !have.has(key(x)))]));
      } else if (localStorage.getItem(k) === null) {
        try { localStorage.setItem(k, v); } catch {}
      }
    }
    return n;
  }
};
function backupCard() {
  return `<section class="card"><h3>📦 انقل بياناتك لجوال ثاني</h3>
    <p class="muted small">ملف فيه جلساتك (مع روابط المشرف)، ومفضلتك، وباقاتك، والقوائم المحفوظة. افتحه في الجوال الثاني من نفس الصفحة.</p>
    <label for="bpw">كلمة سر للملف (مستحسن)</label><input id="bpw" type="password" autocomplete="new-password" placeholder="لو تحطها، الملف ما ينفتح إلا فيها">
    <div class="row multi"><button class="btn primary" id="bExp">📤 حفظ الملف</button><button class="btn" id="bImp">📥 فتح ملف</button></div>
    <input type="file" id="bFile" accept=".json,application/json" hidden>
    <p class="hint">⚠️ الملف فيه روابط المشرف. لا ترسله لأحد، وحط له كلمة سر لو بتنقله عبر تطبيق.</p></section>`;
}
function bindBackup() {
  $('#bExp').onclick = async e => {
    const btn = e.currentTarget; btn.disabled = true;
    try { await saveFile(await Backup.make($('#bpw').value), `saraha-${isoDay(new Date())}.json`); }
    catch (err) { console.error(err); toast('ما قدرنا نسوي الملف', true); }
    finally { btn.disabled = false; }
  };
  $('#bImp').onclick = () => $('#bFile').click();
  $('#bFile').onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const n = Backup.merge(await Backup.read(await f.text(), $('#bpw').value));
      toast(`تم ✓ أُضيفت ${n} جلسة`);
    } catch (err) {
      toast(err.message === 'pw' ? 'الملف عليه كلمة سر، اكتبها فوق وافتحه مرة ثانية' : err.message === 'wrongpw' ? 'كلمة السر غلط' : 'الملف مو ملف صراحة', true);
    }
  };
}

/* ============ باقات الأسئلة الخاصة ============ */
const Packs = {
  all() { try { const a = JSON.parse(store.kv('packs')); return Array.isArray(a) ? a.filter(p => p && MODES[p.mode] && Array.isArray(p.items)) : []; } catch { return []; } },
  save(l) { store.kv('packs', JSON.stringify(l.slice(0, 80))); },
  of: mode => Packs.all().filter(p => p.mode === mode),
  // تنظيف الأسئلة حسب نوع اللعبة (للباقات اللي توصل برابط)
  clean(mode, items) {
    const Q = MODES[mode] && MODES[mode].form && MODES[mode].form.questions;
    if (!Q || !Array.isArray(items)) return [];
    const str = (x, n) => typeof x === 'string' && x.trim() ? x.trim().slice(0, n) : null;
    const out = [];
    for (const it of items.slice(0, 40)) {
      if (Q.kind === 'quiz') {
        if (!Array.isArray(it) || it.length !== 5) continue;
        const v = [str(it[0], Q_LEN), ...it.slice(1).map(x => str(x, OPT_LEN))];
        if (v.every(Boolean) && new Set(v.slice(1)).size === 4) out.push(v);
      } else if (Q.kind === 'pair') {
        if (!Array.isArray(it) || it.length !== 2) continue;
        const v = it.map(x => str(x, OPT_LEN)); if (v.every(Boolean)) out.push(v);
      } else if (Q.kind === 'guess') {
        if (Array.isArray(it) && str(it[0], Q_LEN) && Number.isFinite(it[1])) out.push([str(it[0], Q_LEN), it[1]]);
      } else { const v = str(it, Q_LEN); if (v) out.push(v); }
    }
    return out;
  },
  async encode(p) {
    const raw = enc.encode(JSON.stringify({ m: p.mode, n: p.name, q: p.items }));
    if (window.CompressionStream) {
      try { return 'z' + b64u(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()); } catch {}
    }
    return 'j' + b64u(raw);
  },
  async decode(s) {
    const bytes = unb64u(s.slice(1));
    const raw = s[0] === 'z' ? new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()) : bytes;
    const j = JSON.parse(dec.decode(raw));
    if (!j || !MODES[j.m]) throw new Error('bad');
    const items = Packs.clean(j.m, j.q);
    if (!items.length) throw new Error('bad');
    return { mode: j.m, name: (typeof j.n === 'string' && j.n.trim() ? j.n.trim() : 'باقة').slice(0, 30), items };
  }
};
const packBox = mode => `<details class="packbox" id="mypk"><summary>📦 باقاتك المحفوظة (<span id="pkn">${Packs.of(mode).length}</span>)</summary>
  <div id="pkList"></div>
  <div class="addrow" style="margin-top:10px"><input id="pkName" maxlength="30" placeholder="اسم الباقة (مثلًا: أسئلة شلة الجامعة)"><button class="btn" id="pkSave" type="button">💾 احفظ المختار</button></div>
  <p class="hint">تحفظ الأسئلة المختارة فوق كباقة في جوالك، وتقدر ترسلها لغيرك برابط.</p></details>`;
function bindPacks({ mode, get, set }) {
  const L = $('#pkList'); if (!L) return;
  const draw = () => {
    const list = Packs.of(mode);
    $('#pkn').textContent = list.length;
    L.innerHTML = list.length ? list.map(p => `<div class="pkrow"><button type="button" class="chip" data-use="${p.id}">${esc(p.name)} · ${p.items.length}</button>
      <button type="button" class="btn ghost sm" data-share="${p.id}">🔗 مشاركة</button><button type="button" class="x" data-pdel="${p.id}" aria-label="حذف">✕</button></div>`).join('')
      : '<p class="muted small">ما عندك باقات للحين. اختر أسئلتك فوق واحفظها.</p>';
  };
  L.onclick = async e => {
    const u = e.target.closest('[data-use]'), sh = e.target.closest('[data-share]'), d = e.target.closest('[data-pdel]');
    const id = (u || sh || d || {}).dataset;
    const p = id && Packs.all().find(x => x.id === (id.use || id.share || id.pdel));
    if (!p) return;
    if (u) {
      const cur = get(), keep = cur.filter(q => q.custom || (q.on && q.mine)), key = v => JSON.stringify(v);
      const have = new Set(keep.map(q => key(q.v)));
      let room = MAX_Q - keep.filter(q => q.on).length;
      const added = p.items.filter(v => !have.has(key(v))).map(v => ({ v, on: room-- > 0, custom: true, mine: true }));
      added.forEach(q => have.add(key(q.v)));
      set([...keep, ...added, ...cur.filter(q => !have.has(key(q.v))).map(q => ({ ...q, on: false }))]);
      toast(`تم اختيار أسئلة «${p.name}» ✓`);
    } else if (sh) {
      const link = `${baseUrl()}#pk=${await Packs.encode(p)}`;
      const { m, close } = openSheet(`<h3>🔗 شارك «${esc(p.name)}»</h3><p class="muted small">اللي يفتح الرابط يقدر يحفظ الباقة عنده ويلعب فيها.</p>
        ${link.length < 1500 ? `<div class="qrbig">${qrSvg(link)}</div>` : ''}
        <div class="row multi"><button class="btn" id="pkCp">نسخ الرابط</button><a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`📦 باقة أسئلة «${p.name}» لـ${MODES[mode].name}:\n${link}`)}">واتساب</a><button class="btn ghost" id="pkX">إغلاق</button></div>`);
      $('#pkCp', m).onclick = () => copyText(link);
      $('#pkX', m).onclick = close;
    } else if (d && confirm(`تحذف باقة «${p.name}»؟`)) { Packs.save(Packs.all().filter(x => x.id !== p.id)); draw(); }
  };
  $('#pkSave').onclick = () => {
    const items = get().filter(q => q.on).map(q => q.v);
    if (!items.length) return toast('اختر أسئلة أول', true);
    const name = ($('#pkName').value.trim() || `باقتي ${Packs.of(mode).length + 1}`).slice(0, 30);
    Packs.save([{ id: ID(), mode, name, items, at: Date.now() }, ...Packs.all()]);
    $('#pkName').value = ''; draw(); toast(`تم حفظ «${name}» ✓`);
  };
  draw();
}
async function viewPack(data) {
  let p;
  try { p = await Packs.decode(data); } catch { return brokenLink(); }
  const M = MODES[p.mode], Q = M.form.questions;
  const label = v => !Array.isArray(v) ? esc(v) : Q.kind === 'guess' ? `${esc(v[0])} <em>(${fmtNum(v[1])})</em>` : v.length > 2 ? `${esc(v[0])} <em>✅ ${esc(v[1])}</em>` : `${esc(v[0])} <em>ولا</em> ${esc(v[1])}`;
  document.title = `${p.name} · صراحة`;
  app.innerHTML = `${backLink()}<header class="mhead"><div class="big-ic">📦</div><h2 class="ttl">${esc(p.name)}</h2><p class="muted">باقة أسئلة لـ ${M.icon} ${M.name} · ${p.items.length} سؤال</p></header>
    <section class="card">${p.items.map(v => `<div class="brow"><span>${label(v)}</span></div>`).join('')}</section>
    <button class="btn primary big" id="pkPlay">▶️ احفظها وابدأ جلسة</button><button class="btn big" id="pkKeep">💾 احفظها بس</button>`;
  const keep = () => {
    const all = Packs.all(), k = JSON.stringify(p.items);
    if (!all.some(x => x.mode === p.mode && JSON.stringify(x.items) === k)) Packs.save([{ id: ID(), mode: p.mode, name: p.name, items: p.items, at: Date.now() }, ...all]);
  };
  $('#pkKeep').onclick = () => { keep(); toast('تم حفظ الباقة ✓ تلقاها وقت إنشاء الجلسة'); };
  $('#pkPlay').onclick = () => { keep(); store.kv('usepack', JSON.stringify({ mode: p.mode, items: p.items, name: p.name })); location.hash = 'new/' + p.mode; };
}

/* ============ الصور في الذكريات وصندوق الاقتراحات ============ */
// الصورة تُصغَّر في الجوال (وتُحذف بياناتها المخفية)، وتُشفَّر بمفتاح القائمة، وتُرسل على أجزاء صغيرة
const IMG_PART = 2600, IMG_MAX = 34000;
const ImgDB = {
  db: null,
  open() {
    if (ImgDB.db) return ImgDB.db;
    ImgDB.db = new Promise(res => {
      try {
        const r = indexedDB.open('saraha', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('img');
        r.onsuccess = () => res(r.result); r.onerror = () => res(null);
      } catch { res(null); }
    });
    return ImgDB.db;
  },
  async get(k) { const db = await ImgDB.open(); if (!db) return null; return new Promise(res => { try { const q = db.transaction('img').objectStore('img').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch { res(null); } }); },
  async put(k, v) { const db = await ImgDB.open(); if (!db) return; try { db.transaction('img', 'readwrite').objectStore('img').put(v, k); } catch {} }
};
const Photos = {
  async shrink(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      for (const [max, q] of [[560, .6], [480, .5], [400, .45], [320, .4], [260, .35]]) {
        const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const d = c.toDataURL('image/jpeg', q);
        if (d.length <= IMG_MAX) return d;
      }
      throw new Error('big');
    } finally { URL.revokeObjectURL(url); }
  },
  async upload(my, dataUrl, onProg) {
    const id = ID(), b = dataUrl.slice(dataUrl.indexOf(',') + 1), n = Math.ceil(b.length / IMG_PART);
    for (let p = 0; p < n; p++) { await postRoom(my, 'x', { im: id, p, n, d: b.slice(p * IMG_PART, (p + 1) * IMG_PART) }); onProg && onProg(p + 1, n); }
    Photos.keep(my, id, dataUrl);
    return id;
  },
  keep(my, id, url) { (my.imgs = my.imgs || new Map()).set(id, url); ImgDB.put(`${my.topic}:${id}`, url); },
  part(my, x) {
    if (typeof x.im !== 'string' || x.im.length > 16 || !Number.isInteger(x.p) || !Number.isInteger(x.n) || x.n < 1 || x.n > 20 || x.p < 0 || x.p >= x.n || typeof x.d !== 'string' || !/^[A-Za-z0-9+/=]*$/.test(x.d)) return false;
    my.imgs = my.imgs || new Map(); my.imgParts = my.imgParts || new Map();
    if (my.imgs.has(x.im)) return false;
    if (!my.imgParts.has(x.im)) my.imgParts.set(x.im, new Map());
    const g = my.imgParts.get(x.im); g.set(x.p, x.d);
    if (g.size < x.n) return false;
    Photos.keep(my, x.im, 'data:image/jpeg;base64,' + [...g.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]).join(''));
    my.imgParts.delete(x.im);
    return true;
  },
  html: id => id ? `<img class="bimg" data-img="${esc(id)}" alt="صورة" hidden>` : '',
  // تعبئة الصور بعد الرسم: من الذاكرة، أو من المحفوظ في الجوال
  fill(my, root = app) {
    $$('img[data-img]', root).forEach(async el => {
      const id = el.dataset.img;
      let u = my.imgs && my.imgs.get(id);
      if (!u) { u = await ImgDB.get(`${my.topic}:${id}`); if (u) (my.imgs = my.imgs || new Map()).set(id, u); }
      if (u && u.startsWith('data:image/jpeg;base64,')) { el.src = u; el.hidden = false; }
      else if (!el.nextElementSibling || !el.nextElementSibling.classList.contains('imgwait')) el.insertAdjacentHTML('afterend', `<small class="muted imgwait">📷 الصورة ${isFb(my.topic) ? 'توصل بعد شوي…' : 'ما وصلت (يمكن انتهت مدتها على السيرفر)'}</small>`);
    });
  },
  url: (my, id) => (my.imgs && my.imgs.get(id)) || '',
  picker: (id, label = '📷 أضف صورة (اختياري)') => `<div class="row"><label class="btn ghost" for="${id}">${label}</label><input type="file" id="${id}" accept="image/*" hidden><small class="muted" id="${id}N"></small></div>`,
  bindPicker(id) {
    let file = null;
    const inp = $('#' + id);
    inp.onchange = () => { file = inp.files[0] || null; $('#' + id + 'N').textContent = file ? '✓ صورة جاهزة' : ''; };
    return { get: () => file, clear: () => { file = null; inp.value = ''; $('#' + id + 'N').textContent = ''; } };
  },
  // رفع الصورة المختارة (لو فيه) قبل حفظ العنصر
  async attach(my, pick) {
    const f = pick.get(); if (!f) return '';
    let d;
    try { d = await Photos.shrink(f); } catch { toast('ما قدرنا نقرأ الصورة', true); throw new Error('img'); }
    const t = $('#toast');
    const id = await Photos.upload(my, d, (k, n) => { if (t) { t.textContent = `📤 جاري رفع الصورة ${k} من ${n}`; t.className = 'toast show'; } });
    pick.clear();
    return id;
  }
};

/* ============ حذف الجلسة من السيرفر (Firebase) ============ */
FbRelay.claim = async (topic, own) => {
  const r = await fetch(`${CONF.fb}/o/${topic}.json`, { method: 'PUT', body: JSON.stringify(own) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
};
FbRelay.wipe = async (topic, own) => {
  const r = await fetch(`${CONF.fb}/.json`, { method: 'PATCH', body: JSON.stringify({ [`t/${topic}`]: null, [`del/${topic}`]: own }) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
};
function wipeCard(my, board) {
  const rec = store.get(my.topic) || {};
  if (!isFb(my.topic) || !CONF.fb || !rec.own || !rec.d) return '';
  return `<section class="card wipe" id="wipeCard"><h3>🗑️ احذفها من السيرفر</h3>
    ${rec.wiped ? '<p class="muted">✓ حُذفت من السيرفر.</p>' : `<p class="muted small">${board ? 'القائمة تُحذف من السيرفر نهائيًا، وتبقى بس في الجوالات اللي فتحتها قبل.' : 'النتائج تبقى في الجوالات اللي شافتها، بس كل الرسائل المشفرة تُحذف من السيرفر نهائيًا، واللي ما فتحها للحين ما بيقدر يشوفها.'}</p>
      <button class="btn danger" id="wipeBtn">🗑️ احذف من السيرفر</button>`}</section>`;
}
function bindWipe(my) {
  const b = $('#wipeBtn'); if (!b) return;
  b.onclick = async () => {
    if (!confirm('متأكد؟ الحذف من السيرفر نهائي وما يتراجع.')) return;
    b.disabled = true;
    try {
      await FbRelay.wipe(my.topic, store.get(my.topic).own);
      store.upsert({ topic: my.topic, wiped: true });
      $('#wipeCard').outerHTML = wipeCard(my, my.M.kind === 'board');
      toast('حُذفت من السيرفر ✓');
    } catch (e) { console.error(e); toast('ما قدرنا نحذفها، تأكد من النت', true); b.disabled = false; }
  };
}
function addWipe() {
  const my = S;
  if (!my || $('#wipeCard') || my.tv) return;
  const html = wipeCard(my, my.M && my.M.kind === 'board'); if (!html) return;
  const anchors = $$('#app a.btn.primary.big[href="#"]'), at = anchors[anchors.length - 1];
  at ? at.insertAdjacentHTML('afterend', html) : app.insertAdjacentHTML('beforeend', html);
  bindWipe(my);
}
