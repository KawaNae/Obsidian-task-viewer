/**
 * The index's delete notification (`IndexReads.onTaskDeleted`) in the real
 * app: a name ends when the index's next reading of its file does not carry
 * it, whoever changed the file.
 *
 * A listener is subscribed through `obsidian eval` and records into a window
 * global, which the test reads back.
 *
 * Prerequisites: Obsidian is running with the Dev vault open, and the plugin
 * built from this tree is loaded.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isObsidianRunning, obsidianEval, sleep } from '../helpers/cli-helper';
import { createFixture, writeTestFile } from '../helpers/test-file-manager';

const FILE = 'test-int-delete-notice.md';
const PLUGIN = `app.plugins.plugins['obsidian-task-viewer']`;

function evalOk(code: string): unknown {
    const result = obsidianEval(code);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result;
}

/** The names the index holds for FILE's rows now, by their text. */
function names(): Record<string, string> {
    return evalOk(`JSON.stringify(Object.fromEntries(${PLUGIN}.getIndex().getTasks()
        .filter(t => t.file === ${JSON.stringify(FILE)}).map(t => [t.content, t.id])))`) as Record<string, string>;
}

/** Every name the listener heard since it was subscribed or last cleared. */
function heard(): string[] {
    return evalOk(`JSON.stringify(window.__tvDeleteNotice ?? [])`) as string[];
}

function clearHeard(): void {
    evalOk(`(window.__tvDeleteNotice = [], 'ok')`);
}

/** Wait until `done` holds of what the listener heard, or the time runs out. */
async function waitHeard(done: (ids: string[]) => boolean, timeoutMs = 8000): Promise<string[]> {
    const start = Date.now();
    let ids = heard();
    while (!done(ids) && Date.now() - start < timeoutMs) {
        await sleep(300);
        ids = heard();
    }
    return ids;
}

const fixture = createFixture(FILE, [
    '- [ ] keep @2026-10-01',
    '- [ ] drop @2026-10-02',
    '',
].join('\n'));

beforeAll(async () => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running E2E tests.');
    }
    await fixture.setup();
    evalOk(`(() => {
        window.__tvDeleteNoticeOff?.();
        window.__tvDeleteNotice = [];
        window.__tvDeleteNoticeOff = ${PLUGIN}.getIndex().onTaskDeleted(id => window.__tvDeleteNotice.push(id));
        return 'ok';
    })()`);
});

afterAll(async () => {
    evalOk(`(() => { window.__tvDeleteNoticeOff?.(); delete window.__tvDeleteNoticeOff; delete window.__tvDeleteNotice; return 'ok'; })()`);
    await fixture.teardown();
});

describe('who hears that a row was deleted', () => {
    it('an edit from outside that takes a row away is heard: every name of the file ends', async () => {
        const before = names();
        expect(Object.keys(before).sort()).toEqual(['drop', 'keep']);
        clearHeard();

        writeTestFile(FILE, '- [ ] keep @2026-10-01\n');
        const ids = await waitHeard(ids => ids.includes(before.drop) && ids.includes(before.keep));

        expect(ids).toContain(before.drop);
        // An edit from outside carries no name across it.
        expect(ids).toContain(before.keep);
    });

    it('a delete of ours ends the row it took away, and not the row it left', async () => {
        writeTestFile(FILE, '- [ ] keep @2026-10-01\n- [ ] drop @2026-10-02\n');
        let now = names();
        const start = Date.now();
        while (!now.drop && Date.now() - start < 8000) {
            await sleep(300);
            now = names();
        }
        expect(now.drop).toBeDefined();
        clearHeard();

        const removed = evalOk(`(async () => String(await ${PLUGIN}.getOperations().deleteTask(${JSON.stringify(now.drop)})))()`);
        expect(String(removed)).toBe('true');
        const ids = await waitHeard(ids => ids.includes(now.drop));
        // Past the change event the write's own `modify` starts.
        await sleep(500);

        expect(heard()).toEqual([now.drop]);
        expect(ids).not.toContain(now.keep);
    });
});
