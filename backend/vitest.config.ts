import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Las reglas se prueban contra los emuladores reales: no hay mocks.
    include: ['firebase/tests/**/*.test.ts'],
    environment: 'node',
    // Un solo hilo: los tests comparten los emuladores y se limpian entre casos.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
