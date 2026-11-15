'use strict';
(function () {
  const { api, h, toast, config, fillCountrySelect, date } = window.K;
  const $ = (id) => document.getElementById(id);
  const CATEGORY = { spam: 'مزعج', fraud: 'احتيال' };

  const showError = (el, msg) => {
    el.textContent = msg;
    el.hidden = !msg;
  };
  async function busy(button, label, fn) {
    const old = button.textContent;
    button.disabled = true;
    button.textContent = label;
    try {
      return await fn();
    } finally {
      button.disabled = false;
      button.textContent = old;
    }
  }

  // ---------- Start ----------
  fillCountrySelect($('loginCountry'), 'SA');
  load();

  async function load() {
    try {
      const c = await config();
      if (!c.loggedIn) return showLogin();
      const { user } = await api('/me');
      showProfile(user);
    } catch (err) {
      if (err.code !== 'login_required') toast(err.message, 'bad');
      showLogin();
    } finally {
      $('loading').hidden = true;
    }
  }

  // ---------- Login ----------
  let pending = null; // e164 of the number waiting for a code
  let resendTimer;

  function showLogin() {
    $('profileView').hidden = true;
    $('loginView').hidden = false;
    config().then((c) => fillCountrySelect($('loginCountry'), c.defaultCountry)).catch(() => {});
  }

  $('requestForm').addEventListener('submit', (e) => {
    e.preventDefault();
    sendCode();
  });

  async function sendCode() {
    showError($('requestError'), '');
    if (!$('loginPhone').value.trim()) return $('loginPhone').focus();
    if (!$('acceptTerms').checked) return showError($('requestError'), 'لازم توافق على شروط الاستخدام وسياسة الخصوصية');
    try {
      const res = await busy($('requestBtn'), 'جاري الإرسال…', () =>
        api('/auth/request-otp', { method: 'POST', body: { phone: $('loginPhone').value, country: $('loginCountry').value, acceptTerms: true } }),
      );
      pending = res.e164;
      $('sentTo').textContent = res.international;
      $('requestForm').hidden = true;
      $('verifyForm').hidden = false;
      $('devNote').hidden = !res.devCode;
      if (res.devCode) $('devNote').textContent = `وضع التطوير: الرمز هو ${res.devCode} (ويطلع كمان في طرفية السيرفر). في التشغيل الفعلي يوصل برسالة نصية.`;
      $('code').value = '';
      $('code').focus();
      startResendTimer();
    } catch (err) {
      showError($('requestError'), err.message);
    }
  }

  function startResendTimer() {
    let left = 60;
    const btn = $('resend');
    btn.disabled = true;
    clearInterval(resendTimer);
    const tick = () => {
      btn.textContent = left > 0 ? `أعد الإرسال (${left})` : 'أعد الإرسال';
      if (left-- <= 0) {
        btn.disabled = false;
        clearInterval(resendTimer);
      }
    };
    tick();
    resendTimer = setInterval(tick, 1000);
  }

  $('resend').addEventListener('click', async () => {
    $('verifyForm').hidden = true;
    $('requestForm').hidden = false;
    await sendCode();
  });

  $('changeNumber').addEventListener('click', () => {
    pending = null;
    clearInterval(resendTimer);
    $('verifyForm').hidden = true;
    $('requestForm').hidden = false;
    $('loginPhone').focus();
  });

  $('code').addEventListener('input', () => {
    const v = $('code').value.replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x0660).replace(/\D/g, '').slice(0, 6);
    $('code').value = v;
    if (v.length === 6) $('verifyForm').requestSubmit();
  });

  $('verifyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    showError($('verifyError'), '');
    try {
      await busy($('verifyBtn'), 'جاري التحقق…', () => api('/auth/verify-otp', { method: 'POST', body: { phone: pending, code: $('code').value } }));
      clearInterval(resendTimer);
      const { user } = await api('/me');
      toast('أهلاً فيك! دخلت بنجاح');
      showProfile(user);
    } catch (err) {
      showError($('verifyError'), err.message);
      if (err.code === 'expired' || err.code === 'too_many_attempts') $('resend').disabled = false;
    }
  });

  // ---------- Profile ----------
  function showProfile(user) {
    $('loginView').hidden = true;
    $('profileView').hidden = false;
    $('myPhone').textContent = user.international;
    $('memberSince').textContent = `مسجّل من ${date(user.createdAt)}`;
    $('hidden').checked = user.hidden;
    renderName(user);
    loadReports();
  }

  function renderName(user) {
    const has = !!user.displayName;
    $('displayName').value = user.displayName || '';
    $('nameConsent').checked = false;
    $('deleteNameRow').hidden = !has;
    $('saveName').textContent = has ? 'حدّث الاسم' : 'احفظ الاسم';
    $('nameState').textContent = !has
      ? 'الحين: ما أضفت اسم، فاللي يبحث عن رقمك ما يشوف أي اسم.'
      : user.hidden
        ? `اسمك المحفوظ «${user.displayName}»، لكنه مخفي من البحث حالياً.`
        : `الحين يظهر للي يبحث عن رقمك: «${user.displayName}» (وافقت بتاريخ ${date(user.nameConsentAt)}).`;
  }

  $('nameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    showError($('nameError'), '');
    if (!$('nameConsent').checked) return showError($('nameError'), 'لازم تحدد مربع الموافقة عشان نحفظ اسمك ونعرضه');
    try {
      const { user } = await busy($('saveName'), 'جاري الحفظ…', () =>
        api('/me/name', { method: 'PUT', body: { displayName: $('displayName').value, consent: true } }),
      );
      renderName(user);
      toast('حفظنا اسمك');
    } catch (err) {
      showError($('nameError'), err.message);
    }
  });

  $('deleteName').addEventListener('click', async () => {
    if (!window.confirm('نحذف اسمك ونسحب موافقتك؟ ما راح يظهر اسمك لأي أحد بعدها.')) return;
    try {
      const { user } = await api('/me/name', { method: 'DELETE' });
      renderName(user);
      toast('حذفنا اسمك');
    } catch (err) {
      toast(err.message, 'bad');
    }
  });

  $('hidden').addEventListener('change', async () => {
    const want = $('hidden').checked;
    try {
      const { user } = await api('/me/visibility', { method: 'PUT', body: { hidden: want } });
      renderName(user);
      toast(want ? 'اسمك الحين مخفي من البحث' : 'اسمك يظهر في البحث');
    } catch (err) {
      $('hidden').checked = !want;
      toast(err.message, 'bad');
    }
  });

  async function loadReports() {
    try {
      const { reports } = await api('/me/reports');
      $('reportsEmpty').hidden = reports.length > 0;
      $('reportsList').replaceChildren(
        ...reports.map((r) =>
          h('li', {},
            h('span', {}, h('b', { class: 'ltr' }, r.international), ' ', h('span', { class: 'badge warn' }, CATEGORY[r.category]),
              h('br'), h('span', { class: 'hint' }, date(r.createdAt))),
            h('button', { type: 'button', class: 'btn-ghost', onclick: () => withdraw(r.e164) }, 'اسحب'),
          ),
        ),
      );
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  async function withdraw(e164) {
    try {
      await api('/reports/withdraw', { method: 'POST', body: { phone: e164 } });
      toast('سحبنا بلاغك');
      loadReports();
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  $('logout').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    location.href = '/';
  });

  $('deleteAccount').addEventListener('click', async () => {
    const ok = window.confirm('متأكد؟ بنحذف حسابك واسمك وكل بلاغاتك نهائياً، وما نقدر نرجعها.');
    if (!ok) return;
    try {
      await api('/me', { method: 'DELETE', body: { confirm: true } });
      window.alert('حذفنا حسابك وكل بياناتك.');
      location.href = '/';
    } catch (err) {
      toast(err.message, 'bad');
    }
  });
})();
