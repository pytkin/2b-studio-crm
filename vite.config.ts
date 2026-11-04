import { loadEnv } from "vite";
import { isPublicKey } from "./src/shared/public-config.ts";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  if (env.VITE_SUPABASE_PUBLISHABLE_KEY && !isPublicKey(env.VITE_SUPABASE_PUBLISHABLE_KEY)) {
    throw new Error("Требуется публичный ключ Supabase.");
  }
  return {
  plugins: [react(), tailwindcss()],
  server: {
    fs: { deny: ['**/.local/**', '**/.env', '**/.env.*', '**/*.{crt,pem}', '**/.git/**', '**/supabase/.temp/**'] },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
  },
  };
});
