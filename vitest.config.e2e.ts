import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/integration/**/*.test.ts'],
        // What the suite needs of the running Obsidian, checked once before
        // the first file; the run stops there when it does not hold.
        globalSetup: ['tests/integration/preflight.ts'],
        fileParallelism: false,
        testTimeout: 30000,
    },
});
