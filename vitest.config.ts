import { defineConfig } from 'vitest/config';
// Root vitest runs the backend suite only; web/ runs its own vitest via
// web/vite.config.ts (jsdom environment, setup files).
export default defineConfig({ test: { environment: 'node', include: ['tests/**/*.test.ts'] } });
