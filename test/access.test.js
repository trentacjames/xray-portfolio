const test = require('node:test');
const assert = require('node:assert');
const { checkAccess, _resetForTests } = require('../src/extract/access');

const req = (code, ip = '1.1.1.1') => ({ headers: { 'x-access-code': code, 'x-forwarded-for': ip }, socket: {} });

test('disabled when no code is configured', () => {
  assert.equal(checkAccess(req('x'), { code: '' }).status, 503);
});

test('accepts the right code and rejects a wrong one', () => {
  _resetForTests();
  assert.equal(checkAccess(req('secret'), { code: 'secret' }), null);
  assert.equal(checkAccess(req('nope'), { code: 'secret' }).status, 401);
});

test('locks out after 5 wrong codes, then unlocks', () => {
  _resetForTests();
  const now = 1_000_000;
  for (let i = 0; i < 5; i++) checkAccess(req('nope', '2.2.2.2'), { code: 'secret', now });
  assert.equal(checkAccess(req('secret', '2.2.2.2'), { code: 'secret', now }).status, 429);
  assert.equal(checkAccess(req('secret', '2.2.2.2'), { code: 'secret', now: now + 16 * 60 * 1000 }), null);
});
