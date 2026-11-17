import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/integration/**/*.test.ts'],
        // The E2E vault rebuilt from its definition, and what the suite needs
        // of its window checked, once before the first file; the run stops
        // there when one does not hold.
        globalSetup: ['tests/integration/preflight.ts'],
        fileParallelism: false,
        testTimeout: 30000,
        // A hook may wait out a CLI call that does not answer (15 s, then
        // killed: cli-helper) and still have more to do; vitest's 10 s
        // would cut it short before the call has said why it failed.
        hookTimeout: 60000,
    },
});
