import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { usernameProblem, passwordProblem, RESERVED_USERNAMES } from '../src/auth/rules.js';
import { ipKey } from '../src/http/ipKey.js';

test('usernames: 3 to 32 letters, digits or underscores; persona names reserved', () => {
  assert.equal(usernameProblem('alice_1'), null);
  for (const bad of ['ab', 'a'.repeat(33), 'alice smith', 'alice@example.com', 'ålice', '', null]) assert.match(usernameProblem(bad), /3 to 32 letters, numbers or underscores/, String(bad));
  for (const r of ['priya', 'jordan', 'sam', 'marcus', 'dana', 'admin']) { assert.ok(RESERVED_USERNAMES.has(r)); assert.match(usernameProblem(r), /reserved/); }
});

test('passwords: at least 12 characters, at most 200, not on the common list', () => {
  assert.equal(passwordProblem('correct horse battery'), null);
  assert.match(passwordProblem('short'), /at least 12/);
  assert.match(passwordProblem('x'.repeat(201)), /at most 200/);
  const common = readFileSync(new URL('../src/auth/common-passwords.txt', import.meta.url), 'utf8').split(/\r?\n/).find(p => p.trim().length >= 12);
  assert.ok(common, 'the list has an entry of 12+ characters');
  assert.match(passwordProblem(common), /too common/);
  assert.match(passwordProblem(common.toUpperCase()), /too common/);
});

test('ipKey: IPv4 as is, mapped IPv4 unwrapped, IPv6 by /64', () => {
  assert.equal(ipKey('203.0.113.9'), '203.0.113.9');
  assert.equal(ipKey('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(ipKey('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64');
  assert.equal(ipKey('2001:db8:1:2::9'), '2001:db8:1:2::/64');
  assert.equal(ipKey('2001:DB8:0001:0002:ffff::1'), '2001:db8:1:2::/64');
  assert.equal(ipKey('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(ipKey('fe80::1%eth0'), 'fe80:0:0:0::/64');
  assert.equal(ipKey('::1'), '0:0:0:0::/64');
  assert.equal(ipKey('2001:db8:1:2::9'), ipKey('2001:db8:1:2:aaaa::1'));
  assert.notEqual(ipKey('2001:db8:1:2::9'), ipKey('2001:db8:1:3::9'));
});
