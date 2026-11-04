import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { guardVerifiedAtGateway } from './local-read-access.mjs';

test('refuses to open tables when the gateway can still return planner statistics without Prefer', async (t) => {
  let disabled = false;
  const server = createServer((req, res) => {
    const count = req.headers.prefer === 'count=planned';
    const plan = req.headers.accept === 'application/vnd.pgrst.plan+json';
    const status = count ? 400 : plan && disabled ? 406 : 200;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify(
        count
          ? { code: 'PT400', message: 'UNSUPPORTED_READ_PREFERENCE' }
          : status === 406
            ? { code: 'PGRST107' }
            : [{ Plan: { 'Plan Rows': 4000 } }],
      ),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const config = { url: 'http://127.0.0.1:' + server.address().port, key: 'public-test' };
  assert.equal(await guardVerifiedAtGateway(config), false);
  disabled = true;
  assert.equal(await guardVerifiedAtGateway(config), true);
});
