'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze, cleanInput } = require('../src/phone');
const { cleanName } = require('../src/routes/me');

test('Saudi numbers in different formats become the same E.164', () => {
  for (const s of ['0501234567', '501234567', '+966501234567', '00966501234567', '966 50 123 4567', '٠٥٠١٢٣٤٥٦٧', '+966-50-123-4567']) {
    const n = analyze(s, 'SA');
    assert.equal(n.e164, '+966501234567', s);
    assert.equal(n.valid, true);
    assert.equal(n.type, 'MOBILE');
    assert.equal(n.country, 'SA');
    assert.equal(n.countryName, 'المملكة العربية السعودية');
    assert.equal(n.international, '+966 50 123 4567');
    assert.equal(n.canReceiveSms, true);
  }
});

test('landline, unified and foreign numbers', () => {
  assert.equal(analyze('0112345678', 'SA').type, 'FIXED_LINE');
  assert.equal(analyze('0112345678', 'SA').canReceiveSms, false);
  assert.equal(analyze('+971501234567', 'SA').country, 'AE');
  assert.equal(analyze('0501234567', 'AE').e164, '+971501234567');
});

test('invalid input', () => {
  assert.equal(analyze('', 'SA'), null);
  assert.equal(analyze('abc', 'SA'), null);
  assert.equal(analyze('12', 'SA'), null);
  const bad = analyze('0512', 'SA');
  assert.equal(bad.valid, false);
});

test('cleanInput handles Arabic digits, bidi marks and 00 prefix', () => {
  assert.equal(cleanInput('‏٠٥٥ ١٢٣ ٤٥٦٧'), '0551234567');
  assert.equal(cleanInput('00971501234567'), '+971501234567');
  assert.equal(cleanInput('+966 (50) 123-4567'), '+966501234567');
});

test('names: letters only, 2-40 chars', () => {
  assert.equal(cleanName('  محمد   العتيبي '), 'محمد العتيبي');
  assert.equal(cleanName('Sara O\'Neil'), "Sara O'Neil");
  assert.equal(cleanName('م'), null);
  assert.equal(cleanName('محمد 0501234567'), null);
  assert.equal(cleanName('http://spam'), null);
  assert.equal(cleanName('a'.repeat(41)), null);
});
