import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
    test: {
        environment: 'node',
        setupFiles: ['tests/unit/setup/vitest.setup.ts'],
        alias: {
            obsidian: resolve(__dirname, 'tests/unit/mocks/obsidian.ts'),
        },
        include: ['tests/unit/**/*.test.ts'],
    },
});
