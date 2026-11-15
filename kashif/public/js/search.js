'use strict';
(function () {
  const { api, h, toast, config, fillCountrySelect, flag, count, REPORTS, USERS, SEARCHES } = window.K;

  const form = document.getElementById('searchForm');
  const phone = document.getElementById('phone');
  const country = document.getElementById('country');
  const btn = document.getElementById('searchBtn');
  const errorEl = document.getElementById('searchError');
  const quotaEl = document.getElementById('quota');
  const resultEl = document.getElementById('result');

  const ICONS = { whatsapp: '💬', telegram: '✈️', truecaller: '📇', google: '🔎', call: '📞' };
  const CATEGORY = { spam: 'مزعج', fraud: 'احتيال' };

  let cfg = { defaultCountry: 'SA', loggedIn: false };
  let last = null; // { phone, country, data }

  fillCountrySelect(country, 'SA');
  config()
    .then((c) => {
      cfg = c;
      fillCountrySelect(country, c.defaultCountry);
      quotaEl.textContent = c.loggedIn
        ? `تقدر تسوي ${count(c.limits.searchesPerDay, SEARCHES)} باليوم.`
        : `بدون حساب: ${count(c.limits.anonSearchesPerDay, SEARCHES)} باليوم، ونعرض تحليل الرقم فقط. سجّل دخولك عشان تشوف الاسم والبلاغات.`;
    })
    .catch(() => {});

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const value = phone.value.trim();
    if (!value) {
      phone.focus();
      return;
    }
    btn.disabled = true;
    btn.textContent = 'جاري البحث…';
    try {
      const data = await api('/search', { method: 'POST', body: { phone: value, country: country.value } });
      last = { phone: data.number.e164, country: country.value, data };
      render(data);
      if (data.quota) quotaEl.textContent = data.quota.remainingToday ? `باقي لك اليوم ${count(data.quota.remainingToday, SEARCHES)}.` : 'خلصت عمليات البحث المسموحة لك اليوم.';
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      resultEl.textContent = '';
    } finally {
      btn.disabled = false;
      btn.textContent = 'بحث';
    }
  });

  function render(d) {
    const n = d.number;
    const card = h('section', { class: 'card result' },
      h('div', { class: 'num-head' },
        h('h2', {}, n.international),
        n.valid ? h('span', { class: 'badge ok' }, '✓ رقم صالح') : h('span', { class: 'badge bad' }, '✕ رقم غير صالح'),
      ),
      h('dl', { class: 'facts' },
        fact('الدولة', n.country ? `${flag(n.country)} ${n.countryName}` : 'غير معروفة'),
        fact('رمز الدولة', h('span', { class: 'ltr' }, '+' + n.callingCode)),
        fact('الصيغة المحلية', h('span', { class: 'ltr' }, n.national)),
        fact('الصيغة الدولية', h('span', { class: 'ltr' }, n.e164)),
        fact('نوع الرقم', n.typeLabel || 'غير محدد'),
      ),
      !n.valid && h('p', { class: 'hint' }, n.possible
        ? 'طول الرقم مقبول، لكن ما يطابق أي نطاق أرقام مستخدم في هذي الدولة. تأكد من الرقم.'
        : 'طول الرقم غير صحيح لهذي الدولة. تأكد من الرقم أو اختر الدولة الصحيحة.'),
      carrierSection(d.carrier),
      n.valid && communitySection(d),
      linksSection(d),
    );
    resultEl.replaceChildren(card);
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function fact(label, value) {
    return [h('dt', {}, label), h('dd', {}, value)];
  }

  function carrierSection(c) {
    if (!c) return null;
    if (c.error) return h('div', { class: 'section' }, h('h3', {}, '📶 شركة الاتصالات'), h('p', { class: 'muted' }, 'ما قدرنا نجيب معلومات شركة الاتصالات الحين.'));
    return h('div', { class: 'section' },
      h('h3', {}, '📶 شركة الاتصالات'),
      h('dl', { class: 'facts' },
        fact('الشركة', c.carrierName || 'غير معروفة'),
        fact('نوع الخط', c.lineTypeLabel || 'غير معروف'),
      ),
      h('p', { class: 'hint' }, `المصدر: ${c.source}. إذا الرقم منقول لشركة ثانية تظهر الشركة الحالية غالباً.`),
    );
  }

  function communitySection(d) {
    if (!d.loggedIn) {
      return h('div', { class: 'section' },
        h('div', { class: 'box' },
          h('p', {}, 'الاسم المسجّل وبلاغات المستخدمين تظهر للمستخدمين اللي تحققوا من أرقامهم فقط، عشان نحمي بيانات الناس من الجمع الآلي.'),
          h('a', { class: 'btn btn-soft', href: '/account' }, 'سجّل دخولك برقمك'),
        ),
      );
    }
    const c = d.community;
    const frag = [];

    // Name added by the owner
    frag.push(h('div', { class: 'section' },
      h('h3', {}, '👤 الاسم المسجّل'),
      c.name
        ? [h('p', { class: 'name' }, c.name), h('span', { class: 'badge ok' }, '✓ أضافه صاحب الرقم بنفسه وتحقق من رقمه')]
        : h('p', { class: 'muted' }, 'صاحب الرقم ما أضاف اسمه في كاشف.'),
      c.isMe && h('p', { class: 'hint' }, 'هذا رقمك، وهذا اللي يشوفه غيرك. ', h('a', { href: '/account' }, 'عدّل اسمك أو أخفِ رقمك')),
    ));

    // Reports
    const r = c.reports;
    const kind = r ? (r.fraud > 0 ? 'bad' : 'warn') : '';
    frag.push(h('div', { class: 'section' },
      h('h3', {}, '🚩 بلاغات المستخدمين'),
      r
        ? h('div', { class: 'box ' + kind },
            h('p', {}, `بلّغ عنه ${count(r.total, USERS)}:`),
            h('div', { class: 'counts' },
              h('div', { class: 'count' }, h('b', {}, r.spam), 'مزعج'),
              h('div', { class: 'count' }, h('b', {}, r.fraud), 'احتيال'),
            ),
          )
        : h('p', { class: 'muted' }, 'ما فيه بلاغات كافية عن هذا الرقم.'),
      h('p', { class: 'hint' }, `البلاغات آراء مستخدمين ولا نتحقق منها، وما نعرض أسماء المبلّغين. تظهر الأعداد إذا وصلت ${count(c.reportsMinToShow, REPORTS)} أو أكثر.`),
      !c.isMe && reportActions(c),
    ));
    return frag;
  }

  function reportActions(c) {
    if (c.myReport) {
      return h('div', { class: 'row' },
        h('span', { class: 'badge warn' }, `بلّغت عنه: ${CATEGORY[c.myReport]}`),
        h('button', { type: 'button', class: 'btn-ghost', onclick: withdraw }, 'اسحب بلاغي'),
      );
    }
    return h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn-soft', onclick: () => report('spam') }, '🔕 بلّغ: مزعج'),
      h('button', { type: 'button', class: 'btn-soft', onclick: () => report('fraud') }, '⚠️ بلّغ: احتيال'),
    );
  }

  async function report(category) {
    if (!last) return;
    const ok = window.confirm(`تبي تبلّغ عن الرقم ${last.data.number.international} إنه «${CATEGORY[category]}»؟\n\nبلّغ فقط إذا وصلك منه شي فعلاً. البلاغات الكاذبة مخالفة لشروط الاستخدام.`);
    if (!ok) return;
    try {
      const res = await api('/reports', { method: 'POST', body: { phone: last.phone, category } });
      last.data.community = res.community;
      render(last.data);
      toast(res.community.reports ? 'تم البلاغ. شكراً لك' : `تم البلاغ. العدد يظهر للناس لما يوصل ${count(res.community.reportsMinToShow, REPORTS)}`);
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  async function withdraw() {
    if (!last) return;
    try {
      const res = await api('/reports/withdraw', { method: 'POST', body: { phone: last.phone } });
      last.data.community = res.community;
      render(last.data);
      toast('سحبنا بلاغك');
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  function linksSection(d) {
    if (!d.links.length) return null;
    return h('div', { class: 'section' },
      h('h3', {}, '🔗 ابحث بنفسك في تطبيقات أخرى'),
      h('p', { class: 'hint' }, 'الأزرار تفتح التطبيق أو الموقع والرقم جاهز، والبحث تسويه أنت بنفسك حسب شروط كل خدمة. كاشف ما يجمع أي بيانات منها.'),
      h('div', { class: 'links' },
        d.links.map((l) =>
          h('a', { class: 'btn', href: l.url, target: l.id === 'call' ? null : '_blank', rel: 'noopener noreferrer' },
            h('span', { 'aria-hidden': 'true' }, ICONS[l.id] || '↗'), l.label),
        ),
        h('button', { type: 'button', class: 'btn', onclick: () => copy(d.number.e164) }, h('span', { 'aria-hidden': 'true' }, '📋'), 'نسخ الرقم'),
      ),
    );
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('نسخنا الرقم');
    } catch {
      toast(text);
    }
  }
})();
