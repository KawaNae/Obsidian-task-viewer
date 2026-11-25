/**
 * How a dialog's body moves along with the on-screen keyboard, frame by
 * frame, in the running E2E vault, the keyboard told as iPad tells it (the
 * did show 440ms after the will show: `helpers/keyboard.ts`). Each frame is
 * recorded as the plugin left it, and what is expected is read from the
 * frames as a property (only rising, the field 10px above the keyboard's
 * top), not from the plugin's figures. Where the body comes to rest is seen
 * in keyboard-room.test.ts and the unit tests.
 *
 * - A phone's sheet, its field hidden by the keyboard (the hub of a task not
 *   written yet, its lowest field, the body first scrolled until the field
 *   shows, as a user does to press it): the body rises with the keyboard over
 *   many frames, never jumping in one, the field never below 10px above the
 *   keyboard's top or the body's bottom, the higher of the two, and resting
 *   there; it goes back the same way as the keyboard goes.
 * - The desktop's tall centered box (the same hub): the field stays until
 *   the keyboard's top comes to it, then rides 10px above it. Once the
 *   keyboard is up the body's height is locked and its bottom padded, and
 *   both are put back with its scroll as the keyboard goes.
 * - A field the keyboard leaves in sight (the box of a row with many
 *   properties, its first field): the body is held where it stood until the did
 *   show, the browser's own scroll (made by the test, at frames along the
 *   way) written over by the next frame, and is left as it was.
 * - The user scrolling the body while the keyboard rises (a wheel on it):
 *   the body is no longer written while the keyboard moves; once it is up,
 *   the field left hidden there has the body scrolled for it at once, and
 *   the body goes back to where the user took it as the keyboard goes.
 * - A field the keyboard hides, focused once the keyboard is up: the body is
 *   scrolled for it at once, the field 10px above the keyboard's top, by the
 *   focus alone (the caret's `selectionchange` kept from the plugin).
 * - The keyboard rising while the hub still opens (a field focused as its
 *   panel pops in on the desktop, or slides up on a phone): the body is held
 *   until the panel has come in, and then moves until the field is 10px
 *   above the keyboard's top.
 *
 * The window's height is read as the test runs and the keyboard's height is
 * made from where the field stands, so the cases hold for the window the
 * vault is opened in.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/forms/keyboard-move.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, writeIndexedTestFile } from '../helpers/test-file-manager';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';
import { KEYBOARD, resetKeyboard } from '../helpers/keyboard';

const TEST_FILE = 'test-int-keyboard-move.md';

const NOTE = [
    '# 見出し',
    '- [ ] 名前のある行 @2031-01-21',
    '- [ ] 背の高い行 @2031-01-21',
    ...Array.from({ length: 8 }, (_, i) => `\t- p${i + 1}:: v${i + 1}`),
    '',
].join('\n');

/** How far above the field the keyboard's top is told to end, before anything moves for it (px). */
const BELOW_KEYBOARD = 300;

const PRELUDE = `
const plugin = app.plugins.plugins['obsidian-task-viewer'];
${UNTIL}
${KEYBOARD}
const root = () => document.querySelector('.tv-overlay:not(.is-closing)');
const panel = () => root()?.querySelector('.tv-overlay__panel') ?? null;
const body = () => panel()?.querySelector('.tv-overlay__body') ?? null;
const rowNamed = name => plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith(name));
const panelMoving = () => panel().getAnimations().some(a => a.playState === 'running');
/** Wait for the overlay to have opened: its panel's open animation ended and the first focus put in it. */
const opened = async () => {
    await until(() => panel());
    await until(() => !panelMoving(), 3000, () => panel().getAnimations().map(a => a.animationName ?? a.transitionProperty).join(' '));
    await until(() => panel().contains(document.activeElement));
};
/** The text fields the body shows, top first: none of a pane off (\`inert\`, kept laid out though not seen). */
const fields = () => [...body().querySelectorAll('input[type="text"], input:not([type]), textarea')]
    .filter(el => el.offsetParent !== null && !el.disabled && !el.closest('[inert]'));
/** The hub of a task not written yet, the child of the note's first row. */
const openDraft = () => plugin.openDraftHub({ kind: 'childOf', taskId: rowNamed('名前のある行').id }, {});
/** The hub of the row with many properties, its body holding more than it shows. */
const openTall = () => plugin.openTaskHub(rowNamed('背の高い行').id);
/** Focus \`el\` as a tap does, the browser scrolling nothing for it. */
const focusField = el => el.focus({ preventScroll: true });
/** The keyboard's height that ends its top \`${BELOW_KEYBOARD}\`px above the field's bottom as it stands. */
const keyboardUnder = el => Math.round(innerHeight - (el.getBoundingClientRect().bottom - ${BELOW_KEYBOARD}));
/** What the body has written on it inline. */
const inline = () => ({ height: body().style.height, maxHeight: body().style.maxHeight, paddingBottom: body().style.paddingBottom });
/** The next animation frame. */
const nextFrame = () => new Promise(r => requestAnimationFrame(r));
`;

/** Run `body` (statements, ending in a `return`) in Obsidian after the prelude. */
function run<T>(body: string): T {
    const result = obsidianEval(`(async () => { ${PRELUDE}\n${body}\n})()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

/** One frame as `recordFrames` saw it. */
interface Frame {
    t: number;
    overlap: number;
    scrollTop: number;
    field: number;
    keyboardTop: number;
    bodyBottom: number;
}

interface Inline {
    height: string;
    maxHeight: string;
    paddingBottom: string;
}

/** The keyboard rising and going over a field, frame by frame. */
interface Rise {
    /** The keyboard's height told. */
    k: number;
    /** How far above the body's bottom the field's bottom stands as it is focused. */
    shown: number;
    /** The body's scrollTop and what is written on it inline, before the keyboard, once it is up, and once it has gone. */
    start: number;
    before: Inline;
    up: Inline;
    end: number;
    after: Inline;
    show: Frame[];
    hide: Frame[];
}

/**
 * Open the hub `open` opens, the lowest field of its body focused, and tell
 * it a keyboard ending 300px above the field, then take the keyboard off,
 * recording each frame of both.
 */
function riseOverLowField(open: 'openDraft()', phone: boolean): Rise {
    return run<Rise>(`
        if (${phone}) phoneLayout();
        ${open};
        await opened();
        const field = fields().slice(-1)[0];
        // The body scrolled until the field shows, as a user does to press it.
        const hidden = field.getBoundingClientRect().bottom - (body().getBoundingClientRect().bottom - 10);
        if (hidden > 0) {
            body().scrollTop += Math.ceil(hidden);
            await nextFrame();
        }
        const shown = body().getBoundingClientRect().bottom - field.getBoundingClientRect().bottom;
        focusField(field);
        const start = body().scrollTop;
        const before = inline();
        const k = keyboardUnder(field);
        const show = await recordFrames(root(), body(), field, k, { after: showKeyboardAsIPad(k) });
        const up = inline();
        const end = body().scrollTop;
        hideKeyboard();
        const hide = await recordFrames(root(), body(), field, 0);
        // The frame the plugin puts the body back at has run before the last recorded.
        await nextFrame();
        return JSON.stringify({ k, shown, start, before, up, end, after: inline(), show, hide });
    `);
}

/** Whether each value is at least the one before it. */
function rising(values: number[]): boolean {
    return values.every((v, i) => i === 0 || v >= values[i - 1]);
}

/** Whether each value is at most the one before it. */
function falling(values: number[]): boolean {
    return values.every((v, i) => i === 0 || v <= values[i - 1]);
}

/** The edge the field is kept 10px above at a frame: the keyboard's top, or the body's bottom where higher. */
function edge(f: Frame): number {
    return Math.min(f.keyboardTop, f.bodyBottom);
}

beforeAll(async () => {
    // Focus moves need the window to have the focus.
    if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']);
    await writeIndexedTestFile(TEST_FILE, NOTE);
});

afterEach(() => {
    resetKeyboard();
    run(`
        for (let i = 0; i < 4 && root(); i++) {
            const top = root();
            const discard = [...top.querySelectorAll('.tv-form__discard')].find(el => el.offsetParent !== null);
            (discard ?? top.querySelector('.tv-overlay__close')).click();
            await until(() => root() !== top || [...top.querySelectorAll('.tv-form__discard')].some(el => el.offsetParent !== null));
        }
        await until(() => !document.querySelector('.tv-overlay'));
        return 'true';
    `);
});

afterAll(async () => {
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

describe('a field the keyboard hides', () => {
    it("on a phone's sheet, the body rises with the keyboard over many frames, the field never below 10px above the keyboard's top or the body's bottom, and goes back the same way", () => {
        const seen = riseOverLowField('openDraft()', true);
        // The field shows as it is focused, 10px above the body's bottom at least.
        expect(seen.shown).toBeGreaterThanOrEqual(10);
        // The keyboard hides the field by more than a little.
        expect(seen.end - seen.start).toBeGreaterThan(50);

        const tops = seen.show.map((f) => f.scrollTop);
        expect(rising(tops)).toBe(true);
        expect(tops.some((top) => top > seen.start && top < seen.end)).toBe(true);
        for (const f of seen.show) expect(f.field).toBeLessThanOrEqual(edge(f) - 10 + 1);
        const rest = seen.show[seen.show.length - 1];
        expect(Math.abs(rest.field - (edge(rest) - 10))).toBeLessThanOrEqual(1);

        const back = seen.hide.map((f) => f.scrollTop);
        expect(falling(back)).toBe(true);
        expect(back.some((top) => top > seen.start && top < seen.end)).toBe(true);
        expect(back[back.length - 1]).toBe(seen.start);
    });

    it("in the desktop's tall box, the field stays until the keyboard's top comes to it and then rides 10px above it, the body's height locked and padded until the keyboard has gone", () => {
        const seen = riseOverLowField('openDraft()', false);
        expect(seen.shown).toBeGreaterThanOrEqual(10);
        expect(seen.end - seen.start).toBeGreaterThan(50);

        const tops = seen.show.map((f) => f.scrollTop);
        expect(rising(tops)).toBe(true);
        // Frames of the keyboard rising with the body where it stood.
        expect(seen.show.some((f) => f.overlap > 0 && f.scrollTop === seen.start)).toBe(true);
        expect(tops.some((top) => top > seen.start && top < seen.end)).toBe(true);
        for (const f of seen.show) {
            expect(f.field).toBeLessThanOrEqual(f.keyboardTop - 10 + 1);
            if (f.scrollTop > seen.start) expect(Math.abs(f.field - (f.keyboardTop - 10))).toBeLessThanOrEqual(1);
        }

        // The keyboard covers the body's bottom: its height is locked, and its bottom padded for the scroll.
        expect(seen.before.height).toBe('');
        expect(seen.up.height).not.toBe('');
        expect(seen.up.paddingBottom).not.toBe(seen.before.paddingBottom);
        const back = seen.hide.map((f) => f.scrollTop);
        expect(falling(back)).toBe(true);
        expect(back.some((top) => top > seen.start && top < seen.end)).toBe(true);
        expect(seen.hide[seen.hide.length - 1].scrollTop).toBe(seen.start);
        expect(seen.after).toEqual(seen.before);
    });

    it("focused once the keyboard is up, has the body scrolled at once to keep it 10px above the keyboard's top", () => {
        const seen = run<{ k: number; start: number; up: number; frames: Frame[] }>(`
            await openDraft();
            await opened();
            const low = fields().slice(-1)[0];
            const k = keyboardUnder(low);
            const name = fields()[0];
            focusField(name);
            await recordFrames(root(), body(), name, k, { after: showKeyboardAsIPad(k) });
            const start = body().scrollTop;
            const up = low.getBoundingClientRect().bottom;
            // Chromium tells the caret put in the field as a selectionchange,
            // which measures the field too: kept out, so the focus is what moves the body.
            const quiet = e => e.stopImmediatePropagation();
            window.addEventListener('selectionchange', quiet, true);
            let frames;
            try {
                focusField(low);
                frames = await recordFrames(root(), body(), low, k);
            } finally {
                window.removeEventListener('selectionchange', quiet, true);
            }
            return JSON.stringify({ k, start, up, frames });
        `);
        const f0 = seen.frames[0];
        // Hidden by the keyboard as it rose over the field above.
        expect(seen.up).toBeGreaterThan(f0.keyboardTop);
        // Moved by the first frame after the focus, and left there.
        const at = seen.frames.findIndex((f) => Math.abs(f.field - (f.keyboardTop - 10)) <= 1);
        expect(at).toBeGreaterThanOrEqual(0);
        expect(at).toBeLessThanOrEqual(1);
        const rest = seen.frames[seen.frames.length - 1];
        expect(Math.abs(rest.field - (rest.keyboardTop - 10))).toBeLessThanOrEqual(1);
        expect(rest.scrollTop).toBeGreaterThan(seen.start);
    });
});

describe('a field the keyboard leaves in sight', () => {
    interface Held {
        k: number;
        start: number;
        before: Inline;
        /** The frames the test scrolled the body at, the overlap shown then, and the scrollTop it read right after. */
        scrolled: { at: number; overlap: number; to: number }[];
        show: Frame[];
        end: number;
        up: Inline;
    }

    it("holds the body where it stood until the did show, the browser's scroll written over by the next frame, and leaves it so", () => {
        const seen = run<Held>(`
            await openTall();
            await opened();
            const field = fields()[0];
            focusField(field);
            const start = body().scrollTop;
            const before = inline();
            // A keyboard covering half the window leaves the first field, near the box's top, in sight.
            const k = Math.round(innerHeight / 2);
            const room = body().scrollHeight - body().clientHeight;
            const scrolled = [];
            let settledScroll = false;
            let sent = false;
            const did = showKeyboardAsIPad(k).then(() => { sent = true; });
            const show = await recordFrames(root(), body(), field, k, {
                after: did,
                each: (i, frames) => {
                    if (sent) return;
                    const f = frames[i];
                    // Once on the way up, and once the overlap has come but the did show has not.
                    const onTheWay = i === 2;
                    const comeBeforeDid = !settledScroll && !overlapMoving(root()) && f.overlap === k;
                    if (!onTheWay && !comeBeforeDid) return;
                    if (comeBeforeDid) settledScroll = true;
                    body().scrollTop = start + Math.min(80, room);
                    scrolled.push({ at: i, overlap: f.overlap, to: body().scrollTop });
                },
            });
            return JSON.stringify({ k, start, before, scrolled, show, end: body().scrollTop, up: inline() });
        `);
        // The test's scroll took, at both frames.
        expect(seen.scrolled).toHaveLength(2);
        expect(seen.scrolled[0].overlap).toBeGreaterThan(0);
        expect(seen.scrolled[0].overlap).toBeLessThan(seen.k);
        expect(seen.scrolled[1].overlap).toBe(seen.k);
        for (const s of seen.scrolled) expect(s.to).toBeGreaterThan(seen.start);
        // Each frame is seen as the plugin left it: the scroll of the frame before written over.
        expect(seen.show.every((f) => f.scrollTop === seen.start)).toBe(true);
        for (const s of seen.scrolled) expect(s.at + 1).toBeLessThan(seen.show.length);
        expect(seen.end).toBe(seen.start);
        expect(seen.up).toEqual(seen.before);
    });
});

describe('the user scrolling the body as the keyboard rises', () => {
    it('stops the body being written, measures it from where the user took it once the keyboard is up, and goes back there as the keyboard goes', () => {
        const seen = run<{ start: number; userAt: number | null; at: number; show: Frame[]; end: number; endField: number; back: number; hidden: number }>(`
            await openTall();
            await opened();
            const field = fields().slice(-1)[0];
            focusField(field);
            const start = body().scrollTop;
            const hidden = body().scrollHeight - body().clientHeight;
            const k = keyboardUnder(field);
            let userAt = null;
            let at = -1;
            const show = await recordFrames(root(), body(), field, k, {
                after: showKeyboardAsIPad(k),
                each: (i, frames) => {
                    // On the way, once the body has moved 25px: the user scrolls it 15px back.
                    if (userAt !== null || frames[i].scrollTop < start + 25) return;
                    body().dispatchEvent(new WheelEvent('wheel', { deltaY: -15, bubbles: true, cancelable: true }));
                    body().scrollTop = frames[i].scrollTop - 15;
                    userAt = body().scrollTop;
                    at = i;
                },
            });
            // The frame the body is measured at, once the keyboard is up, may come after the last recorded.
            await nextFrame();
            await nextFrame();
            const end = body().scrollTop;
            const endField = field.getBoundingClientRect().bottom;
            hideKeyboard();
            await recordFrames(root(), body(), field, 0);
            await nextFrame();
            return JSON.stringify({ start, userAt, at, show, end, endField, back: body().scrollTop, hidden });
        `);
        expect(seen.userAt).not.toBeNull();
        // Within what the body holds past what it shows, so the scroll stays as the body's height is put back.
        expect(seen.userAt!).toBeLessThanOrEqual(seen.hidden);
        const after = seen.show.slice(seen.at + 1);
        const last = seen.show[seen.show.length - 1];
        // The keyboard had not come to rest yet.
        expect(after.some((f) => f.overlap < last.overlap)).toBe(true);
        // Held where the user took it while the keyboard moves.
        expect(after.filter((f) => f.overlap < last.overlap).every((f) => f.scrollTop === seen.userAt)).toBe(true);
        // Once it is up, the field the user left 15px lower is scrolled at once to 10px above the keyboard's top.
        expect(after.every((f) => f.scrollTop === seen.userAt || f.scrollTop === seen.end)).toBe(true);
        expect(seen.end).toBeGreaterThan(seen.userAt!);
        expect(Math.abs(seen.endField - (edge(last) - 10))).toBeLessThanOrEqual(1);
        expect(seen.back).toBe(seen.userAt);
    });
});

describe('the keyboard rising while the hub opens', () => {
    interface Opening {
        k: number;
        /** Whether the panel's open animation still ran as the will show was sent. */
        movingAtWill: boolean;
        /** Each frame from the will show, with whether the panel's open animation ran at it. */
        frames: (Frame & { opening: boolean; focused: boolean })[];
    }

    for (const phone of [false, true]) {
        it(`${phone ? "on a phone's sheet sliding up" : "in the desktop's box popping in"}, holds the body while the panel comes in, then moves it until the field is 10px above the keyboard's top`, () => {
            const seen = run<Opening>(`
                if (${phone}) phoneLayout();
                openDraft();
                // Past the frames where the hub draws its body and the panel takes
                // the focus as it opens, a field focused stays so.
                for (let i = 0; i < 3; i++) await nextFrame();
                const field = fields().slice(-1)[0];
                focusField(field);
                const movingAtWill = panelMoving();
                // The field stands midway as the panel comes in: half the window hides where it comes to.
                const k = Math.round(innerHeight / 2);
                const frames = await recordFrames(root(), body(), field, k, {
                    after: showKeyboardAsIPad(k),
                    each: (i, fs) => {
                        fs[i].opening = panelMoving();
                        fs[i].focused = document.activeElement === field;
                    },
                });
                return JSON.stringify({ k, movingAtWill, frames });
            `);
            expect(seen.movingAtWill).toBe(true);
            expect(seen.frames.every((f) => f.focused)).toBe(true);
            const opening = seen.frames.filter((f) => f.opening);
            expect(opening.length).toBeGreaterThan(0);
            expect(opening.every((f) => f.scrollTop === 0)).toBe(true);
            expect(rising(seen.frames.map((f) => f.scrollTop))).toBe(true);
            const rest = seen.frames[seen.frames.length - 1];
            expect(rest.scrollTop).toBeGreaterThan(0);
            expect(Math.abs(rest.field - (edge(rest) - 10))).toBeLessThanOrEqual(1);
        });
    }
});
