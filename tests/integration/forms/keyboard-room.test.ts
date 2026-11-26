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
 * - The box moves there, and back, over the whole of the keyboard's move,
 *   frame by frame (the panel's top as it is seen, `recordFrames`): from the
 *   frame after the keyboard is told, toward where it goes only, still on
 *   its way 200ms on, and slowing to its stop. The keyboard going midway has
 *   it move on from where it is seen, no frame moving it further than the
 *   curve can (`frameBound`), back to where it stood. The bounds are kept
 *   wide (times at least, moves only one way or under a bound that grows
 *   with a frame's length), so frames dropped under load still pass.
 * - A box opened over the keyboard (the delete's question, the hub), its
 *   root laid out by the time the keyboard's room attaches, is laid out
 *   where the keyboard puts it from its first frame and drawn up from the
 *   middle by its shift, which moves to 0 over the keyboard's move.
 * - A phone's sheet stands on the keyboard: it keeps its bottom at the
 *   window's and takes the overlap as a padding of its own, its height at
 *   most the window's less the room kept above it, 120px less the overlap
 *   and 32px at least. A sheet with much in it (the hub, the filter menu
 *   anchored to a view's toolbar, the hub of the row with many properties in
 *   the low window) leaves max(32, 120 - K) above it; one with
 *   little in it (the delete's question) is as tall as what it holds, which
 *   stands right on the keyboard. It moves by the overlap alone, the box's
 *   shift 0 at every frame.
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
const body = () => panel()?.querySelector('.tv-overlay__body') ?? null;
/** How far the box is drawn from where it is laid out (\`--tv-box-shift\`, px). */
const shiftOf = () => parseFloat(getComputedStyle(root()).getPropertyValue('--tv-box-shift')) || 0;
/** Close the overlay open, and wait for it to have gone. */
const closeOverlay = async () => {
    panel().querySelector('.tv-overlay__close').click();
    await until(() => !document.querySelector('.tv-overlay'));
};
/**
 * What is seen at each animation frame from the next one on, while \`open()\`
 * opens an overlay: its panel's top as laid out (\`offsetTop\` from the
 * root's top, which neither the shift nor the open animation moves), the
 * shift, and whether the panel's open animation runs. Frames with no panel
 * yet are not recorded. Resolves to the frames once the open animation has
 * ended and nothing the root moves with the keyboard moves.
 */
const recordOpening = open => new Promise((resolve, reject) => {
    const frames = [];
    const t0 = performance.now();
    const step = () => {
        const p = panel();
        if (p) {
            frames.push({
                t: performance.now() - t0,
                laidOut: root().getBoundingClientRect().top + p.offsetTop,
                shift: shiftOf(),
                opening: p.getAnimations().some(a => a.playState === 'running'),
            });
        }
        const last = frames[frames.length - 1];
        if (frames.length >= 3 && !last.opening && !keyboardMoving(root())) resolve(frames);
        else if (performance.now() - t0 > 3000) reject(new Error('timed out recording the opening: ' + frames.length + ' frames'));
        else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    Promise.resolve().then(open).catch(reject);
});
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

/** One frame as `recordFrames` saw it, of what is read here. */
interface Frame {
    /** When it was seen, from the keyboard told (ms). */
    t: number;
    overlap: number;
    /** The panel's top as it is seen. */
    panelTop: number;
}

/**
 * The most the box's top may move between two frames `dt` ms apart, the
 * box moving `distance` px over the keyboard's move (250ms, the stylesheet's
 * cubic-bezier(0.25, 0.1, 0.25, 1)). That curve is at its steepest 2.29
 * times its mean, so the box covers at most 2.29 * distance / 250 px a ms.
 * The frames' times are read in their callbacks, a few ms off the times the
 * transition was sampled at, so 4ms is added to `dt`, and a quarter and 1px
 * over all. A frame dropped under load widens `dt` and so the bound with it;
 * on the Mac at 120 frames a second a move of 168px took 13 to 15px a frame
 * at most, under the bound's 22px. A box laid out where it goes at once
 * covers the whole distance in one frame, far over it.
 */
function frameBound(distance: number, dt: number): number {
    return 2.29 * distance / 250 * (dt + 4) * 1.25 + 1;
}

/** How far each frame's top moved from the one before, from `from` for the first. */
function stepsOf(frames: Frame[], from: number): number[] {
    return frames.map((f, i) => f.panelTop - (i === 0 ? from : frames[i - 1].panelTop));
}

/**
 * Expect the box's move over `frames`, from `from` to `to`: it has moved by
 * the second frame and is not where it goes at the first, it moves only
 * toward `to`, it is still more than 0.5px off `to` at a frame 200ms or more
 * after the keyboard was told, it stops at `to`, and the last frame it moved
 * at moved less than the frame it moved most at.
 */
function expectOneCurve(frames: Frame[], from: number, to: number): void {
    const toward = Math.sign(to - from);
    expect(Math.abs(to - from)).toBeGreaterThan(50);
    expect(frames.length).toBeGreaterThan(2);
    expect(Math.abs(frames[0].panelTop - to)).toBeGreaterThan(1);
    expect(Math.abs(frames[1].panelTop - from)).toBeGreaterThan(0.5);
    const steps = stepsOf(frames, from);
    for (const step of steps) expect(step * toward).toBeGreaterThanOrEqual(-0.5);
    expect(frames.some((f) => f.t >= 200 && Math.abs(f.panelTop - to) > 0.5)).toBe(true);
    expect(Math.abs(frames[frames.length - 1].panelTop - to)).toBeLessThanOrEqual(1);
    const moved = steps.map(Math.abs).filter((s) => s > 0.01);
    expect(moved[moved.length - 1]).toBeLessThan(Math.max(...moved));
}

describe("the desktop's centered box moves over the whole of the keyboard's move, from the frame after it is told, slowing to its stop", () => {
    /** The low box (the delete's question) under a keyboard putting it at 32px, the keyboard rising and going, frame by frame. */
    interface Move {
        H: number;
        h: number;
        /** The box's top as it opened, with no keyboard. */
        top: number;
        k: number;
        show: Frame[];
        hide: Frame[];
    }

    it("rises from where it stands to where the keyboard puts it, and goes back the same way as the keyboard goes", () => {
        const seen = run<Move>(`
            ${OPEN.question()}
            const H = innerHeight;
            const first = rectOf(panel());
            const k = Math.round(H - 64 - first.height + 100);
            showKeyboard(k);
            const show = await recordFrames(root(), body(), null, k);
            hideKeyboard();
            const hide = await recordFrames(root(), body(), null, 0);
            return JSON.stringify({ H, h: first.height, top: first.top, k, show, hide });
        `);
        const rest = boxTop(seen.H, seen.h, seen.k);
        expect(rest).toBeCloseTo(32, 0);
        expectOneCurve(seen.show, seen.top, rest);
        expectOneCurve(seen.hide, rest, seen.top);
    });

    it('turned back midway by the keyboard going, moves on from where it is seen, never jumping a frame, and stops where it stood', () => {
        const seen = run<Move & { hidAt: number }>(`
            ${OPEN.question()}
            const H = innerHeight;
            const first = rectOf(panel());
            const k = Math.round(H - 64 - first.height + 100);
            let hidAt = -1;
            showKeyboard(k);
            // The keyboard goes at the first frame some tens of ms on, the box midway.
            const frames = await recordFrames(root(), body(), null, 0, {
                each: (i, fs) => {
                    if (hidAt >= 0 || fs[i].t < 40) return;
                    hideKeyboard();
                    hidAt = i;
                },
            });
            return JSON.stringify({ H, h: first.height, top: first.top, k, show: frames, hide: [], hidAt });
        `);
        const rest = boxTop(seen.H, seen.h, seen.k);
        const frames = seen.show;
        expect(seen.hidAt).toBeGreaterThanOrEqual(0);
        const turn = frames[seen.hidAt].panelTop;
        // Midway: moved off where it stood, and short of where the keyboard put it.
        expect(turn).toBeLessThan(seen.top - 1);
        expect(turn).toBeGreaterThan(rest + 1);
        const distance = seen.top - rest;
        frames.forEach((f, i) => {
            const before = i === 0 ? null : frames[i - 1];
            if (before) expect(Math.abs(f.panelTop - before.panelTop)).toBeLessThanOrEqual(frameBound(distance, f.t - before.t));
        });
        // Up until it turns, then down only, to where it stood.
        const low = frames.reduce((at, f, i) => (f.panelTop < frames[at].panelTop ? i : at), 0);
        expect(low).toBeGreaterThanOrEqual(seen.hidAt);
        const steps = stepsOf(frames, seen.top);
        steps.forEach((s, i) => expect(i <= low ? s : -s).toBeLessThanOrEqual(0.5));
        expect(Math.abs(frames[frames.length - 1].panelTop - seen.top)).toBeLessThanOrEqual(1);
    });
});

/** Each frame `recordOpening` saw. */
interface OpeningFrame {
    t: number;
    /** The panel's top as laid out (px from the window's top). */
    laidOut: number;
    shift: number;
    opening: boolean;
}

describe("the desktop's centered box opened over the keyboard", () => {
    interface Opened {
        H: number;
        /** The box's height, read as it opened with no keyboard first. */
        h: number;
        k: number;
        frames: OpeningFrame[];
        /** The box's top once it has opened and nothing moves. */
        rest: number;
    }

    /**
     * Open the overlay `open` names with no keyboard to read its height, close
     * it, tell a keyboard putting it at 32px, and open it again, frame by frame.
     */
    function openOverKeyboard(open: 'hub' | 'question', reopen: string): Opened {
        return run<Opened>(`
            ${OPEN[open]()}
            const H = innerHeight;
            const h = rectOf(panel()).height;
            await closeOverlay();
            const k = Math.round(H - 64 - h + 100);
            showKeyboard(k);
            const frames = await recordOpening(async () => { ${reopen} });
            return JSON.stringify({ H, h, k, frames, rest: rectOf(panel()).top });
        `);
    }

    /** What opens each box again over the keyboard, in the snippet. */
    const REOPEN = {
        question: `
            await plugin.taskHub.cards.menuHandler.showContextMenu(0, 0, row());
            menuItem(one => one.titleEl?.textContent === ${JSON.stringify(tr('menu.deleteTask'))});
        `,
        hub: 'plugin.openTaskHub(row().id);',
    } as const;

    for (const [open, name] of [['question', "the delete's question"], ['hub', 'the hub']] as const) {
        it(`${name}, its root laid out by the time it attaches, is laid out where the keyboard puts it from its first frame and drawn up from the middle over the keyboard's move`, () => {
            const seen = openOverKeyboard(open, REOPEN[open]);
            const to = boxTop(seen.H, seen.h, seen.k);
            const middle = (seen.H - seen.h) / 2;
            expect(to).toBeCloseTo(32, 0);
            expect(middle - to).toBeGreaterThan(50);
            expect(seen.rest).toBeCloseTo(to, 0);
            expect(seen.frames.some((f) => f.opening)).toBe(true);
            for (const f of seen.frames) expect(Math.abs(f.laidOut - to)).toBeLessThanOrEqual(1);
            const shifts = seen.frames.map((f) => f.shift);
            expect(shifts[0]).toBeGreaterThan((middle - to) / 2);
            expect(shifts[0]).toBeLessThanOrEqual(middle - to + 1);
            shifts.forEach((s, i) => { if (i > 0) expect(s).toBeLessThanOrEqual(shifts[i - 1] + 0.5); });
            expect(seen.frames.some((f) => f.t >= 200 && f.shift > 0.5)).toBe(true);
            expect(Math.abs(shifts[shifts.length - 1])).toBeLessThan(0.5);
        });
    }
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

    it('moves by the overlap alone as the keyboard rises and goes, the box\'s shift 0 at every frame', () => {
        const seen = run<{ k: number; show: (Frame & { shift: number })[]; hide: (Frame & { shift: number })[] }>(`
            phoneLayout();
            await openHub();
            const k = Math.round(innerHeight / 3);
            const withShift = (i, fs) => { fs[i].shift = shiftOf(); };
            showKeyboard(k);
            const show = await recordFrames(root(), body(), null, k, { each: withShift });
            hideKeyboard();
            const hide = await recordFrames(root(), body(), null, 0, { each: withShift });
            return JSON.stringify({ k, show, hide });
        `);
        for (const frames of [seen.show, seen.hide]) {
            // The overlap moves over frames, the sheet with it.
            expect(frames.some((f) => f.overlap > 0 && f.overlap < seen.k)).toBe(true);
            for (const f of frames) expect(f.shift).toBe(0);
        }
        const tops = seen.show.map((f) => f.panelTop);
        expect(tops.some((top, i) => i > 0 && top < tops[i - 1] - 0.5)).toBe(true);
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
