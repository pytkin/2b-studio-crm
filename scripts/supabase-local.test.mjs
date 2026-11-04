import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localConfig, runLocalSupabase as runProjectSupabase } from './supabase-local.mjs';

const runLocalSupabase = (args, options) => runProjectSupabase(args, {
  inspect: () => 'unix:///tmp/test.sock',
  ...options,
});

test('test reset targets only the test workdir and does not inherit a cloud target', () => {
  const calls = [];
  runLocalSupabase(['test', 'reset'], {
    run: (...args) => calls.push(args),
    env: { PATH: '/usr/bin', SUPABASE_WORKDIR: '/foreign', SUPABASE_ACCESS_TOKEN: 'secret-marker', SUPABASE_EXPERIMENTAL_STACK: '1' },
  });
  assert.equal(calls.length, 1, 'one local CLI invocation is required');
  const [, args, options] = calls[0];
  assert.deepEqual(args.slice(0, 2), ['db', 'reset']);
  assert.equal(args.includes('--remote'), false);
  assert.match(args[args.indexOf('--workdir') + 1], /\/local\/test$/);
  assert.equal(options.env.SUPABASE_ACCESS_TOKEN, undefined);
  assert.equal(options.env.SUPABASE_WORKDIR, undefined);
  assert.equal(options.env.SUPABASE_EXPERIMENTAL_STACK, '0');
});

test('development data cannot be reset through the project command', () => {
  let invoked = false;
  assert.throws(() => runLocalSupabase(['dev', 'reset'], {
    env: {},
    run: () => { invoked = true; },
  }), /Reset is only allowed for test/);
  assert.equal(invoked, false);
});

test('start uses the standard local Docker CLI without named stacks or remote flags', () => {
  for (const target of ['dev', 'test']) {
    let args;
    runLocalSupabase([target, 'start'], { run: (_cli, received) => { args = received; }, env: {} });
    assert.equal(args[0], 'start');
    for (const flag of ['--runtime', '--stack', '--remote']) assert.equal(args.includes(flag), false);
  }
});

test('arbitrary CLI flags or a foreign target never reach the process', () => {
  for (const args of [['cloud', 'start'], ['test', 'reset', '--remote'], ['test', 'destroy']]) {
    let called = false;
    assert.throws(() => runLocalSupabase(args, { run: () => { called = true; } }), /Usage/);
    assert.equal(called, false);
  }
});

test('start, stop and status work for both local environments and never print CLI credentials', () => {
  for (const target of ['dev', 'test']) {
    for (const action of ['start', 'stop', 'status']) {
      let invocation;
      const result = runLocalSupabase([target, action], {
        run: (...args) => { invocation = args; return 'secret-marker'; },
        env: { PATH: '/usr/bin' },
      });
      assert.equal(invocation[1][0], action);
      assert.equal(invocation[2].stdio, 'ignore', 'raw CLI output may contain local credentials');
      assert.equal(result, `Supabase ${target}: ${action} passed.`);
      assert.equal(result.includes('secret-marker'), false);
    }
  }
});

test('a failed CLI command stays failed without leaking its output', () => {
  assert.throws(() => runLocalSupabase(['test', 'start'], {
    run: () => { throw new Error('secret-marker'); },
    env: {},
  }), error => {
    assert.match(error.message, /Supabase test: start failed/);
    assert.equal(error.message.includes('secret-marker'), false);
    return true;
  });
});

test("a remote Docker endpoint cannot receive the local test reset", () => {
  for (const [env, endpoint] of [
    [{ DOCKER_HOST: "tcp://remote.invalid:2375" }, ""],
    [{ DOCKER_CONTEXT: "remote-context" }, "ssh://example.invalid"],
    [{}, "tcp://remote.invalid:2375"],
  ]) {
    let invoked = false;
    assert.throws(() => runLocalSupabase(["test", "reset"], {
      env, inspect: () => endpoint, run: () => { invoked = true; },
    }), /local Docker/i);
    assert.equal(invoked, false);
  }
  let env;
  runLocalSupabase(["test", "reset"], {
    env: { DOCKER_CONTEXT: "desktop-linux" },
    inspect: () => "unix:///tmp/local-docker.sock\n",
    run: (_command, _args, options) => { env = options.env; },
  });
  assert.equal(env.DOCKER_CONTEXT, undefined);
  assert.equal(env.DOCKER_HOST, "unix:///tmp/local-docker.sock");
});

test('local config accepts only credentials for the requested local API and database', () => {
  for (const [target, port] of [['dev', 56321], ['test', 56421]]) {
    const url = 'http://127.0.0.1:' + port;
    const db = 'postgresql://postgres:private-marker@127.0.0.1:' + (port + 1) + '/postgres';
    const values = {
      API_URL: url,
      DB_URL: db,
      PUBLISHABLE_KEY: 'public-marker',
      SECRET_KEY: 'admin-marker',
    };
    const read = (overrides) => () =>
      Object.entries({ ...values, ...overrides })
        .map(([key, value]) => key + '="' + value + '"')
        .join('\n');
    assert.deepEqual(localConfig(target, read({})), {
      url, db, key: values.PUBLISHABLE_KEY, adminKey: values.SECRET_KEY,
    });
    for (const [label, overrides] of [
      ['foreign API', { API_URL: 'https://example.invalid' }],
      ['database protocol', { DB_URL: db.replace('postgresql:', 'https:') }],
      ['database host', { DB_URL: db.replace('127.0.0.1', 'example.invalid') }],
      ['other local stack', { DB_URL: db.replace(String(port + 1), '5432') }],
      ['other database', { DB_URL: db + '_other' }],
      ['connection overrides', { DB_URL: db + '?host=example.invalid' }],
      ['database fragment', { DB_URL: db + '#unexpected' }],
      ['empty public key', { PUBLISHABLE_KEY: '' }],
      ['empty administrator key', { SECRET_KEY: '' }],
    ]) {
      assert.throws(() => localConfig(target, read(overrides)), {
        message: 'Не удалось прочитать параметры локального Supabase (' + target + ').',
      }, label);
    }
  }
});
