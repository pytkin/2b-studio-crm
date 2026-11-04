import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { protectBuildOutput } from './scripts/build-output.mts';
import { isPublicKey } from './src/shared/public-config.ts';
import { assertPublicApiUrl } from './src/shared/public-url.ts';

export default defineConfig({
  plugins: [
    {
      name: 'check-public-supabase-config',
      configResolved({ env }) {
        if (env.VITE_SUPABASE_URL) assertPublicApiUrl(env.VITE_SUPABASE_URL);
        if (env.VITE_SUPABASE_PUBLISHABLE_KEY && !isPublicKey(env.VITE_SUPABASE_PUBLISHABLE_KEY))
          throw new Error('Требуется публичный ключ Supabase.');
      },
    },
    protectBuildOutput(),
    react(),
    tailwindcss(),
  ],
  server: {
    fs: {
      deny: ['**/.local/**', '**/.env', '**/.env.*', '**/*.{crt,pem}', '**/.git/**', '**/supabase/.temp/**'],
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
