'use strict';

const MESSAGES = {
  invalid_number: 'ما قدرنا نقرأ الرقم. اكتبه مثل 0501234567 أو بالصيغة الدولية +966501234567',
  invalid_mobile: 'اكتب رقم جوال صحيح يستقبل رسائل SMS',
  terms_required: 'لازم توافق على شروط الاستخدام وسياسة الخصوصية',
  rate_limited: 'محاولات كثيرة. انتظر شوي وجرّب مرة ثانية',
  search_daily_limit: 'خلصت عمليات البحث المسموحة لك اليوم. تقدر تبحث مرة ثانية بكرة',
  anon_daily_limit: 'خلصت عمليات البحث المسموحة بدون حساب اليوم. سجّل دخولك برقمك عشان تكمل',
  login_required: 'سجّل دخولك برقمك أول',
  invalid_code: 'اكتب الرمز المكوّن من 6 أرقام',
  wrong_code: 'الرمز غير صحيح',
  expired: 'الرمز انتهت صلاحيته. اطلب رمز جديد',
  too_many_attempts: 'محاولات خاطئة كثيرة. اطلب رمز جديد',
  sms_failed: 'ما قدرنا نرسل الرسالة الحين. حاول بعد شوي',
  invalid_name: 'الاسم لازم يكون من حرفين إلى 40 حرف، حروف فقط بدون أرقام أو روابط',
  consent_required: 'لازم توافق صراحةً على ظهور اسمك قبل ما نحفظه',
  invalid_value: 'قيمة غير صحيحة',
  cannot_report_self: 'ما تقدر تبلّغ عن رقمك',
  invalid_category: 'نوع البلاغ غير صحيح',
  confirm_required: 'لازم تأكّد الحذف',
  forbidden_origin: 'طلب مرفوض',
  not_found: 'الصفحة غير موجودة',
  bad_request: 'طلب غير صحيح',
  server_error: 'صار خطأ عندنا. حاول مرة ثانية',
};

function fail(res, status, code, extra = {}) {
  return res.status(status).json({ error: code, message: MESSAGES[code] || MESSAGES.server_error, ...extra });
}

/**
 * Apply rate-limit rules. Sends 429 and returns false when a rule is exceeded.
 * rule: { bucket, windowSec, max, code? }
 */
function enforce(limiter, res, rules) {
  const failed = limiter.consumeAll(rules);
  if (!failed) return true;
  res.set('Retry-After', String(failed.retryAfterSec));
  fail(res, 429, failed.rule.code || 'rate_limited', { retryAfterSec: failed.retryAfterSec });
  return false;
}

module.exports = { MESSAGES, fail, enforce };
