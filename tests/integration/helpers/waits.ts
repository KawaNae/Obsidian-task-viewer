import { cliList, sleep, type ListResult } from './cli-helper';

/**
 * Waits for a condition, on both sides of the CLI: in a snippet run in
 * Obsidian (`UNTIL`) and in the test process (the functions below). A wait
 * that runs out fails where it waited, saying what it waited for and for how
 * long, rather than going on to fail later on something the wait would have
 * explained. No caller takes a different path when its condition does not
 * come, so there is no wait that answers instead of throwing.
 *
 * The failure reads the same on both sides:
 *   timed out after <ms> ms waiting for <what>[ (<detail>)][; <what was last seen>]
 */

/**
 * JavaScript that defines, in a snippet `obsidian eval` runs, a wait for
 * `test()` to return a truthy value, looking every 50 ms and once more when
 * the time is up: `until(test, ms = 3000, detail)` resolves to true, or
 * throws an Error that quotes the source of `test`, the time waited and
 * `detail` (a string, or a function called at the timeout for what to say of
 * the state then).
 *
 * The loop is `until`'s own, with no other async function between it and the
 * snippet: one more await lets promise callbacks the plugin has pending run
 * before the snippet goes on, where a snippet that waited for one state of a
 * dialog can meet a state half changed (the section dialog's heading field
 * lost its list and the focus that way).
 *
 * It names nothing of the snippet it is put in (the snippets call their sleep
 * `sleep` or `wait`). It is written out here rather than taken from a
 * function's `toString()`, which would carry what the test runner's
 * transform made of the function.
 */
export const UNTIL = `
const until = async (test, ms = 3000, detail) => {
    const end = Date.now() + ms;
    for (;;) {
        if (test()) return true;
        if (Date.now() >= end) break;
        await new Promise(r => setTimeout(r, 50));
    }
    const said = typeof detail === 'function' ? detail() : detail;
    throw new Error('timed out after ' + ms + ' ms waiting for ' + String(test) + (said ? ' (' + said + ')' : ''));
};
`;

/** The Error a wait of the test process throws when `ms` ran out. */
function timedOut(ms: number, what: string, last: string): Error {
    return new Error(`timed out after ${ms} ms waiting for ${what}; ${last}`);
}

/** What a `list` answered, as a timeout says it. */
function answered(result: ListResult | { error: string }): string {
    if ('error' in result) return `the last list answered an error: ${result.error}`;
    return `the last list answered ${result.count} task(s)`;
}

/** Whether `result` is a list, not a CLI call that failed. */
function isList(result: ListResult | { error: string }): result is ListResult {
    return !('error' in result) && Array.isArray(result.tasks);
}

/**
 * Poll `list` with `flags` every `intervalMs` until `probe` finds what is
 * waited for in a list it answered (anything but undefined), and once more
 * when `timeoutMs` is up. Throws the timeout `what` names, with what `list`
 * answered last. An answer that is an error counts as the condition not
 * having come yet.
 */
async function pollList<T>(
    flags: Record<string, string>,
    probe: (result: ListResult) => T | undefined,
    what: string,
    timeoutMs: number,
    intervalMs: number,
): Promise<T> {
    const end = Date.now() + timeoutMs;
    for (;;) {
        const result = cliList(flags) as ListResult | { error: string };
        const found = isList(result) ? probe(result) : undefined;
        if (found !== undefined) return found;
        if (Date.now() >= end) throw timedOut(timeoutMs, what, answered(result));
        await sleep(intervalMs);
    }
}

/** `true` when `holds`, for a `probe` that looks for a state rather than a value. */
function when(holds: boolean): true | undefined {
    return holds ? true : undefined;
}

function fileOf(relativePath: string): string {
    return relativePath.replace(/\.md$/, '');
}

/**
 * Wait for the index to list the file at `relativePath` (at least one task),
 * with none of the IDs in `stale` among its tasks. Throws when `timeoutMs`
 * runs out.
 *
 * @param stale  IDs of a reading the index must have left behind
 *               (`writeIndexedTestFile`)
 */
export async function waitForFileIndexed(
    relativePath: string,
    timeoutMs = 8000,
    stale: ReadonlySet<string> = new Set(),
): Promise<void> {
    const what = stale.size > 0
        ? `${relativePath} to be listed without the ${stale.size} ID(s) of its reading before the write`
        : `${relativePath} to be listed`;
    await pollList(
        { file: fileOf(relativePath) },
        result => when(result.count > 0 && !result.tasks.some(t => stale.has(t.id as string))),
        what, timeoutMs, 300,
    );
}

/** Wait for the index to list no task of the file at `relativePath`. Throws when `timeoutMs` runs out. */
export async function waitForFileDeindexed(relativePath: string, timeoutMs = 8000): Promise<void> {
    await pollList({ file: fileOf(relativePath) }, result => when(result.count === 0),
        `${relativePath} to be listed with no task`, timeoutMs, 300);
}

/**
 * Poll `list` with `flags` until a task matching `predicate` is listed, and
 * resolve to it. Throws when `timeoutMs` runs out.
 */
export function waitForTask(
    flags: Record<string, string>,
    predicate: (task: Record<string, unknown>) => boolean,
    timeoutMs = 5000,
    intervalMs = 200,
): Promise<Record<string, unknown>> {
    return pollList(flags, result => result.tasks.find(predicate),
        `a task of list ${JSON.stringify(flags)} for which ${String(predicate)}`, timeoutMs, intervalMs);
}

/**
 * Poll `list` with `flags` until no task matching `predicate` is listed.
 * Throws when `timeoutMs` runs out.
 */
export async function waitForTaskGone(
    flags: Record<string, string>,
    predicate: (task: Record<string, unknown>) => boolean,
    timeoutMs = 5000,
    intervalMs = 200,
): Promise<void> {
    await pollList(flags, result => when(!result.tasks.some(predicate)),
        `no task of list ${JSON.stringify(flags)} for which ${String(predicate)}`, timeoutMs, intervalMs);
}
