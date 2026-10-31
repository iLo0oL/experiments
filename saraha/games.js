'use strict';
/* ألعاب الجلسات الخاصة: كمّل القصة، متى نجتمع؟، سباق الأسئلة، كم تعرفني؟، كبسولة الزمن */

const medal = k => ['🥇', '🥈', '🥉'][k] || '🎖️';
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayDate = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDay = (iso, o = { weekday: 'long', day: 'numeric', month: 'long' }) => {
  try { return new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', o).format(dayDate(iso)); } catch { return iso; }
};
const liveBar = inner => `<div class="live"><span class="dot" id="dot"></span><span id="conn">يتصل…</span><span>·</span><span>${inner}</span></div>`;
const waitCard = () => `<div class="card wait">⏳ النتائج تنكشف لما صاحب الجلسة ينهيها.<br>خلّ الصفحة مفتوحة، أو ارجع لها بعدين من نفس الجوال.</div>`;
const againBtn = () => `<a class="btn primary big" href="#" style="margin-top:24px">✨ جرّب لعبة ثانية</a>`;
const revealHead = (R, M, icon, sub) => `${backLink()}<header class="hero small"><div class="big-ic">${icon || M.icon}</div>${R.title !== M.name ? `<div class="mchip">${M.name}</div>` : ''}<h2 class="ttl">${esc(R.title)}</h2><p class="muted">${sub}</p></header>`;

// فك رسالة مشفرة بمفتاح الجلسة مرة وحدة بس
async function roomOpen(my, r) {
  if (!my.rcache) my.rcache = new Map();
  if (!my.rcache.has(r.id)) {
    let x = null;
    try { x = await Crypto.open(my.room, r.env); } catch {}
    my.rcache.set(r.id, x);
  }
  return my.rcache.get(r.id);
}
async function postRoom(my, k, obj) {
  const res = await Relay.post(my.topic, { v: 1, k, ...(await Crypto.seal(my.room, obj)) });
  onRaw(res, my);
  return res;
}

/* ============ كمّل القصة ============ */
const Story = {
  async process(my) {
    const lines = [];
    for (const r of my.raws) {
      if (r.env.k !== 'x' || r.idx < my.setupIdx) continue;
      const x = await roomOpen(my, r);
      if (x && typeof x.text === 'string' && x.text.trim()) lines.push({ id: r.id, idx: r.idx, text: x.text.slice(0, 600) });
    }
    my.lines = lines;
    my.msgs = my.reveal ? lines.filter(l => l.idx < my.reveal.idx) : lines;
    if (!my.reveal || my.results) return;
    const R = my.reveal;
    const list = R.ids ? lines.filter(l => R.ids.has(l.id)) : my.msgs.filter(l => !R.hide.has(l.id));
    if (R.ids && list.length < R.ids.size && Date.now() - R.at < 4000) { setTimeout(() => process(my), 1000); return; }
    my.results = { mode: my.mode, title: my.setup.title, cfg: my.cfg, lines: list.map(l => l.text), hidden: Math.max(0, my.msgs.length - list.length), at: Date.now() };
    store.upsert({ topic: my.topic, results: my.results });
  },
  startReveal(my) { reviewSheet(my, my.msgs.map(l => ({ id: l.id, text: l.text }))); },
  update() {
    const my = S, ll = $('#lastLine'), hint = $('#lastHint');
    if (!ll || !my.lines) return;
    const last = my.lines[my.lines.length - 1];
    ll.textContent = last ? last.text : my.cfg.prompt;
    hint.textContent = last ? `هذي آخر جملة انكتبت (القصة فيها ${my.lines.length} جملة). كمّل عليها 👇` : 'هذي بداية القصة. كمّل عليها 👇';
  },
  reveal() {
    const R = S.results, M = S.M, all = [R.cfg.prompt, ...R.lines];
    document.title = `${R.title} · صراحة`;
    app.innerHTML = `${revealHead(R, M, '📜', `القصة كاملة: ${R.lines.length} جملة${R.hidden ? ` · ${R.hidden} مخفية من المشرف` : ''}`)}
      <section class="card story">${all.map((t, i) => `<p class="${i ? '' : 'first'}">${esc(t)}</p>`).join('')}</section>
      <div class="row"><button class="btn grow" id="present">📽️ اقرؤوها جملة جملة</button><button class="btn grow" id="cpStory">📋 نسخ القصة</button></div>
      ${againBtn()}`;
    $('#present').onclick = () => present(all.map((t, i) => ({ kick: i ? `الجملة ${i}` : 'البداية', body: `<p>${esc(t)}</p>` })));
    $('#cpStory').onclick = () => copyText(`📜 ${R.title}\n\n${all.join(' ')}`);
  }
};

/* ============ متى نجتمع؟ ============ */
const When = {
  async process(my) {
    const avail = new Map();
    for (const r of my.raws) {
      if (r.env.k !== 'x' || r.idx < my.setupIdx || (my.reveal && r.idx > my.reveal.idx)) continue;
      const x = await roomOpen(my, r);
      if (x && typeof x.by === 'string' && x.by.trim() && Array.isArray(x.days)) {
        const by = x.by.trim().slice(0, NAME_LEN);
        avail.delete(by); // يحطه في آخر الترتيب
        avail.set(by, x.days.filter(i => Number.isInteger(i) && i >= 0 && i < my.cfg.days.length));
      }
    }
    my.avail = avail;
    my.msgs = [...avail.keys()];
    const p = my.reveal && my.reveal.pick;
    if (my.reveal && !my.results && Number.isInteger(p) && p >= 0 && p < my.cfg.days.length) {
      my.results = { mode: my.mode, title: my.setup.title, cfg: my.cfg, pick: p, avail: [...avail.entries()], at: Date.now() };
      store.upsert({ topic: my.topic, results: my.results });
    }
  },
  counts(cfg, avail) { return cfg.days.map((_, i) => [...avail.values()].filter(ds => ds.includes(i)).length); },
  table(cfg, avail, pick) {
    if (!avail.size) return '<p class="muted">محد حدد أيامه للحين.</p>';
    const counts = When.counts(cfg, avail), best = Math.max(...counts), total = avail.size;
    return cfg.days.map((d, i) => {
      const names = [...avail.entries()].filter(([, ds]) => ds.includes(i)).map(([n]) => n);
      const top = pick === i || (pick == null && best > 0 && counts[i] === best);
      return `<div class="bar${top ? ' top' : ''}"><i style="width:${Math.round(counts[i] * 100 / total)}%"></i><span>${pick === i ? '📌 ' : top ? '⭐ ' : ''}${esc(fmtDay(d))}</span><b>${counts[i]} من ${total}</b></div>
        ${names.length ? `<div class="names">${names.map(esc).join('، ')}</div>` : ''}`;
    }).join('');
  },
  open() { When.view(false); },
  reveal() { When.view(true); },
  view(final) {
    const my = S, cfg = my.cfg, title = (my.setup && my.setup.title) || my.results.title;
    const avail = final ? new Map(my.results.avail) : my.avail || new Map();
    document.title = `${title} · صراحة`;
    app.innerHTML = `
      ${final ? revealHead(my.results, my.M, '📅', 'تثبّت الموعد 🎉') : sessionHead(title)}
      ${final ? `<div class="card pick center"><small>الموعد</small><div class="gname">${esc(fmtDay(cfg.days[my.results.pick]))}</div></div>` : liveBar('حدد <b id="count">0</b> شخص')}
      ${cfg.note ? `<div class="card note">📝 ${esc(cfg.note)}</div>` : ''}
      ${!final && my.isHost ? hostPanel() : ''}
      ${final ? '' : `<section class="card">
        <h3>🙋 وش الأيام اللي تناسبك؟</h3>
        <input id="wname" maxlength="${NAME_LEN}" placeholder="اسمك" value="${esc(store.kv('wname') || '')}">
        <div class="chips" id="mydays">${cfg.days.map((d, i) => `<button class="chip" data-i="${i}">${esc(fmtDay(d))}</button>`).join('')}</div>
        <button class="btn primary big" id="wsave">حفظ أيامي</button>
        <p class="hint">الأسماء ظاهرة للكل هنا. تقدر تعدّل وتحفظ مرة ثانية بنفس الاسم.</p>
      </section>`}
      <section class="card"><h3>📊 الأيام</h3><div id="wtable">${When.table(cfg, avail, final ? my.results.pick : null)}</div></section>
      ${!final && my.isHost ? `<button class="btn danger big" id="reveal">📌 ثبّت الموعد</button>` : ''}
      ${final ? againBtn() : howCard(my.M)}`;
    if (final) return;
    if (my.isHost) bindHost();
    const sel = new Set(), nameIn = $('#wname');
    const paint = () => $$('#mydays .chip').forEach(c => c.classList.toggle('on', sel.has(+c.dataset.i)));
    const preload = () => { const mine = my.avail && my.avail.get(nameIn.value.trim()); if (mine) { sel.clear(); mine.forEach(i => sel.add(i)); paint(); } };
    preload();
    nameIn.onchange = preload;
    $('#mydays').onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; const i = +b.dataset.i; sel.has(i) ? sel.delete(i) : sel.add(i); paint(); };
    $('#wsave').onclick = async e => {
      const by = nameIn.value.trim().slice(0, NAME_LEN);
      if (!by) return toast('اكتب اسمك أول', true);
      const btn = e.currentTarget; btn.disabled = true;
      try { store.kv('wname', by); await postRoom(my, 'x', { by, days: [...sel].sort((a, b) => a - b) }); toast('انحفظت أيامك ✓'); }
      catch (err) { console.error(err); toast('ما انحفظت… تأكد من النت', true); }
      finally { btn.disabled = false; }
    };
    When.update();
  },
  update() {
    const my = S, t = $('#wtable');
    if (t && my.avail && !my.results) t.innerHTML = When.table(my.cfg, my.avail, null);
  },
  startReveal(my) {
    const counts = When.counts(my.cfg, my.avail || new Map()), best = counts.indexOf(Math.max(...counts));
    const { m, close } = openSheet(`<h3>📌 ثبّت الموعد</h3><p class="muted">اختر اليوم، ويطلع للكل.</p>
      ${my.cfg.days.map((d, i) => `<label class="rv"><input type="radio" name="pk" value="${i}"${i === best ? ' checked' : ''}><span>${esc(fmtDay(d))}<small>${counts[i]} يقدرون</small></span></label>`).join('')}
      <div class="row"><button class="btn ghost" id="rvBack">رجوع</button><button class="btn primary grow" id="rvGo">📌 ثبّت</button></div>`);
    $('#rvBack', m).onclick = close;
    $('#rvGo', m).onclick = e => postReveal(my, { d: my.d, pick: +$('input[name=pk]:checked', m).value }, e.currentTarget, close);
  }
};

/* ============ سباق الأسئلة ============ */
const QCOL = ['#e11d48', '#2563eb', '#d97706', '#16a34a'], QSYM = ['▲', '◆', '●', '■'], QTIME = 20000;
let quizTimer = null;
const validBoard = b => Array.isArray(b) ? b.filter(x => Array.isArray(x) && typeof x[0] === 'string' && Number.isFinite(x[1])).slice(0, 100).map(([n, s]) => [n.slice(0, NAME_LEN), Math.round(s)]) : [];
const boardHtml = (board, me, max = 10) => {
  if (!board.length) return '<p class="muted">محد جاوب للحين</p>';
  const rows = board.slice(0, max).map(([n, s], k) => `<div class="brow${n === me ? ' me' : ''}"><span>${medal(k)} ${esc(n)}</span><b>${s}</b></div>`).join('');
  const k = me ? board.findIndex(b => b[0] === me) : -1;
  return rows + (k >= max ? `<div class="brow me"><span>${k + 1}. ${esc(me)}</span><b>${board[k][1]}</b></div>` : '');
};
const Quiz = {
  qs(my) { return my.qs || my.cfg.questions; },
  async process(my) {
    if (my.M.fromFacts && !my.qs) {
      // مسابقة الشلة: الأسئلة تنبني بعدين من معلومات اللاعبين وتنرسل على أجزاء
      const got = assemble((await roomEvents(my)).filter(x => x.s === 'qs'), 'qs')[0];
      const list = got && Array.isArray(got.qs) ? got.qs.filter(x => x && typeof x.q === 'string' && Array.isArray(x.opts)).map(x => ({ q: x.q.slice(0, 200), opts: strArr(x.opts, 4, NAME_LEN) })).filter(x => x.opts.length >= 2).slice(0, 15) : [];
      if (list.length) my.qs = list;
    }
    const ev = [], n = Quiz.qs(my).length;
    for (const r of my.raws) {
      if (r.env.k !== 'q' || r.idx < my.setupIdx) continue;
      const x = await roomOpen(my, r);
      if (!x || !['ask', 'show', 'end'].includes(x.s)) continue;
      if (x.s !== 'end' && !(Number.isInteger(x.i) && x.i >= 0 && x.i < n)) continue;
      ev.push({ s: x.s, i: x.i, idx: r.idx, c: Number.isInteger(x.c) ? x.c : -1, board: validBoard(x.board), stats: Array.isArray(x.stats) ? x.stats.slice(0, 4).map(v => +v || 0) : [] });
    }
    my.qev = ev;
    my.state = ev.length ? ev[ev.length - 1] : null;
    my.msgs = [];
    if (my.isHost) {
      const c = my.secret && my.secret.c;
      if (!my.qkey && Array.isArray(c) && c.length === n && c.every(Number.isInteger)) my.qkey = c;
      my.answers = my.answers || new Map(); my.aseen = my.aseen || new Set();
      if (!my.priv) my.priv = await Crypto.priv(my.d, my.setup.pk);
      for (const r of my.raws) {
        if (r.env.k !== 'm' || my.aseen.has(r.id)) continue;
        my.aseen.add(r.id);
        try {
          const raw = await Crypto.openFrom(my.priv, r.env);
          if (my.M.fromFacts && raw && Array.isArray(raw.facts) && typeof raw.by === 'string' && raw.by.trim()) {
            (my.facts = my.facts || new Map()).set(raw.by.trim().slice(0, NAME_LEN), strArr(raw.facts, 3, 100));
            continue;
          }
          const p = validItem(my.M, { ...my.cfg, questions: Quiz.qs(my) }, raw);
          if (!p) continue;
          if (!my.answers.has(p.i)) my.answers.set(p.i, new Map());
          const m = my.answers.get(p.i);
          if (!m.has(p.by)) m.set(p.by, { a: p.a, t: p.t, idx: r.idx }); // أول جواب بس يُحسب
        } catch {}
      }
    }
    if (my.state && my.state.s === 'end' && !my.results) {
      my.results = { mode: my.mode, title: my.setup.title, cfg: my.cfg, board: my.state.board, at: Date.now() };
      store.upsert({ topic: my.topic, results: my.results });
    }
  },
  board(my, upto) {
    const scores = new Map();
    for (const [i, m] of my.answers) {
      if (i > upto) continue;
      const shown = my.qev.find(e => e.s === 'show' && e.i === i);
      for (const [by, x] of m) {
        if (shown && x.idx > shown.idx) continue;
        if (!scores.has(by)) scores.set(by, 0);
        if (x.a === my.qkey[i]) scores.set(by, scores.get(by) + Math.round(500 + 500 * Math.max(0, 1 - x.t / QTIME)));
      }
    }
    return [...scores.entries()].sort((a, b) => b[1] - a[1]);
  },
  players(my) { const s = new Set(); for (const m of (my.answers || new Map()).values()) for (const by of m.keys()) s.add(by); return s.size; },
  async send(my, ev, btn) {
    btn.disabled = true;
    try { await postRoom(my, 'q', ev); }
    catch (err) { console.error(err); toast('ما انرسل… تأكد من النت', true); btn.disabled = false; }
  },
  open() {
    const my = S;
    document.title = `${my.setup.title} · صراحة`;
    app.innerHTML = `${sessionHead(my.setup.title)}
      ${liveBar(my.isHost ? 'لاعبين جاوبوا: <b id="count">0</b>' : '<span id="qpos">قبل البداية</span>')}
      ${my.isHost ? `<details class="card"${my.state ? '' : ' open'}><summary>📨 رابط الدعوة ورابط المشرف</summary>${hostPanel().replace('<section class="card share">', '<section class="share">')}</details>` : ''}
      <div id="qarea"></div>
      ${howCard(my.M)}${privacyNote(my.M)}`;
    if (my.isHost) bindHost();
    my.qdrawn = null;
    Quiz.update();
  },
  update() {
    const my = S, st = my.state, key = (st ? st.s + st.i : 'lobby') + (my.isHost && my.qkey ? 'k' : '') + (my.qs ? 'q' : '');
    if (my.isHost && my.M.fromFacts && !my.qs) {
      const f = my.facts || new Map(), fc = $('#fcount');
      if (fc) { fc.textContent = f.size; $('#fnames').textContent = [...f.keys()].join('، '); }
    }
    if (my.isHost) { const c = $('#count'); if (c) c.textContent = Quiz.players(my); }
    else { const q = $('#qpos'); if (q) q.textContent = st && st.s !== 'end' ? `سؤال ${st.i + 1} من ${Quiz.qs(my).length}` : 'قبل البداية'; }
    if (key !== my.qdrawn) { my.qdrawn = key; Quiz.draw(); }
    else if (my.isHost && st && st.s === 'ask') { const a = $('#acount'); if (a) a.textContent = (my.answers.get(st.i) || new Map()).size; }
  },
  draw() {
    clearInterval(quizTimer);
    const A = $('#qarea'); if (!A) return;
    A.onclick = null;
    S.isHost ? Quiz.drawHost(A) : Quiz.drawPlayer(A);
  },
  qCard(my, i, inner) {
    const q = Quiz.qs(my)[i];
    return `<div class="card"><div class="qhead">سؤال ${i + 1} من ${Quiz.qs(my).length}</div><h3 class="qq">${esc(q.q)}</h3>${inner}</div>`;
  },
  showHtml(my, st, me) {
    const q = Quiz.qs(my)[st.i];
    return Quiz.qCard(my, st.i, q.opts.map((o, k) => `<div class="qopt ${k === st.c ? 'ok' : 'dim'}" style="--c:${QCOL[k]}"><span>${QSYM[k]}</span>${esc(o)}${k === st.c ? ' ✅' : ''}<b>${st.stats[k] ?? ''}</b></div>`).join(''))
      + `<section class="card"><h3>🏆 الترتيب</h3>${boardHtml(st.board, me)}</section>`;
  },
  drawHost(A) {
    const my = S, st = my.state, n = Quiz.qs(my).length;
    if (my.M.fromFacts && !my.qs) return Quiz.drawFactsHost(A);
    if (!my.qkey) { A.innerHTML = '<div class="card center"><div class="spin" style="margin:20px auto"></div><p class="muted">جاري تجهيز المسابقة…</p></div>'; return; }
    if (!st) {
      A.innerHTML = `<div class="card center"><div class="big-ic">🎮</div><h3>جاهزين؟</h3><p class="muted">أرسل الرابط للشلة، وكل واحد يدخل اسمه. لما يجهزون ابدأ.</p></div>
        <button class="btn primary big" id="qgo">▶️ ابدأ السؤال 1</button>`;
      $('#qgo').onclick = e => Quiz.send(my, { s: 'ask', i: 0 }, e.currentTarget);
    } else if (st.s === 'ask') {
      const q = Quiz.qs(my)[st.i];
      A.innerHTML = Quiz.qCard(my, st.i, q.opts.map((o, k) => `<div class="qopt ${k === my.qkey[st.i] ? 'ok' : ''}" style="--c:${QCOL[k]}"><span>${QSYM[k]}</span>${esc(o)}${k === my.qkey[st.i] ? ' ✅' : ''}</div>`).join('')
        + `<p class="muted center" style="margin-top:10px">جاوب <b id="acount">${(my.answers.get(st.i) || new Map()).size}</b> لاعب</p>`)
        + `<button class="btn primary big" id="qshow">👀 اعرض الجواب والترتيب</button>`;
      $('#qshow').onclick = e => {
        const ans = [...(my.answers.get(st.i) || new Map()).values()];
        Quiz.send(my, { s: 'show', i: st.i, c: my.qkey[st.i], board: Quiz.board(my, st.i).slice(0, 60), stats: q.opts.map((_, k) => ans.filter(x => x.a === k).length) }, e.currentTarget);
      };
    } else if (st.s === 'show') {
      const last = st.i >= n - 1;
      A.innerHTML = Quiz.showHtml(my, st) + `<button class="btn primary big" id="qnext">${last ? '🏆 النتيجة النهائية' : `⏭️ السؤال ${st.i + 2}`}</button>`;
      $('#qnext').onclick = e => Quiz.send(my, last ? { s: 'end', board: Quiz.board(my, n - 1).slice(0, 60) } : { s: 'ask', i: st.i + 1 }, e.currentTarget);
    }
  },
  drawPlayer(A) {
    const my = S, st = my.state, name = store.kv('qname.' + my.topic);
    if (!name) {
      A.innerHTML = `<div class="card"><h3>👋 وش اسمك؟</h3><input id="qn" maxlength="${NAME_LEN}" placeholder="الاسم اللي بيطلع في الترتيب"><button class="btn primary big" id="qjoin">دخول</button></div>`;
      $('#qjoin').onclick = () => { const v = $('#qn').value.trim(); if (!v) return toast('اكتب اسمك', true); store.kv('qname.' + my.topic, v.slice(0, NAME_LEN)); Quiz.draw(); };
      return;
    }
    if (my.M.fromFacts && !my.qs) return Quiz.drawFacts(A, name);
    if (!st) {
      A.innerHTML = `<div class="card center"><div class="big-ic">⏳</div><h3>أهلًا ${esc(name)}!</h3><p class="muted">بانتظار المشرف يبدأ المسابقة…</p><button class="btn ghost sm" id="rename">تغيير الاسم</button></div>`;
      $('#rename').onclick = () => { localStorage.removeItem('saraha.qname.' + my.topic); Quiz.draw(); };
      return;
    }
    if (my.M.fromFacts && !my.qs) return Quiz.drawFacts(A, name);
    if (st.s === 'ask') {
      const q = Quiz.qs(my)[st.i], key = `qans.${my.topic}.${st.i}`;
      let own = [];
      try { own = JSON.parse(store.kv('gfacts.' + my.topic)) || []; } catch {}
      if (own.some(f => q.q.includes(`«${f}»`))) { A.innerHTML = Quiz.qCard(my, st.i, '<div class="center"><div class="big-ic">😄</div><h3>هذي معلومتك!</h3><p class="muted">خلّهم يخمّنون…</p></div>'); return; }
      if (store.kv(key) !== null) { A.innerHTML = '<div class="card center"><div class="big-ic">✅</div><h3>جاوبت!</h3><p class="muted">بانتظار الباقين…</p></div>'; return; }
      my.seenAt = my.seenAt || {};
      if (!my.seenAt[st.i]) my.seenAt[st.i] = Date.now();
      A.innerHTML = Quiz.qCard(my, st.i, `<div class="qbar"><i id="qbar"></i></div>${q.opts.map((o, k) => `<button class="qopt" data-k="${k}" style="--c:${QCOL[k]}"><span>${QSYM[k]}</span>${esc(o)}</button>`).join('')}`);
      const tick = () => { const left = Math.max(0, 1 - (Date.now() - my.seenAt[st.i]) / QTIME), b = $('#qbar'); if (b) b.style.width = left * 100 + '%'; if (!left) clearInterval(quizTimer); };
      tick(); quizTimer = setInterval(tick, 100);
      A.onclick = async e => {
        const b = e.target.closest('[data-k]'); if (!b) return;
        $$('.qopt', A).forEach(x => { x.disabled = true; });
        b.classList.add('picked');
        try {
          const res = await Relay.post(my.topic, { v: 1, k: 'm', ...(await Crypto.sealTo(my.setup.pk, { by: name, i: st.i, a: +b.dataset.k, t: Date.now() - my.seenAt[st.i] })) });
          store.kv(key, b.dataset.k);
          onRaw(res, my);
          if (S === my && my.state === st) Quiz.draw();
        } catch (err) { console.error(err); toast('ما انرسل… جرّب مرة ثانية', true); $$('.qopt', A).forEach(x => { x.disabled = false; }); b.classList.remove('picked'); }
      };
      return;
    }
    if (st.s === 'show') {
      const mine = store.kv(`qans.${my.topic}.${st.i}`);
      const res = mine === null ? '⌛ ما لحقت تجاوب' : +mine === st.c ? '🎉 صح!' : '❌ للأسف غلط';
      A.innerHTML = `<div class="card center result"><h3>${res}</h3></div>` + Quiz.showHtml(my, st, name);
    }
  },
  drawFactsHost(A) {
    const my = S, f = my.facts || new Map();
    A.innerHTML = `<div class="card center"><div class="big-ic">🧠</div><h3>المرحلة الأولى: المعلومات</h3>
      <p class="muted">كل واحد يكتب معلومات عن نفسه من جواله. لما يخلصون، سوّ المسابقة.</p>
      <p>كتب <b id="fcount">${f.size}</b> شخص: <span class="muted" id="fnames">${[...f.keys()].map(esc).join('، ')}</span></p></div>
      <button class="btn primary big" id="build">🎲 سوّ المسابقة</button>`;
    $('#build').onclick = e => Quiz.build(my, e.currentTarget);
  },
  async build(my, btn) {
    const f = my.facts || new Map(), people = [...f.keys()];
    if (people.length < 2) return toast('لازم شخصين على الأقل يكتبون معلوماتهم', true);
    const all = [];
    for (const [by, fs] of f) fs.forEach(t => all.push([by, t]));
    const qs = [], c = [];
    for (const [by, t] of shuffle(all).slice(0, 12)) {
      const opts = shuffle([by, ...shuffle(people.filter(p => p !== by)).slice(0, 3)]);
      qs.push({ q: `«${t}»\nمين صاحب هذي المعلومة؟`, opts }); c.push(opts.indexOf(by));
    }
    btn.disabled = true;
    try {
      my.qkey = c; my.secret = { c };
      store.upsert({ topic: my.topic, secret: { c }, cfg: my.cfg, pk: my.setup.pk, rc: my.setup.rc });
      await Relay.post(my.topic, { v: 1, k: 't', ...(await Crypto.sealTo(my.setup.pk, { c })) });
      await postChunked(my, 'q', { s: 'qs' }, 'qs', qs);
    } catch (err) { console.error(err); toast('ما انرسل… تأكد من النت', true); btn.disabled = false; }
  },
  drawFacts(A, name) {
    const my = S;
    let mine = [];
    try { mine = JSON.parse(store.kv('gfacts.' + my.topic)) || []; } catch {}
    A.innerHTML = `<div class="card"><h3>🧠 اكتب معلومات عنك</h3>
      <p class="muted small">معلومات ما يعرفها الكل. بتنقلب أسئلة: «مين صاحب هذي المعلومة؟». والكلام يتصحح ويتوحّد أسلوبه عشان ما ينعرف من طريقة الكتابة.</p>
      ${[0, 1, 2].map(i => `<input class="gf" maxlength="100" placeholder="${esc(FACT_HINTS[i])}" value="${esc(mine[i] || '')}" style="margin-top:8px">`).join('')}
      <div class="err" id="err"></div>
      <button class="btn primary big" id="gsend">🔒 ${mine.length ? 'تحديث معلوماتي' : 'إرسال'}</button>
      ${mine.length ? '<p class="muted small center">انرسلت ✓ بانتظار المشرف يبدأ المسابقة</p>' : ''}</div>`;
    $('#gsend').onclick = async e => {
      const facts = $$('.gf', A).map(i => i.value.trim()).filter(v => v.length >= 3).map(v => Polish.polish(v).slice(0, 100)).filter(Boolean);
      if (!facts.length) return ($('#err').textContent = 'اكتب معلومة وحدة على الأقل');
      if (facts.some(Polish.isRude)) return ($('#err').textContent = RUDE_MSG);
      e.currentTarget.disabled = true;
      try {
        const res = await Relay.post(my.topic, { v: 1, k: 'm', ...(await Crypto.sealTo(my.setup.pk, { by: name, facts })) });
        store.kv('gfacts.' + my.topic, JSON.stringify(facts)); onRaw(res, my); toast('انرسلت ✓');
        if (S === my && !my.qs) Quiz.drawFacts(A, name);
      } catch { toast('ما انرسلت… تأكد من النت', true); e.currentTarget.disabled = false; }
    };
  },
  reveal() {
    clearInterval(quizTimer);
    const R = S.results, me = store.kv('qname.' + S.topic), b = R.board;
    document.title = `${R.title} · صراحة`;
    app.innerHTML = `${revealHead(R, S.M, '🏆', 'انتهت المسابقة')}
      ${b.length ? `<div class="podium">${[1, 0, 2].filter(k => b[k]).map(k => `<div class="pod p${k}"><div class="big-ic">${medal(k)}</div><b>${esc(b[k][0])}</b><small>${b[k][1]}</small></div>`).join('')}</div>
        <section class="card"><h3>الترتيب الكامل</h3>${boardHtml(b, me, 100)}</section>` : emptyCard('محد لعب هالمرة 😅')}
      ${againBtn()}`;
  }
};

/* ============ كم تعرفني؟ ============ */
function knowCard() {
  const { cfg } = S;
  return `<section class="card vote">
    <h3>أنت مين؟</h3>
    <div class="chips" id="targets"><button class="chip" data-to="${esc(cfg.subject)}">👑 أنا ${esc(cfg.subject)}</button>${cfg.names.map(n => `<button class="chip" data-to="${esc(n)}">${esc(n)}</button>`).join('')}</div>
    <p class="hint" id="khint">اختر اسمك عشان تبدأ.</p>
    <div id="kq" hidden>
      ${cfg.questions.map((q, qi) => `<div class="vq"><div class="vqt">${qi + 1}. ${esc(q.opts[0])} ولا ${esc(q.opts[1])}؟</div>
        <div class="chips pair" data-q="${qi}">${q.opts.map((o, oi) => `<button class="chip" data-o="${oi}">${esc(o)}</button>`).join('<span class="or">ولا</span>')}</div></div>`).join('')}
      <div class="err" id="err"></div>
      <button class="btn primary big" id="vote">🔒 إرسال أجوبتي</button>
    </div>
    <p class="muted small" id="sent"></p>
  </section>`;
}
function bindKnow() {
  const my = S, cfg = my.cfg, ans = cfg.questions.map(() => -1);
  let me = null;
  const pick = n => {
    me = n;
    $$('#targets .chip').forEach(c => c.classList.toggle('on', c.dataset.to === n));
    $('#khint').textContent = n === cfg.subject ? 'جاوب عن نفسك بصدق 😇' : `خمّن وش بيختار ${cfg.subject} 🤔`;
    $('#kq').hidden = false;
    store.kv('me.' + my.topic, n);
  };
  $('#targets').onclick = e => { const b = e.target.closest('[data-to]'); if (b) pick(b.dataset.to); };
  const saved = store.kv('me.' + my.topic);
  if (saved && (saved === cfg.subject || cfg.names.includes(saved))) pick(saved);
  $$('#kq .chips').forEach(box => {
    box.onclick = e => {
      const b = e.target.closest('[data-o]'); if (!b) return;
      const qi = +box.dataset.q, oi = +b.dataset.o;
      ans[qi] = ans[qi] === oi ? -1 : oi;
      $$('.chip', box).forEach(c => c.classList.toggle('on', +c.dataset.o === ans[qi]));
      $('#err').textContent = '';
    };
  });
  $('#vote').onclick = async e => {
    if (my.reveal) return toast('اللعبة انتهت', true);
    if (!me) return toast('اختر اسمك أول', true);
    if (ans.every(a => a < 0)) { $('#err').textContent = 'جاوب سؤال واحد على الأقل'; return; }
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const res = await Relay.post(my.topic, { v: 1, k: 'm', ...(await Crypto.sealTo(my.setup.pk, { by: me, a: ans })) });
      store.kv('voted.' + my.topic, '1');
      onRaw(res, my); toast('انرسلت أجوبتك ✓'); updateLive();
    } catch (err) { console.error(err); toast('ما انرسلت… تأكد من النت', true); }
    finally { btn.disabled = false; }
  };
}
function knowReveal(R, M, cfg) {
  if (!R.key) return { body: emptyCard(`${esc(cfg.subject)} ما جاوب على الأسئلة 😅`), slides: [] };
  const n = cfg.questions.length;
  const right = qi => R.key[qi] < 0 ? [] : R.players.filter(p => p.a[qi] === R.key[qi]).map(p => p.by);
  const answer = (q, qi) => R.key[qi] >= 0 ? esc(q.opts[R.key[qi]]) : 'ما جاوب';
  const rank = R.players.map((p, k) => `<div class="bar${k === 0 ? ' top' : ''}"><i style="width:${Math.round(p.score * 100 / n)}%"></i><span>${medal(k)} ${esc(p.by)}</span><b>${p.score} من ${n}</b></div>`).join('');
  return {
    body: `<button class="btn primary big" id="present">🎯 اكشفوها سؤال سؤال</button>
      ${R.players.length ? `<section class="card"><h3>🏆 مين يعرف ${esc(cfg.subject)} أكثر؟</h3>${rank}</section>` : ''}
      ${cfg.questions.map((q, qi) => `<section class="card"><h3>${esc(q.opts[0])} ولا ${esc(q.opts[1])}؟</h3>
        <p>جواب ${esc(cfg.subject)}: <b class="pink">${answer(q, qi)}</b></p>
        <p class="muted small">عرفوها: ${right(qi).map(esc).join('، ') || 'محد 😅'}</p></section>`).join('')}`,
    slides: [
      ...cfg.questions.map((q, qi) => ({
        kick: `${esc(cfg.subject)} · سؤال ${qi + 1}`, body: `<p>${esc(q.opts[0])} ولا ${esc(q.opts[1])}؟</p>`,
        ans: `${answer(q, qi)}<div class="small muted" style="margin-top:8px">عرفوها: ${right(qi).map(esc).join('، ') || 'محد'}</div>`, ansBtn: '👀 وش جاوب؟'
      })),
      { kick: `🏆 مين يعرف ${esc(cfg.subject)} أكثر؟`, body: rank || '<p>محد خمّن</p>' }
    ]
  };
}

/* ============ كبسولة الزمن ============ */
let capTimer = null;
const capOpenAt = open => dayDate(open).getTime();
const capLocked = open => Date.now() < capOpenAt(open);
async function capsuleLink(R) {
  const data = enc.encode(JSON.stringify({ t: R.title, o: R.cfg.open, p: R.cfg.prompt || '', m: R.items.map(x => x.by ? [x.text, x.by] : [x.text]) }));
  let bytes = data, tag = 'j';
  if (window.CompressionStream) {
    try { bytes = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()); tag = 'z'; }
    catch { bytes = data; tag = 'j'; }
  }
  return `${baseUrl()}#c=${tag}${b64u(bytes)}`;
}
async function readCapsule(s) {
  let bytes = unb64u(s.slice(1));
  if (s[0] === 'z') bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  const x = JSON.parse(dec.decode(bytes));
  if (!x || typeof x.t !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x.o) || !Array.isArray(x.m)) throw new Error('bad capsule');
  const items = x.m.filter(m => Array.isArray(m) && typeof m[0] === 'string').map(m => typeof m[1] === 'string' ? { text: m[0].slice(0, 2000), by: m[1].slice(0, NAME_LEN) } : { text: m[0].slice(0, 2000) });
  return { mode: 'capsule', title: x.t.slice(0, TITLE_LEN), cfg: { open: x.o, prompt: typeof x.p === 'string' ? x.p.slice(0, Q_LEN) : '' }, items, at: Date.now() };
}
async function openCapsuleLink(data) {
  try {
    const R = await readCapsule(data);
    const topic = 'cap_' + (await Crypto.sha(data)).slice(0, 16);
    if (!store.list().some(s => s.results && s.mode === 'capsule' && s.title === R.title && s.results.cfg && s.results.cfg.open === R.cfg.open && s.results.items.length === R.items.length))
      store.upsert({ topic, key: '', mode: 'capsule', title: R.title, results: R, caplink: '#c=' + data, created: Date.now() });
    renderCapsule(R, location.href);
  } catch (e) { console.error(e); brokenLink(); }
}
function renderCapsule(R, link) {
  const M = MODES.capsule, cfg = R.cfg, locked = capLocked(cfg.open);
  document.title = `${R.title} · صراحة`;
  app.innerHTML = `${revealHead(R, M, locked ? '🔒' : '⏳', `${R.items.length} رسالة · تنفتح ${esc(fmtDay(cfg.open, { day: 'numeric', month: 'long', year: 'numeric' }))}`)}
    ${locked
      ? `<div class="card center capsule"><div class="cd" id="cd"></div><p class="muted">الكبسولة مقفلة لين يجي الموعد 🔒</p></div>`
      : `${cfg.prompt ? `<div class="prompt">${esc(cfg.prompt)}</div>` : ''}<button class="btn primary big" id="present" style="margin-top:14px">📽️ افتحوها رسالة رسالة</button>
        ${R.items.map(x => `<div class="msg">${esc(x.text)}${x.by ? `<div class="by">— ${esc(x.by)}</div>` : ''}</div>`).join('')}`}
    <section class="card"><h3>🔗 رابط الكبسولة</h3>
      <p class="muted small">الرسايل محفوظة داخل الرابط نفسه، وما يحتاج سيرفر. أرسله للشلة عشان يفتحونها في موعدها من أي جهاز. (القفل في الصفحة: ما تعرض الرسايل قبل الموعد.)</p>
      <div class="row multi"><button class="btn" id="cpCap">نسخ الرابط</button><a class="btn wa" id="waCap" target="_blank" rel="noopener" href="#">واتساب</a></div>
    </section>
    ${againBtn()}`;
  const ready = link ? Promise.resolve(link) : capsuleLink(R);
  ready.then(l => {
    $('#cpCap').onclick = () => copyText(l);
    $('#waCap').href = `https://wa.me/?text=${encodeURIComponent(`⏳ كبسولة الزمن «${R.title}» تنفتح ${fmtDay(cfg.open, { day: 'numeric', month: 'long', year: 'numeric' })}:\n${l}`)}`;
  });
  if (!locked) {
    $('#present').onclick = () => present(R.items.map(x => ({ kick: x.by ? `من ${esc(x.by)}` : '💌 رسالة بدون اسم', body: `<p>${esc(x.text)}</p>` })));
    return;
  }
  const tick = () => {
    const el = $('#cd'); if (!el) return clearInterval(capTimer);
    let s = Math.max(0, Math.floor((capOpenAt(cfg.open) - Date.now()) / 1000));
    if (!s) { clearInterval(capTimer); return renderCapsule(R, link); }
    const d = Math.floor(s / 86400); s %= 86400;
    const h = Math.floor(s / 3600); s %= 3600;
    el.innerHTML = [[d, 'يوم'], [h, 'ساعة'], [Math.floor(s / 60), 'دقيقة'], [s % 60, 'ثانية']].map(([v, u]) => `<div><b>${v}</b><small>${u}</small></div>`).join('');
  };
  clearInterval(capTimer); tick(); capTimer = setInterval(tick, 1000);
}

const KINDS = { story: Story, when: When, quiz: Quiz };
