import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
    // Mirrors esbuild's dev build, so dev-only assertions run under test.
    define: {
        __DEV__: true,
    },
    test: {
        environment: 'node',
        setupFiles: ['tests/unit/setup/vitest.setup.ts'],
        alias: {
            obsidian: resolve(__dirname, 'tests/unit/mocks/obsidian.ts'),
        },
        include: ['tests/unit/**/*.test.ts'],
    },
});
