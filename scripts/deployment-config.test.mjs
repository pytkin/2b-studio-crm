import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const config = existsSync('vercel.json') ? JSON.parse(readFileSync('vercel.json', 'utf8')) : {};

test('public direct URLs resolve to the SPA shell on Vercel', () => {
  for (const path of ['/login', '/objects', '/objects/12b4c816-4394-44a8-bd56-7d84e6d56ef9', '/tasks', '/tasks/12b4c816-4394-44a8-bd56-7d84e6d56ef9']) {
    const fallback = config.rewrites?.find(({ source }) => new RegExp(`^${source}$`).test(path));
    assert.equal(fallback?.destination, '/index.html', `${path} needs the SPA fallback`);
  }
});

test('hosted pages allow the Supabase API while rejecting remote scripts and framing', () => {
  const headers = new Map(
    (config.headers ?? []).filter(({ source }) => new RegExp(`^${source}$`).test('/tasks/example'))
      .flatMap(({ headers }) => headers.map(({ key, value }) => [key.toLowerCase(), value])),
  );
  const policy = new Map((headers.get('content-security-policy') ?? '').split(';')
    .map((directive) => directive.trim().split(/\s+/))
    .filter(([name]) => name).map(([name, ...sources]) => [name, sources]));
  assert.deepEqual(policy.get('script-src'), ["'self'"], 'scripts must stay on the application origin');
  assert.ok(policy.get('connect-src')?.some((source) => /^https:\/\/[^/]+\.supabase\.co$/.test(source)), 'Supabase HTTPS requests must be allowed');
  assert.deepEqual(policy.get('frame-ancestors'), ["'none'"]);
  assert.deepEqual(policy.get('object-src'), ["'none'"]);
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('referrer-policy'), 'no-referrer');
});
