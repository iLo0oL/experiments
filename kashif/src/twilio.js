'use strict';
/*
  Minimal Twilio REST client (no SDK). Used for:
  - Verify: send and check SMS login codes (OTP_PROVIDER=twilio_verify)
  - Lookup v2 Line Type Intelligence: carrier and line type (TWILIO_LOOKUP_ENABLED=true)
  Both are official, paid Twilio APIs. Nothing here scrapes other services.
*/

function createTwilio(cfg, fetchImpl = globalThis.fetch) {
  const { accountSid, authToken, verifyServiceSid } = cfg.twilio;
  const auth = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  async function call(method, url, form) {
    const res = await fetchImpl(url, {
      method,
      headers: {
        Authorization: auth,
        ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: form ? new URLSearchParams(form).toString() : undefined,
      signal: AbortSignal.timeout(8000),
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* ignore non-JSON bodies */
    }
    return { status: res.status, ok: res.ok, body };
  }

  return {
    async startVerification(phone) {
      const r = await call('POST', `https://verify.twilio.com/v2/Services/${verifyServiceSid}/Verifications`, { To: phone, Channel: 'sms', Locale: 'ar' });
      if (!r.ok) throw Object.assign(new Error('twilio_verify_failed'), { status: r.status, detail: r.body });
    },

    async checkVerification(phone, code) {
      const r = await call('POST', `https://verify.twilio.com/v2/Services/${verifyServiceSid}/VerificationCheck`, { To: phone, Code: code });
      // 404 = no pending verification (expired, used or too many attempts).
      if (r.status === 404) return false;
      if (!r.ok) throw Object.assign(new Error('twilio_verify_failed'), { status: r.status, detail: r.body });
      return r.body && r.body.status === 'approved';
    },

    async lookupLineType(phone) {
      const r = await call('GET', `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(phone)}?Fields=line_type_intelligence`);
      if (!r.ok) throw Object.assign(new Error('twilio_lookup_failed'), { status: r.status, detail: r.body });
      const lti = (r.body && r.body.line_type_intelligence) || {};
      return {
        carrierName: lti.carrier_name || null,
        lineType: lti.type || null,
        mcc: lti.mobile_country_code || null,
        mnc: lti.mobile_network_code || null,
      };
    },
  };
}

module.exports = { createTwilio };
