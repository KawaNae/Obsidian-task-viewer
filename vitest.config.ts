import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
    test: {
        environment: 'node',
        setupFiles: ['tests/setup/vitest.setup.ts'],
        alias: {
            obsidian: resolve(__dirname, 'tests/mocks/obsidian.ts'),
        },
        include: ['tests/**/*.test.ts'],
    },
});
