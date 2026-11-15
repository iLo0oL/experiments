'use strict';
// "max" metadata is needed for accurate number types (mobile, landline, toll free...).
const { parsePhoneNumberFromString, isSupportedCountry } = require('libphonenumber-js/max');

const regionNames = new Intl.DisplayNames(['ar'], { type: 'region' });

const TYPE_LABELS = {
  MOBILE: 'جوال',
  FIXED_LINE: 'هاتف ثابت',
  FIXED_LINE_OR_MOBILE: 'ثابت أو جوال',
  TOLL_FREE: 'رقم مجاني',
  PREMIUM_RATE: 'رقم بتعرفة مرتفعة',
  SHARED_COST: 'رقم موحّد بتكلفة مشتركة',
  VOIP: 'اتصال عبر الإنترنت (VoIP)',
  PERSONAL_NUMBER: 'رقم شخصي',
  PAGER: 'جهاز نداء (Pager)',
  UAN: 'رقم موحّد',
  VOICEMAIL: 'بريد صوتي',
};

// Turn Arabic-Indic / Persian digits into ASCII and drop everything except digits and a leading +.
function cleanInput(raw) {
  let s = String(raw ?? '').slice(0, 40);
  s = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  s = s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  s = s.replace(/[‎‏‪-‮⁦-⁩]/g, ''); // bidi marks from copy/paste
  const plus = /^\s*\+/.test(s);
  s = s.replace(/\D/g, '');
  if (!plus && s.startsWith('00')) return '+' + s.slice(2);
  return (plus ? '+' : '') + s;
}

function countryName(code) {
  if (!code) return null;
  try {
    return regionNames.of(code);
  } catch {
    return code;
  }
}

function normalizeCountry(country, fallback) {
  const c = String(country || '').toUpperCase();
  return isSupportedCountry(c) ? c : fallback;
}

/**
 * Parse and describe a phone number.
 * Returns null when the input cannot be read as a phone number at all.
 */
function analyze(raw, defaultCountry = 'SA') {
  const input = cleanInput(raw);
  const digits = input.replace(/\D/g, '');
  if (digits.length < 4 || digits.length > 17) return null;

  const pn = parsePhoneNumberFromString(input, defaultCountry);
  if (!pn) return null;

  const valid = pn.isValid();
  const type = valid ? pn.getType() || null : null;
  return {
    e164: pn.number,
    international: pn.formatInternational(),
    national: pn.formatNational(),
    nationalNumber: pn.nationalNumber,
    callingCode: pn.countryCallingCode,
    country: pn.country || null,
    countryName: countryName(pn.country),
    valid,
    possible: pn.isPossible(),
    type,
    typeLabel: type ? TYPE_LABELS[type] || type : null,
    canReceiveSms: valid && (type === 'MOBILE' || type === 'FIXED_LINE_OR_MOBILE'),
  };
}

module.exports = { analyze, cleanInput, countryName, normalizeCountry, TYPE_LABELS };
