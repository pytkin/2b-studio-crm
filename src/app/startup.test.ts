import { expect, test, vi } from 'vitest';

test('the entrypoint configures validation before schemas can probe eval under strict CSP', async () => {
  vi.resetModules();
  let evalAttempts = 0;
  vi.stubGlobal('Function', function blockedFunction() {
    evalAttempts++;
    throw new EvalError('Dynamic code generation blocked by CSP');
  });
  let z: typeof import('zod').z | undefined;
  try {
    // Import the actual entrypoint, including its eager route/form schema imports.
    // There is no mount node, so this tests initialization without rendering React.
    await import('../main');
    ({ z } = await import('zod'));
    const schema = z.object({ title: z.string().trim().min(1) });
    expect(schema.safeParse({ title: '  Задача  ' }).data).toEqual({ title: 'Задача' });
    expect(schema.safeParse({ title: '   ' }).success).toBe(false);
    expect(evalAttempts).toBe(0);

    // Run the unsafe control last: Zod memoizes its eval probe. Running this
    // first could cache a rejection and hide an incorrect startup import order.
    z.config({ jitless: false });
    expect(z.object({ title: z.string() }).safeParse({ title: 'Контроль' }).success).toBe(true);
    expect(evalAttempts).toBeGreaterThan(0);
  } finally {
    z?.config({ jitless: true });
    vi.unstubAllGlobals();
  }
});
