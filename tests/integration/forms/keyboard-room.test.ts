/**
 * Where the overlays stand while the on-screen keyboard covers the window,
 * in the running E2E vault, the keyboard told as Obsidian mobile tells it
 * (`helpers/keyboard.ts`). What the stylesheet lays out by the overlap is
 * read once the overlap's transition has ended.
 *
 * - The desktop's centered box stands in the window's middle, 32px kept
 *   above and below it, and rises only by what it lacks to end 32px above
 *   the keyboard's top, as far up as 32px from the window's top. Its top is
 *   max(32, min((H - h) / 2, H - K - 32 - h)), for the window's height H,
 *   the keyboard's K and the box's h. A low box (the delete's question) and
 *   a tall one (the hub) are each seen under a keyboard that ends below the
 *   box (it does not move), one that would cover its lower part (it ends
 *   32px above the keyboard), and one that puts it at 32px, and back where
 *   it stood once the keyboard goes. The box keeps its height under each.
 *   A box holding more than the window less 64px (the hub of a row with
 *   many properties, in a window made too low for it) is that tall, at 32px
 *   from the top, under keyboards of any height as with none.
 * - A phone's sheet stands on the keyboard: it keeps its bottom at the
 *   window's and takes the overlap as a padding of its own, its height at
 *   most the window's less the room kept above it, 120px less the overlap
 *   and 32px at least. A sheet with much in it (the hub, the filter menu
 *   anchored to a view's toolbar, the hub of the row with many properties in
 *   the low window) leaves max(32, 120 - K) above it; one with
 *   little in it (the delete's question) is as tall as what it holds, which
 *   stands right on the keyboard.
 * - A keyboard covering 31px of the window is a keyboard as any other: the
 *   sheet takes its 31px as a padding, its contents raised by that much.
 *
 * The heights of the window and of each overlay are read as the test runs,
 * and the keyboard's heights are made from them, so the cases hold for the
 * window the vault is opened in. The hub is as tall as its General tab
 * makes it, whichever tab is chosen, so a hub taller than the room it is
 * given is made by lowering the window (600px inside), put back after.
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
    '- [ ] 背の高い行 @2031-01-21',
    ...Array.from({ length: 8 }, (_, i) => `\t- p${i + 1}:: v${i + 1}`),
    '',
].join('\n');

/** The view whose toolbar's filter menu is opened, kept under this name by `openView`. */
const VIEW = 'kr-kanban';

/** The inner height a window is lowered to for a hub taller than the room the window gives it. */
const LOW_WINDOW = 600;

const PRELUDE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plugin = app.plugins.plugins['obsidian-task-viewer'];
${UNTIL}
${MENUS}
${KEYBOARD}
const root = () => document.querySelector('.tv-overlay:not(.is-closing)');
const panel = () => root()?.querySelector('.tv-overlay__panel') ?? null;
const rowNamed = name => plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith(name));
const row = () => rowNamed('名前のある行');
/** Wait for an overlay to be open and its panel's open animation to have ended. */
const opened = async () => {
    await until(() => panel());
    await until(() => panel().getAnimations().every(a => a.playState !== 'running'), 3000,
        () => panel().getAnimations().map(a => a.animationName ?? a.transitionProperty).join(' '));
};
/** The hub, opened on the note's row, or on the one named. */
const openHub = async (name = '名前のある行') => {
    plugin.openTaskHub(rowNamed(name).id);
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
/** The window's inner height set to \`height\`; answers what puts it back. */
const lowWindow = async height => {
    const win = require('electron').remote.getCurrentWindow();
    const bounds = win.getBounds();
    const was = innerHeight;
    win.setBounds({ ...bounds, height: bounds.height - (innerHeight - height) });
    await until(() => innerHeight === height, 3000, () => 'the window is ' + innerHeight + 'px high');
    return async () => {
        win.setBounds(bounds);
        await until(() => innerHeight === was, 3000, () => 'the window is ' + innerHeight + 'px high');
    };
};
const rectOf = el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
`;

/** What opens each overlay seen, in a snippet after the prelude. */
const OPEN = {
    hub: () => 'await openHub();',
    /** The hub of a row with many properties, taller than a sheet with no keyboard holds. */
    tallHub: () => `await openHub(${JSON.stringify('背の高い行')});`,
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
    /** The box's height once the overlap had settled. */
    height: number;
    /** The box's top once the keyboard had gone and the overlap settled at 0. */
    back: number;
    /** The box's height once the keyboard had gone. */
    backHeight: number;
}

interface CenteredBox {
    /** The window's innerHeight. */
    H: number;
    /** The box's height as it opened. */
    h: number;
    /** The box's top as it opened, with no keyboard. */
    top: number;
    /** Under a keyboard ending below the box, one that would cover its lower part, and one putting it at the window's top. */
    clear: BoxUnder;
    covering: BoxUnder;
    atTop: BoxUnder;
}

/**
 * Open the overlay `open` names as the desktop's centered box, and tell it
 * three keyboards one after the other, each going before the next comes.
 * Their heights are made from the room the box leaves in the window (R,
 * the window's height less the 64px kept and the box's): R/2 - 20 ends
 * more than 32px below the box, 3R/4 would cover its lower part, and
 * R + 100 puts it at 32px.
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
            const { top, height } = rectOf(panel());
            hideKeyboard();
            await overlapSettled(root(), 0);
            const back = rectOf(panel());
            out[name] = { k, top, height, back: back.top, backHeight: back.height };
        }
        return JSON.stringify(out);
    `);
}

/** The centered box's top under a keyboard `k` tall: centred, raised to end 32px above the keyboard, 32px from the top at most. */
function boxTop(H: number, h: number, k: number): number {
    return Math.max(32, Math.min((H - h) / 2, H - k - 32 - h));
}

function expectBoxUnderKeyboards(seen: CenteredBox): void {
    expect(seen.top).toBeCloseTo((seen.H - seen.h) / 2, 0);
    for (const under of [seen.clear, seen.covering, seen.atTop]) {
        expect(under.top).toBeGreaterThanOrEqual(boxTop(seen.H, seen.h, under.k) - 1);
        expect(under.top).toBeLessThanOrEqual(boxTop(seen.H, seen.h, under.k) + 1);
        // The box keeps its height under the keyboard, even the one putting
        // it at 32px, whose overlap and the box together are more than the
        // room the box leaves.
        expect(Math.abs(under.height - seen.h)).toBeLessThanOrEqual(1);
        expect(Math.abs(under.back - seen.top)).toBeLessThanOrEqual(1);
        expect(Math.abs(under.backHeight - seen.h)).toBeLessThanOrEqual(1);
    }
    // The keyboard that ends more than 32px below the box leaves it where it stood.
    expect(Math.abs(seen.clear.top - seen.top)).toBeLessThanOrEqual(1);
    // The one that would cover its lower part raises it to end 32px above
    // the keyboard, still below 32px from the top; the last puts it there.
    expect(Math.abs(seen.covering.top + seen.h - (seen.H - seen.covering.k - 32))).toBeLessThanOrEqual(1);
    expect(seen.covering.top).toBeGreaterThan(33);
    expect(seen.covering.top).toBeLessThan(seen.top - 1);
    expect(seen.atTop.top).toBeCloseTo(32, 0);
}

/** Where a box at its greatest height stood with no keyboard, under keyboards, and once each went. */
interface TallBox {
    H: number;
    /** The box's top and height as it opened, with no keyboard. */
    top: number;
    h: number;
    /** What its body holds past what it shows (px). */
    hidden: number;
    under: BoxUnder[];
}

/**
 * Open the overlay `open` names as the desktop's centered box, in the
 * window lowered to `LOW_WINDOW`, and tell it keyboards covering a little
 * of the window, half of it, and nearly all of it, each going before the
 * next comes.
 */
function tallUnderKeyboards(open: keyof typeof OPEN): TallBox {
    return run<TallBox>(`
        const putBack = await lowWindow(${LOW_WINDOW});
        try {
            ${OPEN[open]()}
            const H = innerHeight;
            const first = rectOf(panel());
            const body = panel().querySelector('.tv-overlay__body');
            const hidden = body.scrollHeight - body.clientHeight;
            const under = [];
            for (const k of [40, Math.round(H / 2), H - 50]) {
                showKeyboard(k);
                await overlapSettled(root(), k);
                const { top, height } = rectOf(panel());
                hideKeyboard();
                await overlapSettled(root(), 0);
                const back = rectOf(panel());
                under.push({ k, top, height, back: back.top, backHeight: back.height });
            }
            return JSON.stringify({ H, top: first.top, h: first.height, hidden, under });
        } finally {
            await putBack();
        }
    `);
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
 * `full` one tall enough for the sheet to reach its greatest height with
 * 32px left above it (100px past the room it leaves under the window's
 * height less 120px, 100px at least), `half` one half as tall as that room,
 * so it stays as tall as what it holds, or a keyboard as tall as the number
 * given. `low` opens it in the window lowered to `LOW_WINDOW`, put back once
 * the sheet has been read.
 */
function sheetUnderKeyboard(open: keyof typeof OPEN, reach: 'full' | 'half' | number, low = false): SheetUnder {
    return run<SheetUnder>(`
        const putBack = ${low} ? await lowWindow(${LOW_WINDOW}) : null;
        try {
            phoneLayout();
            ${OPEN[open]()}
            const H = innerHeight;
            const footPad = () => { const foot = panel().querySelector('.tv-overlay__foot'); return foot ? parseFloat(getComputedStyle(foot).paddingBottom) : null; };
            const first = rectOf(panel());
            const footFirst = footPad();
            const room = H - 120 - first.height;
            const reach = ${JSON.stringify(reach)};
            const k = reach === 'full' ? Math.max(100, Math.round(room + 100)) : reach === 'half' ? Math.round(room / 2) : reach;
            showKeyboard(k);
            await overlapSettled(root(), k);
            const under = rectOf(panel());
            const contentsBottom = under.bottom - parseFloat(getComputedStyle(panel()).paddingBottom);
            return JSON.stringify({ H, first, k, under, contentsBottom, foot: { first: footFirst, under: footPad() } });
        } finally {
            await putBack?.();
        }
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

describe("the desktop's centered box stays in the window's middle and rises only to end 32px above the keyboard, at 32px from the top at most", () => {
    it('a low box (the delete\'s question)', () => {
        const seen = underKeyboards('question');
        expect(seen.h).toBeLessThan(seen.H / 2);
        expectBoxUnderKeyboards(seen);
    });

    it('a tall box (the hub of a row with many properties)', () => {
        const seen = underKeyboards('tallHub');
        expect(seen.h).toBeGreaterThan(seen.H / 2);
        // Room enough under the hub for the three keyboards to differ.
        expect(seen.H - 64 - seen.h).toBeGreaterThan(80);
        expectBoxUnderKeyboards(seen);
    });

    it('a box holding more than the window less 64px (the hub of a row with many properties) keeps that height at 32px from the top', () => {
        const seen = tallUnderKeyboards('tallHub');
        expect(seen.H).toBe(LOW_WINDOW);
        // With no keyboard it is as tall as the window less the 32px kept
        // above and below it, its body scrolling what it holds past that.
        expect(seen.hidden).toBeGreaterThan(0);
        expect(seen.h).toBeCloseTo(seen.H - 64, 0);
        expect(seen.top).toBeCloseTo(32, 0);
        for (const under of seen.under) {
            expect(under.top).toBeCloseTo(boxTop(seen.H, seen.h, under.k), 0);
            expect(under.top).toBeCloseTo(32, 0);
            expect(under.height).toBeCloseTo(seen.H - 64, 0);
            expect(under.back).toBeCloseTo(32, 0);
            expect(under.backHeight).toBeCloseTo(seen.H - 64, 0);
        }
    });
});

/** The room a sheet at its greatest height leaves above it under a keyboard `k` tall. */
function roomAbove(k: number): number {
    return Math.max(32, 120 - k);
}

describe("a phone's sheet stands on the keyboard, the room above it giving way to the keyboard down to 32px", () => {
    it('the hub reaching its greatest height leaves 32px above it, its contents right on the keyboard', () => {
        const seen = sheetUnderKeyboard('hub', 'full');
        expect(seen.first.bottom).toBeCloseTo(seen.H, 0);
        expect(seen.k).toBeGreaterThanOrEqual(88);
        expect(seen.under.top).toBeCloseTo(roomAbove(seen.k), 0);
        expect(seen.under.top).toBeCloseTo(32, 0);
        expect(seen.under.bottom).toBeCloseTo(seen.H, 0);
        expect(seen.contentsBottom).toBeCloseTo(seen.H - seen.k, 0);
    });

    it('a hub taller than the window less 120px leaves 120px less the overlap above it under a low keyboard', () => {
        const seen = sheetUnderKeyboard('tallHub', 56, true);
        expect(seen.H).toBe(LOW_WINDOW);
        // With no keyboard it stands at its greatest height, 120px left above it.
        expect(seen.first.top).toBeCloseTo(120, 0);
        expect(seen.under.top).toBeCloseTo(roomAbove(seen.k), 0);
        expect(seen.under.top).toBeCloseTo(64, 0);
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

        it('reaching its greatest height leaves 32px above it', () => {
            const seen = sheetUnderKeyboard('filter', 'full');
            expect(seen.first.bottom).toBeCloseTo(seen.H, 0);
            expect(seen.under.top).toBeCloseTo(roomAbove(seen.k), 0);
            expect(seen.under.top).toBeCloseTo(32, 0);
            expect(seen.contentsBottom).toBeCloseTo(seen.H - seen.k, 0);
        });
    });
});

describe('a keyboard covering 31px of the window', () => {
    interface Read {
        panel: { top: number; height: number };
        /** Where what the sheet holds ends: its bottom, less the padding the overlap gives it. */
        contentsBottom: number;
    }

    interface Seen {
        before: Read;
        after: Read;
        set: string;
        overlap: string;
        moving: boolean;
    }

    it("raises the phone's sheet's contents by 31px, the overlap set", () => {
        const seen = run<Seen>(`
            phoneLayout();
            await openHub();
            const read = () => {
                const p = rectOf(panel());
                return {
                    panel: { top: p.top, height: p.height },
                    contentsBottom: p.bottom - parseFloat(getComputedStyle(panel()).paddingBottom),
                };
            };
            const before = read();
            showKeyboard(31);
            const set = root().style.getPropertyValue('--tv-keyboard-overlap');
            await overlapSettled(root(), 31);
            return JSON.stringify({ before, after: read(), set, overlap: overlapOf(root()), moving: overlapMoving(root()) });
        `);
        expect(seen.set).toBe('31px');
        expect(seen.overlap).toBe('31px');
        expect(seen.moving).toBe(false);
        // What the sheet holds ends 31px higher, on the keyboard. The hub (a
        // row's, with no row of buttons) is lower than the sheet's greatest
        // height, so the sheet grows by the overlap, its bottom at the window's.
        expect(seen.after.contentsBottom).toBeCloseTo(seen.before.contentsBottom - 31, 0);
        expect(seen.after.panel.height).toBeCloseTo(seen.before.panel.height + 31, 0);
        expect(seen.after.panel.top).toBeCloseTo(seen.before.panel.top - 31, 0);
    });
});
