/**
 * The hub's first focus, in the running E2E vault, opened on a row with a
 * field named: the field takes the focus once the panel's open animation has
 * ended, and from the frame after the hub opens until then the focus is on
 * the panel itself. The field's text is met as its kind asks: a name's with
 * the caret after it, a long one scrolled in its field to its end and the
 * hub's body not scrolled; a date's selected whole.
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

const LONG_NAME = '長い名前の行'.padEnd(120, 'あいうえおかきくけこ');

const NOTE = [
    '# 見出し',
    '- [ ] 名前のある行 @2031-01-21',
    `- [ ] ${LONG_NAME}`,
    '',
].join('\n');

const PRELUDE = `
const plugin = app.plugins.plugins['obsidian-task-viewer'];
${UNTIL}
const hub = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
const panel = () => hub()?.closest('.tv-overlay__panel') ?? null;
const nameInput = () => hub()?.querySelector('.tv-form__name-section input') ?? null;
/** The start's date: the text field of the first row of dates. */
const startInput = () => hub()?.querySelector('.tv-form__field--date input[type="text"]') ?? null;
const rowNamed = start => plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith(start));
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
    /** What had the focus at each frame from the open until the field had it. */
    frames: string[];
    /** The field's value once it had the focus. */
    value: string;
    /** What of the field's text was selected then: all of it, the caret after it, or something else. */
    text: 'all' | 'end' | 'other';
    /** Whether the field's own text was scrolled for its end to show. */
    endShown: boolean;
    /** How far the hub's body was scrolled then. */
    bodyScrolled: number;
}

/** The field the hub opens on, and the element of the form that is it. */
const FIELDS = {
    name: 'nameInput()',
    start: 'startInput()',
} as const;

/**
 * Open the hub on the row whose name starts with `rowStart`, with `field`
 * named, and say what took the focus and when, until the field has it.
 */
function openOn(field: keyof typeof FIELDS, rowStart = '名前のある行'): FirstFocus {
    return run<FirstFocus>(`
        const target = () => ${FIELDS[field]};
        const focusins = [];
        const what = el => el === target() ? 'field' : el === panel() ? 'panel' : (panel()?.contains(el) ? 'in panel' : 'outside');
        const onFocus = e => focusins.push({ on: what(e.target), moving: panel() ? moving(panel()) : [] });
        document.addEventListener('focusin', onFocus, true);
        try {
            plugin.openTaskHub(rowNamed(${JSON.stringify(rowStart)}).id, { focusField: ${JSON.stringify(field)} });
            const opening = moving(panel());
            const frames = [];
            const end = Date.now() + 3000;
            while (document.activeElement !== target() && Date.now() < end) {
                await new Promise(r => requestAnimationFrame(r));
                frames.push(what(document.activeElement));
            }
            const input = target();
            const length = input?.value.length ?? -1;
            const text = input && length > 0 && input.selectionStart === 0 && input.selectionEnd === length ? 'all'
                : input && input.selectionStart === length && input.selectionEnd === length ? 'end'
                : 'other';
            const endShown = !!input && input.scrollLeft + input.clientWidth >= input.scrollWidth - 1;
            const bodyScrolled = panel()?.querySelector('.tv-overlay__body')?.scrollTop ?? -1;
            return JSON.stringify({ opening, focusins, frames, value: input?.value ?? '', text, endShown, bodyScrolled });
        } finally {
            document.removeEventListener('focusin', onFocus, true);
        }
    `);
}

/** The frames from the open on: the panel's, until the field's last one. */
function expectPanelUntilField(frames: string[]): void {
    expect(frames.length).toBeGreaterThan(1);
    expect(frames[frames.length - 1]).toBe('field');
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
        const seen = openOn('name');
        expect(seen.opening).toEqual(['tv-overlay-slide']);
        expect(seen.focusins).toEqual([
            { on: 'panel', moving: ['tv-overlay-slide'] },
            { on: 'field', moving: [] },
        ]);
        expectPanelUntilField(seen.frames);
        expect(seen.text).toBe('end');
    });

    it("the desktop's centered box: the name is focused once the pop in has ended, the panel focused until then", () => {
        const seen = openOn('name');
        expect(seen.opening).toEqual(['tv-overlay-pop']);
        expect(seen.focusins).toEqual([
            { on: 'panel', moving: ['tv-overlay-pop'] },
            { on: 'field', moving: [] },
        ]);
        expectPanelUntilField(seen.frames);
        expect(seen.text).toBe('end');
    });
});

describe('the text of the field the hub opens on', () => {
    it('is the name\'s with the caret after it, so a key pressed at once does not replace it', () => {
        const seen = openOn('name');
        expect(seen.value).toBe('名前のある行');
        expect(seen.text).toBe('end');
    });

    it('is a long name\'s scrolled in its field to its end, the hub\'s body not scrolled', () => {
        const seen = openOn('name', '長い名前の行');
        expect(seen.value).toBe(LONG_NAME);
        expect(seen.text).toBe('end');
        expect(seen.endShown).toBe(true);
        expect(seen.bodyScrolled).toBe(0);
    });

    it('is the start date\'s selected whole, so what is typed replaces it', () => {
        const seen = openOn('start');
        expect(seen.value).toBe('2031-01-21');
        expect(seen.text).toBe('all');
    });
});
