import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runLocalSupabase } from './supabase-local.mjs';

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
  assert.throws(() => runLocalSupabase(['dev', 'reset']), /Reset is only allowed for test/);
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
