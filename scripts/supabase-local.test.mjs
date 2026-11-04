import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localConfig, openLocalStack, prepareLocalStack, runLocalSupabase as runProjectSupabase } from './supabase-local.mjs';

const safeContainers = (target) => ['kong', 'db'].map((service, i) => {
  const binding = { HostIp: '127.0.0.1', HostPort: String((target === 'test' ? 56421 : 56321) + i) };
  const ports = { [(i ? '5432' : '8000') + '/tcp']: [binding] };
  return { name: '/supabase_' + service + '_2b-studio-crm-' + target, running: true,
    mode: 'supabase_network_2b-studio-crm-' + target, publishAll: false, requested: ports, actual: ports };
});

function dockerFixture(rows, version = '29.9.2') {
  return (args) => {
    if (args[0] === '--crm-loopback-preflight') return version;
    if (args[0] === 'ps') return rows.map((_, i) => 'id' + i).join('\n');
    if (args[0] === 'inspect') return rows.map((row) => JSON.stringify(row)).join('\n');
    throw Error('unexpected Docker invocation');
  };
}

const runLocalSupabase = (args, options) => runProjectSupabase(args, {
  docker: dockerFixture(safeContainers(args[0])),
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

test('start pins the Docker publish adapter before invoking the local CLI', () => {
  let cliEnv;
  runLocalSupabase(['test', 'start'], {
    env: { PATH: '/bin' },
    run: (_cli, _args, options) => { cliEnv = options.env; },
  });
  assert.match(cliEnv.PATH, /scripts\/loopback-docker:/);
});

test('start refuses old engines and unsafe saved or active bindings before the CLI', () => {
  for (const problem of ['old engine', 'saved wildcard', 'actual IPv6 wildcard', 'empty saved IP', 'host networking']) {
    const rows = safeContainers('test');
    rows[0] = structuredClone(rows[0]);
    if (problem === 'saved wildcard' || problem === 'empty saved IP') {
      rows[0].running = false;
      rows[0].requested = { '8000/tcp': [{ HostIp: problem === 'saved wildcard' ? '0.0.0.0' : '', HostPort: '56421' }] };
    }
    if (problem === 'actual IPv6 wildcard')
      rows[0].actual = { '8000/tcp': [...rows[0].actual['8000/tcp'], { HostIp: '::', HostPort: '56421' }] };
    if (problem === 'host networking') rows[0].mode = 'host';
    let called = false;
    assert.throws(() => runLocalSupabase(['test', 'start'], {
      docker: dockerFixture(rows, problem === 'old engine' ? '27.5.1' : '29.9.2'),
      run: () => { called = true; },
    }), /loopback/i, problem);
    assert.equal(called, false, problem);
  }
});

test('successful CLI start still fails without both loopback endpoints in Docker readback', () => {
  for (const problem of ['missing SQL', 'extra IPv6 wildcard']) {
    let rows = [];
    assert.throws(() => runLocalSupabase(['test', 'start'], {
      docker: (args) => dockerFixture(rows)(args),
      run: () => {
        rows = safeContainers('test');
        if (problem === 'missing SQL') rows.pop();
        else rows[1].actual['5432/tcp'].push({ HostIp: '::', HostPort: '56422' });
      },
    }), /loopback/i, problem);
  }
});

test('Docker receives explicit loopback publishes and cannot start an unsafe saved container', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crm-isolation-'));
  try {
    const received = join(dir, 'called');
    writeFileSync(join(dir, 'docker'), '#!/bin/sh\nif [ "$1" = inspect ]; then printf "%s" "$SAVED"; else printf "%s\\n" "$@" > "$LOG"; fi\n', {mode: 0o700});
    const exec = (args, saved = '') => spawnSync(fileURLToPath(new URL('./loopback-docker/docker', import.meta.url)), args, {
      env: { CRM_DOCKER_PATH: dir, CRM_DOCKER_NETWORK: 'crm', LOG: received, SAVED: saved }, encoding: 'utf8',
    });
    const result = exec(['create', '--network', 'crm', '-p', '56422:5432', 'postgres', '-p', '5432']);
    assert.equal(result.status, 0);
    assert.match(readFileSync(received, 'utf8'), /-p\n127\.0\.0\.1:56422:5432\npostgres\n-p\n5432/);
    for (const args of [['run', '-P', 'postgres'], ['create', '-p', '0.0.0.0:123:123', 'image'], ['run', '--network', 'host', 'image'],
      ['container', 'run', '-P', 'image'], ['compose', 'up'], ['--context', 'remote', 'run', '-P', 'image']])
      assert.notEqual(exec(args).status, 0);
    assert.notEqual(exec(['start', 'saved'], 'unsafe').status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('postflight failure stops the new stack but preserves a stack that was already running', async () => {
  for (const alreadyRunning of [false, true]) {
    let rows = alreadyRunning ? safeContainers('test') : [];
    const actions = [];
    const stack = openLocalStack('test', {
      env: { DOCKER_HOST: 'unix:///tmp/test.sock' },
      docker: (args) => dockerFixture(rows)(args),
      run: (_cli, args) => {
        actions.push(args[0]);
        if (args[0] === 'start') {
          rows = safeContainers('test');
          rows[0].actual['8000/tcp'].push({ HostIp: '::', HostPort: '56421' });
        } else if (args[0] === 'stop') rows = [];
      },
    });
    await assert.rejects(() => prepareLocalStack('test', 'start', stack), /loopback/i);
    assert.deepEqual(actions, alreadyRunning ? ['start'] : ['start', 'stop']);
  }
});

test('changing Docker context cannot redirect later migration, status, or rollback within a lifecycle', async () => {
  const hosts = [];
  let selected = 'unix:///tmp/first.sock';
  let reads = 0;
  const safe = dockerFixture(safeContainers('test'));
  const stack = openLocalStack('test', {
    env: { DOCKER_CONTEXT: 'selected', PATH: '/bin' },
    inspect: () => { reads++; return selected; },
    docker: (args, env) => { hosts.push(env.DOCKER_HOST); return safe(args); },
    run: (_file, args, options) => {
      hosts.push(options.env.DOCKER_HOST);
      if (args[0] === 'status') return [
        'API_URL="http://127.0.0.1:56421"', 'DB_URL="postgres://postgres@127.0.0.1:56422/postgres"',
        'PUBLISHABLE_KEY="synthetic"', 'SECRET_KEY="synthetic"'].join('\n');
    },
  });
  assert.equal(stack.isRunning(), true);
  stack.run('start');
  selected = 'unix:///tmp/other.sock';
  stack.migrate();
  assert.equal(stack.config().url, 'http://127.0.0.1:56421');
  stack.run('stop');
  assert.equal(reads, 1);
  assert.deepEqual([...new Set(hosts)], ['unix:///tmp/first.sock']);
});

test('direct preparation cleans up once on CLI, migration or activation failure according to prior ownership', async () => {
  for (const action of ['start', 'reset']) {
    for (const failure of ['cli', ...(action === 'start' ? ['migrate'] : []), 'activate']) {
      for (const existing of [false, true]) {
        let running = existing;
        const actions = [];
        const fail = (at) => { if (at === failure) throw Error('Injected failure'); };
        const stack = {
          isRunning: () => running,
          run: (command) => {
            actions.push(command);
            running = command !== 'stop';
            if (running) fail('cli');
          },
          migrate: () => fail('migrate'),
          config: () => ({}),
        };
        await assert.rejects(() => prepareLocalStack('test', action, stack, () => fail('activate')), /Injected failure/);
        assert.equal(running, existing);
        assert.deepEqual(actions, existing ? [action] : [action, 'stop']);
      }
    }
  }
});
