/**
 * Waits for a condition in a snippet run in Obsidian. A wait that runs out
 * fails where it waited, saying what it waited for and for how long, rather
 * than going on to fail later on something the wait would have explained. A
 * caller that takes a different path when the condition does not come asks
 * for the answer instead (`tryUntil`).
 *
 * The failure reads:
 *   timed out after <ms> ms waiting for <what>[ (<detail>)]
 */

/**
 * JavaScript that defines, in a snippet `obsidian eval` runs, two waits for
 * `test()` to return a truthy value, looking every 50 ms and once more when
 * the time is up:
 *
 * - `until(test, ms = 3000, detail)` resolves to true, or throws an Error
 *   that quotes the source of `test`, the time waited and `detail` (a string,
 *   or a function called at the timeout for what to say of the state then)
 * - `tryUntil(test, ms = 3000)` resolves to whether the condition came
 *
 * It names nothing of the snippet it is put in (the snippets call their sleep
 * `sleep` or `wait`). It is written out here rather than taken from a
 * function's `toString()`, which would carry what the test runner's
 * transform made of the function.
 */
export const UNTIL = `
const tryUntil = async (test, ms = 3000) => {
    const end = Date.now() + ms;
    for (;;) {
        if (test()) return true;
        if (Date.now() >= end) return false;
        await new Promise(r => setTimeout(r, 50));
    }
};
const until = async (test, ms = 3000, detail) => {
    if (await tryUntil(test, ms)) return true;
    const said = typeof detail === 'function' ? detail() : detail;
    throw new Error('timed out after ' + ms + ' ms waiting for ' + String(test) + (said ? ' (' + said + ')' : ''));
};
`;
