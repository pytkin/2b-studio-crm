import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(new URL('../node_modules/.bin/supabase', import.meta.url));

export function runLocalSupabase(args, { run = execFileSync, env = process.env } = {}) {
  const [target, action] = args;
  if (args.length !== 2 || !['dev', 'test'].includes(target) || !['start', 'stop', 'status', 'reset'].includes(action)) {
    throw new Error('Usage: pnpm db:{dev|test} {start|stop|status}; pnpm db:test reset');
  }
  if (action === 'reset' && target !== 'test') {
    throw new Error('Reset is only allowed for test. Development data is retained.');
  }
  // Local commands must not inherit CLI target overrides or hosted credentials.
  const localEnv = Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('SUPABASE_')));
  localEnv.SUPABASE_EXPERIMENTAL_STACK = '0';
  const workdir = target === 'dev' ? root : `${root}local/test`;
  const command = action === 'reset' ? ['db', 'reset', '--yes'] : [action];
  try {
    run(cli, [...command, '--workdir', workdir], { cwd: root, env: localEnv, stdio: 'ignore' });
  } catch {
    throw new Error(`Supabase ${target}: ${action} failed. Check Docker, the configured ports and container health. Raw CLI output is suppressed because it can contain credentials.`);
  }
  return `Supabase ${target}: ${action} passed.`;
}

if (import.meta.main) {
  try {
    console.log(runLocalSupabase(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
