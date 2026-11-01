'use strict';
/* الدفعة الرابعة: أقرب تخمين، مزاد الشلة، وش نشوف؟، والقوائم المحفوظة الجديدة */

const strHash = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const daysBetween = (a, b) => Math.round((dayDate(b) - dayDate(a)) / 864e5);
const today = () => isoDay(new Date());
const isDayStr = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const numIn = v => { const n = parseFloat(toLatin(String(v || '')).replace(/[^\d.\-]/g, '')); return Number.isFinite(n) ? n : null; };
const fmtNum = n => Number(n).toLocaleString('en');
function gameSend(btn, fn) {
  btn.disabled = true;
  return Promise.resolve().then(fn).catch(err => { console.error(err); toast('ما وصل… تأكد من النت', true); btn.disabled = false; });
}
const playerWait = (name, msg = 'بانتظار المشرف يبدأ…') => `<div class="card center"><div class="big-ic">⏳</div><h3>أهلًا ${esc(name)}!</h3><p class="muted">${msg}</p></div>`;
async function sendToHost(my, obj) {
  const res = await Relay.post(my.topic, { v: 1, k: 'm', ...(await Crypto.sealTo(my.setup.pk, obj)) });
  onRaw(res, my);
}

/* ============ أقرب تخمين ============ */
const Guess = {
  async process(my) {
    const n = my.cfg.questions.length;
    const ev = assemble((await roomEvents(my)).filter(x => ['ask', 'show', 'end'].includes(x.s)), 'rows')
      .filter(x => x.s === 'end' || (Number.isInteger(x.i) && x.i >= 0 && x.i < n));
    ev.forEach(x => {
      x.board = validBoard(x.board);
      x.a = Number.isFinite(x.a) ? x.a : null;
      x.rows = Array.isArray(x.rows) ? x.rows.filter(r => Array.isArray(r) && typeof r[0] === 'string' && Number.isFinite(r[1])).map(([b, g, p]) => [b.slice(0, NAME_LEN), g, +p || 0]) : [];
    });
    my.qev = ev; my.state = ev.length ? ev[ev.length - 1] : null; my.msgs = [];
    if (my.isHost) {
      const a = my.secret && my.secret.a;
      my.gkey = Array.isArray(a) && a.length === n && a.every(Number.isFinite) ? a : null;
      const g = new Map();
      for (const p of await hostInbox(my)) {
        if (typeof p.by !== 'string' || !p.by.trim() || !Number.isInteger(p.i) || !Number.isFinite(p.g)) continue;
        const shown = ev.find(e => e.s === 'show' && e.i === p.i);
        if (shown && p.idx > shown.idx) continue;
        if (!g.has(p.i)) g.set(p.i, new Map());
        g.get(p.i).set(p.by.trim().slice(0, NAME_LEN), p.g);
      }
      my.guesses = g;
    }
    if (my.state && my.state.s === 'end' && !my.results) {
      my.results = { mode: my.mode, title: my.setup.title, cfg: my.cfg, board: my.state.board, at: Date.now() };
      store.upsert({ topic: my.topic, results: my.results });
    }
  },
  rows(my, i) {
    const a = my.gkey[i], pts = [300, 200, 100];
    const list = [...((my.guesses.get(i)) || new Map()).entries()].map(([by, g]) => [by, g, Math.abs(g - a)]).sort((x, y) => x[2] - y[2]);
    let rank = -1, prev = null;
    return list.map(([by, g, d], k) => { if (d !== prev) { rank = k; prev = d; } return [by, g, (rank < 3 ? pts[rank] : 0) + (d === 0 ? 200 : 0)]; });
  },
  qCard: (my, i, inner) => `<div class="card"><div class="qhead">سؤال ${i + 1} من ${my.cfg.questions.length}</div><h3 class="qq">${esc(my.cfg.questions[i].q)}</h3>${inner}</div>`,
  showHtml(my, st, me) {
    return Guess.qCard(my, st.i, `<div class="center"><small class="muted">الجواب</small><div class="bigl">${fmtNum(st.a)}</div></div>
      ${st.rows.map(([by, g, p], k) => `<div class="brow${by === me ? ' me' : ''}"><span>${p ? medal(k) : '▫️'} ${esc(by)}: <b>${fmtNum(g)}</b></span><small class="muted">${p ? '+' + p : ''}${g === st.a ? ' 🎯' : ''}</small></div>`).join('') || '<p class="muted">محد خمّن</p>'}`)
      + `<section class="card"><h3>🏆 الترتيب</h3>${boardHtml(st.board, me)}</section>`;
  },
  open() { hostGameShell(S, S.isHost ? 'خمّن <b id="count">0</b>' : '<span id="qpos">قبل البداية</span>'); Guess.update(); },
  update() {
    const my = S, st = my.state, key = (st ? st.s + st.i : 'lobby') + (my.gkey ? 'k' : '');
    const cnt = st && my.guesses ? ((my.guesses.get(st.i)) || new Map()).size : 0;
    if (my.isHost) { const c = $('#count'); if (c) c.textContent = cnt; const a = $('#acount'); if (a) a.textContent = cnt; }
    else { const q = $('#qpos'); if (q) q.textContent = st && st.s !== 'end' ? `سؤال ${st.i + 1} من ${my.cfg.questions.length}` : 'قبل البداية'; }
    if (key !== my.qdrawn) { my.qdrawn = key; Guess.draw(); }
  },
  draw() {
    const A = $('#qarea'); if (!A) return;
    A.onclick = null;
    S.isHost ? Guess.drawHost(A) : Guess.drawPlayer(A);
  },
  drawHost(A) {
    const my = S, st = my.state, n = my.cfg.questions.length;
    if (!my.gkey) { A.innerHTML = '<div class="card center"><div class="spin" style="margin:20px auto"></div><p class="muted">جاري التجهيز…</p></div>'; return; }
    if (!st || st.s === 'show') {
      const next = st ? st.i + 1 : 0;
      A.innerHTML = (st ? Guess.showHtml(my, st) : `<div class="card center"><div class="big-ic">🎯</div><h3>جاهزين؟</h3><p class="muted">كل سؤال جوابه رقم. كل واحد يخمّن من جواله، والأقرب ياخذ النقاط.</p></div>`)
        + (next < n ? `<button class="btn primary big" id="go">▶️ السؤال ${next + 1}</button>` : '') + (st ? '<button class="btn big" id="fin">🏁 النتيجة النهائية</button>' : '');
      const go = $('#go'); if (go) go.onclick = e => gameSend(e.currentTarget, () => postRoom(my, 'q', { s: 'ask', i: next }));
      const fin = $('#fin'); if (fin) fin.onclick = e => gameSend(e.currentTarget, () => postRoom(my, 'q', { s: 'end', board: st.board }));
    } else if (st.s === 'ask') {
      A.innerHTML = Guess.qCard(my, st.i, `<p class="muted center">الجواب (لك بس): <b>${fmtNum(my.gkey[st.i])}</b></p><p class="muted center">خمّن <b id="acount">0</b> لاعب</p>`) + `<button class="btn primary big" id="show">👀 اكشف الجواب</button>`;
      Guess.update();
      $('#show').onclick = e => {
        const rows = Guess.rows(my, st.i), prev = [...my.qev].reverse().find(x => x.s === 'show');
        const board = addBoard(prev ? prev.board : [], rows.map(([by, , p]) => [by, p]));
        gameSend(e.currentTarget, () => postChunked(my, 'q', { s: 'show', i: st.i, a: my.gkey[st.i], board }, 'rows', rows));
      };
    }
  },
  drawPlayer(A) {
    const my = S, st = my.state;
    if (!nameGate(A, my, () => Guess.draw())) return;
    const name = gameName(my);
    if (!st) { A.innerHTML = playerWait(name); return; }
    if (st.s === 'ask') {
      const mine = store.kv(`gg.${my.topic}.${st.i}`);
      A.innerHTML = Guess.qCard(my, st.i, `${mine !== null ? `<p class="center">تخمينك: <b>${fmtNum(mine)}</b> ✓ تقدر تغيّره</p>` : ''}
        <input id="gv" inputmode="decimal" placeholder="تخمينك (رقم)"><button class="btn primary big" id="gs">🎯 ${mine !== null ? 'تغيير التخمين' : 'إرسال'}</button>`);
      $('#gs').onclick = e => {
        const g = numIn($('#gv').value);
        if (g === null) return toast('اكتب رقم', true);
        gameSend(e.currentTarget, async () => { await sendToHost(my, { by: name, i: st.i, g }); store.kv(`gg.${my.topic}.${st.i}`, String(g)); toast('وصل تخمينك ✓'); my.qdrawn = null; Guess.update(); });
      };
    } else if (st.s === 'show') A.innerHTML = Guess.showHtml(my, st, name);
  },
  reveal() { finalPodium('🎯', 'انتهت اللعبة'); }
};

/* ============ مزاد الشلة ============ */
const BUDGET = 1000;
const Auction = {
  async process(my) {
    const n = my.cfg.questions.length;
    const ev = (await roomEvents(my)).filter(x => ['ask', 'show', 'end'].includes(x.s) && (x.s === 'end' || (Number.isInteger(x.i) && x.i >= 0 && x.i < n)));
    ev.forEach(x => {
      x.w = typeof x.w === 'string' ? x.w.slice(0, NAME_LEN) : '';
      x.p = Number.isFinite(x.p) && x.p > 0 ? Math.round(x.p) : 0;
      x.bids = Array.isArray(x.bids) ? x.bids.filter(b => Array.isArray(b) && typeof b[0] === 'string' && Number.isFinite(b[1])).slice(0, 60) : [];
    });
    my.qev = ev; my.state = ev.length ? ev[ev.length - 1] : null; my.msgs = [];
    if (my.isHost) {
      const bids = new Map();
      for (const p of await hostInbox(my)) {
        if (typeof p.by !== 'string' || !p.by.trim() || !Number.isInteger(p.i) || !Number.isFinite(p.b) || p.b < 0) continue;
        const shown = ev.find(e => e.s === 'show' && e.i === p.i);
        if (shown && p.idx > shown.idx) continue;
        if (!bids.has(p.i)) bids.set(p.i, new Map());
        bids.get(p.i).set(p.by.trim().slice(0, NAME_LEN), { b: Math.round(p.b), idx: p.idx });
      }
      my.bids = bids;
    }
    if (my.state && my.state.s === 'end' && !my.results) {
      my.results = { mode: my.mode, title: my.setup.title, cfg: my.cfg, owned: Auction.owned(my), at: Date.now() };
      store.upsert({ topic: my.topic, results: my.results });
    }
  },
  spent: (my, name) => my.qev.filter(e => e.s === 'show' && e.w === name).reduce((s, e) => s + e.p, 0),
  owned(my) {
    const m = new Map();
    for (const e of my.qev) if (e.s === 'show' && e.w) { if (!m.has(e.w)) m.set(e.w, []); m.get(e.w).push(my.cfg.questions[e.i].q); }
    for (const e of my.qev) for (const [by] of e.bids) if (!m.has(by)) m.set(by, []);
    return [...m.entries()].map(([n, items]) => [n, items, BUDGET - Auction.spent(my, n)]).sort((a, b) => b[1].length - a[1].length || b[2] - a[2]);
  },
  ownedHtml: (list, me) => list.length ? list.map(([n, items, left]) => `<div class="brow${n === me ? ' me' : ''}"><span><b>${esc(n)}</b>${items.length ? ': ' + items.map(esc).join('، ') : ' <small class="muted">ما اشترى شي</small>'}</span><small class="muted">💰 ${left}</small></div>`).join('') : '<p class="muted">محد زايد للحين</p>',
  itemCard: (my, i, inner) => `<div class="card center"><div class="qhead">الغرض ${i + 1} من ${my.cfg.questions.length}</div><div class="auc">${esc(my.cfg.questions[i].q)}</div>${inner}</div>`,
  showHtml(my, st, me) {
    return Auction.itemCard(my, st.i, st.w ? `<p>🔨 راح لـ <b class="pink">${esc(st.w)}</b> بـ <b>${st.p}</b></p>` : '<p class="muted">محد زايد عليه 🤷</p>')
      + (st.bids.length ? `<section class="card"><h3>المزايدات</h3>${st.bids.map(([b, v]) => `<div class="brow"><span>${esc(b)}</span><b>${v}</b></div>`).join('')}</section>` : '')
      + `<section class="card"><h3>🛍️ مقتنيات الشلة</h3>${Auction.ownedHtml(Auction.owned(my), me)}</section>`;
  },
  open() { hostGameShell(S, S.isHost ? 'زايد <b id="count">0</b>' : '<span id="qpos">قبل البداية</span>'); Auction.update(); },
  update() {
    const my = S, st = my.state, key = st ? st.s + st.i : 'lobby';
    const cnt = st && my.bids ? ((my.bids.get(st.i)) || new Map()).size : 0;
    if (my.isHost) { const c = $('#count'); if (c) c.textContent = cnt; const a = $('#acount'); if (a) a.textContent = cnt; }
    else { const q = $('#qpos'); if (q) q.textContent = st && st.s !== 'end' ? `الغرض ${st.i + 1} من ${my.cfg.questions.length}` : 'قبل البداية'; }
    if (key !== my.qdrawn) { my.qdrawn = key; Auction.draw(); }
  },
  draw() {
    const A = $('#qarea'); if (!A) return;
    S.isHost ? Auction.drawHost(A) : Auction.drawPlayer(A);
  },
  drawHost(A) {
    const my = S, st = my.state, n = my.cfg.questions.length;
    if (!st || st.s === 'show') {
      const next = st ? st.i + 1 : 0;
      A.innerHTML = (st ? Auction.showHtml(my, st) : `<div class="card center"><div class="big-ic">🔨</div><h3>جاهزين؟</h3><p class="muted">كل واحد معه ${BUDGET} ريال وهمي. كل غرض يزايدون عليه بالسر، وأعلى واحد ياخذه.</p></div>`)
        + (next < n ? `<button class="btn primary big" id="go">▶️ الغرض ${next + 1}</button>` : '') + (st ? '<button class="btn big" id="fin">🏁 خلّصوا المزاد</button>' : '');
      const go = $('#go'); if (go) go.onclick = e => gameSend(e.currentTarget, () => postRoom(my, 'q', { s: 'ask', i: next }));
      const fin = $('#fin'); if (fin) fin.onclick = e => gameSend(e.currentTarget, () => postRoom(my, 'q', { s: 'end' }));
    } else if (st.s === 'ask') {
      A.innerHTML = Auction.itemCard(my, st.i, `<p class="muted">زايد <b id="acount">0</b> لاعب</p>`) + `<button class="btn primary big" id="sell">🔨 بيع!</button>`;
      Auction.update();
      $('#sell').onclick = e => {
        // المزايدة اللي أكبر من الرصيد ما تُحسب
        const list = [...((my.bids.get(st.i)) || new Map()).entries()].filter(([by, x]) => x.b > 0 && x.b <= BUDGET - Auction.spent(my, by)).sort((a, b) => b[1].b - a[1].b || a[1].idx - b[1].idx);
        const top = list[0];
        gameSend(e.currentTarget, () => postRoom(my, 'q', { s: 'show', i: st.i, w: top ? top[0] : '', p: top ? top[1].b : 0, bids: list.map(([by, x]) => [by, x.b]).slice(0, 40) }));
      };
    }
  },
  drawPlayer(A) {
    const my = S, st = my.state;
    if (!nameGate(A, my, () => Auction.draw())) return;
    const name = gameName(my), left = BUDGET - Auction.spent(my, name);
    if (!st) { A.innerHTML = playerWait(name, `معك ${BUDGET} ريال وهمي. بانتظار المشرف يبدأ المزاد…`); return; }
    if (st.s === 'ask') {
      const mine = store.kv(`ab.${my.topic}.${st.i}`);
      A.innerHTML = Auction.itemCard(my, st.i, `<p>💰 رصيدك: <b>${left}</b></p>${mine !== null ? `<p class="muted">مزايدتك: <b>${mine}</b> ✓ تقدر تغيّرها</p>` : ''}
        <input id="bv" inputmode="numeric" placeholder="كم تدفع؟"><button class="btn primary big" id="bs">🔨 زايد بالسر</button>`);
      $('#bs').onclick = e => {
        const b = numIn($('#bv').value);
        if (b === null || b < 0) return toast('اكتب مبلغ', true);
        if (b > left) return toast(`رصيدك ${left} بس`, true);
        gameSend(e.currentTarget, async () => { await sendToHost(my, { by: name, i: st.i, b: Math.round(b) }); store.kv(`ab.${my.topic}.${st.i}`, String(Math.round(b))); toast('وصلت مزايدتك ✓'); my.qdrawn = null; Auction.update(); });
      };
    } else if (st.s === 'show') A.innerHTML = Auction.showHtml(my, st, name);
  },
  reveal() {
    const R = S.results, me = gameName(S);
    document.title = `${R.title} · صراحة`;
    app.innerHTML = `${revealHead(R, S.M, '🔨', 'انتهى المزاد')}<section class="card"><h3>🛍️ وش طلع مع كل واحد؟</h3>${Auction.ownedHtml(R.owned || [], me)}</section>${againBtn()}`;
  }
};

/* ============ وش نشوف؟ (اقتراحات ثم تصويت بالإقصاء) ============ */
const Movie = {
  async process(my) {
    const ev = (await roomEvents(my)).filter(x => ['round', 'win'].includes(x.s));
    ev.forEach(x => {
      x.alive = strArr(x.alive, 20, 80);
      x.out = strArr(x.out, 20, 80);
      x.counts = Array.isArray(x.counts) ? x.counts.map(v => +v || 0) : [];
      x.prev = strArr(x.prev, 20, 80);
      x.w = typeof x.w === 'string' ? x.w.slice(0, 80) : '';
    });
    my.qev = ev; my.state = ev.length ? ev[ev.length - 1] : null;
    const firstRound = ev.find(x => x.s === 'round'), seen = new Set(), sugg = [];
    for (const r of my.raws) {
      if (r.env.k !== 'x' || r.idx < my.setupIdx || (firstRound && r.idx > firstRound.idx)) continue;
      const x = await roomOpen(my, r);
      if (!x || typeof x.text !== 'string') continue;
      const t = x.text.trim().slice(0, 80), k = abcNorm(t);
      if (t && !seen.has(k)) { seen.add(k); sugg.push(t); }
    }
    my.sugg = sugg; my.msgs = sugg;
    if (my.isHost) {
      const votes = new Map();
      for (const p of await hostInbox(my)) {
        if (typeof p.bid !== 'string' || !Number.isInteger(p.r) || !Number.isInteger(p.v)) continue;
        const after = ev.find(e => e.idx > p.idx && (e.s === 'win' || (e.s === 'round' && e.r > p.r)));
        if (after) continue;
        if (!votes.has(p.r)) votes.set(p.r, new Map());
        votes.get(p.r).set(p.bid.slice(0, 40), p.v);
      }
      my.votes = votes;
    }
    if (my.state && my.state.s === 'win' && !my.results) {
      my.results = { mode: my.mode, title: my.setup.title, cfg: my.cfg, winner: my.state.w, at: Date.now() };
      store.upsert({ topic: my.topic, results: my.results });
    }
  },
  counts(my, st) { const c = st.alive.map(() => 0); for (const v of ((my.votes && my.votes.get(st.r)) || new Map()).values()) if (v >= 0 && v < c.length) c[v]++; return c; },
  open() {
    const my = S;
    document.title = `${my.setup.title} · صراحة`;
    app.innerHTML = `${sessionHead(my.setup.title)}${liveBar('<b id="count">0</b> اقتراح')}${my.isHost ? `<details class="card"${my.state ? '' : ' open'}><summary>📨 رابط الدعوة ورابط المشرف</summary>${hostPanel().replace('<section class="card share">', '<section class="share">')}</details>` : ''}<div id="qarea"></div>${howCard(my.M)}${privacyNote(my.M)}`;
    if (my.isHost) bindHost();
    my.qdrawn = null; Movie.update();
  },
  update() {
    const my = S, st = my.state, key = st ? st.s + (st.r ?? '') : 'lobby';
    if (key !== my.qdrawn) { my.qdrawn = key; Movie.draw(); return; }
    if (!st) { const l = $('#slist'); if (l) l.innerHTML = Movie.suggHtml(my); }
    else if (my.isHost && st.s === 'round') { const c = Movie.counts(my, st); $$('[data-cnt]').forEach(el => { el.textContent = c[+el.dataset.cnt]; }); }
  },
  suggHtml: my => my.sugg.length ? my.sugg.map(t => `<div class="brow"><span>🎬 ${esc(t)}</span></div>`).join('') : '<p class="muted">ما فيه اقتراحات للحين.</p>',
  draw() {
    const my = S, st = my.state, A = $('#qarea'); if (!A) return;
    A.onclick = null;
    if (!st) {
      A.innerHTML = `<section class="card"><h3>💡 اقترح</h3><div class="addrow"><input id="si" maxlength="80" placeholder="اسم فيلم، مسلسل، أو أي خيار"><button class="btn" id="sa">إضافة</button></div></section>
        <section class="card"><h3>📋 الاقتراحات</h3><div id="slist">${Movie.suggHtml(my)}</div></section>
        ${my.isHost ? '<button class="btn primary big" id="start">🗳️ ابدأ التصويت</button>' : '<p class="muted center">لما تخلص الاقتراحات، المشرف يبدأ التصويت.</p>'}`;
      const add = e => {
        const t = $('#si').value.trim().slice(0, 80);
        if (!t) return;
        if (Polish.isRude(t)) return toast(RUDE_MSG, true);
        $('#si').value = '';
        gameSend(e.currentTarget || $('#sa'), async () => { await postRoom(my, 'x', { text: t }); $('#sa').disabled = false; });
      };
      $('#sa').onclick = add;
      $('#si').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add({ currentTarget: $('#sa') }); } };
      const s = $('#start');
      if (s) s.onclick = e => { if (my.sugg.length < 2) return toast('يحتاج اقتراحين على الأقل', true); gameSend(e.currentTarget, () => postRoom(my, 'q', { s: 'round', r: 0, alive: my.sugg.slice(0, 20) })); };
      return;
    }
    if (st.s === 'win') return;
    const lastOut = st.out && st.out.length ? `<p class="muted center">طلع من الجولة اللي فاتت: ${st.out.map(esc).join('، ')}</p>` : '';
    if (my.isHost) {
      const c = Movie.counts(my, st);
      A.innerHTML = `<div class="card"><div class="qhead">الجولة ${st.r + 1} · باقي ${st.alive.length}</div>${lastOut}
        ${st.alive.map((t, i) => `<div class="brow"><span>🎬 ${esc(t)}</span><b data-cnt="${i}">${c[i]}</b></div>`).join('')}</div>
        <button class="btn primary big" id="cut">${st.alive.length <= 2 ? '🏆 اعلن الفايز' : '✂️ اطلّع الأقل أصوات'}</button>`;
      $('#cut').onclick = e => {
        const cn = Movie.counts(my, st);
        if (st.alive.length <= 2) {
          const top = Math.max(...cn), best = st.alive.filter((_, i) => cn[i] === top);
          return gameSend(e.currentTarget, () => postRoom(my, 'q', { s: 'win', w: randOf(best), counts: cn, prev: st.alive }));
        }
        const low = Math.min(...cn);
        let out = st.alive.filter((_, i) => cn[i] === low);
        if (out.length >= st.alive.length - 1) out = [randOf(out)];
        gameSend(e.currentTarget, () => postRoom(my, 'q', { s: 'round', r: st.r + 1, alive: st.alive.filter(t => !out.includes(t)), out }));
      };
    } else {
      const key = `mv.${my.topic}.${st.r}`, mine = store.kv(key);
      A.innerHTML = `<div class="card"><div class="qhead">الجولة ${st.r + 1} · باقي ${st.alive.length}</div>${lastOut}
        <p class="muted">${mine !== null ? 'صوّتت ✓ تقدر تغيّر صوتك.' : 'صوّت للي تبيه يبقى:'}</p>
        ${st.alive.map((t, i) => `<button class="qopt fun${mine === String(i) ? ' picked' : ''}" data-v="${i}" style="--c:var(--card2)">🎬 ${esc(t)}</button>`).join('')}</div>`;
      A.onclick = e => {
        const b = e.target.closest('[data-v]'); if (!b) return;
        let bid = store.kv('bid.' + my.topic);
        if (!bid) { bid = b64u(crypto.getRandomValues(new Uint8Array(12))); store.kv('bid.' + my.topic, bid); }
        sendToHost(my, { bid, r: st.r, v: +b.dataset.v }).then(() => { store.kv(key, b.dataset.v); my.qdrawn = null; Movie.update(); toast('تم احتساب صوتك ✓'); }).catch(() => toast('ما وصل… جرّب مرة ثانية', true));
      };
    }
  },
  reveal() {
    const R = S.results;
    document.title = `${R.title} · صراحة`;
    app.innerHTML = `${revealHead(R, S.M, '🍿', 'قرّرت الشلة')}<div class="card pick center"><small>بتشوفون</small><div class="gname">🎬 ${esc(R.winner)}</div></div>${againBtn()}`;
  }
};

Object.assign(KINDS, { guess: Guess, auction: Auction, movie: Movie });

/* ============ القوائم المحفوظة الجديدة ============ */
const onKey = (sel, fn) => { const el = $(sel); if (el) el.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); fn(); } }; };

// بطولة الشلة: جدول خروج المغلوب
BOARDS.tourney = {
  live: 'خلصت <b id="count">0</b> مباراة', named: false, shareHint: 'أي أحد معه الرابط يقدر يسجّل النتائج.',
  valid: (e, base, s) => e.k === 'm' ? { ...base, k: 'm', w: s(e.w, NAME_LEN), sc: s(e.sc, 12) } : null,
  count: my => [...my.bstate.values()].filter(e => !e.del && e.k === 'm' && e.w),
  rounds(names, res) {
    const n = names.length, size = 2 ** Math.ceil(Math.log2(Math.max(2, n))), byes = size - n, p = names.slice();
    let cur = [];
    for (let k = 0; k < size / 2; k++) cur.push(k < byes ? [p.shift(), null] : [p.shift(), p.shift()]);
    const rounds = [];
    for (let r = 0; ; r++) {
      const ms = cur.map(([a, b], m) => {
        const id = `m${r}_${m}`, e = res.get(id), bye = r === 0 && (!a || !b);
        let w = null;
        if (bye) w = a || b;
        else if (a && b && e && (e.w === a || e.w === b)) w = e.w;
        return { id, a, b, w, bye, sc: e && w ? e.sc : '' };
      });
      rounds.push(ms);
      if (ms.length === 1) break;
      cur = [];
      for (let m = 0; m < ms.length; m += 2) cur.push([ms[m].w, ms[m + 1].w]);
    }
    return rounds;
  },
  bind(my) {
    $('#blist').onclick = e => {
      const b = e.target.closest('[data-w]'); if (!b) return;
      const cur = my.bstate.get(b.dataset.m), w = cur && cur.w === b.dataset.w ? '' : b.dataset.w;
      Board.put(my, [{ id: b.dataset.m, k: 'm', w, sc: cur ? cur.sc : '' }]);
    };
    $('#blist').addEventListener('change', e => {
      const i = e.target.closest('.scin'); if (!i) return;
      const cur = my.bstate.get(i.dataset.m);
      if (cur && cur.w) Board.put(my, [{ ...cur, sc: i.value.trim().slice(0, 12) }]);
    });
  },
  render(my, L, live) {
    const res = new Map(live.filter(e => e.k === 'm').map(e => [e.id, e]));
    const rounds = BOARDS.tourney.rounds(my.cfg.names, res), champ = rounds[rounds.length - 1][0].w;
    const label = (ms, r) => ms.length === 1 ? '🏆 النهائي' : ms.length === 2 ? 'نصف النهائي' : ms.length === 4 ? 'ربع النهائي' : `الدور ${r + 1}`;
    const side = (m, x) => x ? `<button class="pl${m.w === x ? ' win' : ''}" data-m="${m.id}" data-w="${esc(x)}">${m.w === x ? '✅ ' : ''}${esc(x)}</button>` : '<span class="pl pend">⏳ بانتظار</span>';
    L.innerHTML = `${champ ? `<div class="card pick center"><small>بطل البطولة</small><div class="gname">🏆 ${esc(champ)}</div></div>` : '<p class="hint center">اضغط على الفايز في كل مباراة.</p>'}
      ${rounds.map((ms, r) => `<section class="card"><h3>${label(ms, r)}</h3>${ms.map(m => m.bye
        ? `<div class="match bye">${esc(m.w)} <small class="muted">يتأهل مباشرة</small></div>`
        : `<div class="match">${side(m, m.a)}<span class="vs">ضد</span>${side(m, m.b)}${m.w ? `<input class="scin" data-m="${m.id}" maxlength="12" placeholder="النتيجة" value="${esc(m.sc)}">` : ''}</div>`).join('')}</section>`).join('')}`;
  }
};

// الجمعية الشهرية
const monthLabel = (start, i) => { const [y, m] = start.split('-').map(Number); try { return new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1 + i, 1)); } catch { return `${m + i}/${y}`; } };
const monthIdx = start => { const [y, m] = start.split('-').map(Number), d = new Date(); return (d.getFullYear() - y) * 12 + (d.getMonth() + 1 - m); };
BOARDS.jamia = {
  live: 'دفع <b id="count">0</b> هالشهر', named: false,
  valid: (e, base) => e.k === 'p' ? { ...base, k: 'p', paid: !!e.paid } : null,
  count(my) { const i = Math.max(0, Math.min(my.cfg.names.length - 1, monthIdx(my.cfg.start))); return [...my.bstate.values()].filter(e => !e.del && e.k === 'p' && e.paid && e.id.startsWith(i + '|')); },
  bind(my) {
    $('#blist').onclick = e => {
      const b = e.target.closest('[data-p]'); if (!b) return;
      const cur = my.bstate.get(b.dataset.p);
      Board.put(my, [{ id: b.dataset.p, k: 'p', paid: !(cur && cur.paid) }]);
    };
  },
  render(my, L, live) {
    const { names, amount, start } = my.cfg, n = names.length, total = amount * n, now = monthIdx(start);
    const paid = new Set(live.filter(e => e.k === 'p' && e.paid).map(e => e.id));
    const cur = Math.max(0, Math.min(n - 1, now));
    L.innerHTML = `<div class="card pick center"><small>${now < 0 ? 'أول شهر' : now >= n ? 'خلصت الجمعية' : 'هالشهر'} · ${esc(monthLabel(start, cur))}</small>
        <div class="gname">${esc(names[cur])}</div><p class="muted">يستلم ${fmtNum(total)} ريال · دفع ${names.filter(x => paid.has(cur + '|' + x)).length} من ${n}</p></div>
      ${names.map((rcv, i) => `<details class="card month${i === cur ? ' now' : ''}"${i === cur ? ' open' : ''}><summary>${i + 1}. ${esc(monthLabel(start, i))} — <b>${esc(rcv)}</b> <small class="muted">(${names.filter(x => paid.has(i + '|' + x)).length}/${n})</small></summary>
        <p class="hint">اضغط على اللي دفع (${fmtNum(amount)} ريال لكل واحد):</p>
        <div class="chips">${names.map(x => `<button class="chip${paid.has(i + '|' + x) ? ' on' : ''}" data-p="${esc(i + '|' + x)}">${paid.has(i + '|' + x) ? '✅ ' : ''}${esc(x)}</button>`).join('')}</div></details>`).join('')}`;
  }
};

// دور الحساب
BOARDS.turn = {
  live: 'سجّلتوا <b id="count">0</b> مرة', named: false,
  valid: (e, base, s) => e.k === 't' ? { ...base, k: 't', who: s(e.who, NAME_LEN), note: s(e.note, 40), skip: !!e.skip } : null,
  count: my => [...my.bstate.values()].filter(e => !e.del && e.k === 't'),
  due(names, ev) { if (!ev.length) return names[0]; const i = names.indexOf(ev[ev.length - 1].who); return names[(i + 1) % names.length]; },
  bind(my) {
    $('#blist').onclick = e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const note = ($('#tnote') || {}).value || '';
      if (b.dataset.act === 'pay') Board.put(my, [{ id: ID(), k: 't', who: b.dataset.who, note: note.trim().slice(0, 40), skip: false }]);
      else if (b.dataset.act === 'skip') Board.put(my, [{ id: ID(), k: 't', who: b.dataset.who, note: '', skip: true }]);
      else if (b.dataset.act === 'other') { const w = $('#tother').value; if (w) Board.put(my, [{ id: ID(), k: 't', who: w, note: note.trim().slice(0, 40), skip: false }]); }
      else if (b.dataset.act === 'del') { const it = my.bstate.get(b.dataset.id); if (it && confirm('تحذف هالتسجيل؟')) Board.put(my, [{ ...it, del: true }]); }
    };
  },
  render(my, L, live) {
    const names = my.cfg.names, ev = live.filter(e => e.k === 't').sort((a, b) => a.c - b.c), due = BOARDS.turn.due(names, ev);
    const times = n => ev.filter(e => e.who === n && !e.skip).length;
    L.innerHTML = `<div class="card pick center"><small>الدور على</small><div class="gname">${esc(due)}</div>
        <input id="tnote" maxlength="40" placeholder="على وش؟ (مثلًا: عشاء الخميس)" style="margin-top:8px">
        <div class="row"><button class="btn primary grow" data-act="pay" data-who="${esc(due)}">✅ ${esc(due)} دفع</button><button class="btn ghost" data-act="skip" data-who="${esc(due)}">⏭️ تخطي</button></div>
        <div class="addrow" style="margin-top:10px"><select id="tother" class="sel">${names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select><button class="btn" data-act="other">دفع شخص ثاني</button></div></div>
      <section class="card"><h3>👥 الترتيب</h3>${names.map(n => `<div class="brow${n === due ? ' me' : ''}"><span>${n === due ? '👉 ' : ''}${esc(n)}</span><small class="muted">دفع ${times(n)} مرة</small></div>`).join('')}</section>
      <section class="card"><h3>📜 السجل</h3>${ev.length ? [...ev].reverse().slice(0, 40).map(e => `<div class="brow"><span>${e.skip ? '⏭️' : '✅'} ${esc(e.who)}${e.note ? ` <small class="muted">— ${esc(e.note)}</small>` : ''}</span><small class="muted">${esc(fmtDay(isoDay(new Date(e.c)), { day: 'numeric', month: 'short' }))}</small><button class="x" data-act="del" data-id="${e.id}">✕</button></div>`).join('') : '<p class="muted">ما فيه تسجيلات للحين</p>'}</section>`;
  }
};

// قائمة أمنياتي: الحجز مخفي عن صاحب الأمنية
BOARDS.wish = {
  live: '<b id="count">0</b> أمنية', namePh: 'اسمك (عشان تضيف أمنياتك وتحجز)', shareHint: 'كل واحد يضيف أمنياته، والباقي يحجزون الهدايا بالسر عن صاحبها.',
  valid: (e, base, s) => e.k === 'w' ? { ...base, k: 'w', owner: s(e.owner, NAME_LEN), name: s(e.name, 60) } : e.k === 'c' ? { ...base, k: 'c', w: s(e.w, 20), by: s(e.by, NAME_LEN) } : null,
  count: my => [...my.bstate.values()].filter(e => !e.del && e.k === 'w'),
  html: () => `<section class="card"><h3>🎁 أضف أمنية لك</h3><div class="addrow"><input id="wi" maxlength="60" placeholder="وش تتمنى؟ (مثلًا: عطر، ساعة…)"><button class="btn" id="wadd">إضافة</button></div></section>`,
  bind(my) {
    const add = () => { const name = $('#wi').value.trim().slice(0, 60), me = Board.me(); if (!name || !me) return; $('#wi').value = ''; Board.put(my, [{ id: ID(), k: 'w', owner: me, name }]); };
    $('#wadd').onclick = add; onKey('#wi', add);
    $('#blist').onclick = e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const id = b.dataset.id;
      if (b.dataset.act === 'claim') { const me = Board.me(); if (me) Board.put(my, [{ id: id + '|c', k: 'c', w: id, by: me }]); }
      else if (b.dataset.act === 'unclaim') Board.put(my, [{ id: id + '|c', k: 'c', w: id, by: '' }]);
      else if (b.dataset.act === 'del') { const it = my.bstate.get(id); if (it && confirm(`تحذف «${it.name}»؟`)) Board.put(my, [{ ...it, del: true }]); }
    };
  },
  render(my, L, live, me) {
    const wishes = live.filter(e => e.k === 'w').sort((a, b) => a.c - b.c), claim = id => (my.bstate.get(id + '|c') || {}).by || '';
    const mine = wishes.filter(w => me && w.owner === me), owners = [...new Set(wishes.filter(w => w.owner !== me).map(w => w.owner))];
    L.innerHTML = `${me ? `<section class="card"><h3>🎁 أمنياتي</h3>${mine.length ? mine.map(w => `<div class="brow"><span>${esc(w.name)}</span><button class="x" data-act="del" data-id="${w.id}">✕</button></div>`).join('') : '<p class="muted">ما أضفت أمنيات للحين.</p>'}<p class="hint">ما تقدر تشوف مين حجز أمنياتك، عشان تبقى مفاجأة 🤫</p></section>` : ''}
      ${owners.length ? owners.map(o => `<section class="card"><h3>💝 أمنيات ${esc(o)}</h3>${wishes.filter(w => w.owner === o).map(w => {
        const by = claim(w.id);
        return `<div class="brow"><span>${esc(w.name)}</span>${!by ? `<button class="btn sm" data-act="claim" data-id="${w.id}">🎁 أنا بجيبها</button>` : by === me ? `<span><small class="pink">أنت بتجيبها ✓</small> <button class="btn ghost sm" data-act="unclaim" data-id="${w.id}">ألغي</button></span>` : `<small class="muted">محجوزة لـ ${esc(by)} 🔒</small>`}</div>`;
      }).join('')}</section>`).join('') : '<p class="muted center">ما أحد أضاف أمنياته للحين.</p>'}`;
  }
};

// صندوق الاقتراحات: بدون أسماء
const voterId = () => { let v = store.kv('voter'); if (!v) { v = b64u(crypto.getRandomValues(new Uint8Array(8))); store.kv('voter', v); } return v; };
BOARDS.box = {
  live: '<b id="count">0</b> اقتراح', named: false, shareHint: 'أي أحد معه الرابط يقدر يضيف اقتراح بدون اسمه.',
  valid: (e, base, s) => e.k === 's' ? { ...base, k: 's', text: s(e.text, 400), done: !!e.done, img: s(e.img, 16) } : e.k === 'v' ? { ...base, k: 'v', s: s(e.s, 20), v: e.v ? 1 : 0 } : null,
  count: my => [...my.bstate.values()].filter(e => !e.del && e.k === 's'),
  html: my => `<section class="card"><h3>💡 اقتراح جديد</h3><textarea id="bx" maxlength="400" placeholder="اكتب اقتراحك أو ملاحظتك… بدون اسمك"></textarea>
    ${Photos.picker('bimg')}<p class="hint">الصورة تُصغَّر وتُحذف منها بياناتها المخفية (مثل المكان) قبل الإرسال.${isFb(my.topic) ? '' : ' وتبقى على السيرفر 12 ساعة، وبعدها تبقى بس في الجوالات اللي شافتها.'}</p>
    <div class="err" id="err"></div><button class="btn primary big" id="bsend">🔒 إرسال بدون اسم</button></section>`,
  bind(my) {
    const pick = Photos.bindPicker('bimg');
    $('#bsend').onclick = async e => {
      const raw = $('#bx').value.trim();
      if (raw.length < 3) return ($('#err').textContent = 'اكتب اقتراحك أول');
      const text = Polish.polish(raw).slice(0, 400);
      if (!text) return ($('#err').textContent = 'الاقتراح فاضي بعد التصحيح');
      if (Polish.isRude(text)) return ($('#err').textContent = RUDE_MSG);
      const btn = e.currentTarget; btn.disabled = true;
      let img = '';
      try { img = await Photos.attach(my, pick); } catch { btn.disabled = false; return toast('ما وصلت الصورة… جرّب مرة ثانية', true); }
      btn.disabled = false;
      $('#bx').value = ''; $('#err').textContent = '';
      Board.put(my, [{ id: ID(), k: 's', text, done: false, img }]); toast('تم إرسال اقتراحك بدون اسم ✓');
    };
    $('#blist').onclick = e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const id = b.dataset.id, it = my.bstate.get(id);
      if (b.dataset.act === 'up') { const vid = id + '|' + voterId(), cur = my.bstate.get(vid); Board.put(my, [{ id: vid, k: 'v', s: id, v: cur && cur.v ? 0 : 1 }]); }
      else if (b.dataset.act === 'done' && it) Board.put(my, [{ ...it, done: !it.done }]);
      else if (b.dataset.act === 'del' && it && confirm('تحذف الاقتراح؟')) Board.put(my, [{ ...it, del: true }]);
    };
  },
  render(my, L, live) {
    const votes = id => live.filter(e => e.k === 'v' && e.s === id && e.v).length, mine = id => { const v = my.bstate.get(id + '|' + voterId()); return v && v.v; };
    const list = live.filter(e => e.k === 's').map(e => ({ e, n: votes(e.id) })).sort((a, b) => a.e.done - b.e.done || b.n - a.n || b.e.c - a.e.c);
    L.innerHTML = list.length ? list.map(({ e, n }) => `<div class="card sug${e.done ? ' done' : ''}"><p>${esc(e.text)}</p>${Photos.html(e.img)}
      <div class="row"><button class="btn sm${mine(e.id) ? ' primary' : ''}" data-act="up" data-id="${e.id}">👍 ${n}</button><button class="btn ghost sm" data-act="done" data-id="${e.id}">${e.done ? '↩️ رجّعه' : '✅ تم'}</button><span class="grow"></span><button class="x" data-act="del" data-id="${e.id}">✕</button></div></div>`).join('')
      : emptyCard('الصندوق فاضي. أول اقتراح عليك 💡');
  }
};

// ذكريات الشلة
BOARDS.memories = {
  live: '<b id="count">0</b> ذكرى', namePh: 'اسمك (اختياري)',
  valid: (e, base, s) => e.k === 'm' && isDayStr(e.day) ? { ...base, k: 'm', day: e.day, text: s(e.text, 400), by: s(e.by, NAME_LEN), img: s(e.img, 16) } : null,
  count: my => [...my.bstate.values()].filter(e => !e.del && e.k === 'm'),
  html: my => `<section class="card"><h3>✍️ أضف ذكرى</h3><input type="date" id="md" value="${today()}"><textarea id="mt" maxlength="400" placeholder="وش صار؟ (مثلًا: أول كشتة لنا، وضاع الفحم 😂)"></textarea>
    ${Photos.picker('mimg')}${isFb(my.topic) ? '' : '<p class="hint">الصور تبقى على السيرفر 12 ساعة، وبعدها تبقى بس في الجوالات اللي شافتها. (تبقى دايم لو تفعّلت الجلسات الطويلة)</p>'}
    <button class="btn primary big" id="madd">إضافة الذكرى</button></section><button class="btn big" id="mshow">📽️ اعرضوا الذكريات</button>`,
  bind(my) {
    const pick = Photos.bindPicker('mimg');
    $('#madd').onclick = async e => {
      const day = $('#md').value, text = $('#mt').value.trim().slice(0, 400);
      if (!isDayStr(day)) return toast('اختر التاريخ', true);
      if (text.length < 3) return toast('اكتب الذكرى', true);
      const btn = e.currentTarget; btn.disabled = true;
      let img = '';
      try { img = await Photos.attach(my, pick); } catch { btn.disabled = false; return toast('ما وصلت الصورة… جرّب مرة ثانية', true); }
      btn.disabled = false;
      $('#mt').value = '';
      Board.put(my, [{ id: ID(), k: 'm', day, text, img, by: (($('#wname') || {}).value || '').trim().slice(0, NAME_LEN) }]);
      if (img) toast('تمت إضافة الذكرى مع الصورة ✓');
    };
    $('#mshow').onclick = () => present([...my.bstate.values()].filter(e => !e.del && e.k === 'm').sort((a, b) => a.day.localeCompare(b.day))
      .map(e => ({ kick: esc(fmtDay(e.day, { day: 'numeric', month: 'long', year: 'numeric' })), body: `${Photos.url(my, e.img) ? `<img class="pimg" src="${esc(Photos.url(my, e.img))}" alt="">` : ''}<p>${esc(e.text)}</p>${e.by ? `<div class="pans">— ${esc(e.by)}</div>` : ''}` })));
    $('#blist').onclick = e => { const b = e.target.closest('[data-del]'); if (!b) return; const it = my.bstate.get(b.dataset.del); if (it && confirm('تحذف الذكرى؟')) Board.put(my, [{ ...it, del: true }]); };
  },
  render(my, L, live) {
    const list = live.filter(e => e.k === 'm').sort((a, b) => b.day.localeCompare(a.day) || b.c - a.c);
    const years = [...new Set(list.map(e => e.day.slice(0, 4)))];
    L.innerHTML = list.length ? years.map(y => `<h3 class="sec">${y}</h3>${list.filter(e => e.day.startsWith(y)).map(e => `<div class="card mem"><div class="gh"><small class="pink">${esc(fmtDay(e.day, { day: 'numeric', month: 'long' }))}</small><button class="x" data-del="${e.id}">✕</button></div><p>${esc(e.text)}</p>${Photos.html(e.img)}${e.by ? `<small class="muted">— ${esc(e.by)}</small>` : ''}</div>`).join('')}`).join('')
      : emptyCard('ما فيه ذكريات للحين. أضيفوا أول ذكرى 📸');
  }
};

// سؤال اليوم
BOARDS.daily = {
  live: 'جاوب اليوم <b id="count">0</b>', namePh: 'اسمك',
  valid: (e, base, s) => e.k === 'a' && isDayStr(e.day) ? { ...base, k: 'a', day: e.day, by: s(e.by, NAME_LEN), text: s(e.text, 300) } : null,
  count: my => [...my.bstate.values()].filter(e => !e.del && e.k === 'a' && e.day === today() && e.text),
  q(my, day) { const list = dailyQuestions(my.cfg.pack), n = list.length, k = (daysBetween(my.cfg.start, day) + (my.cfg.pack ? 0 : strHash(my.topic))) % n; return list[(k + n) % n]; },
  bind(my) {
    $('#blist').onclick = e => {
      const b = e.target.closest('#dsave'); if (!b) return;
      const me = Board.me(); if (!me) return;
      const text = $('#da').value.trim().slice(0, 300);
      if (!text) return toast('اكتب جوابك', true);
      Board.put(my, [{ id: today() + '|' + me, k: 'a', day: today(), by: me, text }]); toast('تم حفظ جوابك ✓');
    };
  },
  render(my, L, live, me) {
    const d = today(), ans = day => live.filter(e => e.k === 'a' && e.day === day && e.text);
    const mine = ans(d).find(a => a.by === me), others = ans(d).filter(a => a.by !== me);
    const past = Array.from({ length: 14 }, (_, i) => { const x = new Date(); x.setDate(x.getDate() - i - 1); return isoDay(x); }).filter(day => day >= my.cfg.start);
    L.innerHTML = `<div class="card"><small class="pink">${esc(fmtDay(d))}</small><h3 class="qq">${esc(BOARDS.daily.q(my, d))}</h3>
        <textarea id="da" maxlength="300" placeholder="جوابك…">${esc(mine ? mine.text : '')}</textarea><button class="btn primary big" id="dsave">${mine ? 'تعديل جوابي' : 'حفظ جوابي'}</button></div>
      <section class="card"><h3>💬 أجوبة الشلة</h3>${mine ? (others.length ? others.map(a => `<div class="brow"><span><b>${esc(a.by)}:</b> ${esc(a.text)}</span></div>`).join('') : '<p class="muted">محد جاوب غيرك للحين.</p>') : `<p class="muted">جاوب أول عشان تشوف أجوبتهم 👀 (جاوب ${others.length})</p>`}</section>
      ${past.length ? `<details class="card"><summary>📅 الأيام اللي فاتت</summary>${past.map(day => `<div class="past"><small class="pink">${esc(fmtDay(day, { weekday: 'long', day: 'numeric', month: 'short' }))}</small><p><b>${esc(BOARDS.daily.q(my, day))}</b></p>${ans(day).map(a => `<div class="brow"><span><b>${esc(a.by)}:</b> ${esc(a.text)}</span></div>`).join('') || '<p class="muted small">محد جاوب</p>'}</div>`).join('')}</details>` : ''}`;
  }
};

// تحدي الشلة
BOARDS.challenge = {
  live: 'المشاركين <b id="count">0</b>', namePh: 'اسمك',
  valid: (e, base, s) => e.k === 'l' && isDayStr(e.day) && Number.isFinite(e.n) && e.n >= 0 && e.n < 1e8 ? { ...base, k: 'l', day: e.day, by: s(e.by, NAME_LEN), n: e.n } : null,
  count: my => [...new Set([...my.bstate.values()].filter(e => !e.del && e.k === 'l').map(e => e.by))],
  streak(logs, by) {
    const days = new Set(logs.filter(l => l.by === by && l.n > 0).map(l => l.day));
    const d = new Date(); if (!days.has(isoDay(d))) d.setDate(d.getDate() - 1);
    let k = 0; while (days.has(isoDay(d))) { k++; d.setDate(d.getDate() - 1); }
    return k;
  },
  bind(my) {
    $('#blist').onclick = e => {
      const b = e.target.closest('[data-add]'); if (!b) return;
      const me = Board.me(); if (!me) return;
      const id = today() + '|' + me, cur = my.bstate.get(id), base = cur && !cur.del ? cur.n : 0;
      const v = b.dataset.add === 'set' ? numIn($('#cn').value) : base + (+b.dataset.add);
      if (v === null || v < 0) return toast('اكتب رقم', true);
      Board.put(my, [{ id, k: 'l', day: today(), by: me, n: v }]); toast('تم التسجيل ✓');
    };
  },
  render(my, L, live, me) {
    const { goal, unit, target, end } = my.cfg, logs = live.filter(e => e.k === 'l'), d = today();
    const people = [...new Set(logs.map(l => l.by))];
    const rows = people.map(p => ({ p, total: logs.filter(l => l.by === p).reduce((s, l) => s + l.n, 0), todayN: (logs.find(l => l.by === p && l.day === d) || {}).n || 0, st: BOARDS.challenge.streak(logs, p) })).sort((a, b) => b.total - a.total);
    const mine = (logs.find(l => l.by === me && l.day === d) || {}).n || 0, sum = rows.reduce((s, r) => s + r.total, 0);
    const left = end ? daysBetween(d, end) : null;
    L.innerHTML = `<div class="card center"><div class="big-ic">🏁</div><h3>${esc(goal)}</h3><p class="muted">${target ? `الهدف اليومي: ${fmtNum(target)} ${esc(unit)}` : ''}${left !== null ? ` · ${left >= 0 ? `باقي ${left} يوم` : 'خلص التحدي'}` : ''}</p>
        <p>مجموع الشلة: <b>${fmtNum(sum)}</b> ${esc(unit)}</p></div>
      <section class="card"><h3>📝 إنجازك اليوم: <span class="pink">${fmtNum(mine)}</span> ${esc(unit)}${target && mine >= target ? ' ✅' : ''}</h3>
        <div class="addrow"><input id="cn" inputmode="decimal" placeholder="كم ${esc(unit)} اليوم؟"><button class="btn primary" data-add="set">سجّل</button></div>
        <div class="row">${[1, 5, 10].map(v => `<button class="btn sm grow" data-add="${v}" dir="ltr">+${v}</button>`).join('')}</div></section>
      <section class="card"><h3>🏆 الترتيب</h3>${rows.length ? rows.map((r, k) => `<div class="brow${r.p === me ? ' me' : ''}"><span>${medal(k)} ${esc(r.p)} ${r.st ? `<small>🔥${r.st}</small>` : ''}</span><small class="muted">${fmtNum(r.total)} ${esc(unit)} · اليوم ${fmtNum(r.todayN)}${target && r.todayN >= target ? ' ✅' : ''}</small></div>`).join('') : '<p class="muted">محد سجّل للحين.</p>'}</section>`;
  }
};
