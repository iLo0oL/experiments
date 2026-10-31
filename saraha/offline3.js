'use strict';
/* الدفعة الرابعة: ألعاب الجوال الواحد والأدوات */

const DIE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const rnd = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;

Object.assign(OFFLINE, {
  /* ---------- خمس ثواني ---------- */
  five() {
    const names = loadPlayers(), next = deck(FIVE_PROMPTS), score = {};
    let turn = 0;
    app.innerHTML = `${offHead('five')}${playersField('اللاعبين (اختياري)')}<div id="stage"></div><div id="fsc"></div>`;
    let playing = false;
    // لو تغيّرت الأسماء والشاشة على «ابدأ»، نحدّث مين عليه الدور
    chipList($('#nm'), $('#add'), $('#chips'), names, { max: MAX_NAMES, len: NAME_LEN, empty: 'بدون أسماء: تلعبون بالدور', onChange: () => { store.kv('players', JSON.stringify(names)); scores(); if (!playing) idle(); } });
    const stage = $('#stage');
    const scores = () => { $('#fsc').innerHTML = names.length ? `<section class="card"><h3>🏆 النقاط</h3>${[...names].sort((a, b) => (score[b] || 0) - (score[a] || 0)).map((n, k) => `<div class="brow"><span>${medal(k)} ${esc(n)}</span><b>${score[n] || 0}</b></div>`).join('')}</section>` : ''; };
    const idle = () => {
      clearInterval(offTimer); playing = false;
      const who = names.length ? names[turn % names.length] : null;
      stage.innerHTML = `<div class="card center">${who ? `<p class="muted">الدور على</p><div class="gname">${esc(who)}</div>` : '<div class="big-ic">⏱️</div>'}<p class="muted small">عندك 5 ثواني بس!</p></div><button class="btn primary big" id="go">▶️ ابدأ</button>`;
      $('#go').onclick = () => play(who);
    };
    const play = who => {
      let left = 5; playing = true;
      stage.innerHTML = `<div class="card center"><p class="rq">${esc(next())}</p><div class="timer big" id="tm">5</div>
        <div class="row"><button class="btn primary grow" id="ok">✅ قالها</button><button class="btn grow" id="no">❌ ما لحق</button></div></div>`;
      const done = got => { clearInterval(offTimer); if (got && who) score[who] = (score[who] || 0) + 1; turn++; scores(); idle(); };
      $('#ok').onclick = () => done(true);
      $('#no').onclick = () => done(false);
      offTimer = setInterval(() => { left--; const t = $('#tm'); if (t) t.textContent = Math.max(0, left); if (left <= 0) { clearInterval(offTimer); if (t) t.textContent = '⏰'; } }, 1000);
    };
    scores(); idle();
  },

  /* ---------- سلسلة الكلمات ---------- */
  chain() {
    const names = loadPlayers();
    app.innerHTML = `${offHead('chain')}${playersField()}<div id="stage"></div>`;
    bindPlayers(names);
    const stage = $('#stage');
    const lastOf = w => { const n = abcNorm(w); const c = n[n.length - 1]; return c === 'ء' || c === 'ؤ' || c === 'ئ' ? 'ا' : c; };
    const start = () => {
      if (names.length < 2) return toast('أضف لاعبين على الأقل', true);
      const alive = shuffle(names), used = new Set(), log = [];
      let turn = 0, letter = ABC_LETTERS[rnd(ABC_LETTERS.length)];
      const draw = () => {
        clearInterval(offTimer);
        if (alive.length === 1) {
          stage.innerHTML = `<div class="card pick center"><small>الفايز</small><div class="gname">🏆 ${esc(alive[0])}</div><p class="muted">${log.length} كلمة</p></div><button class="btn primary big" id="again">🔄 جولة جديدة</button>`;
          return ($('#again').onclick = start);
        }
        const who = alive[turn % alive.length];
        let left = 15;
        stage.innerHTML = `<div class="card center"><p class="muted">الدور على <b>${esc(who)}</b></p><small class="muted">كلمة تبدأ بحرف</small><div class="bigl">${esc(letter)}</div>
          <div class="timer" id="tm">15</div><input id="cw" maxlength="30" placeholder="اكتب الكلمة اللي قالها"><div class="err" id="err"></div>
          <div class="row"><button class="btn primary grow" id="ok">✅ صح</button><button class="btn danger grow" id="out">❌ ما قدر</button></div></div>
          <p class="muted center">باقي: ${alive.map(esc).join('، ')}</p>
          ${log.length ? `<div class="tlog">${log.slice(-20).map(w => `<span>${esc(w)}</span>`).join('')}</div>` : ''}`;
        const kick = () => { clearInterval(offTimer); toast(`${who} طلع 😅`); alive.splice(alive.indexOf(who), 1); turn = turn % Math.max(1, alive.length); draw(); };
        $('#out').onclick = kick;
        const ok = () => {
          const w = $('#cw').value.trim(), n = abcNorm(w);
          if (n.length < 2) return ($('#err').textContent = 'اكتب الكلمة');
          if (!n.startsWith(abcNorm(letter))) return ($('#err').textContent = `لازم تبدأ بحرف ${letter}`);
          if (used.has(n)) return ($('#err').textContent = 'هالكلمة قالها أحد قبل!');
          used.add(n); log.push(w); letter = lastOf(w); turn = (turn + 1) % alive.length; draw();
        };
        $('#ok').onclick = ok;
        $('#cw').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); ok(); } };
        $('#cw').focus();
        offTimer = setInterval(() => { left--; const t = $('#tm'); if (t) t.textContent = left; if (left <= 0) kick(); }, 1000);
      };
      draw();
    };
    stage.innerHTML = `<button class="btn primary big" id="start">🔗 ابدأ</button>`;
    $('#start').onclick = start;
  },

  /* ---------- السؤال الغريب ---------- */
  oddq() {
    const names = loadPlayers(), pairs = deck(ODDQ_PAIRS);
    app.innerHTML = `${offHead('oddq')}${playersField()}<div id="stage"></div>`;
    bindPlayers(names);
    const stage = $('#stage');
    const start = () => {
      if (names.length < 3) return toast('أضف 3 لاعبين على الأقل', true);
      const [main, other] = pairs(), odd = randOf(names);
      passAround(stage, shuffle(names), n => `<p class="muted">سؤالك يا ${esc(n)}:</p><p class="rq">${esc(n === odd ? other : main)}</p><p class="muted small">فكّر بجوابك، ولا تقول السؤال لأحد 🤫</p>`, () => {
        stage.innerHTML = `<div class="card"><h3>🗣️ الكل شاف سؤاله</h3><ol><li>بالدور، كل واحد يقول جوابه بس (بدون السؤال).</li><li>بعدين اكشفوا السؤال الأصلي.</li><li>تناقشوا: جواب مين ما يركب؟</li></ol><p class="muted">يبدأ: <b>${esc(randOf(names))}</b></p></div>
          <button class="btn primary big" id="q">👀 اكشف السؤال</button>`;
        $('#q').onclick = () => {
          stage.innerHTML = `<div class="card center"><small class="muted">السؤال كان</small><p class="rq">${esc(main)}</p><p class="muted">جواب مين ما يركب؟ صوّتوا!</p></div><button class="btn danger big" id="rev">🧐 اكشف الغريب</button>`;
          $('#rev').onclick = () => {
            stage.innerHTML = `<div class="card center pass"><p class="muted">الغريب كان</p><div class="gname">${esc(odd)}</div><p>سؤاله: <b>${esc(other)}</b></p></div><button class="btn primary big" id="again">🔄 جولة جديدة</button>`;
            $('#again').onclick = start;
          };
        };
      });
    };
    stage.innerHTML = `<button class="btn primary big" id="start">🎲 ابدأ جولة</button>`;
    $('#start').onclick = start;
  },

  /* ---------- إكس أو وأربعة في صف ---------- */
  duo() {
    const S0 = loadKV('duo', null) || { g: 'xo', p: ['اللاعب الأول', 'اللاعب الثاني'], s: { xo: [0, 0, 0], c4: [0, 0, 0] } };
    const save = () => saveKV('duo', S0);
    let board, turn, over, starter = 0;
    app.innerHTML = `${offHead('duo')}
      <div class="chips" id="dg"><button class="chip" data-g="xo">❌⭕ إكس أو</button><button class="chip" data-g="c4">🔴🟡 أربعة في صف</button></div>
      <div class="card"><div class="addrow"><input id="p0" maxlength="14" value="${esc(S0.p[0])}"><input id="p1" maxlength="14" value="${esc(S0.p[1])}"></div></div>
      <div class="scoreboard" id="dsb"></div><div class="card center"><p id="dturn"></p><div id="grid"></div></div>
      <div class="row"><button class="btn primary grow" id="dnew">🔄 جولة جديدة</button><button class="btn ghost grow" id="dzero">🧹 تصفير</button></div>`;
    const mark = () => S0.g === 'xo' ? ['❌', '⭕'] : ['🔴', '🟡'];
    const sb = () => { const s = S0.s[S0.g]; $('#dsb').innerHTML = `<div class="sbt${turn === 0 && !over ? ' on' : ''}"><small>${mark()[0]} ${esc(S0.p[0])}</small><b>${s[0]}</b></div><div class="sbt"><small>تعادل</small><b>${s[2]}</b></div><div class="sbt${turn === 1 && !over ? ' on' : ''}"><small>${mark()[1]} ${esc(S0.p[1])}</small><b>${s[1]}</b></div>`; };
    const lines = (W, H, need) => {
      const L = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const cells = []; for (let k = 0; k < need; k++) { const X = x + dx * k, Y = y + dy * k; if (X < 0 || Y < 0 || X >= W || Y >= H) break; cells.push(Y * W + X); }
        if (cells.length === need) L.push(cells);
      }
      return L;
    };
    const LX = lines(3, 3, 3), LC = lines(7, 6, 4);
    const winner = () => { for (const l of (S0.g === 'xo' ? LX : LC)) { const v = board[l[0]]; if (v !== null && l.every(i => board[i] === v)) return { v, l }; } return null; };
    const draw = win => {
      const W = S0.g === 'xo' ? 3 : 7;
      $('#grid').className = S0.g === 'xo' ? 'xo' : 'c4';
      $('#grid').innerHTML = board.map((v, i) => `<button class="cell${win && win.l.includes(i) ? ' hit' : ''}" data-i="${i}">${v === null ? '' : mark()[v]}</button>`).join('');
      $('#grid').style.gridTemplateColumns = `repeat(${W},1fr)`;
      $('#dturn').innerHTML = over ? over : `الدور على: <b>${mark()[turn]} ${esc(S0.p[turn])}</b>`;
      sb();
    };
    const reset = () => { board = Array(S0.g === 'xo' ? 9 : 42).fill(null); turn = starter; over = ''; $$('#dg .chip').forEach(c => c.classList.toggle('on', c.dataset.g === S0.g)); draw(); };
    $('#grid').onclick = e => {
      const b = e.target.closest('[data-i]'); if (!b || over) return;
      let i = +b.dataset.i;
      if (S0.g === 'c4') { const col = i % 7; i = -1; for (let r = 5; r >= 0; r--) if (board[r * 7 + col] === null) { i = r * 7 + col; break; } if (i < 0) return; }
      else if (board[i] !== null) return;
      board[i] = turn;
      const w = winner();
      if (w) { S0.s[S0.g][w.v]++; over = `🎉 فاز ${mark()[w.v]} ${esc(S0.p[w.v])}!`; starter = 1 - w.v; save(); return draw(w); }
      if (board.every(v => v !== null)) { S0.s[S0.g][2]++; over = '🤝 تعادل!'; starter = 1 - starter; save(); return draw(); }
      turn = 1 - turn; draw();
    };
    $('#dg').onclick = e => { const b = e.target.closest('[data-g]'); if (!b) return; S0.g = b.dataset.g; save(); reset(); };
    [0, 1].forEach(k => { $('#p' + k).onchange = e => { S0.p[k] = e.target.value.trim() || (k ? 'اللاعب الثاني' : 'اللاعب الأول'); save(); draw(); }; });
    $('#dnew').onclick = reset;
    $('#dzero').onclick = () => { if (confirm('تصفّر النتيجة؟')) { S0.s[S0.g] = [0, 0, 0]; save(); draw(); } };
    reset();
  },

  /* ---------- نرد وعملة ---------- */
  dice() {
    let n = +store.kv('dice.n') || 2;
    const hist = [];
    app.innerHTML = `${offHead('dice')}
      <div class="card center"><div class="chips" id="dn" style="justify-content:center">${[1, 2, 3, 4, 5, 6].map(k => `<button class="chip" data-n="${k}">${k} ${k === 1 ? 'نرد' : 'نرود'}</button>`).join('')}</div>
        <div class="dice" id="dv"></div><p id="dsum" class="muted"></p><button class="btn primary big" id="roll">🎲 ارمِ</button></div>
      <div class="card center"><div class="coin" id="cv">🪙</div><button class="btn big" id="flip">🪙 اقلب العملة</button></div>
      <section class="card"><h3>📜 آخر الرميات</h3><div id="dh"><p class="muted">ما رميت للحين</p></div></section>`;
    const pickN = () => { $$('#dn .chip').forEach(c => c.classList.toggle('on', +c.dataset.n === n)); $('#dv').innerHTML = Array(n).fill('<span>⚀</span>').join(''); $('#dsum').textContent = ''; };
    const addHist = t => { hist.unshift(t); $('#dh').innerHTML = hist.slice(0, 10).map(x => `<div class="brow"><span>${x}</span></div>`).join(''); };
    $('#dn').onclick = e => { const b = e.target.closest('[data-n]'); if (!b) return; n = +b.dataset.n; store.kv('dice.n', n); pickN(); };
    $('#roll').onclick = () => {
      let k = 0;
      clearInterval(offTimer);
      offTimer = setInterval(() => {
        const v = Array.from({ length: n }, () => rnd(6));
        $('#dv').innerHTML = v.map(x => `<span>${DIE[x]}</span>`).join('');
        if (++k > 8) {
          clearInterval(offTimer);
          const sum = v.reduce((s, x) => s + x + 1, 0);
          $('#dsum').innerHTML = n > 1 ? `المجموع: <b>${sum}</b> (${v.map(x => x + 1).join(' + ')})` : `<b>${sum}</b>`;
          addHist(`🎲 ${v.map(x => DIE[x]).join(' ')} = ${sum}`);
        }
      }, 70);
    };
    $('#flip').onclick = () => {
      const c = $('#cv'); c.classList.remove('spin3d'); void c.offsetWidth; c.classList.add('spin3d');
      setTimeout(() => { const r = rnd(2) ? 'صورة 👑' : 'كتابة ✍️'; c.textContent = r; addHist(`🪙 ${r}`); }, 600);
    };
    pickN();
  },

  /* ---------- عدّاد المناسبة ---------- */
  countdown(data) {
    const EMO = ['🎉', '✈️', '💍', '🎓', '🎂', '🌙', '🏖️', '⚽'];
    if (data) {
      let x;
      try { x = JSON.parse(dec.decode(unb64u(data))); } catch { return brokenLink(); }
      if (!x || typeof x.t !== 'string' || typeof x.d !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(x.d)) return brokenLink();
      const title = x.t.slice(0, TITLE_LEN), when = new Date(x.d), emo = EMO.includes(x.e) ? x.e : '🎉', link = `${baseUrl()}#cd=${data}`;
      const topic = 'cd_' + strHash(data).toString(36);
      if (!store.get(topic)) store.upsert({ topic, key: '', mode: 'countdown', title, caplink: '#cd=' + data, at: when.getTime(), created: Date.now() });
      document.title = `${title} · صراحة`;
      const dateTxt = (() => { try { return new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(when); } catch { return x.d; } })();
      app.innerHTML = `${backLink()}<header class="mhead"><div class="big-ic" style="font-size:64px">${emo}</div><h2 class="ttl">${esc(title)}</h2><p class="muted">${esc(dateTxt)}</p></header>
        <div class="card center capsule"><div class="cd" id="cd"></div><p class="muted" id="cdl"></p></div>
        <section class="card"><h3>🔗 شارك العدّاد</h3><div class="row multi"><button class="btn" id="cp">نسخ الرابط</button><a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`${emo} ${title}\n${link}`)}">واتساب</a></div></section>
        <a class="btn ghost big" href="#play/countdown">✨ سوّ عدّاد ثاني</a>`;
      $('#cp').onclick = () => copyText(link);
      const tick = () => {
        const el = $('#cd'); if (!el) return clearInterval(capTimer);
        let s = Math.floor((when - Date.now()) / 1000);
        if (s <= 0) { clearInterval(capTimer); el.innerHTML = '<div><b>🎉</b></div>'; $('#cdl').textContent = 'جا اليوم!'; return; }
        const d = Math.floor(s / 86400); s %= 86400;
        const h = Math.floor(s / 3600); s %= 3600;
        el.innerHTML = [[d, 'يوم'], [h, 'ساعة'], [Math.floor(s / 60), 'دقيقة'], [s % 60, 'ثانية']].map(([v, u]) => `<div><b>${v}</b><small>${u}</small></div>`).join('');
        $('#cdl').textContent = 'باقي على الموعد';
      };
      clearInterval(capTimer); tick(); capTimer = setInterval(tick, 1000);
      return;
    }
    const def = new Date(); def.setDate(def.getDate() + 30);
    let emo = EMO[0];
    app.innerHTML = `${offHead('countdown')}<div class="card">
      <label for="ct">وش المناسبة؟</label><input id="ct" maxlength="${TITLE_LEN}" placeholder="مثلًا: سفرة الشلة لجورجيا">
      <label for="cdd">التاريخ</label><input type="date" id="cdd" value="${isoDay(def)}" min="${isoDay(new Date())}">
      <label for="ctm">الساعة</label><input type="time" id="ctm" value="20:00">
      <label>الأيقونة</label><div class="chips" id="ce">${EMO.map((e, i) => `<button type="button" class="chip${i ? '' : ' on'}" data-e="${e}">${e}</button>`).join('')}</div></div>
      <button class="btn primary big" id="cgo">⏳ سوّ العدّاد</button>`;
    $('#ce').onclick = e => { const b = e.target.closest('[data-e]'); if (!b) return; emo = b.dataset.e; $$('#ce .chip').forEach(c => c.classList.toggle('on', c === b)); };
    $('#cgo').onclick = () => {
      const t = $('#ct').value.trim(), d = $('#cdd').value, tm = $('#ctm').value || '00:00';
      if (!t) return toast('اكتب اسم المناسبة', true);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return toast('اختر التاريخ', true);
      if (new Date(`${d}T${tm}`) <= new Date()) return toast('اختر وقت بعد الحين', true);
      location.hash = 'cd=' + b64u(enc.encode(JSON.stringify({ t: t.slice(0, TITLE_LEN), d: `${d}T${tm}`, e: emo })));
    };
  }
});
