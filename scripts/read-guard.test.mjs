import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { guardVerifiedAtGateway } from './local-read-access.mjs';

test('accepts only the two documented PostgREST denials at the local tasks endpoint', async (t) => {
  const countDenied = [400, { code: 'PT400', message: 'UNSUPPORTED_READ_PREFERENCE' }];
  const planDisabled = [406, { code: 'PGRST107' }];
  const endpoint = '/rest/v1/tasks?select=id&limit=0';
  const key = 'public-test';
  let countReply = countDenied;
  let planReply = planDisabled;
  let redirects = 0;
  const server = createServer((req, res) => {
    const count = req.headers.prefer === 'count=planned';
    const plan = req.headers.accept === 'application/vnd.pgrst.plan+json' && !req.headers.prefer;
    if (req.url === '/redirected') redirects++;
    if (
      req.url !== endpoint ||
      req.method !== 'GET' ||
      req.headers.apikey !== key ||
      (!count && !plan)
    ) {
      res.writeHead(404).end();
      return;
    }
    const reply = count ? countReply : planReply;
    if (!reply) {
      req.socket.destroy();
      return;
    }
    const [status, body] = reply;
    res.writeHead(
      status,
      status === 307 ? { location: '/redirected' } : { 'content-type': 'application/json' },
    );
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const config = { url: 'http://127.0.0.1:' + server.address().port, key };
  assert.equal(await guardVerifiedAtGateway(config), true, 'both exact denials are sufficient');

  for (const [label, count, plan] of [
    ['count status', [403, countDenied[1]], planDisabled],
    ['count code', [400, { ...countDenied[1], code: '42501' }], planDisabled],
    ['count message', [400, { ...countDenied[1], message: 'invalid request' }], planDisabled],
    ['plan status', countDenied, [403, planDisabled[1]]],
    ['plan code', countDenied, [406, { code: 'PGRST116' }]],
    ['plan exposed', countDenied, [200, [{ Plan: { 'Plan Rows': 4000 } }]]],
    ['count malformed JSON', [400, '<html>error</html>'], planDisabled],
    ['plan malformed JSON', countDenied, [406, 'invalid JSON']],
    ['count network failure', null, planDisabled],
    ['plan network failure', countDenied, null],
    ['count redirect', [307, ''], planDisabled],
    ['plan redirect', countDenied, [307, '']],
  ]) {
    countReply = count;
    planReply = plan;
    assert.equal(await guardVerifiedAtGateway(config), false, label);
  }
  assert.equal(redirects, 0, 'the public key and the check must stay at the configured endpoint');
});
