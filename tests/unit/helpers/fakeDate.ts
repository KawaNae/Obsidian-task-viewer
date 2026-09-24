import { vi, beforeEach, afterEach } from 'vitest';

/**
 * Freeze `Date` (only) for every test in the importing file, so a value
 * a src computation reads off "today" (a `==> every ...` recurrence, for
 * instance) lands on the same day no matter which day the suite actually
 * runs. Real timers stay real: an executor that settles through a genuine
 * `setTimeout` in `flush()` still does.
 *
 * `beforeEach`/`afterEach`, not `beforeAll`/`afterAll`: a `setupFiles` hook
 * that fakes `Date` globally (for measuring what a different real day would
 * do) registers its own `beforeEach` ahead of this file's, so a file-scoped
 * `beforeAll` here would run once and then lose the date to that hook before
 * every test. Re-asserting per test keeps this file's date the one a test
 * actually sees.
 *
 * Call once at the top of a test file, outside any `describe`.
 */
export function freezeDate(at: Date): void {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(at);
    });
    afterEach(() => {
        vi.useRealTimers();
    });
}
