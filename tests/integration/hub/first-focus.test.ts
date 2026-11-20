/**
 * The hub's first focus, in the running E2E vault, opened on a row with its
 * name named: the field takes the focus once the panel's open animation has
 * ended, its text selected, and from the frame after the hub opens until
 * then the focus is on the panel itself.
 *
 * A field focused while the panel still moves raises the on-screen keyboard
 * with the field where it stands midway, and WebKit scrolls the body by that
 * place (on iPad the sheet sliding up from below the window scrolled it to
 * its end). The desktop's window scrolls nothing, so what is seen here is
 * when the focus comes, as the phone's sheet (`.is-phone` on the body, which
 * lays the shell out as one) and the desktop's centered box each open.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/first-focus.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, writeIndexedTestFile } from '../helpers/test-file-manager';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';

const TEST_FILE = 'test-int-first-focus.md';

const NOTE = [
    '# 見出し',
    '- [ ] 名前のある行 @2031-01-21',
    '',
].join('\n');

const PRELUDE = `
const plugin = app.plugins.plugins['obsidian-task-viewer'];
${UNTIL}
const hub = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
const panel = () => hub()?.closest('.tv-overlay__panel') ?? null;
const nameInput = () => hub()?.querySelector('.tv-form__name-section input') ?? null;
const row = () => plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith('名前のある行'));
/** The panel's own animations running now: its open animation, while it moves. */
const moving = el => el.getAnimations().filter(a => a.playState === 'running').map(a => a.animationName ?? a.id);
`;

/** Run `body` (statements, ending in a `return`) in Obsidian after the prelude. */
function run<T>(body: string): T {
    const result = obsidianEval(`(async () => { ${PRELUDE}\n${body}\n})()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

interface FirstFocus {
    /** The panel's open animation, as it ran once the hub opened. */
    opening: string[];
    /** Each focusin from the open on: what took the focus, and what of the panel still moved then. */
    focusins: { on: string; moving: string[] }[];
    /** What had the focus at each frame from the open until the name had it. */
    frames: string[];
    selected: boolean;
}

/**
 * Open the hub on the row with its name named, and say what took the focus
 * and when, until the name has it.
 */
function openOnName(): FirstFocus {
    return run<FirstFocus>(`
        const focusins = [];
        const what = el => el === nameInput() ? 'name' : el === panel() ? 'panel' : (panel()?.contains(el) ? 'in panel' : 'outside');
        const onFocus = e => focusins.push({ on: what(e.target), moving: panel() ? moving(panel()) : [] });
        document.addEventListener('focusin', onFocus, true);
        try {
            plugin.openTaskHub(row().id, { focusField: 'name' });
            const opening = moving(panel());
            const frames = [];
            const end = Date.now() + 3000;
            while (document.activeElement !== nameInput() && Date.now() < end) {
                await new Promise(r => requestAnimationFrame(r));
                frames.push(what(document.activeElement));
            }
            const input = nameInput();
            const selected = !!input && input.value.length > 0
                && input.selectionStart === 0 && input.selectionEnd === input.value.length;
            return JSON.stringify({ opening, focusins, frames, selected });
        } finally {
            document.removeEventListener('focusin', onFocus, true);
        }
    `);
}

/** The frames from the open on: the panel's, until the name's last one. */
function expectPanelUntilName(frames: string[]): void {
    expect(frames.length).toBeGreaterThan(1);
    expect(frames[frames.length - 1]).toBe('name');
    expect(new Set(frames.slice(0, -1))).toEqual(new Set(['panel']));
}

beforeAll(async () => {
    // Focus moves need the window to have the focus.
    if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']);
    await writeIndexedTestFile(TEST_FILE, NOTE);
});

afterEach(() => {
    run(`
        document.body.classList.remove('is-phone');
        if (hub()) {
            panel().querySelector('.tv-overlay__close').click();
            await until(() => !document.querySelector('.tv-overlay'));
        }
        return 'true';
    `);
});

afterAll(async () => {
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

describe('the first focus comes to the field once the panel has opened', () => {
    it("a phone's sheet: the name is focused once the slide up has ended, the panel focused until then", () => {
        run(`document.body.classList.add('is-phone'); return 'true';`);
        const seen = openOnName();
        expect(seen.opening).toEqual(['tv-overlay-slide']);
        expect(seen.focusins).toEqual([
            { on: 'panel', moving: ['tv-overlay-slide'] },
            { on: 'name', moving: [] },
        ]);
        expectPanelUntilName(seen.frames);
        expect(seen.selected).toBe(true);
    });

    it("the desktop's centered box: the name is focused once the pop in has ended, the panel focused until then", () => {
        const seen = openOnName();
        expect(seen.opening).toEqual(['tv-overlay-pop']);
        expect(seen.focusins).toEqual([
            { on: 'panel', moving: ['tv-overlay-pop'] },
            { on: 'name', moving: [] },
        ]);
        expectPanelUntilName(seen.frames);
        expect(seen.selected).toBe(true);
    });
});
