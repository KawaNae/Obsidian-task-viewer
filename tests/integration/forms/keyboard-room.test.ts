/**
 * Where the overlays stand while the on-screen keyboard covers the window,
 * in the running E2E vault, the keyboard told as Obsidian mobile tells it
 * (`helpers/keyboard.ts`). What the stylesheet lays out by the overlap is
 * read once the overlap's transition has ended.
 *
 * - The desktop's centered box keeps 32px above and below it, the keyboard's
 *   overlap added below: it stands centred in the room from 32px under the
 *   window's top to 32px above the keyboard's, and at 32px from the top when
 *   that room is shorter than it. Its top is
 *   max(32, 32 + (H - 64 - K - h) / 2), for the window's height H, the
 *   keyboard's K and the box's h. A low box (the delete's question) and a
 *   tall one (the hub) are each seen under a keyboard that ends below the
 *   box, one that covers its lower part, and one that puts it at 32px, and
 *   back where it stood once the keyboard goes.
 * - A phone's sheet stands on the keyboard: it keeps its bottom at the
 *   window's and takes the overlap as a padding of its own, its height at
 *   most the window's less 120px. A sheet with much in it (the hub, the
 *   filter menu anchored to a view's toolbar) leaves 120px above it; one
 *   with little in it (the delete's question) is as tall as what it holds,
 *   which stands right on the keyboard.
 * - A keyboard covering 31px of the window is taken as none: nothing is laid
 *   out by it, the sheet's contents not raised.
 *
 * The heights of the window and of each overlay are read as the test runs,
 * and the keyboard's heights are made from them, so the cases hold for the
 * window the vault is opened in.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/forms/keyboard-room.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, writeIndexedTestFile } from '../helpers/test-file-manager';
import { closeViews, openView, tr } from '../helpers/view-helper';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';
import { MENUS } from '../helpers/menus';
import { KEYBOARD, resetKeyboard } from '../helpers/keyboard';

const TEST_FILE = 'test-int-keyboard-room.md';

const NOTE = [
    '# 見出し',
    '- [ ] 名前のある行 @2031-01-21',
    '',
].join('\n');

/** The view whose toolbar's filter menu is opened, kept under this name by `openView`. */
const VIEW = 'kr-kanban';

const PRELUDE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plugin = app.plugins.plugins['obsidian-task-viewer'];
${UNTIL}
${MENUS}
${KEYBOARD}
const root = () => document.querySelector('.tv-overlay:not(.is-closing)');
const panel = () => root()?.querySelector('.tv-overlay__panel') ?? null;
const row = () => plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith('名前のある行'));
/** Wait for an overlay to be open and its panel's open animation to have ended. */
const opened = async () => {
    await until(() => panel());
    await until(() => panel().getAnimations().every(a => a.playState !== 'running'), 3000,
        () => panel().getAnimations().map(a => a.animationName ?? a.transitionProperty).join(' '));
};
/** The hub, opened on the note's row. */
const openHub = async () => {
    plugin.openTaskHub(row().id);
    await opened();
};
/** The delete's question, chosen from the row's card menu by its title, as a user chooses it. */
const openQuestion = async title => {
    // The card menu the hub's cards open, made as a hub first opens.
    if (!plugin.taskHub.cards) {
        await openHub();
        panel().querySelector('.tv-overlay__close').click();
        await until(() => !document.querySelector('.tv-overlay'));
    }
    await plugin.taskHub.cards.menuHandler.showContextMenu(0, 0, row());
    menuItem(one => one.titleEl?.textContent === title);
    await until(() => root()?.querySelector('.tv-overlay__panel.tv-ask'));
    await opened();
};
/** The filter menu of the kanban view's toolbar, anchored to its button. */
const openFilter = async () => {
    const el = window.__tvE2E[${JSON.stringify(VIEW)}].view.contentEl;
    el.querySelector('.view-toolbar__btn--icon:has(svg.lucide-filter)').click();
    await until(() => root()?.querySelector('.tv-overlay__panel.filter-popover'));
    await opened();
};
const rectOf = el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
const frame = () => new Promise(r => requestAnimationFrame(r));
`;

/** What opens each overlay seen, in a snippet after the prelude. */
const OPEN = {
    hub: () => 'await openHub();',
    question: () => `await openQuestion(${JSON.stringify(tr('menu.deleteTask'))});`,
    filter: () => 'await openFilter();',
} as const;

/** Run `body` (statements, ending in a `return`) in Obsidian after the prelude. */
function run<T>(body: string): T {
    const result = obsidianEval(`(async () => { ${PRELUDE}\n${body}\n})()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

/** Where the centered box stood under one keyboard, and once it went. */
interface BoxUnder {
    /** The keyboard's height told. */
    k: number;
    /** The box's top once the overlap had settled. */
    top: number;
    /** The box's top once the keyboard had gone and the overlap settled at 0. */
    back: number;
}

interface CenteredBox {
    /** The window's innerHeight. */
    H: number;
    /** The box's height as it opened. */
    h: number;
    /** The box's top as it opened, with no keyboard. */
    top: number;
    /** Under a keyboard ending below the box, one covering its lower part, and one putting it at the window's top. */
    clear: BoxUnder;
    covering: BoxUnder;
    atTop: BoxUnder;
}

/**
 * Open the overlay `open` names as the desktop's centered box, and tell it
 * three keyboards one after the other, each going before the next comes.
 * Their heights are made from the room the box leaves in the window (R,
 * the window's height less the 64px kept and the box's): R/2 - 20 ends
 * below the box, 3R/4 covers its lower part, and R + 100 puts it at 32px.
 */
function underKeyboards(open: keyof typeof OPEN): CenteredBox {
    return run<CenteredBox>(`
        ${OPEN[open]()}
        const H = innerHeight;
        const first = rectOf(panel());
        const R = H - 64 - first.height;
        const heights = { clear: Math.round(R / 2 - 20), covering: Math.round(R * 3 / 4), atTop: Math.round(R + 100) };
        const out = { H, h: first.height, top: first.top };
        for (const [name, k] of Object.entries(heights)) {
            showKeyboard(k);
            await overlapSettled(root(), k);
            const top = rectOf(panel()).top;
            hideKeyboard();
            await overlapSettled(root(), 0);
            out[name] = { k, top, back: rectOf(panel()).top };
        }
        return JSON.stringify(out);
    `);
}

/** The centered box's top under a keyboard `k` tall, as the stylesheet lays it out now. */
function boxTop(H: number, h: number, k: number): number {
    return Math.max(32, 32 + (H - 64 - k - h) / 2);
}

function expectBoxUnderKeyboards(seen: CenteredBox): void {
    expect(seen.top).toBeCloseTo((seen.H - seen.h) / 2, 0);
    for (const under of [seen.clear, seen.covering, seen.atTop]) {
        expect(under.top).toBeGreaterThanOrEqual(boxTop(seen.H, seen.h, under.k) - 1);
        expect(under.top).toBeLessThanOrEqual(boxTop(seen.H, seen.h, under.k) + 1);
        expect(Math.abs(under.back - seen.top)).toBeLessThanOrEqual(1);
    }
    // The keyboard that ends below the box raises it now, by half its height.
    expect(seen.clear.top).toBeLessThan(seen.top - 1);
    // The one covering its lower part leaves it above 32px; the last puts it there.
    expect(seen.covering.top).toBeGreaterThan(33);
    expect(seen.atTop.top).toBeCloseTo(32, 0);
}

/** Where a phone's sheet stood with no keyboard, and under one. */
interface SheetUnder {
    H: number;
    /** The sheet with no keyboard: as tall as what it holds, up to the window's height less 120px. */
    first: { top: number; bottom: number; height: number };
    /** The keyboard's height told. */
    k: number;
    /** The sheet once the overlap had settled. */
    under: { top: number; bottom: number; height: number };
    /** Where what the sheet holds ends: its bottom, less the padding the overlap gives it. */
    contentsBottom: number;
    /** The room under the sheet's row of buttons, with no keyboard and under it; null with no row. */
    foot: { first: number | null; under: number | null };
}

/**
 * Open the overlay `open` names as a phone's sheet and tell it a keyboard:
 * `full` one tall enough for the sheet to reach its greatest height (100px
 * past it), `half` one half as tall as the room the sheet leaves under its
 * greatest height, so it stays as tall as what it holds.
 */
function sheetUnderKeyboard(open: keyof typeof OPEN, reach: 'full' | 'half'): SheetUnder {
    return run<SheetUnder>(`
        phoneLayout();
        ${OPEN[open]()}
        const H = innerHeight;
        const footPad = () => { const foot = panel().querySelector('.tv-overlay__foot'); return foot ? parseFloat(getComputedStyle(foot).paddingBottom) : null; };
        const first = rectOf(panel());
        const footFirst = footPad();
        const room = H - 120 - first.height;
        const k = ${JSON.stringify(reach)} === 'full' ? Math.max(100, Math.round(room + 100)) : Math.round(room / 2);
        showKeyboard(k);
        await overlapSettled(root(), k);
        const under = rectOf(panel());
        const contentsBottom = under.bottom - parseFloat(getComputedStyle(panel()).paddingBottom);
        return JSON.stringify({ H, first, k, under, contentsBottom, foot: { first: footFirst, under: footPad() } });
    `);
}

beforeAll(async () => {
    // Focus moves need the window to have the focus.
    if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']);
    await writeIndexedTestFile(TEST_FILE, NOTE);
});

afterEach(() => {
    resetKeyboard();
    run(`
        document.querySelectorAll('.tv-overlay:not(.is-closing) .tv-overlay__close').forEach(b => b.click());
        plugin.menuPresenter.dismiss();
        await until(() => !document.querySelector('.tv-overlay'));
        return 'true';
    `);
});

afterAll(async () => {
    await closeViews();
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

describe("the desktop's centered box stands centred above the keyboard, at 32px from the top at most", () => {
    it('a low box (the delete\'s question)', () => {
        const seen = underKeyboards('question');
        expect(seen.h).toBeLessThan(seen.H / 2);
        expectBoxUnderKeyboards(seen);
    });

    it('a tall box (the hub)', () => {
        const seen = underKeyboards('hub');
        expect(seen.h).toBeGreaterThan(seen.H / 2);
        // Room enough under the hub for the three keyboards to differ.
        expect(seen.H - 64 - seen.h).toBeGreaterThan(80);
        expectBoxUnderKeyboards(seen);
    });
});

describe("a phone's sheet stands on the keyboard, 120px left above it at least", () => {
    it('the hub reaching its greatest height leaves 120px above it, its contents right on the keyboard', () => {
        const seen = sheetUnderKeyboard('hub', 'full');
        expect(seen.first.bottom).toBeCloseTo(seen.H, 0);
        expect(seen.under.top).toBeCloseTo(120, 0);
        expect(seen.under.bottom).toBeCloseTo(seen.H, 0);
        expect(seen.contentsBottom).toBeCloseTo(seen.H - seen.k, 0);
    });

    it('a low question is as tall as what it holds, which stands right on the keyboard', () => {
        const seen = sheetUnderKeyboard('question', 'half');
        expect(seen.k).toBeGreaterThan(50);
        expect(seen.first.bottom).toBeCloseTo(seen.H, 0);
        // The row of buttons keeps the room under it for the window's bottom
        // (24px) with no keyboard, and only the 12px it has above it over one.
        expect(seen.foot).toEqual({ first: 24, under: 12 });
        const held = seen.first.height - 12;
        expect(seen.under.height).toBeCloseTo(held + seen.k, 0);
        expect(seen.under.top).toBeCloseTo(seen.H - seen.k - held, 0);
        expect(seen.under.top).toBeGreaterThan(121);
        expect(seen.contentsBottom).toBeCloseTo(seen.H - seen.k, 0);
    });

    describe('the filter menu anchored to a view\'s toolbar, a sheet on the phone', () => {
        beforeAll(() => { openView(VIEW, 'kanban-view'); });

        it('reaching its greatest height leaves 120px above it', () => {
            const seen = sheetUnderKeyboard('filter', 'full');
            expect(seen.first.bottom).toBeCloseTo(seen.H, 0);
            expect(seen.under.top).toBeCloseTo(120, 0);
            expect(seen.contentsBottom).toBeCloseTo(seen.H - seen.k, 0);
        });
    });
});

describe('a keyboard covering 31px of the window', () => {
    interface Seen {
        before: { panel: { top: number; height: number }; bodyBottom: number };
        after: { panel: { top: number; height: number }; bodyBottom: number };
        set: string;
        overlap: string;
        moving: boolean;
    }

    it("is taken as none by the phone's sheet: no overlap is set, and its contents stay where they stood", () => {
        const seen = run<Seen>(`
            phoneLayout();
            await openHub();
            const read = () => {
                const p = rectOf(panel());
                return { panel: { top: p.top, height: p.height }, bodyBottom: rectOf(panel().querySelector('.tv-overlay__body')).bottom };
            };
            const before = read();
            showKeyboard(31);
            const set = root().style.getPropertyValue('--tv-keyboard-overlap');
            await frame();
            await frame();
            return JSON.stringify({ before, after: read(), set, overlap: overlapOf(root()), moving: overlapMoving(root()) });
        `);
        expect(seen.set).toBe('');
        expect(seen.overlap).toBe('0px');
        expect(seen.moving).toBe(false);
        expect(seen.after).toEqual(seen.before);
    });
});
