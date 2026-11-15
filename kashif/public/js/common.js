'use strict';
/* Shared helpers for all pages. No inline scripts: the CSP only allows files from this site. */
(function () {
  // Calling codes for the country picker. The server does the real parsing with libphonenumber.
  const COUNTRIES = [
    ['SA', '966'], ['AE', '971'], ['KW', '965'], ['QA', '974'], ['BH', '973'], ['OM', '968'],
    ['YE', '967'], ['IQ', '964'], ['JO', '962'], ['SY', '963'], ['LB', '961'], ['PS', '970'],
    ['EG', '20'], ['SD', '249'], ['LY', '218'], ['TN', '216'], ['DZ', '213'], ['MA', '212'],
    ['TR', '90'], ['PK', '92'], ['IN', '91'], ['BD', '880'], ['PH', '63'], ['ID', '62'],
    ['GB', '44'], ['US', '1'],
  ];
  const regionNames = new Intl.DisplayNames(['ar'], { type: 'region' });
  const flag = (cc) => String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

  function fillCountrySelect(select, selected) {
    select.textContent = '';
    for (const [cc, code] of COUNTRIES) {
      const opt = document.createElement('option');
      opt.value = cc;
      opt.textContent = `${flag(cc)} +${code}`;
      opt.title = regionNames.of(cc);
      if (cc === selected) opt.selected = true;
      select.append(opt);
    }
  }

  // Build DOM safely (text is never parsed as HTML).
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  async function api(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch('/api' + path, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw Object.assign(new Error('ما فيه اتصال بالسيرفر. تأكد من الإنترنت وحاول مرة ثانية'), { code: 'network' });
    }
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* empty body */
    }
    if (!res.ok) {
      let msg = data.message || 'صار خطأ. حاول مرة ثانية';
      if (data.retryAfterSec && data.error === 'rate_limited') msg += ` (بعد ${waitText(data.retryAfterSec)})`;
      throw Object.assign(new Error(msg), { code: data.error, status: res.status, data });
    }
    return data;
  }

  function waitText(sec) {
    if (sec < 60) return `${sec} ثانية`;
    const m = Math.ceil(sec / 60);
    if (m < 60) return m === 1 ? 'دقيقة' : m === 2 ? 'دقيقتين' : `${m} دقيقة`;
    const hr = Math.ceil(m / 60);
    return hr === 1 ? 'ساعة' : hr === 2 ? 'ساعتين' : `${hr} ساعات`;
  }

  let toastTimer;
  function toast(msg, kind) {
    document.querySelector('.toast')?.remove();
    const t = h('div', { class: 'toast' + (kind === 'bad' ? ' bad' : ''), role: 'status' }, msg);
    document.body.append(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 3500);
  }

  // Arabic number agreement: count(3, ['بلاغ واحد', 'بلاغين', 'بلاغات', 'بلاغ']) -> "3 بلاغات"
  function count(n, [one, two, few, many]) {
    if (n === 1) return one;
    if (n === 2) return two;
    if (n >= 3 && n <= 10) return `${n} ${few}`;
    return `${n} ${many}`;
  }
  const REPORTS = ['بلاغ واحد', 'بلاغين', 'بلاغات', 'بلاغ'];
  const USERS = ['مستخدم واحد', 'مستخدمَين', 'مستخدمين', 'مستخدم'];
  const SEARCHES = ['عملية بحث واحدة', 'عمليتين بحث', 'عمليات بحث', 'عملية بحث'];

  const date = (ms) => new Date(ms).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' });

  let configPromise;
  const config = () => (configPromise ||= api('/config'));

  // Header link: "دخول" or "حسابي".
  document.addEventListener('DOMContentLoaded', () => {
    const link = document.getElementById('accountLink');
    if (link) config().then((c) => { link.textContent = c.loggedIn ? 'حسابي' : 'دخول'; }).catch(() => {});
  });

  window.K = { api, h, toast, config, fillCountrySelect, flag, regionNames, waitText, date, count, REPORTS, USERS, SEARCHES };
})();
