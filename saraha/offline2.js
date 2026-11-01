'use strict';
/* الدفعة الثالثة من ألعاب الجوال الواحد والأدوات */

const loadKV = (k, def) => { try { const v = JSON.parse(store.kv(k)); return v && typeof v === 'object' ? v : def; } catch { return def; } };
const saveKV = (k, v) => store.kv(k, JSON.stringify(v));
const num = s => parseFloat(toLatin(s));

// كرت يكشف الجواب: للفوازير والأمثال
function revealDeck(id, list, front, back, btnText) {
  const next = deck(list);
  let score = 0;
  app.innerHTML = `${offHead(id)}
    <div class="card center ecard"><p class="rq" id="rq"></p><p class="ans" id="ra" hidden></p>
      <div class="row"><button class="btn grow" id="rv">👀 ${btnText}</button><button class="btn primary grow" id="nx">التالي ←</button></div>
      <button class="btn ghost sm" id="pt" style="margin-top:10px">✅ عرفناها (+1)</button><p class="muted small" id="sc">النقاط: 0</p></div>`;
  const show = () => { const x = next(); $('#rq').textContent = front(x); $('#ra').textContent = back(x); $('#ra').hidden = true; };
  $('#rv').onclick = () => { $('#ra').hidden = false; };
  $('#nx').onclick = show;
  $('#pt').onclick = () => { score++; $('#sc').textContent = `النقاط: ${score}`; $('#ra').hidden = false; };
  show();
}

// لعبة فرق بوقت: مثّلها ولا تقولها
function teamTimer(id, list, cardHtml, taboo) {
  const next = deck(list), teams = [{ n: 'الفريق الأول', s: 0 }, { n: 'الفريق الثاني', s: 0 }];
  let turn = 0, left = 0, cur = null, got = 0;
  app.innerHTML = `${offHead(id)}
    <div class="card"><div class="addrow"><input id="t0" maxlength="20" value="${teams[0].n}"><input id="t1" maxlength="20" value="${teams[1].n}"></div>
      <label for="tt">وقت كل دور</label><select id="tt" class="sel"><option value="60">دقيقة</option><option value="90">دقيقة ونص</option><option value="120">دقيقتين</option></select></div>
    <div class="scoreboard" id="sb"></div>
    <div id="stage"></div>`;
  const sb = () => { $('#sb').innerHTML = teams.map((t, i) => `<div class="sbt${i === turn ? ' on' : ''}"><small>${esc(t.n)}</small><b dir="ltr">${t.s}</b></div>`).join(''); };
  [0, 1].forEach(i => { $('#t' + i).oninput = e => { teams[i].n = e.target.value.trim() || `الفريق ${i ? 'الثاني' : 'الأول'}`; sb(); }; });
  const stage = $('#stage');
  const idle = () => {
    clearInterval(offTimer); sb();
    stage.innerHTML = `<div class="card center"><p class="muted">الدور على</p><div class="gname">${esc(teams[turn].n)}</div><p class="muted small">واحد منهم ياخذ الجوال، والباقي يخمّنون.</p></div>
      <button class="btn primary big" id="go">▶️ ابدأ الدور</button>`;
    $('#go').onclick = start;
  };
  const card = () => { cur = next(); $('#card').innerHTML = cardHtml(cur); };
  const start = () => {
    left = +$('#tt').value; got = 0;
    stage.innerHTML = `<div class="card center"><div class="timer big" id="tm">${left}</div><div id="card" class="tcard"></div>
      <div class="row"><button class="btn primary grow" id="ok">✅ صح</button>${taboo ? '<button class="btn danger grow" id="no">⛔ قالها</button>' : ''}<button class="btn grow" id="sk">⏭️ تخطي</button></div></div>`;
    card();
    $('#ok').onclick = () => { teams[turn].s++; got++; sb(); card(); };
    $('#sk').onclick = card;
    if (taboo) $('#no').onclick = () => { teams[turn].s--; got--; sb(); card(); };
    offTimer = setInterval(() => {
      left--; const t = $('#tm'); if (t) t.textContent = left;
      if (left <= 0) {
        clearInterval(offTimer); Sound.play('alarm');
        stage.innerHTML = `<div class="card center"><h3>⏰ انتهى الوقت!</h3><p>${esc(teams[turn].n)} جاب <b>${got}</b> هالدور</p></div><button class="btn primary big" id="nt">الدور اللي بعده ←</button>`;
        $('#nt').onclick = () => { turn = 1 - turn; idle(); };
      }
    }, 1000);
  };
  idle();
}

Object.assign(OFFLINE, {
  /* ---------- صراحة ولا جرأة بمستويات ---------- */
  tod() {
    const names = loadPlayers(), decks = {};
    let lv = store.kv('tod.level') || 'friends', last = null, kind = null;
    if (!todLevels().some(l => l[0] === lv)) lv = 'friends';
    app.innerHTML = `${offHead('tod')}${playersField('اللاعبين (اختياري)')}
      <div class="chips" id="lv">${todLevels().map(([k, t]) => `<button class="chip${k === lv ? ' on' : ''}" data-l="${k}">${t}</button>`).join('')}</div>
      <div class="card center" style="margin-top:12px"><div class="turn" id="turn">🎲</div><button class="btn" id="spin">🎯 مين عليه الدور؟</button></div>
      <div class="todbtns"><button class="btn big truth" id="bt">🤫 صراحة</button><button class="btn big dare" id="bd">🔥 جرأة</button></div>
      <div class="card qcard" id="qc" hidden><small id="qk"></small><p id="qt"></p><button class="btn ghost" id="again">🔄 غيّر السؤال</button></div>`;
    bindPlayers(names, 'بدون أسماء تقدرون تلعبون بالدور');
    const get = k => { const key = lv + k; if (!decks[key]) { const L = todLevels().find(l => l[0] === lv); decks[key] = deck(k === 't' ? L[2] : L[3]); } return decks[key](); };
    $('#lv').onclick = e => { const b = e.target.closest('[data-l]'); if (!b) return; lv = b.dataset.l; store.kv('tod.level', lv); $$('#lv .chip').forEach(c => c.classList.toggle('on', c === b)); };
    $('#spin').onclick = () => {
      if (names.length < 2) return toast('أضف اسمين على الأقل', true);
      const t = $('#turn'), pick = randOf(names.filter(n => n !== last));
      let k = 0;
      clearInterval(offTimer);
      offTimer = setInterval(() => { t.textContent = names[k++ % names.length]; }, 70);
      setTimeout(() => { clearInterval(offTimer); t.textContent = '👉 ' + pick; last = pick; Sound.play('pop'); }, 1100);
    };
    const show = k => {
      kind = k;
      $('#qk').textContent = (k === 't' ? '🤫 صراحة' : '🔥 جرأة') + (last ? ` · ${last}` : '');
      $('#qt').textContent = get(k);
      const qc = $('#qc'); qc.hidden = false; qc.classList.remove('flip'); void qc.offsetWidth; qc.classList.add('flip');
      qc.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    $('#bt').onclick = () => show('t');
    $('#bd').onclick = () => show('d');
    $('#again').onclick = () => kind && show(kind);
  },

  /* ---------- مثّلها ---------- */
  charades() { teamTimer('charades', CHARADES, w => `<small class="muted">مثّل بدون كلام:</small><div class="gname">${esc(w)}</div>`, false); },

  /* ---------- لا تقولها! ---------- */
  taboo() {
    teamTimer('taboo', TABOO, ([w, ban]) => `<small class="muted">وصّف الكلمة:</small><div class="gname">${esc(w)}</div>
      <div class="ban"><small>ممنوع تقول:</small>${ban.map(b => `<span>${esc(b)}</span>`).join('')}</div>`, true);
  },

  /* ---------- فوازير ---------- */
  riddles() { revealDeck('riddles', RIDDLES, x => x[0], x => x[1], 'الجواب'); },

  /* ---------- كمّل المثل ---------- */
  proverb() { revealDeck('proverb', PROVERBS, x => `${x[0]}…`, x => `${x[0]} ${x[1]}`, 'كمّله'); },

  /* ---------- عشرين سؤال ---------- */
  twenty() {
    app.innerHTML = `${offHead('twenty')}<div id="stage"></div>`;
    const stage = $('#stage');
    const pickPhase = () => {
      stage.innerHTML = `<div class="card center"><h3>🤔 اللي بيفكر ياخذ الجوال</h3><p class="muted">اختار شي في بالك، أو خلّ الصفحة تقترح عليك (بالسر).</p></div>
        <button class="btn primary big" id="sug">🎲 اقترح عليّ</button><button class="btn big" id="own">💭 بفكر بنفسي</button>`;
      $('#sug').onclick = () => {
        const [cat, list] = randOf(TWENTY_THINGS), thing = randOf(list);
        stage.innerHTML = `<div class="card center pass"><p class="muted">${esc(cat)}:</p><div class="gname">${esc(thing)}</div><p class="muted small">احفظه ولا تقوله 🤫</p></div><button class="btn primary big" id="ok">حفظته، ابدأوا الأسئلة ←</button>`;
        $('#ok').onclick = () => play(`${cat}: ${thing}`);
      };
      $('#own').onclick = () => play(null);
    };
    const play = secret => {
      const log = [];
      const draw = () => {
        const n = log.length, done = n >= 20;
        stage.innerHTML = `<div class="card center"><div class="timer big">${n} / 20</div><p class="muted">${done ? 'خلصت الأسئلة! 😱' : 'كل سؤال جوابه «إي» أو «لا»'}</p>
          <div class="qbar"><i style="width:${(1 - n / 20) * 100}%"></i></div>
          <div class="tlog">${log.map((a, i) => `<span>${i + 1}${a}</span>`).join('')}</div></div>
          ${done ? '' : `<div class="todbtns"><button class="btn big truth" data-a="✅">✅ إي</button><button class="btn big dare" data-a="❌">❌ لا</button><button class="btn big" data-a="🤷">🤷 يمكن</button></div>`}
          <div class="row"><button class="btn ghost grow" id="undo"${n ? '' : ' disabled'}>↩️ تراجع</button><button class="btn primary grow" id="win">🎉 عرفوها!</button></div>
          <button class="btn danger big" id="end">${done ? '👀 اكشف' : '🏳️ استسلموا'}</button>`;
        $$('[data-a]', stage).forEach(b => { b.onclick = () => { log.push(b.dataset.a); draw(); }; });
        $('#undo').onclick = () => { log.pop(); draw(); };
        const fin = won => {
          stage.innerHTML = `<div class="card center pass"><h3>${won ? `🎉 عرفوها بعد ${log.length} سؤال!` : '😅 ما عرفوها'}</h3>${secret ? `<p class="muted">كان:</p><div class="gname">${esc(secret)}</div>` : '<p>قول لهم وش كان في بالك 😄</p>'}</div>
            <button class="btn primary big" id="again">🔄 جولة جديدة</button>`;
          $('#again').onclick = pickPhase;
        };
        $('#win').onclick = () => fin(true);
        $('#end').onclick = () => fin(false);
      };
      draw();
    };
    pickPhase();
  },

  /* ---------- حاسبة البلوت ---------- */
  baloot() {
    const G = loadKV('baloot', null) || { a: 'لنا', b: 'لهم', rounds: [], wins: { a: 0, b: 0 }, target: 152 };
    const save = () => saveKV('baloot', G);
    app.innerHTML = `${offHead('baloot')}
      <div class="baloot">
        <div class="bcol"><input id="na" maxlength="12" value="${esc(G.a)}"><b id="sa">0</b></div>
        <div class="bcol"><input id="nb" maxlength="12" value="${esc(G.b)}"><b id="sb2">0</b></div>
      </div>
      <div class="card pick center" id="win" hidden></div>
      <section class="card"><div class="addrow"><input id="ia" inputmode="numeric" placeholder="${esc(G.a)}"><input id="ib" inputmode="numeric" placeholder="${esc(G.b)}"></div>
        <button class="btn primary big" id="add">➕ سجّل الجولة</button></section>
      <p class="muted center" id="wins"></p>
      <section class="card"><div class="gh"><h3>📜 الجولات</h3><button class="btn ghost sm" id="undo">↩️ تراجع</button></div><div id="rl"></div></section>
      <div class="row"><button class="btn grow" id="newg">🆕 صكّة جديدة</button><button class="btn ghost grow" id="reset">🧹 تصفير الكل</button></div>`;
    const tot = k => G.rounds.reduce((s, r) => s + r[k], 0);
    const winner = () => { const A = tot('a'), B = tot('b'); if (A < G.target && B < G.target) return null; return A === B ? 'tie' : A > B ? 'a' : 'b'; };
    const draw = () => {
      $('#sa').textContent = tot('a'); $('#sb2').textContent = tot('b');
      const w = winner(), W = $('#win');
      W.hidden = !w; if (w) W.innerHTML = w === 'tie' ? '<div class="gname">تعادل! 🤝</div>' : `<small>الصكّة لـ</small><div class="gname">🏆 ${esc(G[w])}</div>`;
      $('#wins').textContent = `الصكّات: ${G.a} ${G.wins.a} · ${G.b} ${G.wins.b}`;
      $('#rl').innerHTML = G.rounds.length ? G.rounds.map((r, i) => `<div class="brow"><span>${i + 1}.</span><span>${esc(G.a)}: <b>${r.a}</b></span><span>${esc(G.b)}: <b>${r.b}</b></span><button class="x" data-del="${i}">✕</button></div>`).reverse().join('') : '<p class="muted">ما فيه جولات للحين</p>';
      $('#ia').placeholder = G.a; $('#ib').placeholder = G.b;
    };
    $('#na').onchange = e => { G.a = e.target.value.trim() || 'لنا'; save(); draw(); };
    $('#nb').onchange = e => { G.b = e.target.value.trim() || 'لهم'; save(); draw(); };
    $('#add').onclick = () => {
      const a = num($('#ia').value) || 0, b = num($('#ib').value) || 0;
      if (!a && !b) return toast('اكتب النقاط', true);
      G.rounds.push({ a: Math.round(a), b: Math.round(b) }); save();
      $('#ia').value = ''; $('#ib').value = ''; $('#ia').focus(); draw();
    };
    $('#ib').onkeydown = e => { if (e.key === 'Enter') $('#add').click(); };
    $('#undo').onclick = () => { G.rounds.pop(); save(); draw(); };
    $('#rl').onclick = e => { const b = e.target.closest('[data-del]'); if (b) { G.rounds.splice(+b.dataset.del, 1); save(); draw(); } };
    $('#newg').onclick = () => {
      const w = winner();
      if (!w && G.rounds.length && !confirm('محد وصل 152. تبدأ صكّة جديدة؟')) return;
      if (w === 'a' || w === 'b') G.wins[w]++;
      G.rounds = []; save(); draw();
    };
    $('#reset').onclick = () => { if (confirm('تصفّر النقاط والصكّات؟')) { G.rounds = []; G.wins = { a: 0, b: 0 }; save(); draw(); } };
    draw();
  },

  /* ---------- عدّاد النقاط ---------- */
  score() {
    const D = loadKV('score', null) || { players: loadPlayers().slice(0, MAX_NAMES), pts: {} };
    const save = () => saveKV('score', D);
    app.innerHTML = `${offHead('score')}
      <div class="card"><label for="nm">اللاعبين</label>
        <div class="addrow"><input id="nm" maxlength="400" placeholder="اكتب اسم واضغط إضافة" enterkeyhint="done"><button class="btn" id="add" type="button">إضافة</button></div>
        <div class="chips" id="chips"></div></div>
      <div id="sl"></div>
      <div class="row"><button class="btn grow" id="sh">📋 نسخ الترتيب</button><button class="btn ghost grow" id="zero">🧹 تصفير النقاط</button></div>`;
    const draw = () => {
      const top = Math.max(0, ...D.players.map(p => D.pts[p] || 0));
      $('#sl').innerHTML = D.players.length ? D.players.map(p => `<div class="card srow"><b>${top && (D.pts[p] || 0) === top ? '👑 ' : ''}${esc(p)}</b><span class="sval" dir="ltr">${D.pts[p] || 0}</span>
        <div class="sbtns">${[-1, 1, 5, 10].map(v => `<button class="btn sm${v < 0 ? ' ghost' : ''}" data-p="${esc(p)}" data-v="${v}">${v > 0 ? '+' : ''}${v}</button>`).join('')}</div></div>`).join('')
        : emptyCard('أضف اللاعبين فوق 👆');
    };
    chipList($('#nm'), $('#add'), $('#chips'), D.players, { max: MAX_NAMES, len: NAME_LEN, empty: 'ما أضفت أحد للحين', onChange: () => { save(); draw(); } });
    $('#sl').onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; D.pts[b.dataset.p] = (D.pts[b.dataset.p] || 0) + +b.dataset.v; save(); draw(); };
    $('#zero').onclick = () => { if (confirm('تصفّر نقاط الكل؟')) { D.pts = {}; save(); draw(); } };
    $('#sh').onclick = () => copyText('🏆 الترتيب\n' + [...D.players].sort((a, b) => (D.pts[b] || 0) - (D.pts[a] || 0)).map((p, i) => `${i + 1}. ${p}: ${D.pts[p] || 0}`).join('\n'));
    draw();
  }
});
