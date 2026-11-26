/**
 * The card and the source swapped by the switch on the hub's title line, in
 * the running E2E vault, on a phone's sheet: the title line does not scroll,
 * so the switch is pressed with the body scrolled however the user left it,
 * and the one the switch shows is brought into the body's sight.
 *
 * - The source opened with the body scrolled to its bottom: the editor's top
 *   stands in the body. Back to the card, scrolled to the bottom again: the
 *   card's top stands in the body. Both in a source that writes the note
 *   and in one opened while the hub moves the row.
 * - The switch back pressed in a move on a first line that is no task: the
 *   source stays, and its top and what is said under the editor stand in
 *   the body.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/source-sight.test.ts
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, writeIndexedTestFile } from '../helpers/test-file-manager';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';
import { KEYBOARD, resetKeyboard } from '../helpers/keyboard';
import { DIALOG_ROWS } from '../helpers/dialog-rows';

const TEST_FILE = 'test-int-source-sight.md';

/** A row with children enough that its card and the form below make the body scroll. */
const NOTE = [
    '# 予定',
    '- [ ] 背の高い行',
    ...Array.from({ length: 30 }, (_, i) => `    - [ ] 子${i + 1}`),
    '# 済み',
    '- [ ] ほかの行',
    '',
].join('\n');

const PRELUDE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plugin = app.plugins.plugins['obsidian-task-viewer'];
${UNTIL}
${KEYBOARD}
${DIALOG_ROWS}
const hub = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
const body = () => hub().querySelector('.tv-overlay__body');
const rowNamed = start => plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith(start));
const shown = el => !!el && !el.hidden && getComputedStyle(el).display !== 'none';
const moveButton = () => hub().querySelector('.task-hub__move');
const placeInputs = () => [...hub().querySelectorAll('.task-hub__place input')];
const act = () => formRow(hub())?.querySelector('.mod-cta');
const pencil = () => hub().querySelectorAll('.task-hub__mode-toggle button')[0];
const sourceButton = () => hub().querySelectorAll('.task-hub__mode-toggle button')[1];
const pressButton = button => { button.focus(); button.click(); };
const viewOf = which => {
    const el = hub()?.querySelector('.tv-source-editor__' + which + ' .cm-content');
    return el ? (el.cmTile?.view ?? el.cmView?.rootView?.view ?? null) : null;
};
/** Scroll the body to its bottom, as a user does to reach the form's lower fields. */
const scrollDown = async () => {
    const b = body();
    b.scrollTo({ top: b.scrollHeight, behavior: 'instant' });
    await sleep(50);
    return b.scrollTop;
};
/** Where \`el\` stands against the body's room: its top and bottom less the body's top, and the room's height. */
const against = el => {
    const room = body().getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { top: r.top - room.top, bottom: r.bottom - room.top, room: body().clientHeight };
};
const open = async name => {
    phoneLayout();
    plugin.openTaskHub(rowNamed(name).id);
    await until(() => hub()?.querySelector('.task-hub__shown') && sourceButton());
    await sleep(400);
};
const beginMove = async () => {
    moveButton().click();
    await until(() => placeInputs().length === 2 && act());
    await sleep(100);
};
/** Down, the source opened: where the editor stands. Down again, back to the card: where the card stands. */
const swapBothWays = async () => {
    const before = await scrollDown();
    pressButton(sourceButton());
    await until(() => viewOf('children'));
    await sleep(200);
    const editor = against(hub().querySelector('.task-hub__source-editor'));
    const scrolledAgain = await scrollDown();
    pressButton(pencil());
    await until(() => !viewOf('children'));
    await sleep(200);
    const card = against(hub().querySelector('.task-hub__preview'));
    return { before, editor, scrolledAgain, card };
};
`;

function run<T>(body: string): T {
    const result = obsidianEval(`(async () => { ${PRELUDE}\n${body}\n})()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

interface Place { top: number; bottom: number; room: number }

/** The top of `place` stands in the body's room. */
function topInSight(place: Place): void {
    expect(place.top).toBeGreaterThanOrEqual(-0.5);
    expect(place.top).toBeLessThan(place.room);
}

afterEach(() => {
    run(`
        document.querySelectorAll('.tv-overlay:not(.is-closing) .tv-overlay__close').forEach(b => b.click());
        await sleep(100);
        document.querySelectorAll('.tv-overlay:not(.is-closing) .tv-form__discard').forEach(b => b.click());
        await sleep(100);
        // A sheet has no ×: the back closes it, and a discard asked is answered.
        for (const root of document.querySelectorAll('.tv-overlay:not(.is-closing)')) root.querySelector('.tv-overlay__backdrop')?.click();
        await sleep(100);
        document.querySelectorAll('.tv-overlay:not(.is-closing) .tv-form__discard').forEach(b => b.click());
        await until(() => !document.querySelector('.tv-overlay'));
        return 'true';
    `);
    resetKeyboard();
});

afterAll(async () => {
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

describe('the card and the source swapped by the switch, on a phone\'s sheet scrolled down', () => {
    it('opens the source with the editor\'s top in the body, and goes back with the card\'s top in it', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const seen = run<{ before: number; editor: Place; scrolledAgain: number; card: Place }>(`
            await open('背の高い行');
            return JSON.stringify(await swapBothWays());
        `);
        expect(seen.before).toBeGreaterThan(0);
        expect(seen.scrolledAgain).toBeGreaterThan(0);
        topInSight(seen.editor);
        topInSight(seen.card);
    });

    it('does the same while the hub moves the row', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const seen = run<{ before: number; editor: Place; scrolledAgain: number; card: Place }>(`
            await open('背の高い行');
            await beginMove();
            return JSON.stringify(await swapBothWays());
        `);
        expect(seen.before).toBeGreaterThan(0);
        expect(seen.scrolledAgain).toBeGreaterThan(0);
        topInSight(seen.editor);
        topInSight(seen.card);
    });

    it('keeps the source in a move whose first line is no task, its top and what is said under the editor in the body', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const seen = run<{ open: boolean; before: number; editor: Place; message: Place | null; said: string | null }>(`
            await open('背の高い行');
            await beginMove();
            pressButton(sourceButton());
            await until(() => viewOf('children'));
            await sleep(200);
            const parent = viewOf('parent');
            parent.dispatch({ changes: { from: 0, to: parent.state.doc.length, insert: 'ただの文' } });
            await sleep(100);
            const before = await scrollDown();
            pressButton(pencil());
            await sleep(300);
            const messageEl = hub().querySelector('.task-hub__source-message');
            return JSON.stringify({
                open: !!viewOf('children'),
                before,
                editor: against(hub().querySelector('.task-hub__source-pane')),
                message: shown(messageEl) && messageEl.textContent ? against(messageEl) : null,
                said: messageEl?.textContent || null,
            });
        `);
        expect(seen.open).toBe(true);
        expect(seen.before).toBeGreaterThan(0);
        expect(seen.said).not.toBeNull();
        topInSight(seen.editor);
        if (seen.editor.bottom - seen.editor.top <= seen.editor.room) {
            expect(seen.message!.top).toBeGreaterThanOrEqual(-0.5);
            expect(seen.message!.bottom).toBeLessThanOrEqual(seen.message!.room + 0.5);
        }
    });
});
