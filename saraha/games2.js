'use strict';
/* الدفعة الثالثة: اسم حيوان جماد نبات، أضحك جواب، رتّب الشلة، والقوائم المحفوظة (مين يجيب وش؟، قيّم الطلعة) */

/* ---------- أدوات مشتركة ---------- */
// الرسائل على السيرفر حدها 4KB، فالقوائم الكبيرة تنقسم أجزاء وتتجمع عند الاستقبال
async function postChunked(my, k, base, key, items, max = 2200) {
  const size = x => enc.encode(JSON.stringify(x)).length;
  if (size({ ...base, [key]: items }) <= max) return postRoom(my, k, { ...base, [key]: items });
  const parts = [];
  let cur = [];
  for (const it of items) {
    if (cur.length && size({ ...base, [key]: [...cur, it] }) > max) { parts.push(cur); cur = []; }
    cur.push(it);
  }
  if (cur.length) parts.push(cur);
  const b = b64u(crypto.getRandomValues(new Uint8Array(6)));
  for (let p = 0; p < parts.length; p++) await postRoom(my, k, { ...base, b, p, n: parts.length, [key]: parts[p] });
}
function assemble(list, key) {
  const out = [], groups = new Map();
  for (const x of list) {
    if (typeof x.b !== 'string' || !Number.isInteger(x.p) || !Number.isInteger(x.n) || x.n < 1 || x.n > 40) { out.push(x); continue; }
    if (!groups.has(x.b)) groups.set(x.b, new Map());
    const g = groups.get(x.b);
    g.set(x.p, x);
    if (g.size === x.n) {
      const parts = [...g.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
      const { b, p, n, ...rest } = parts[0];
      out.push({ ...rest, idx: Math.max(...parts.map(q => q.idx)), [key]: parts.flatMap(q => Array.isArray(q[key]) ? q[key] : []) });
    }
  }
  return out.sort((a, b) => a.idx - b.idx);
}
async function roomEvents(my) {
  const list = [];
  for (const r of my.raws) {
    if (r.env.k !== 'q' || r.idx < my.setupIdx) continue;
    const x = await roomOpen(my, r);
    if (x && typeof x === 'object') list.push({ ...x, idx: r.idx });
  }
  return list;
}
async function hostInbox(my) {
  // يفك رسائل اللاعبين للمشرف مرة وحدة لكل رسالة
  const out = [];
  if (!my.isHost) return out;
  my.inbox = my.inbox || new Map();
  if (!my.priv) my.priv = await Crypto.priv(my.d, my.setup.pk);
  for (const r of my.raws) {
    if (r.env.k !== 'm') continue;
    if (!my.inbox.has(r.id)) { let p = null; try { p = await Crypto.openFrom(my.priv, r.env); } catch {} my.inbox.set(r.id, p); }
    const p = my.inbox.get(r.id);
    if (p && typeof p === 'object') out.push({ ...p, idx: r.idx });
  }
  return out;
}
const gameName = my => store.kv('qname.' + my.topic);
function nameGate(A, my, redraw) {
  if (gameName(my)) return true;
  A.innerHTML = `<div class="card"><h3>👋 وش اسمك؟</h3><input id="qn" maxlength="${NAME_LEN}" placeholder="الاسم اللي بيطلع في الترتيب"><button class="btn primary big" id="qjoin">دخول</button></div>`;
  $('#qjoin').onclick = () => { const v = $('#qn').value.trim(); if (!v) return toast('اكتب اسمك', true); store.kv('qname.' + my.topic, v.slice(0, NAME_LEN)); redraw(); };
  return false;
}
const addBoard = (board, pts) => {
  const m = new Map(board);
  for (const [n, s] of pts) m.set(n, (m.get(n) || 0) + s);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60);
};
const hostShare = my => my.isHost ? `<details class="card"${my.state ? '' : ' open'}><summary>📨 رابط الدعوة ورابط المشرف</summary>${hostPanel().replace('<section class="card share">', '<section class="share">')}</details>` : '';
function finalPodium(icon, sub) {
  clearInterval(quizTimer);
  const R = S.results, me = gameName(S), b = R.board || [];
  document.title = `${R.title} · صراحة`;
  app.innerHTML = `${revealHead(R, S.M, icon, sub)}
    ${b.length ? `<div class="podium">${[1, 0, 2].filter(k => b[k]).map(k => `<div class="pod p${k}"><div class="big-ic">${medal(k)}</div><b>${esc(b[k][0])}</b><small>${b[k][1]}</small></div>`).join('')}</div>
      <section class="card"><h3>الترتيب الكامل</h3>${boardHtml(b, me, 100)}</section>` : emptyCard('محد لعب هالمرة 😅')}
    ${againBtn()}`;
}
function hostGameShell(my, liveInner) {
  document.title = `${my.setup.title} · صراحة`;
  app.innerHTML = `${sessionHead(my.setup.title)}${liveBar(liveInner)}${hostShare(my)}<div id="qarea"></div>${howCard(my.M)}${privacyNote(my.M)}`;
  if (my.isHost) bindHost();
  my.qdrawn = null;
}

/* ============ اسم، حيوان، جماد، نبات ============ */
const ABC_TIME = 120000;
const abcNorm = w => String(w || '').normalize('NFKC').replace(/[ً-ٰٟـ]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, '').replace(/^ال(?=..)/, '');
const Abc = {
  async process(my) {
    const cats = my.cfg.cats.length;
    const ev = assemble((await roomEvents(my)).filter(x => ['ask', 'stop', 'show', 'end'].includes(x.s)), 'rows')
      .filter(x => x.s === 'end' || (Number.isInteger(x.r) && x.r >= 0 && x.r < 100));
    ev.forEach(x => {
      x.board = validBoard(x.board);
      x.rows = Array.isArray(x.rows) ? x.rows.filter(r => Array.isArray(r) && typeof r[0] === 'string' && Array.isArray(r[1]) && Array.isArray(r[2]))
        .map(([by, a, p]) => [by.slice(0, NAME_LEN), a.slice(0, cats).map(s => String(s || '').slice(0, 20)), p.slice(0, cats).map(v => +v || 0)]) : [];
      x.l = typeof x.l === 'string' ? x.l.slice(0, 1) : '';
    });
    ev.forEach(x => { if (!x.l && x.s !== 'end') { const a = ev.find(e => e.s === 'ask' && e.r === x.r); x.l = a ? a.l : ''; } });
    my.qev = ev;
    my.state = ev.length ? ev[ev.length - 1] : null;
    my.msgs = [];
    if (my.isHost) {
      const ans = new Map();
      for (const p of await hostInbox(my)) {
        if (typeof p.by !== 'string' || !p.by.trim() || !Number.isInteger(p.r) || !Array.isArray(p.a)) continue;
        const shown = ev.find(e => e.s === 'show' && e.r === p.r);
        if (shown && p.idx > shown.idx) continue;
        if (!ans.has(p.r)) ans.set(p.r, new Map());
        ans.get(p.r).set(p.by.trim().slice(0, NAME_LEN), my.cfg.cats.map((_, i) => String(p.a[i] || '').trim().slice(0, 20)));
      }
      my.ans = ans;
    }
    if (my.state && my.state.s === 'end' && !my.results) {
      my.results = { mode: my.mode, title: my.setup.title, cfg: my.cfg, board: my.state.board, at: Date.now() };
      store.upsert({ topic: my.topic, results: my.results });
    }
  },
  score(my, r, l, rej) {
    const rows = [...((my.ans && my.ans.get(r)) || new Map()).entries()], L = abcNorm(l);
    const pts = rows.map(() => my.cfg.cats.map(() => 0));
    my.cfg.cats.forEach((_, ci) => {
      const valid = rows.map(([by, a]) => { const n = abcNorm(a[ci]); return n && n.startsWith(L) && !rej.has(by + '|' + ci) ? n : null; });
      const cnt = {}, total = valid.filter(Boolean).length;
      valid.forEach(n => { if (n) cnt[n] = (cnt[n] || 0) + 1; });
      valid.forEach((n, ri) => { if (n) pts[ri][ci] = total === 1 ? 20 : cnt[n] > 1 ? 5 : 10; });
    });
    return rows.map(([by, a], ri) => [by, a, pts[ri]]);
  },
  rowsHtml(my, rows, clickable) {
    if (!rows.length) return '<p class="muted">محد جاوب هالجولة.</p>';
    return rows.map(([by, a, p], ri) => `<div class="arow"><b>${esc(by)}</b><span>+${p.reduce((x, y) => x + y, 0)}</span></div>
      <div class="acells">${my.cfg.cats.map((c, ci) => `<span class="cell s${p[ci]}"${clickable ? ` data-c="${ri}|${ci}"` : ''}>${esc(c)}: ${esc(a[ci] || '—')}${p[ci] ? ` <small>${p[ci]}</small>` : ''}</span>`).join('')}</div>`).join('');
  },
  open() { hostGameShell(S, S.isHost ? 'جاوب <b id="count">0</b>' : '<span id="qpos">قبل البداية</span>'); Abc.update(); },
  update() {
    const my = S, st = my.state, key = st ? st.s + st.r : 'lobby';
    const subs = st && my.ans ? ((my.ans.get(st.r) || new Map()).size) : 0;
    if (my.isHost) { const c = $('#count'); if (c) c.textContent = subs; }
    else { const q = $('#qpos'); if (q) q.textContent = st && st.s !== 'end' ? `الجولة ${st.r + 1}` : 'قبل البداية'; }
    if (!my.isHost && st && st.s === 'stop' && !store.kv(`abcsent.${my.topic}.${st.r}`)) Abc.submit(my, st.r);
    if (key !== my.qdrawn || (my.isHost && st && st.s === 'stop' && subs !== my.qsubs)) { my.qdrawn = key; my.qsubs = subs; Abc.draw(); }
    else if (my.isHost && st && st.s === 'ask') { const a = $('#acount'); if (a) a.textContent = subs; }
  },
  draw() {
    clearInterval(quizTimer);
    const A = $('#qarea'); if (!A) return;
    A.onclick = null;
    S.isHost ? Abc.drawHost(A) : Abc.drawPlayer(A);
  },
  bigLetter: (r, l) => `<div class="qhead">الجولة ${r + 1}</div><div class="bigl">${esc(l)}</div>`,
  showHtml(my, st, me) {
    return `<div class="card center">${Abc.bigLetter(st.r, st.l)}</div><section class="card">${Abc.rowsHtml(my, st.rows)}</section>
      <section class="card"><h3>🏆 الترتيب</h3>${boardHtml(st.board, me)}</section>`;
  },
  drawHost(A) {
    const my = S, st = my.state;
    const newRound = async e => {
      const used = new Set(my.qev.filter(x => x.s === 'ask').map(x => x.l));
      const pool = [...ABC_LETTERS].filter(l => !used.has(l));
      const l = (pool.length ? pool : [...ABC_LETTERS])[Math.floor(Math.random() * (pool.length || ABC_LETTERS.length))];
      const r = my.qev.filter(x => x.s === 'ask').length;
      e.currentTarget.disabled = true;
      try { await postRoom(my, 'q', { s: 'ask', r, l }); } catch { toast('ما وصل… تأكد من النت', true); e.currentTarget.disabled = false; }
    };
    if (!st || st.s === 'show') {
      const prev = st ? Abc.showHtml(my, st) : `<div class="card center"><div class="big-ic">🔤</div><h3>جاهزين؟</h3><p class="muted">أرسل الرابط، وكل واحد يدخل اسمه. كل جولة يطلع حرف، والكل يكتب كلمة لكل خانة تبدأ فيه.</p><p class="muted small">الخانات: ${my.cfg.cats.map(esc).join('، ')}</p></div>`;
      A.innerHTML = prev + `<button class="btn primary big" id="nr">🔤 ${st ? 'جولة جديدة' : 'ابدأ أول جولة'}</button>` + (st ? '<button class="btn big" id="fin">🏁 النتيجة النهائية</button>' : '');
      $('#nr').onclick = newRound;
      const fin = $('#fin');
      if (fin) fin.onclick = e => { e.currentTarget.disabled = true; postRoom(my, 'q', { s: 'end', board: st.board }).catch(() => { toast('ما وصل', true); e.currentTarget.disabled = false; }); };
    } else if (st.s === 'ask') {
      A.innerHTML = `<div class="card center">${Abc.bigLetter(st.r, st.l)}<p class="muted">خلّص <b id="acount">${(my.ans && my.ans.get(st.r) || new Map()).size}</b> لاعب</p></div>
        <button class="btn danger big" id="stop">⏹️ وقّف الجولة</button>`;
      $('#stop').onclick = e => { e.currentTarget.disabled = true; postRoom(my, 'q', { s: 'stop', r: st.r }).catch(() => { e.currentTarget.disabled = false; }); };
    } else if (st.s === 'stop') {
      my.rej = my.rej && my.rej.r === st.r ? my.rej : Object.assign(new Set(), { r: st.r });
      const rows = Abc.score(my, st.r, st.l, my.rej);
      A.innerHTML = `<div class="card center">${Abc.bigLetter(st.r, st.l)}</div>
        <section class="card"><h3>📝 التصحيح</h3><p class="muted small">اضغط على أي جواب غلط عشان تلغيه. (10 نقاط للجواب، 5 لو تكرر، و20 لو محد غيره جاوب)</p>${Abc.rowsHtml(my, rows, true)}</section>
        <button class="btn primary big" id="pub">📢 انشر النتيجة</button>`;
      A.onclick = e => {
        const c = e.target.closest('[data-c]'); if (!c) return;
        const [ri, ci] = c.dataset.c.split('|').map(Number), k = rows[ri][0] + '|' + ci;
        my.rej.has(k) ? my.rej.delete(k) : my.rej.add(k);
        my.qdrawn = null; Abc.update();
      };
      $('#pub').onclick = async e => {
        e.currentTarget.disabled = true;
        const prev = [...my.qev].reverse().find(x => x.s === 'show');
        const board = addBoard(prev ? prev.board : [], rows.map(([by, , p]) => [by, p.reduce((x, y) => x + y, 0)]));
        try { await postChunked(my, 'q', { s: 'show', r: st.r, l: st.l, board }, 'rows', rows); }
        catch { toast('ما وصل… تأكد من النت', true); e.currentTarget.disabled = false; }
      };
    }
  },
  async submit(my, r) {
    if (store.kv(`abcsent.${my.topic}.${r}`) || my.abcBusy) return;
    my.abcBusy = true;
    const a = (my.abcDraft && my.abcDraft[r]) || my.cfg.cats.map(() => '');
    try {
      const res = await Relay.post(my.topic, { v: 1, k: 'm', ...(await Crypto.sealTo(my.setup.pk, { by: gameName(my), r, a })) });
      store.kv(`abcsent.${my.topic}.${r}`, '1');
      onRaw(res, my);
      if (S === my) { my.qdrawn = null; Abc.update(); }
    } catch { toast('ما وصل… جرّب مرة ثانية', true); }
    finally { my.abcBusy = false; }
  },
  drawPlayer(A) {
    const my = S, st = my.state;
    if (!nameGate(A, my, () => Abc.draw())) return;
    const name = gameName(my);
    if (!st) { A.innerHTML = `<div class="card center"><div class="big-ic">⏳</div><h3>أهلًا ${esc(name)}!</h3><p class="muted">بانتظار المشرف يبدأ الجولة…</p></div>`; return; }
    if (st.s === 'ask') {
      if (store.kv(`abcsent.${my.topic}.${st.r}`)) { A.innerHTML = `<div class="card center">${Abc.bigLetter(st.r, st.l)}<h3>✋ وصلت أجوبتك</h3><p class="muted">بانتظار الباقين…</p></div>`; return; }
      my.abcDraft = my.abcDraft || {};
      const d = my.abcDraft[st.r] = my.abcDraft[st.r] || my.cfg.cats.map(() => '');
      my.seenAt = my.seenAt || {};
      if (!my.seenAt['a' + st.r]) my.seenAt['a' + st.r] = Date.now();
      A.innerHTML = `<div class="card">${Abc.bigLetter(st.r, st.l)}<div class="qbar"><i id="qbar"></i></div>
        ${my.cfg.cats.map((c, i) => `<label class="abcin">${esc(c)}<input data-i="${i}" maxlength="20" value="${esc(d[i])}" placeholder="${esc(st.l)}…"></label>`).join('')}
        <button class="btn primary big" id="done">✋ خلصت</button></div>`;
      $$('.abcin input', A).forEach(inp => { inp.oninput = () => { d[+inp.dataset.i] = inp.value; }; });
      $('#done').onclick = () => Abc.submit(my, st.r);
      const tick = () => {
        const left = Math.max(0, 1 - (Date.now() - my.seenAt['a' + st.r]) / ABC_TIME), b = $('#qbar');
        if (b) b.style.width = left * 100 + '%';
        if (!left) { clearInterval(quizTimer); Abc.submit(my, st.r); }
      };
      tick(); quizTimer = setInterval(tick, 250);
      return;
    }
    if (st.s === 'stop') { A.innerHTML = `<div class="card center">${Abc.bigLetter(st.r, st.l)}<h3>⏹️ انتهت الجولة</h3><p class="muted">بانتظار المشرف يصحّح…</p></div>`; return; }
    if (st.s === 'show') A.innerHTML = Abc.showHtml(my, st, name);
  },
  reveal() { finalPodium('🔤', 'انتهت اللعبة'); }
};

/* ============ أضحك جواب ============ */
const Funny = {
  async process(my) {
    const n = my.cfg.questions.length;
    const raw = (await roomEvents(my)).filter(x => ['ask', 'vote', 'show', 'end'].includes(x.s));
    const ev = assemble(assemble(raw.filter(x => x.s !== 'show'), 'opts').concat(raw.filter(x => x.s === 'show')), 'res')
      .filter(x => x.s === 'end' || (Number.isInteger(x.i) && x.i >= 0 && x.i < n));
    ev.forEach(x => {
      x.board = validBoard(x.board);
      x.opts = Array.isArray(x.opts) ? x.opts.filter(o => o && typeof o.k === 'string' && typeof o.text === 'string').map(o => ({ k: o.k.slice(0, 8), text: o.text.slice(0, 200) })) : [];
      x.res = Array.isArray(x.res) ? x.res.filter(o => o && typeof o.text === 'string').map(o => ({ text: o.text.slice(0, 200), by: String(o.by || '').slice(0, NAME_LEN), v: +o.v || 0 })) : [];
    });
    my.qev = ev;
    my.state = ev.length ? ev[ev.length - 1] : null;
    my.msgs = [];
    if (my.isHost) {
      const fa = new Map(), fv = new Map();
      for (const p of await hostInbox(my)) {
        if (typeof p.by !== 'string' || !p.by.trim() || !Number.isInteger(p.i)) continue;
        const by = p.by.trim().slice(0, NAME_LEN);
        if (typeof p.text === 'string' && p.text.trim()) {
          const voting = ev.find(e => e.s === 'vote' && e.i === p.i);
          if (voting && p.idx > voting.idx) continue;
          if (!fa.has(p.i)) fa.set(p.i, new Map());
          fa.get(p.i).set(by, p.text.slice(0, 200));
        } else if (typeof p.v === 'string') {
          const shown = ev.find(e => e.s === 'show' && e.i === p.i);
          if (shown && p.idx > shown.idx) continue;
          if (!fv.has(p.i)) fv.set(p.i, new Map());
          fv.get(p.i).set(by, p.v);
        }
      }
      my.fa = fa; my.fv = fv;
    }
    if (my.state && my.state.s === 'end' && !my.results) {
      my.results = { mode: my.mode, title: my.setup.title, cfg: my.cfg, board: my.state.board, at: Date.now() };
      store.upsert({ topic: my.topic, results: my.results });
    }
  },
  promptHtml: q => esc(q).replace(/_{3,}/g, '<span class="blank">؟؟؟</span>'),
  qCard(my, i, inner) { return `<div class="card"><div class="qhead">الجملة ${i + 1} من ${my.cfg.questions.length}</div><h3 class="qq">${Funny.promptHtml(my.cfg.questions[i].q)}</h3>${inner}</div>`; },
  showHtml(my, st, me) {
    const top = Math.max(0, ...st.res.map(r => r.v));
    return Funny.qCard(my, st.i, st.res.map(r => `<div class="msg">${top && r.v === top ? '👑 ' : ''}${esc(r.text)}<div class="by">— ${esc(r.by)} · ${r.v} صوت</div></div>`).join('') || '<p class="muted">محد جاوب.</p>')
      + `<section class="card"><h3>🏆 الترتيب</h3>${boardHtml(st.board, me)}</section>`;
  },
  open() { hostGameShell(S, S.isHost ? 'وصل <b id="count">0</b>' : '<span id="qpos">قبل البداية</span>'); Funny.update(); },
  update() {
    const my = S, st = my.state, key = st ? st.s + st.i : 'lobby';
    const cnt = !st ? 0 : st.s === 'vote' ? ((my.fv && my.fv.get(st.i)) || new Map()).size : ((my.fa && my.fa.get(st.i)) || new Map()).size;
    if (my.isHost) { const c = $('#count'); if (c) c.textContent = cnt; const a = $('#acount'); if (a) a.textContent = cnt; }
    else { const q = $('#qpos'); if (q) q.textContent = st && st.s !== 'end' ? `الجملة ${st.i + 1} من ${my.cfg.questions.length}` : 'قبل البداية'; }
    if (key !== my.qdrawn) { my.qdrawn = key; Funny.draw(); }
  },
  draw() {
    const A = $('#qarea'); if (!A) return;
    A.onclick = null;
    S.isHost ? Funny.drawHost(A) : Funny.drawPlayer(A);
  },
  async send(my, btn, fn) {
    btn.disabled = true;
    try { await fn(); } catch (err) { console.error(err); toast('ما وصل… تأكد من النت', true); btn.disabled = false; }
  },
  drawHost(A) {
    const my = S, st = my.state, n = my.cfg.questions.length;
    if (!st || st.s === 'show') {
      const next = st ? st.i + 1 : 0;
      A.innerHTML = (st ? Funny.showHtml(my, st) : `<div class="card center"><div class="big-ic">😂</div><h3>جاهزين؟</h3><p class="muted">أرسل الرابط، وكل واحد يدخل اسمه. كل جولة تطلع جملة ناقصة، والكل يكمّلها، وبعدين تصوّتون على أضحك جواب.</p></div>`)
        + (next < n ? `<button class="btn primary big" id="go">▶️ الجملة ${next + 1}</button>` : '') + (st ? '<button class="btn big" id="fin">🏁 النتيجة النهائية</button>' : '');
      const go = $('#go'); if (go) go.onclick = e => Funny.send(my, e.currentTarget, () => postRoom(my, 'q', { s: 'ask', i: next }));
      const fin = $('#fin'); if (fin) fin.onclick = e => Funny.send(my, e.currentTarget, () => postRoom(my, 'q', { s: 'end', board: st.board }));
    } else if (st.s === 'ask') {
      A.innerHTML = Funny.qCard(my, st.i, `<p class="muted center">جاوب <b id="acount">${((my.fa && my.fa.get(st.i)) || new Map()).size}</b> لاعب</p>`) + `<button class="btn primary big" id="vote">🗳️ ابدأ التصويت</button>`;
      $('#vote').onclick = e => {
        const answers = [...((my.fa && my.fa.get(st.i)) || new Map()).entries()];
        if (answers.length < 2) return toast('يحتاج جوابين على الأقل', true);
        const mixed = shuffle(answers).map(([by, text], k) => ({ k: String(k), text, by }));
        store.kv(`fmap.${my.topic}.${st.i}`, JSON.stringify(mixed.map(o => [o.k, o.by, o.text])));
        Funny.send(my, e.currentTarget, () => postChunked(my, 'q', { s: 'vote', i: st.i }, 'opts', mixed.map(({ k, text }) => ({ k, text }))));
      };
    } else if (st.s === 'vote') {
      A.innerHTML = Funny.qCard(my, st.i, st.opts.map(o => `<div class="msg">${esc(o.text)}</div>`).join('') + `<p class="muted center">صوّت <b id="acount">0</b> لاعب</p>`) + `<button class="btn primary big" id="show">🏆 اكشف الأضحك</button>`;
      Funny.update();
      $('#show').onclick = e => {
        let map = [];
        try { map = JSON.parse(store.kv(`fmap.${my.topic}.${st.i}`)) || []; } catch {}
        const who = new Map(map.map(([k, by]) => [k, by]));
        const votes = new Map();
        for (const [voter, k] of (my.fv && my.fv.get(st.i)) || new Map()) if (who.has(k) && who.get(k) !== voter) votes.set(k, (votes.get(k) || 0) + 1);
        const res = st.opts.map(o => ({ text: o.text, by: who.get(o.k) || '؟', v: votes.get(o.k) || 0 })).sort((a, b) => b.v - a.v);
        const prev = [...my.qev].reverse().find(x => x.s === 'show');
        const board = addBoard(prev ? prev.board : [], res.filter(r => r.by !== '؟').map(r => [r.by, r.v * 100]));
        Funny.send(my, e.currentTarget, () => postChunked(my, 'q', { s: 'show', i: st.i, board }, 'res', res));
      };
    }
  },
  drawPlayer(A) {
    const my = S, st = my.state;
    if (!nameGate(A, my, () => Funny.draw())) return;
    const name = gameName(my);
    if (!st) { A.innerHTML = `<div class="card center"><div class="big-ic">⏳</div><h3>أهلًا ${esc(name)}!</h3><p class="muted">بانتظار المشرف يبدأ…</p></div>`; return; }
    const mine = store.kv(`fans.${my.topic}.${st.i}`);
    if (st.s === 'ask') {
      if (mine) { A.innerHTML = Funny.qCard(my, st.i, `<div class="msg">${esc(mine)}</div><p class="muted center">وصل جوابك ✓ بانتظار الباقين…</p>`); return; }
      A.innerHTML = Funny.qCard(my, st.i, `<textarea id="fa" maxlength="120" placeholder="جوابك اللي بيضحّكهم… (بدون اسمك)"></textarea><div class="err" id="err"></div><button class="btn primary big" id="send">🔒 إرسال</button>`);
      $('#send').onclick = async e => {
        const raw = $('#fa').value.trim();
        if (raw.length < 2) return ($('#err').textContent = 'اكتب جوابك أول');
        const text = Polish.polish(raw).slice(0, 150);
        if (!text) return ($('#err').textContent = 'الجواب فاضي بعد التصحيح');
        if (Polish.isRude(text)) return ($('#err').textContent = RUDE_MSG);
        await Funny.send(my, e.currentTarget, async () => {
          const res = await Relay.post(my.topic, { v: 1, k: 'm', ...(await Crypto.sealTo(my.setup.pk, { by: name, i: st.i, text })) });
          store.kv(`fans.${my.topic}.${st.i}`, text); onRaw(res, my);
          if (S === my) { my.qdrawn = null; Funny.update(); }
        });
      };
    } else if (st.s === 'vote') {
      const voted = store.kv(`fvote.${my.topic}.${st.i}`);
      const opts = st.opts.filter(o => o.text !== mine);
      A.innerHTML = Funny.qCard(my, st.i, `<p class="muted">${voted ? 'صوّتت ✓ تقدر تغيّر صوتك.' : 'صوّت لأضحك جواب (جوابك ما يطلع لك):'}</p>
        ${opts.map(o => `<button class="qopt fun${voted === o.k ? ' picked' : ''}" data-k="${o.k}" style="--c:var(--card2)">${esc(o.text)}</button>`).join('')}`);
      A.onclick = async e => {
        const b = e.target.closest('[data-k]'); if (!b) return;
        try {
          const res = await Relay.post(my.topic, { v: 1, k: 'm', ...(await Crypto.sealTo(my.setup.pk, { by: name, i: st.i, v: b.dataset.k })) });
          store.kv(`fvote.${my.topic}.${st.i}`, b.dataset.k); onRaw(res, my);
          my.qdrawn = null; Funny.update(); toast('تم احتساب صوتك ✓');
        } catch { toast('ما وصل… جرّب مرة ثانية', true); }
      };
    } else if (st.s === 'show') A.innerHTML = Funny.showHtml(my, st, name);
  },
  reveal() { finalPodium('😂', 'انتهت اللعبة'); }
};

/* ============ رتّب الشلة ============ */
function rankCard() {
  const { cfg } = S;
  return `<section class="card vote"><h3>🏅 رتّبهم</h3>
    <p class="hint">اضغط الأسماء بالترتيب: أول ضغطة = المركز الأول. اضغط مرة ثانية عشان تشيله.</p>
    ${cfg.questions.map((q, qi) => `<div class="vq"><div class="vqt">${esc(q.q)}</div><div class="chips rank" data-q="${qi}">${cfg.names.map((n, ni) => `<button class="chip" data-o="${ni}"><i></i>${esc(n)}</button>`).join('')}</div></div>`).join('')}
    <div class="err" id="err"></div>
    <button class="btn primary big" id="vote">🔒 إرسال ترتيبي</button>
    <p class="muted small" id="sent"></p></section>`;
}
function bindRank() {
  const my = S, orders = my.cfg.questions.map(() => []);
  $$('.chips.rank').forEach(box => {
    const qi = +box.dataset.q;
    box.onclick = e => {
      const b = e.target.closest('[data-o]'); if (!b) return;
      const o = orders[qi], ni = +b.dataset.o, at = o.indexOf(ni);
      at >= 0 ? o.splice(at, 1) : o.push(ni);
      $$('.chip', box).forEach(c => { const k = o.indexOf(+c.dataset.o); c.classList.toggle('on', k >= 0); c.querySelector('i').textContent = k >= 0 ? k + 1 : ''; });
      $('#err').textContent = '';
    };
  });
  $('#vote').onclick = async e => {
    if (my.reveal) return toast('التصويت انتهى', true);
    if (orders.every(o => !o.length)) { $('#err').textContent = 'رتّب سؤال واحد على الأقل'; return; }
    const btn = e.currentTarget; btn.disabled = true;
    try {
      let bid = store.kv('bid.' + my.topic);
      if (!bid) { bid = b64u(crypto.getRandomValues(new Uint8Array(12))); store.kv('bid.' + my.topic, bid); }
      const res = await Relay.post(my.topic, { v: 1, k: 'm', ...(await Crypto.sealTo(my.setup.pk, { bid, r: orders })) });
      store.kv('voted.' + my.topic, '1'); onRaw(res, my); toast('وصل ترتيبك ✓'); updateLive();
    } catch (err) { console.error(err); toast('ما وصل… تأكد من النت', true); }
    finally { btn.disabled = false; }
  };
}
function rankTally(cfg, ballots) {
  const n = cfg.names.length;
  return cfg.questions.map((_, qi) => {
    const sc = cfg.names.map(() => 0), sum = cfg.names.map(() => 0), cnt = cfg.names.map(() => 0);
    for (const b of ballots) b.r[qi].forEach((ni, pos) => { sc[ni] += n - pos; sum[ni] += pos + 1; cnt[ni]++; });
    return cfg.names.map((_, ni) => [ni, sc[ni], cnt[ni] ? sum[ni] / cnt[ni] : 0]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
  });
}
function rankReveal(R, M, cfg) {
  const list = qi => R.tally[qi].length
    ? R.tally[qi].map(([ni, sc], k) => `<div class="brow${k === 0 ? ' me' : ''}"><span>${medal(k)} ${esc(cfg.names[ni])}</span><small class="muted">${sc} نقطة</small></div>`).join('')
    : '<p class="muted">محد رتّب هالسؤال</p>';
  return {
    body: R.voters ? `<button class="btn primary big" id="present">📽️ اكشف الترتيب سؤال سؤال</button>
      ${cfg.questions.map((q, qi) => `<section class="card"><h3>${esc(q.q)}</h3>${list(qi)}</section>`).join('')}` : emptyCard('محد رتّب هالمرة 😅'),
    slides: cfg.questions.map((q, qi) => ({ kick: `سؤال ${qi + 1}`, body: `<p>${esc(q.q)}</p>`, ans: list(qi), ansBtn: '🏅 اكشف الترتيب' }))
  };
}

/* ============ القوائم المحفوظة: مين يجيب وش؟ وقيّم الطلعة ============ */
const ID = () => b64u(crypto.getRandomValues(new Uint8Array(6)));
// أنواع القوائم الإضافية (تتعرّف في games3.js): كل نوع يحدد التحقق والنموذج والرسم
const BOARDS = {};
const Board = {
  load(my) {
    if (my.bstate) return;
    my.bstate = new Map();
    try { for (const e of JSON.parse(store.kv('board.' + my.topic)) || []) { const v = Board.valid(my, e); if (v) my.bstate.set(v.id, v); } } catch {}
  },
  save(my) { store.kv('board.' + my.topic, JSON.stringify([...my.bstate.values()])); },
  valid(my, e) {
    if (!e || typeof e.id !== 'string' || !e.id || e.id.length > 80 || !Number.isFinite(e.t)) return null;
    const s = (x, n) => typeof x === 'string' ? x.slice(0, n) : '';
    const base = { id: e.id.slice(0, 80), t: e.t, c: Number.isFinite(e.c) ? e.c : e.t, del: !!e.del };
    if (BOARDS[my.M.board]) return BOARDS[my.M.board].valid(e, base, s);
    if (my.M.board === 'trip' && e.k === 'i') return { ...base, k: 'i', name: s(e.name, 50), who: s(e.who, NAME_LEN), done: !!e.done };
    if (my.M.board === 'rate' && e.k === 'p') return { ...base, k: 'p', name: s(e.name, 50), type: PLACE_TYPES.some(p => p[0] === e.type) ? e.type : 'other' };
    if (my.M.board === 'rate' && e.k === 'r' && Number.isInteger(e.s) && e.s >= 0 && e.s <= 5) return { ...base, k: 'r', p: s(e.p, 20), by: s(e.by, NAME_LEN), s: e.s, note: s(e.note, 80) };
    return null;
  },
  merge(my, list) {
    let ch = false;
    for (const e of list) {
      const v = Board.valid(my, e); if (!v) continue;
      const cur = my.bstate.get(v.id);
      if (!cur || v.t > cur.t) { my.bstate.set(v.id, v); ch = true; }
    }
    return ch;
  },
  async process(my) {
    Board.load(my);
    my.bseen = my.bseen || new Set();
    let ch = false;
    for (const r of my.raws) {
      if (r.env.k !== 'x' || my.bseen.has(r.id)) continue;
      my.bseen.add(r.id);
      if (r.time) my.bnewest = Math.max(my.bnewest || 0, r.time);
      const x = await roomOpen(my, r);
      if (x && Array.isArray(x.e)) ch = Board.merge(my, x.e) || ch;
      else if (x && typeof x.im === 'string' && Photos.part(my, x)) my.imgNew = true;
    }
    if (ch) Board.save(my);
    if (my.imgNew) { my.imgNew = false; if (S === my) Board.update(); }
    my.msgs = BOARDS[my.M.board] ? BOARDS[my.M.board].count(my) : [...my.bstate.values()].filter(e => !e.del && e.k !== 'r');
  },
  async put(my, entries) {
    const t = Date.now();
    entries.forEach(e => { e.t = t; if (!e.c) e.c = t; });
    Board.merge(my, entries); Board.save(my); Board.update();
    try { await postRoom(my, 'x', { e: entries }); }
    catch { toast('تم الحفظ في جوالك، بس ما وصل للشلة… تأكد من النت', true); }
  },
  async sync(my) {
    // الرسائل على السيرفر تبقى 12 ساعة، فإذا صار لها وقت نرسل نسخة كاملة عشان توصل للي ما فتحوها
    if (S !== my || my.synced || !my.online || isFb(my.topic)) return; // Firebase يحفظ الرسائل، فما نحتاج نعيد إرسالها
    my.synced = true;
    const stale = !my.bnewest || Date.now() / 1000 - my.bnewest > 10 * 3600;
    if (!stale || !my.bstate.size) return;
    try {
      if (!my.raws.some(r => r.env.k === 's'))
        await Relay.post(my.topic, { v: 1, k: 's', ...(await Crypto.seal(my.room, { mode: my.mode, title: my.setup.title, cfg: my.cfg, pk: my.setup.pk, rc: my.setup.rc })) });
      await postChunked(my, 'x', {}, 'e', [...my.bstate.values()]);
    } catch (e) { console.error(e); }
  },
  me() {
    const el = $('#wname'), n = el ? el.value.trim().slice(0, NAME_LEN) : (store.kv('wname') || '');
    if (!n) { toast('اكتب اسمك فوق أول', true); if (el) el.focus(); } else store.kv('wname', n);
    return n;
  },
  openWith(my, B) {
    app.innerHTML = `${sessionHead(my.setup.title)}
      ${liveBar(B.live)}
      ${my.cfg.note ? `<div class="card note">📝 ${esc(my.cfg.note)}</div>` : ''}
      <section class="card share"><h3>📨 شارك الرابط مع الشلة</h3><p class="muted small">${B.shareHint || 'أي أحد معه الرابط يقدر يضيف ويعدّل.'}</p>
        <div class="row multi"><button class="btn" id="cp">نسخ الرابط</button><a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(shareText(inviteLink()))}">واتساب</a><button class="btn" id="qrb">📱 QR</button></div></section>
      ${B.named === false ? '' : `<section class="card"><label for="wname" style="margin-top:0">اسمك</label><input id="wname" maxlength="${NAME_LEN}" placeholder="${B.namePh || 'اكتب اسمك'}" value="${esc(store.kv('wname') || '')}"></section>`}
      ${B.html ? B.html(my) : ''}
      <div id="blist"></div>
      <p class="fine">📌 محفوظة في جوالك وجوال كل واحد فتحها، وتتزامن كل ما أحد فتح الرابط.</p>
      ${howCard(my.M)}${privacyNote(my.M)}`;
    $('#cp').onclick = () => copyText(inviteLink());
    $('#qrb').onclick = () => qrSheet(inviteLink(my), 'كود الرابط');
    const w = $('#wname'); if (w) w.onchange = e => { store.kv('wname', e.target.value.trim().slice(0, NAME_LEN)); Board.update(); };
    $('#blist').addEventListener('focusout', () => setTimeout(() => { if (my.pendingDraw) Board.update(); }, 50));
    if (B.bind) B.bind(my);
    my.openedAt = my.openedAt || Date.now();
    Board.render();
    addWipe();
    setTimeout(() => Board.sync(my), 6500);
  },
  open() {
    const my = S;
    document.title = `${my.setup.title} · صراحة`;
    Board.load(my);
    if (BOARDS[my.M.board]) return Board.openWith(my, BOARDS[my.M.board]);
    const trip = my.M.board === 'trip';
    app.innerHTML = `${sessionHead(my.setup.title)}
      ${liveBar(trip ? '<b id="count">0</b> غرض · <span id="tleft"></span>' : '<b id="count">0</b> مكان')}
      ${my.cfg.note ? `<div class="card note">📝 ${esc(my.cfg.note)}</div>` : ''}
      <section class="card share"><h3>📨 شارك الرابط مع الشلة</h3><p class="muted small">أي أحد معه الرابط يقدر يضيف ويعدّل.</p>
        <div class="row multi"><button class="btn" id="cp">نسخ الرابط</button><a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(shareText(inviteLink()))}">واتساب</a><button class="btn" id="qrb">📱 QR</button></div></section>
      <section class="card"><label for="wname" style="margin-top:0">اسمك</label><input id="wname" maxlength="${NAME_LEN}" placeholder="عشان يعرفون ${trip ? 'مين بيجيب وش' : 'مين قيّم'}" value="${esc(store.kv('wname') || '')}"></section>
      ${trip ? `<section class="card"><h3>➕ أضف غرض</h3>
          <div class="addrow"><input id="ti" maxlength="50" placeholder="وش نحتاج؟" enterkeyhint="done"><button class="btn" id="tadd">إضافة</button></div>
          <p class="hint">اقتراحات (اضغط عشان تضيف):</p><div class="chips" id="tsug"></div></section>
        <section class="card"><h3>🧺 القائمة</h3><div id="blist"></div></section>`
      : `<section class="card"><h3>➕ أضف مكان</h3><input id="pn" maxlength="50" placeholder="اسم المكان">
          <div class="chips" id="ptype">${PLACE_TYPES.map(([k, t], i) => `<button class="chip${i ? '' : ' on'}" data-t="${k}">${t}</button>`).join('')}</div>
          <button class="btn primary big" id="padd">إضافة المكان</button></section>
        <div id="blist"></div>`}
      <p class="fine">📌 ${trip ? 'القائمة' : 'الدليل'} محفوظ في جوالك وجوال كل واحد فتحه، ويتزامن كل ما أحد فتح الرابط.</p>
      ${howCard(my.M)}`;
    $('#cp').onclick = () => copyText(inviteLink());
    $('#qrb').onclick = () => qrSheet(inviteLink(my), 'كود الرابط');
    $('#wname').onchange = e => { store.kv('wname', e.target.value.trim().slice(0, NAME_LEN)); Board.update(); };
    const me = () => { const n = $('#wname').value.trim().slice(0, NAME_LEN); if (!n) { toast('اكتب اسمك فوق أول', true); $('#wname').focus(); } else store.kv('wname', n); return n; };
    if (trip) {
      const add = name => { name = name.trim().slice(0, 50); if (!name) return; Board.put(my, [{ id: ID(), k: 'i', name, who: '', done: false }]); };
      $('#tadd').onclick = () => { add($('#ti').value); $('#ti').value = ''; };
      $('#ti').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('#tadd').click(); } };
      $('#tsug').onclick = e => { const b = e.target.closest('[data-s]'); if (b) add(b.dataset.s); };
      $('#blist').onclick = e => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        const it = my.bstate.get(b.dataset.id); if (!it) return;
        const a = b.dataset.act, x = { ...it };
        if (a === 'claim') { const n = me(); if (!n) return; x.who = n; }
        else if (a === 'unclaim') x.who = '';
        else if (a === 'done') x.done = !x.done;
        else if (a === 'del') { if (!confirm(`تحذف «${it.name}»؟`)) return; x.del = true; }
        Board.put(my, [x]);
      };
    } else {
      let type = PLACE_TYPES[0][0];
      $('#ptype').onclick = e => { const b = e.target.closest('[data-t]'); if (!b) return; type = b.dataset.t; $$('#ptype .chip').forEach(c => c.classList.toggle('on', c === b)); };
      $('#padd').onclick = () => { const name = $('#pn').value.trim().slice(0, 50); if (!name) return toast('اكتب اسم المكان', true); $('#pn').value = ''; Board.put(my, [{ id: ID(), k: 'p', name, type }]); };
      const rate = (p, patch) => {
        const n = me(); if (!n) return;
        const id = `${p}|${n}`, cur = my.bstate.get(id);
        Board.put(my, [{ id, k: 'r', p, by: n, s: cur ? cur.s : 0, note: cur ? cur.note : '', ...patch }]);
      };
      $('#blist').onclick = e => {
        const st = e.target.closest('[data-star]');
        if (st) return rate(st.dataset.p, { s: +st.dataset.star });
        const d = e.target.closest('[data-del]');
        if (d) { const it = my.bstate.get(d.dataset.del); if (it && confirm(`تحذف «${it.name}»؟`)) Board.put(my, [{ ...it, del: true }]); }
      };
      $('#blist').addEventListener('change', e => { const t = e.target.closest('.rnote'); if (t) rate(t.dataset.p, { note: t.value.trim().slice(0, 80) }); });
      $('#blist').addEventListener('focusout', () => setTimeout(() => { if (my.pendingDraw) Board.update(); }, 50));
    }
    my.openedAt = my.openedAt || Date.now();
    Board.render();
    addWipe();
    setTimeout(() => Board.sync(my), 6500);
  },
  // نأخر الرسم شوي عشان الضغطة اللي صايرة الحين ما تضيع لو انرسمت القائمة من جديد
  update() { const my = S; clearTimeout(my.bt); my.bt = setTimeout(() => { if (S === my) Board.render(); }, 180); },
  render() {
    const my = S, L = $('#blist'); if (!L || !my.bstate) return;
    if (!my.synced && my.online && Date.now() - (my.openedAt || 0) > 6000) Board.sync(my);
    if (L.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') { my.pendingDraw = true; return; }
    my.pendingDraw = false;
    const live = [...my.bstate.values()].filter(e => !e.del), meName = store.kv('wname') || '';
    if (BOARDS[my.M.board]) { BOARDS[my.M.board].render(my, L, live, meName); return Photos.fill(my, L); }
    if (my.M.board === 'trip') {
      const items = live.filter(e => e.k === 'i').sort((a, b) => a.c - b.c);
      const free = items.filter(i => !i.who).length;
      const c = $('#count'); if (c) c.textContent = items.length;
      const tl = $('#tleft'); if (tl) tl.textContent = free ? `${free} ما أحد حجزه` : items.length ? 'كل شي محجوز ✅' : '';
      L.innerHTML = items.length ? items.map(i => `<div class="titem${i.done ? ' done' : ''}">
          <button class="tchk" data-act="done" data-id="${i.id}" aria-label="تم">${i.done ? '✅' : '⬜'}</button>
          <div class="tmain"><b>${esc(i.name)}</b><small>${i.who ? `🙋 ${esc(i.who)}` : 'محد حجزه'}</small></div>
          ${i.who && i.who === meName ? `<button class="btn ghost sm" data-act="unclaim" data-id="${i.id}">ألغي</button>` : !i.who ? `<button class="btn sm" data-act="claim" data-id="${i.id}">🙋 أنا بجيبه</button>` : ''}
          <button class="x" data-act="del" data-id="${i.id}" aria-label="حذف">✕</button></div>`).join('')
        : '<p class="muted">القائمة فاضية. أضف أغراض أو اضغط على الاقتراحات.</p>';
      const sug = $('#tsug'), have = new Set(items.map(i => i.name));
      if (sug) sug.innerHTML = KASHTA_ITEMS.filter(s => !have.has(s)).map(s => `<button class="chip" data-s="${esc(s)}">+ ${esc(s)}</button>`).join('');
    } else {
      const places = live.filter(e => e.k === 'p'), rates = live.filter(e => e.k === 'r' && e.s > 0);
      const info = places.map(p => {
        const rs = rates.filter(r => r.p === p.id);
        return { p, rs, avg: rs.length ? rs.reduce((s, r) => s + r.s, 0) / rs.length : 0, mine: my.bstate.get(`${p.id}|${meName}`) };
      }).sort((a, b) => b.avg - a.avg || b.rs.length - a.rs.length || a.p.c - b.p.c);
      const c = $('#count'); if (c) c.textContent = places.length;
      const icon = t => (PLACE_TYPES.find(x => x[0] === t) || PLACE_TYPES[3])[1].split(' ')[0];
      L.innerHTML = info.length ? info.map(({ p, rs, avg, mine }, k) => `<section class="card place">
          <div class="gh"><h3>${k === 0 && avg ? '🏆 ' : ''}${icon(p.type)} ${esc(p.name)}</h3><button class="x" data-del="${p.id}" aria-label="حذف">✕</button></div>
          <div class="avg">${avg ? `<b>★ ${avg.toFixed(1)}</b> <small class="muted">(${rs.length} تقييم)</small>` : '<small class="muted">ما أحد قيّمه للحين</small>'}</div>
          <div class="stars">${[1, 2, 3, 4, 5].map(s => `<button data-star="${s}" data-p="${p.id}" class="${mine && mine.s >= s ? 'on' : ''}" aria-label="${s} نجوم">★</button>`).join('')}<small class="muted">تقييمك</small></div>
          <input class="rnote" data-p="${p.id}" maxlength="80" placeholder="ملاحظتك (اختياري)" value="${esc(mine ? mine.note : '')}">
          ${rs.length ? `<details><summary>تقييمات الشلة</summary>${rs.map(r => `<div class="brow"><span>${esc(r.by)}${r.note ? ` <small class="muted">— ${esc(r.note)}</small>` : ''}</span><b>${'★'.repeat(r.s)}</b></div>`).join('')}</details>` : ''}
        </section>`).join('') : emptyCard('ما فيه أماكن للحين. أضف أول مكان رحتوه 👆');
    }
  }
};

Object.assign(KINDS, { abc: Abc, funny: Funny, board: Board });
