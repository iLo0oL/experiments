'use strict';
/* ألعاب على جوال واحد وأدوات الطلعات: ما تحتاج روابط ولا نت */

let offTimer = null;
const offHead = id => {
  const M = MODES[id];
  document.title = `${M.name} · صراحة`;
  return `${backLink()}<header class="mhead"><div class="big-ic">${M.icon}</div><h2 class="ttl">${M.name}</h2><p class="muted">${M.tag}</p></header>${howCard(M)}`;
};
const loadPlayers = () => { try { return JSON.parse(store.kv('players') || store.kv('tod.names')) || []; } catch { return []; } };
const playersField = (label = 'اللاعبين') => `<div class="card"><label for="nm">${label}</label>
  <div class="addrow"><input id="nm" maxlength="400" placeholder="اكتب اسم واضغط إضافة" enterkeyhint="done"><button class="btn" id="add" type="button">إضافة</button></div>
  <div class="chips" id="chips"></div></div>`;
const bindPlayers = (names, empty = 'ما أضفت أحد للحين') => chipList($('#nm'), $('#add'), $('#chips'), names, {
  max: MAX_NAMES, len: NAME_LEN, empty, onChange: () => store.kv('players', JSON.stringify(names))
});
const deck = list => { let d = []; return () => { if (!d.length) d = shuffle(list); return d.pop(); }; };
const randOf = a => a[Math.floor(Math.random() * a.length)];
const toLatin = s => String(s).replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x6F0).replace(/[٫,]/g, '.');
const money = n => (Math.round(n * 100) / 100).toLocaleString('en', { maximumFractionDigits: 2 });

// تمرير الجوال: كل لاعب يشوف سره بدوره
function passAround(stage, order, secretHtml, done) {
  let k = 0;
  const next = () => {
    if (k >= order.length) return done();
    const n = order[k];
    stage.innerHTML = `<div class="card center pass"><p class="muted">مرّر الجوال لـ</p><div class="gname">${esc(n)}</div>
      <button class="btn primary big" id="see">أنا ${esc(n)}، ورّني 👀</button><p class="muted small">${k + 1} من ${order.length}</p></div>`;
    $('#see').onclick = () => {
      stage.innerHTML = `<div class="card center pass">${secretHtml(n)}<button class="btn big" id="hide" style="margin-top:16px">خبّيته، التالي ←</button></div>`;
      $('#hide').onclick = () => { k++; next(); };
    };
  };
  next();
}

const OFFLINE = {
  /* ---------- صراحة ولا جرأة ---------- */
  tod() {
    const names = loadPlayers(), truth = deck(TOD_TRUTH), dare = deck(TOD_DARE);
    let last = null, kind = null;
    app.innerHTML = `${offHead('tod')}${playersField('اللاعبين (اختياري)')}
      <div class="card center"><div class="turn" id="turn">🎲</div><button class="btn" id="spin">🎯 مين عليه الدور؟</button></div>
      <div class="todbtns"><button class="btn big truth" id="bt">🤫 صراحة</button><button class="btn big dare" id="bd">🔥 جرأة</button></div>
      <div class="card qcard" id="qc" hidden><small id="qk"></small><p id="qt"></p><button class="btn ghost" id="again">🔄 غيّر السؤال</button></div>`;
    bindPlayers(names, 'بدون أسماء تقدرون تلعبون بالدور');
    $('#spin').onclick = () => {
      if (names.length < 2) return toast('أضف اسمين على الأقل', true);
      const t = $('#turn'), pick = randOf(names.filter(n => n !== last));
      let k = 0;
      clearInterval(offTimer);
      offTimer = setInterval(() => { t.textContent = names[k++ % names.length]; }, 70);
      setTimeout(() => { clearInterval(offTimer); t.textContent = '👉 ' + pick; last = pick; }, 1100);
    };
    const show = k => {
      kind = k;
      $('#qk').textContent = (k === 't' ? '🤫 صراحة' : '🔥 جرأة') + (last ? ` · ${last}` : '');
      $('#qt').textContent = k === 't' ? truth() : dare();
      const qc = $('#qc'); qc.hidden = false; qc.classList.remove('flip'); void qc.offsetWidth; qc.classList.add('flip');
      qc.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    $('#bt').onclick = () => show('t');
    $('#bd').onclick = () => show('d');
    $('#again').onclick = () => kind && show(kind);
  },

  /* ---------- مين الغريب؟ ---------- */
  odd() {
    const names = loadPlayers(), pairs = deck(ODD_PAIRS);
    app.innerHTML = `${offHead('odd')}${playersField()}<div id="stage"></div>`;
    bindPlayers(names);
    const stage = $('#stage');
    const start = () => {
      if (names.length < 3) return toast('أضف 3 لاعبين على الأقل', true);
      const p = pairs(), flip = Math.random() < 0.5, w = flip ? p[1] : p[0], ow = flip ? p[0] : p[1], odd = randOf(names);
      passAround(stage, shuffle(names), n => `<p class="muted">كلمتك يا ${esc(n)}:</p><div class="gname">${esc(n === odd ? ow : w)}</div><p class="muted small">احفظها ولا تقولها لأحد 🤫</p>`, () => {
        stage.innerHTML = `<div class="card"><h3>🗣️ الكل شاف كلمته</h3><ol>
          <li>بالدور، كل واحد يوصف كلمته بكلمة وحدة.</li><li>تناقشوا: وصف مين كان غريب؟</li><li>صوّتوا على الغريب، وبعدين اكشفوا.</li></ol>
          <p class="muted">يبدأ: <b>${esc(randOf(names))}</b></p></div>
          <button class="btn danger big" id="rev">🧐 اكشف الغريب</button>`;
        $('#rev').onclick = () => {
          stage.innerHTML = `<div class="card center pass"><p class="muted">الغريب كان</p><div class="gname">${esc(odd)}</div>
            <p>كلمة الكل: <b>${esc(w)}</b><br>كلمة الغريب: <b>${esc(ow)}</b></p></div>
            <button class="btn primary big" id="again">🔄 جولة جديدة</button>`;
          $('#again').onclick = start;
        };
      });
    };
    stage.innerHTML = `<button class="btn primary big" id="start">🎲 ابدأ جولة</button>`;
    $('#start').onclick = start;
  },

  /* ---------- الذيب بالشلة ---------- */
  wolf() {
    const names = loadPlayers();
    app.innerHTML = `${offHead('wolf')}${playersField('اللاعبين (بدون الراوي)')}
      <div class="card"><label for="wn">عدد الذيابة</label><select id="wn" class="sel"></select>
        <label class="qrow"><input type="checkbox" id="rg" checked><span>🛡️ فيه حارس</span></label>
        <label class="qrow"><input type="checkbox" id="rs" checked><span>🔮 فيه عرّاف</span></label></div>
      <div id="stage"></div>`;
    const sel = $('#wn');
    const opts = () => {
      const max = Math.max(1, Math.floor((names.length - 1) / 2)), cur = +sel.value || Math.max(1, Math.floor(names.length / 4));
      sel.innerHTML = Array.from({ length: max }, (_, i) => `<option value="${i + 1}"${i + 1 === Math.min(cur, max) ? ' selected' : ''}>${i + 1}</option>`).join('');
    };
    chipList($('#nm'), $('#add'), $('#chips'), names, { max: MAX_NAMES, len: NAME_LEN, empty: 'ما أضفت أحد للحين', onChange: () => { store.kv('players', JSON.stringify(names)); opts(); } });
    opts();
    const stage = $('#stage');
    const start = () => {
      const w = +sel.value, g = $('#rg').checked, s = $('#rs').checked;
      if (names.length < 4) return toast('أضف 4 لاعبين على الأقل', true);
      const roles = [...Array(w).fill('wolf'), ...(g ? ['guard'] : []), ...(s ? ['seer'] : [])];
      if (roles.length >= names.length) return toast('الأدوار أكثر من اللاعبين، قلّل الذيابة', true);
      while (roles.length < names.length) roles.push('village');
      const mixed = shuffle(roles), role = new Map(names.map((n, i) => [n, mixed[i]]));
      const wolves = names.filter(n => role.get(n) === 'wolf');
      passAround(stage, shuffle(names), n => {
        const R = WOLF_ROLES[role.get(n)], mates = role.get(n) === 'wolf' ? wolves.filter(x => x !== n) : [];
        return `<p class="muted">دورك يا ${esc(n)}:</p><div class="big-ic">${R.icon}</div><div class="gname">${R.name}</div><p>${R.desc}</p>${mates.length ? `<p class="muted small">الذيابة معك: <b>${mates.map(esc).join('، ')}</b></p>` : ''}`;
      }, () => narrator(role));
    };
    const narrator = role => {
      const out = new Set();
      let show = false;
      const draw = () => {
        const alive = names.filter(n => !out.has(n)), aw = alive.filter(n => role.get(n) === 'wolf').length, ao = alive.length - aw;
        const win = aw === 0 ? '🎉 أهل القرية فازوا! طلّعوا كل الذيابة.' : aw >= ao ? '🐺 الذيب فاز! صار عددهم مثل الباقين.' : '';
        stage.innerHTML = `<div class="card center"><h3>📱 الحين عطوا الجوال للراوي</h3><p class="muted small">الراوي ما يلعب، هو اللي يمشّي اللعبة.</p></div>
          ${win ? `<div class="card center pick"><div class="gname">${win}</div></div>` : ''}
          <section class="card"><div class="gh"><h3>👥 اللاعبين</h3><button class="btn ghost sm" id="tg">${show ? '🙈 خبّ الأدوار' : '👁️ ورّني الأدوار'}</button></div>
            <p class="muted small">اضغط على اللي يطلع (انقتل أو صوّتوا عليه).</p>
            ${names.map(n => `<button class="prow wrow${out.has(n) ? ' out' : ''}" data-n="${esc(n)}"><b>${out.has(n) ? '❌ ' : ''}${esc(n)}</b><span>${show ? WOLF_ROLES[role.get(n)].icon + ' ' + WOLF_ROLES[role.get(n)].name : ''}</span></button>`).join('')}
            ${show ? `<p class="muted" style="margin-top:8px">باقي: 🐺 ${aw} · 🏡 ${ao}</p>` : ''}</section>
          <details class="card" open><summary>🌙 الليل</summary><ol>
            <li>«الكل يغمض عيونه» 😴</li><li>«يا ذيابة افتحوا عيونكم… اختاروا ضحية بالإشارة… وغمّضوا» 🐺</li>
            ${role.size && [...role.values()].includes('guard') ? '<li>«يا حارس افتح عيونك… اختر مين تحمي… وغمّض» 🛡️</li>' : ''}
            ${[...role.values()].includes('seer') ? '<li>«يا عرّاف افتح عيونك… أشر على شخص» (الراوي يأشر 👍 ذيب أو 👎 لا) «…وغمّض» 🔮</li>' : ''}
            <li>«الكل يفتح عيونه» ☀️</li></ol></details>
          <details class="card" open><summary>☀️ النهار</summary><ol>
            <li>أعلن مين انقتل (إلا لو الحارس حماه)، واضغط عليه فوق.</li><li>نقاش: مين تشكّون فيه؟</li>
            <li>تصويت: اللي ياخذ أكثر الأصوات يطلع، واضغط عليه فوق.</li><li>ارجعوا لليل 🌙</li></ol></details>
          <button class="btn primary big" id="again">🔄 لعبة جديدة</button>`;
        $('#tg').onclick = () => { show = !show; draw(); };
        $$('.wrow', stage).forEach(b => { b.onclick = () => { const n = b.dataset.n; out.has(n) ? out.delete(n) : out.add(n); draw(); }; });
        $('#again').onclick = () => { if (confirm('تبدأ لعبة جديدة بأدوار جديدة؟')) start(); };
      };
      draw();
    };
    stage.innerHTML = `<button class="btn primary big" id="start">🐺 وزّع الأدوار</button>`;
    $('#start').onclick = start;
  },

  /* ---------- ارسم وخمّن ---------- */
  draw() {
    const words = deck(DRAW_WORDS), COLORS = ['#111111', '#e11d48', '#2563eb', '#16a34a', '#f59e0b', '#8b5cf6'];
    let word = null, color = COLORS[0], strokes = [], cur = null, left = 0, got = 0;
    app.innerHTML = `${offHead('draw')}
      <div class="card center"><div class="dword" id="dword">اضغط «كلمة جديدة»، والرسام بس يشوفها 🤫</div>
        <div class="row"><button class="btn primary grow" id="nw">🎲 كلمة جديدة</button><button class="btn grow" id="peek" disabled>👀 ورّني الكلمة</button></div></div>
      <div class="card">
        <div class="tools">${COLORS.map((c, i) => `<button class="sw${i ? '' : ' on'}" data-c="${c}" style="background:${c}" aria-label="لون"></button>`).join('')}
          <button class="sw er" data-c="#ffffff" aria-label="ممحاة">🧽</button><span class="grow"></span>
          <button class="btn ghost sm" id="undo">↩️</button><button class="btn ghost sm" id="clr">🗑️</button></div>
        <canvas id="pad"></canvas>
        <div class="row between"><span class="timer" id="tm">60</span><button class="btn" id="go">⏱️ ابدأ الوقت</button><button class="btn primary" id="ok">✅ عرفوها</button></div>
        <p class="muted small center" id="score">عرفوا 0</p>
      </div>`;
    const cv = $('#pad'), ctx = cv.getContext('2d'), dpr = Math.max(1, window.devicePixelRatio || 1);
    const size = () => { const w = cv.clientWidth; cv.width = w * dpr; cv.height = Math.round(w * 1.1) * dpr; cv.style.height = Math.round(w * 1.1) + 'px'; redraw(); };
    const redraw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = ctx.lineJoin = 'round';
      for (const s of strokes) {
        ctx.strokeStyle = s.c; ctx.lineWidth = s.w; ctx.beginPath();
        s.p.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
        if (s.p.length === 1) ctx.lineTo(s.p[0][0] + 0.1, s.p[0][1]);
        ctx.stroke();
      }
    };
    const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); cur = { c: color, w: color === '#ffffff' ? 26 : 5, p: [pos(e)] }; strokes.push(cur); redraw(); };
    cv.onpointermove = e => { if (cur) { cur.p.push(pos(e)); redraw(); } };
    cv.onpointerup = cv.onpointercancel = () => { cur = null; };
    $('.tools').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; color = b.dataset.c; $$('.sw').forEach(x => x.classList.toggle('on', x === b)); };
    $('#undo').onclick = () => { strokes.pop(); redraw(); };
    $('#clr').onclick = () => { strokes = []; redraw(); };
    const dw = $('#dword'), stop = () => { clearInterval(offTimer); };
    $('#nw').onclick = () => {
      word = words(); strokes = []; redraw(); stop(); left = 60; $('#tm').textContent = '60';
      dw.textContent = 'الكلمة جاهزة. الرسام بس يضغط «ورّني» 👀'; $('#peek').disabled = false;
    };
    $('#peek').onclick = () => {
      if (!word) return;
      dw.innerHTML = `<b class="pink" style="font-size:30px">${esc(word)}</b>`;
      setTimeout(() => { if (word) dw.textContent = 'احفظتها؟ ابدأ الوقت وارسم ✏️'; }, 2500);
    };
    $('#go').onclick = () => {
      if (!word) return toast('اختار كلمة أول', true);
      stop(); left = 60; $('#tm').textContent = left;
      offTimer = setInterval(() => {
        left--; $('#tm').textContent = left;
        if (left <= 0) { stop(); dw.innerHTML = `⏰ انتهى الوقت! الكلمة كانت: <b class="pink">${esc(word)}</b>`; word = null; $('#peek').disabled = true; }
      }, 1000);
    };
    $('#ok').onclick = () => {
      if (!word) return;
      stop(); got++; $('#score').textContent = `عرفوا ${got}`;
      dw.innerHTML = `🎉 عرفوها! الكلمة: <b class="pink">${esc(word)}</b>`; word = null; $('#peek').disabled = true;
    };
    size();
    addEventListener('resize', size, { once: true });
  },

  /* ---------- خمّن من الإيموجي ---------- */
  emoji() {
    const cats = [...new Set(EMOJI_PUZZLES.map(p => p[0]))];
    let cat = '', next = deck(EMOJI_PUZZLES), cur = null, score = 0;
    app.innerHTML = `${offHead('emoji')}
      <div class="chips" id="cats"><button class="chip on" data-c="">الكل</button>${cats.map(c => `<button class="chip" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <div class="card center ecard"><small id="ec"></small><div class="emo" id="eq"></div><p class="ans" id="ea" hidden></p>
        <div class="row"><button class="btn grow" id="reveal">👀 اكشف الجواب</button><button class="btn primary grow" id="nx">التالي ←</button></div>
        <button class="btn ghost sm" id="pt" style="margin-top:10px">✅ عرفناها (+1)</button><p class="muted small" id="sc">النقاط: 0</p></div>`;
    const show = () => {
      cur = next();
      $('#ec').textContent = cur[0]; $('#eq').textContent = cur[1]; $('#ea').textContent = cur[2]; $('#ea').hidden = true;
    };
    $('#cats').onclick = e => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      cat = b.dataset.c; $$('#cats .chip').forEach(c => c.classList.toggle('on', c === b));
      next = deck(cat ? EMOJI_PUZZLES.filter(p => p[0] === cat) : EMOJI_PUZZLES); show();
    };
    $('#reveal').onclick = () => { $('#ea').hidden = false; };
    $('#nx').onclick = show;
    $('#pt').onclick = () => { score++; $('#sc').textContent = `النقاط: ${score}`; $('#ea').hidden = false; };
    show();
  },

  /* ---------- أسئلة عميقة ---------- */
  deep() {
    const names = loadPlayers(), LV = [['light', '🙂 خفيف'], ['mid', '🤔 متوسط'], ['deep', '💭 عميق']], decks = {};
    let lv = 'light', turn = 0;
    app.innerHTML = `${offHead('deep')}${playersField('اللاعبين (اختياري، عشان نعرف على مين الدور)')}
      <div class="chips" id="lv">${LV.map(([k, t], i) => `<button class="chip${i ? '' : ' on'}" data-l="${k}">${t}</button>`).join('')}</div>
      <div class="card center qcard"><small id="dw"></small><p id="dq"></p><button class="btn primary" id="dn">سؤال ثاني ←</button></div>`;
    bindPlayers(names, 'بدون أسماء: كل واحد يجاوب بدوره');
    const show = () => {
      if (!decks[lv]) decks[lv] = deck(DEEP_Q[lv]);
      $('#dq').textContent = decks[lv]();
      $('#dw').textContent = names.length ? `يجاوب: ${names[turn++ % names.length]}` : LV.find(x => x[0] === lv)[1];
      const c = $('.qcard'); c.classList.remove('flip'); void c.offsetWidth; c.classList.add('flip');
    };
    $('#lv').onclick = e => { const b = e.target.closest('[data-l]'); if (!b) return; lv = b.dataset.l; $$('#lv .chip').forEach(c => c.classList.toggle('on', c === b)); show(); };
    $('#dn').onclick = show;
    show();
  },

  /* ---------- قرعة الفرق ---------- */
  teams() {
    const names = loadPlayers(), TEAMS = [['🔴', 'الأحمر'], ['🔵', 'الأزرق'], ['🟢', 'الأخضر'], ['🟡', 'الأصفر'], ['🟣', 'البنفسجي'], ['🟠', 'البرتقالي']];
    let last = null;
    app.innerHTML = `${offHead('teams')}${playersField('الأسماء')}
      <div class="card"><label for="tn">عدد الفرق</label><select id="tn" class="sel">${[2, 3, 4, 5, 6].map(n => `<option>${n}</option>`).join('')}</select></div>
      <button class="btn primary big" id="go">🎲 سوّ القرعة</button><div id="out"></div>`;
    bindPlayers(names);
    const text = () => last.map((t, i) => `${TEAMS[i][0]} الفريق ${TEAMS[i][1]}: ${t.join('، ')}`).join('\n');
    $('#go').onclick = () => {
      const k = +$('#tn').value;
      if (names.length < k) return toast(`تحتاج ${k} أسماء على الأقل`, true);
      last = Array.from({ length: k }, () => []);
      shuffle(names).forEach((n, i) => last[i % k].push(n));
      $('#out').innerHTML = `<div class="teams">${last.map((t, i) => `<div class="card team"><h3>${TEAMS[i][0]} الفريق ${TEAMS[i][1]}</h3>${t.map(n => `<div>${esc(n)}</div>`).join('')}</div>`).join('')}</div>
        <div class="row"><button class="btn grow" id="cp">📋 نسخ</button><a class="btn wa grow" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('👥 قرعة الفرق\n' + text())}">واتساب</a></div>`;
      $('#cp').onclick = () => copyText(text());
      $('#out').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  },

  /* ---------- دولاب القرار ---------- */
  wheel() {
    let items = []; try { items = JSON.parse(store.kv('wheel')) || []; } catch {}
    if (!items.length) items = WHEEL_SETS[0][1].slice();
    const COLS = ['#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#14b8a6', '#a855f7'];
    let rot = 0, spinning = false;
    app.innerHTML = `${offHead('wheel')}
      <div class="chips" id="sets">${WHEEL_SETS.map(([t], i) => `<button class="chip" data-s="${i}">${t}</button>`).join('')}<button class="chip" data-s="p">👥 أسماء اللاعبين</button></div>
      <div class="card"><label for="nm">الخيارات</label>
        <div class="addrow"><input id="nm" maxlength="200" placeholder="اكتب خيار واضغط إضافة" enterkeyhint="done"><button class="btn" id="add" type="button">إضافة</button></div>
        <div class="chips" id="chips"></div></div>
      <div class="wheelbox"><div class="pin">▼</div><canvas id="wh"></canvas></div>
      <button class="btn primary big" id="spin">🎡 لفّ الدولاب</button>
      <div class="card center pick" id="res" hidden></div>`;
    const cv = $('#wh'), ctx = cv.getContext('2d'), dpr = Math.max(1, window.devicePixelRatio || 1);
    const S0 = Math.min(340, app.clientWidth - 20);
    cv.width = cv.height = S0 * dpr; cv.style.width = cv.style.height = S0 + 'px';
    const draw = () => {
      const n = items.length, r = S0 / 2, seg = 2 * Math.PI / Math.max(1, n);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, S0, S0);
      if (!n) { ctx.fillStyle = '#241f36'; ctx.beginPath(); ctx.arc(r, r, r - 2, 0, 7); ctx.fill(); return; }
      items.forEach((t, i) => {
        const a = rot + i * seg;
        ctx.beginPath(); ctx.moveTo(r, r); ctx.arc(r, r, r - 2, a, a + seg); ctx.closePath();
        ctx.fillStyle = COLS[i % COLS.length]; ctx.fill();
        // الكتابة في النص اليسار تنقلب عشان ما تطلع مقلوبة
        const mid = a + seg / 2, m = ((mid % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), flip = m > Math.PI / 2 && m < 3 * Math.PI / 2;
        ctx.save(); ctx.translate(r, r); ctx.rotate(mid + (flip ? Math.PI : 0));
        ctx.fillStyle = '#fff'; ctx.font = `700 ${n > 8 ? 13 : 16}px Tajawal, sans-serif`; ctx.textAlign = flip ? 'left' : 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(t.length > 14 ? t.slice(0, 13) + '…' : t, flip ? -(r - 14) : r - 14, 0); ctx.restore();
      });
      ctx.beginPath(); ctx.arc(r, r, 18, 0, 7); ctx.fillStyle = '#0f0c1a'; ctx.fill();
    };
    const ctl = chipList($('#nm'), $('#add'), $('#chips'), items, { max: 16, len: 40, empty: 'أضف خيارين على الأقل', onChange: () => { store.kv('wheel', JSON.stringify(items)); draw(); } });
    $('#sets').onclick = e => {
      const b = e.target.closest('[data-s]'); if (!b) return;
      const src = b.dataset.s === 'p' ? loadPlayers() : WHEEL_SETS[+b.dataset.s][1];
      if (!src.length) return toast('ما فيه أسماء محفوظة، أضفها من أي لعبة', true);
      items.splice(0, items.length, ...src.slice(0, 16)); store.kv('wheel', JSON.stringify(items)); $('#nm').value = ''; ctl.add(); draw();
    };
    $('#spin').onclick = () => {
      if (spinning) return;
      if (items.length < 2) return toast('أضف خيارين على الأقل', true);
      spinning = true; $('#res').hidden = true;
      const n = items.length, seg = 2 * Math.PI / n, win = Math.floor(Math.random() * n);
      // نوقف بحيث يكون نص القطعة الفايزة تحت السهم (فوق)
      const target = -Math.PI / 2 - (win + 0.2 + Math.random() * 0.6) * seg;
      const from = rot, to = target - 2 * Math.PI * (5 + Math.ceil((from - target) / (2 * Math.PI))), t0 = performance.now(), T = 4200;
      const step = now => {
        const p = Math.min(1, (now - t0) / T), e = 1 - Math.pow(1 - p, 3);
        rot = from + (to - from) * e; draw();
        if (p < 1) return requestAnimationFrame(step);
        rot = to % (2 * Math.PI); spinning = false;
        const res = $('#res'); res.hidden = false; res.innerHTML = `<small>الدولاب اختار</small><div class="gname">${esc(items[win])}</div>`;
        res.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      };
      requestAnimationFrame(step);
    };
    draw();
  },

  /* ---------- تقسيم الحساب ---------- */
  bill(shared) {
    let B = null;
    try { B = JSON.parse(store.kv('bill')); } catch {}
    if (shared) {
      try {
        const x = JSON.parse(dec.decode(unb64u(shared)));
        if (x && Array.isArray(x.people) && Array.isArray(x.items) && (!B || !B.items.length || confirm('فتحت حساب من رابط. تبي تستبدل حسابك الحالي فيه؟'))) B = x;
      } catch { toast('رابط الحساب فيه مشكلة', true); }
      history.replaceState(null, '', '#play/bill');
    }
    if (!B || !Array.isArray(B.people) || !Array.isArray(B.items)) B = { cur: 'ريال', people: loadPlayers().slice(0, MAX_NAMES), items: [] };
    B.people = strArr(B.people, MAX_NAMES, NAME_LEN);
    B.items = B.items.filter(it => it && typeof it.d === 'string' && Number.isFinite(it.amt) && it.amt > 0 && B.people.includes(it.by) && Array.isArray(it.for))
      .map(it => ({ d: it.d.slice(0, 60), amt: it.amt, by: it.by, for: it.for.filter(n => B.people.includes(n)) })).filter(it => it.for.length);
    const save = () => store.kv('bill', JSON.stringify(B));
    save();
    app.innerHTML = `${offHead('bill')}
      <div class="card"><label for="nm">مين معكم؟</label>
        <div class="addrow"><input id="nm" maxlength="400" placeholder="اكتب اسم واضغط إضافة" enterkeyhint="done"><button class="btn" id="add" type="button">إضافة</button></div>
        <div class="chips" id="chips"></div>
        <label for="cur">العملة</label><input id="cur" maxlength="12" value="${esc(B.cur || 'ريال')}"></div>
      <section class="card"><h3>➕ أضف مصروف</h3>
        <input id="ed" maxlength="60" placeholder="وش هو؟ (مثلًا: عشاء)">
        <div class="addrow" style="margin-top:10px"><input id="ea" inputmode="decimal" placeholder="المبلغ"><select id="eb" class="sel"></select></div>
        <p class="hint">على مين؟ (اضغط عشان تشيل أحد)</p><div class="chips" id="ef"></div>
        <button class="btn primary big" id="eadd">إضافة المصروف</button></section>
      <div id="sum"></div>`;
    const forSel = new Set(B.people);
    const drawForm = () => {
      const keep = $('#eb').value;
      $('#eb').innerHTML = B.people.length ? B.people.map(n => `<option value="${esc(n)}">دفع: ${esc(n)}</option>`).join('') : '<option value="">أضف أسماء أول</option>';
      if (B.people.includes(keep)) $('#eb').value = keep;
      $('#ef').innerHTML = B.people.map(n => `<button class="chip${forSel.has(n) ? ' on' : ''}" data-n="${esc(n)}">${esc(n)}</button>`).join('');
    };
    const calc = () => {
      const bal = new Map(B.people.map(n => [n, { paid: 0, share: 0 }]));
      for (const it of B.items) {
        bal.get(it.by).paid += it.amt;
        for (const n of it.for) bal.get(n).share += it.amt / it.for.length;
      }
      const net = [...bal.entries()].map(([n, v]) => [n, v.paid - v.share]);
      const cred = net.filter(x => x[1] > 0.005).map(x => [...x]).sort((a, b) => b[1] - a[1]);
      const debt = net.filter(x => x[1] < -0.005).map(([n, v]) => [n, -v]).sort((a, b) => b[1] - a[1]);
      const tr = [];
      let i = 0, j = 0;
      while (i < debt.length && j < cred.length) {
        const m = Math.min(debt[i][1], cred[j][1]);
        tr.push([debt[i][0], cred[j][0], m]);
        debt[i][1] -= m; cred[j][1] -= m;
        if (debt[i][1] < 0.005) i++;
        if (cred[j][1] < 0.005) j++;
      }
      return { bal, tr, total: B.items.reduce((s, it) => s + it.amt, 0) };
    };
    const summaryText = (c) => `🧾 تقسيم الحساب\nالمجموع: ${money(c.total)} ${B.cur}\n\n${c.tr.length ? c.tr.map(([a, b, m]) => `• ${a} يحوّل لـ ${b}: ${money(m)} ${B.cur}`).join('\n') : 'كل واحد دفع اللي عليه ✅'}`;
    const drawSum = () => {
      const c = calc();
      $('#sum').innerHTML = !B.items.length ? '' : `
        <section class="card"><h3>📋 المصاريف</h3>${B.items.map((it, k) => `<div class="prow"><b>${esc(it.d || 'مصروف')}</b><span class="muted small">${esc(it.by)} · على ${it.for.length === B.people.length ? 'الكل' : it.for.map(esc).join('، ')}</span><span>${money(it.amt)}</span><button class="btn ghost sm" data-del="${k}">✕</button></div>`).join('')}
          <p style="margin-top:8px">المجموع: <b>${money(c.total)} ${esc(B.cur)}</b></p></section>
        <section class="card"><h3>💸 مين يحوّل لمين؟</h3>${c.tr.length ? c.tr.map(([a, b, m]) => `<div class="brow"><span>${esc(a)} ← يحوّل لـ ${esc(b)}</span><b>${money(m)} ${esc(B.cur)}</b></div>`).join('') : '<p>كل واحد دفع اللي عليه ✅</p>'}</section>
        <section class="card"><h3>👤 لكل واحد</h3>${[...c.bal.entries()].map(([n, v]) => `<div class="brow"><span>${esc(n)}</span><small class="muted">دفع ${money(v.paid)} · عليه ${money(v.share)}</small></div>`).join('')}</section>
        <div class="row multi"><a class="btn wa grow" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(summaryText(c))}">واتساب</a><button class="btn grow" id="lnk">🔗 رابط الحساب</button><button class="btn ghost grow" id="reset">🆕 حساب جديد</button></div>`;
      $$('[data-del]', $('#sum')).forEach(b => { b.onclick = () => { B.items.splice(+b.dataset.del, 1); save(); drawSum(); }; });
      const l = $('#lnk'); if (l) l.onclick = () => copyText(`${baseUrl()}#bill=${b64u(enc.encode(JSON.stringify(B)))}`);
      const r = $('#reset'); if (r) r.onclick = () => { if (confirm('تمسح كل المصاريف وتبدأ حساب جديد؟')) { B.items = []; save(); drawSum(); } };
    };
    chipList($('#nm'), $('#add'), $('#chips'), B.people, {
      max: MAX_NAMES, len: NAME_LEN, empty: 'أضف الأسماء أول',
      onChange: () => {
        const used = new Set(B.items.flatMap(it => [it.by, ...it.for]));
        for (const n of used) if (!B.people.includes(n)) { B.people.push(n); toast(`${n} عليه مصاريف، احذفها أول`, true); }
        B.people.forEach(n => forSel.add(n)); [...forSel].forEach(n => { if (!B.people.includes(n)) forSel.delete(n); });
        save(); drawForm(); drawSum();
        $('#chips').innerHTML = B.people.map((n, i) => `<button type="button" class="chip" data-i="${i}">${esc(n)} <span class="x">✕</span></button>`).join('') || '<p class="hint">أضف الأسماء أول</p>';
      }
    });
    $('#cur').onchange = e => { B.cur = e.target.value.trim().slice(0, 12) || 'ريال'; save(); drawSum(); };
    $('#ef').onclick = e => { const b = e.target.closest('[data-n]'); if (!b) return; const n = b.dataset.n; forSel.has(n) ? forSel.delete(n) : forSel.add(n); drawForm(); };
    $('#eadd').onclick = () => {
      const amt = parseFloat(toLatin($('#ea').value));
      if (!B.people.length) return toast('أضف الأسماء أول', true);
      if (!(amt > 0)) return toast('اكتب المبلغ', true);
      const fr = B.people.filter(n => forSel.has(n));
      if (!fr.length) return toast('اختر على مين المصروف', true);
      B.items.push({ d: $('#ed').value.trim().slice(0, 60), amt, by: $('#eb').value, for: fr });
      $('#ed').value = ''; $('#ea').value = ''; save(); drawSum(); toast('انضاف ✓');
    };
    drawForm(); drawSum();
  }
};
