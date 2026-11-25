/**
 * How a dialog's body moves along with the on-screen keyboard, frame by
 * frame: rising with it, and going back with it. Where the body comes to
 * rest is seen in BodyOverKeyboard.test.ts.
 *
 * The keyboard is told as iPad tells it (`keyboardWillShow`, the overlap's
 * transition of 250ms, `keyboardDidShow` 440ms after; `keyboardDidHide` 3ms
 * after `keyboardWillHide`), on rooms laid out by the stylesheet's rules
 * (`keyboardRoomHarness`).
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, useKeyboardRoomHarness, type Room, type RoomShape, type FakeField } from './keyboardRoomHarness';
import { lack, scrollAlong, alongLack, alongOverlap, type Along } from '../../../src/utils/KeyboardRoom';
import type { Place } from '../../../src/utils/RoomLayout';

useKeyboardRoomHarness();

/** The desktop's box in an 800px window: at rest from 100 to 700, its body from 160 to 640; under a keyboard of 136 or more, at 32. */
const BOX: RoomShape = { kind: 'centered', panel: 600, bodyOffset: 60, bodyHeight: 480 };
/** The phone's sheet in an 800px window, its body ending 60 above the window's bottom, or the keyboard's top. */
const SHEET: RoomShape = { kind: 'sheet', above: 40, below: 60 };
const K = 300;
const NONE = { height: '', maxHeight: '', paddingBottom: '' };

/** One frame as seen once its callbacks have run. */
interface Seen {
    frame: number;
    t: number;
    overlap: number;
    scrollTop: number;
    /** The field's visible bottom. */
    field: number;
    /** The keyboard's top as the overlap shown lays it out, or the body's visible bottom where higher. */
    edge: number;
}

function watch(room: Room, field: FakeField, each?: (frame: number) => void): Seen[] {
    const seen: Seen[] = [];
    room.watchFrames((frame) => {
        const overlap = room.shownOverlap();
        seen.push({
            frame, t: room.now(), overlap, scrollTop: room.scrollTop, field: room.bottomOf(field),
            edge: Math.min(room.H - overlap, room.layout().bodyBottom),
        });
        each?.(frame);
    });
    return seen;
}

/** The room, its part mounted, a field `at` px into the body's content focused, the body scrolled to `scrollTop`. */
function focused(shape: RoomShape, at: number, opts: { scrollTop?: number; transitions?: boolean; viewport?: boolean } = {}) {
    const room = makeRoom({ shape, content: 1000, transitions: opts.transitions, viewport: opts.viewport });
    if (opts.scrollTop !== undefined) room.scrollTop = opts.scrollTop;
    const field = room.field(at);
    room.focus(field);
    room.mount();
    return { room, field, start: room.bottomOf(field) };
}

function nonDecreasing(values: number[]): boolean {
    return values.every((v, i) => i === 0 || v >= values[i - 1]);
}

function nonIncreasing(values: number[]): boolean {
    return values.every((v, i) => i === 0 || v <= values[i - 1]);
}

describe('the body along the keyboard rising', () => {
    // The box: the field at 610, 10px above the keyboard's top once the overlap passes 248, and 52 short under 300.
    // The sheet: the field at 610, 10px above the body's bottom once the overlap passes 208, and 92 short under 300.
    const cases: { name: string; shape: RoomShape; from: number; end: number }[] = [
        { name: 'the tall box', shape: BOX, from: 248, end: 52 },
        { name: 'the sheet', shape: SHEET, from: 208, end: 92 },
    ];

    for (const c of cases) {
        it(`${c.name}: the body stays until the keyboard comes to the field, then rises with it 10px under the field`, async () => {
            const { room, field, start } = focused(c.shape, 450);
            const seen = watch(room, field);

            room.iPadShow(K);
            await room.settle();

            expect(seen.length).toBeGreaterThan(10);
            expect(nonDecreasing(seen.map((s) => s.scrollTop))).toBe(true);
            for (const s of seen) {
                expect(s.field).toBeLessThanOrEqual(Math.max(start, s.edge - 10) + 1);
                if (s.overlap < c.from - 1) expect(s.scrollTop).toBe(0);
                if (s.overlap > c.from + 1) expect(Math.abs(s.field - (s.edge - 10))).toBeLessThanOrEqual(1);
            }
            expect(room.scrollTop).toBe(c.end);
            expect(seen.some((s) => s.scrollTop > 0 && s.scrollTop < c.end)).toBe(true);
        });

        it(`${c.name}: goes back along with the keyboard going, 10px under the field until it is where it stood`, async () => {
            const { room, field, start } = focused(c.shape, 450);
            room.iPadShow(K);
            await room.settle();
            const seen = watch(room, field);

            room.iPadHide();
            await room.settle();

            expect(seen.length).toBeGreaterThan(10);
            expect(nonIncreasing(seen.map((s) => s.scrollTop))).toBe(true);
            for (const s of seen) {
                expect(s.field).toBeLessThanOrEqual(Math.max(start, s.edge - 10) + 1);
                if (s.overlap > c.from + 1) expect(Math.abs(s.field - (s.edge - 10))).toBeLessThanOrEqual(1);
            }
            expect(seen.some((s) => s.scrollTop > 0 && s.scrollTop < c.end)).toBe(true);
            expect(room.scrollTop).toBe(0);
            expect(room.inline()).toEqual(NONE);
        });
    }

    it('rises along with the keyboard to the field 10px above it where the content gives way to the padding, and goes back', async () => {
        // The content gives way to the padding until it ends at 430 (BodyOverKeyboard.test.ts):
        // the field at 420 lacks 22 under 300, and the body is padded as far as it scrolls so.
        const room = makeRoom({ shape: BOX, content: 430, fills: 478, padding: 12 });
        const field = room.field(420);
        room.focus(field);
        room.mount();
        const start = room.bottomOf(field);
        const seen = watch(room, field);

        room.iPadShow(K);
        await room.settle();

        expect(seen.length).toBeGreaterThan(10);
        expect(nonDecreasing(seen.map((s) => s.scrollTop))).toBe(true);
        for (const s of seen) expect(s.field).toBeLessThanOrEqual(Math.max(start, s.edge - 10) + 1);
        expect(seen.some((s) => s.scrollTop > 0 && s.scrollTop < 22)).toBe(true);
        expect(room.scrollTop).toBe(22);
        expect(room.bottomOf(field)).toBe(490);

        room.iPadHide();
        await room.settle();

        expect(room.scrollTop).toBe(0);
        expect(room.inline()).toEqual(NONE);
    });

    it('asks for no frame once the keyboard is up and at rest, nor once it has gone', async () => {
        const { room } = focused(BOX, 450);
        room.iPadShow(K);
        await room.advance(460);
        expect(room.framesAsked()).toBe(0);

        room.iPadHide();
        await room.advance(270);
        expect(room.framesAsked()).toBe(0);
    });

    it('holds the body until the did show, a field the keyboard will not hide', async () => {
        const { room, field } = focused(SHEET, 200, { scrollTop: 30 });
        const frames: number[] = [];
        watch(room, field, () => frames.push(room.now()));

        room.iPadShow(K);
        await room.settle();

        // The did show comes at 440: the last frame is the one after it.
        expect(Math.max(...frames)).toBeGreaterThanOrEqual(440);
        expect(Math.max(...frames)).toBeLessThan(440 + 20);
        expect(room.scrollTop).toBe(30);
    });

    it('ends by 1000ms when no did show comes', async () => {
        const { room, field } = focused(BOX, 450);
        const frames: number[] = [];
        watch(room, field, () => frames.push(room.now()));

        room.native('keyboardWillShow', K);
        await room.settle();

        expect(Math.max(...frames)).toBeGreaterThanOrEqual(1000);
        expect(Math.max(...frames)).toBeLessThan(1000 + 20);
        expect(room.scrollTop).toBe(52);
    });

    it('stops moving the body by 1000ms where the overlay never ends opening, holding it meanwhile', async () => {
        const room = makeRoom({ shape: SHEET, content: 1000 });
        const field = room.field(450);
        room.open(Infinity);
        room.focus(field);
        room.mount();
        const frames: number[] = [];
        watch(room, field, () => frames.push(room.now()));

        room.iPadShow(K);
        await room.settle();

        // The frame after the last asks to measure once the overlay has opened.
        expect(Math.max(...frames)).toBeGreaterThanOrEqual(1000);
        expect(Math.max(...frames)).toBeLessThan(1000 + 40);
        expect(room.framesAsked()).toBe(0);
        expect(room.scrollTop).toBe(0);
    });

    it('scrolls for where the field comes to rest once an overlay opening past 1000ms has opened', async () => {
        const room = makeRoom({ shape: SHEET, content: 1000 });
        const field = room.field(450);
        room.open(1300);
        room.focus(field);
        room.mount();

        room.iPadShow(K);
        await room.settle();

        expect(room.scrollTop).toBe(92);
        expect(room.bottomOf(field)).toBe(430);
    });
});

describe('the browser and the user scrolling the body as the keyboard rises', () => {
    for (const hidden of [true, false]) {
        it(`writes the planned place over the browser's own scroll at the next frame, a field ${hidden ? 'the keyboard hides' : 'left in sight'}`, async () => {
            const { room, field } = focused(SHEET, hidden ? 450 : 200, { scrollTop: 30 });
            const seen = watch(room, field, (frame) => {
                if (frame >= 3 && frame <= 9) room.browserScroll(room.scrollTop + 171);
            });

            room.iPadShow(K);
            await room.settle();

            // Each frame from the fourth on is seen as the part wrote it, the scroll of the frame before written over.
            const tops = seen.map((s) => s.scrollTop);
            expect(nonDecreasing(tops)).toBe(true);
            if (!hidden) expect(tops.every((top) => top === 30)).toBe(true);
            expect(room.scrollTop).toBe(hidden ? 30 + 62 : 30);
        });
    }

    it('writes the planned place over the browser\'s own scroll when the caret moves at the same frame', async () => {
        // The caret at 455 lacks 57 under the keyboard.
        const room = makeRoom({ shape: BOX, content: 1500 });
        const field = room.editable(1400, 450);
        room.focus(field);
        room.mount();
        const tops: { frame: number; scrollTop: number }[] = [];
        room.watchFrames((frame) => {
            tops.push({ frame, scrollTop: room.scrollTop });
            if (frame === 3) {
                room.browserScroll(room.scrollTop + 100);
                field.caretTo(455);
            }
        });

        room.iPadShow(K);
        await room.settle();

        // The frame after plans again; from the next on, the body moves from where it was written.
        const after = tops.filter((s) => s.frame > 4).map((s) => s.scrollTop);
        expect(after.length).toBeGreaterThan(5);
        expect(nonDecreasing(after)).toBe(true);
        expect(after.every((top) => top <= 57)).toBe(true);
        expect(room.scrollTop).toBe(57);
    });

    for (const gesture of ['touchmove', 'wheel'] as const) {
        it(`stops writing the body on a ${gesture}, and leaves it there as the keyboard goes`, async () => {
            const { room, field } = focused(BOX, 450);
            const seen = watch(room, field);
            room.iPadShow(K);
            await room.advance(200); // the overlap past 248: the body under way
            const at = room.scrollTop;
            expect(at).toBeGreaterThan(0);

            room.userScroll(gesture, at + 40);
            await room.settle();
            expect(room.scrollTop).toBe(at + 40);
            expect(seen.filter((s) => s.t > 200).every((s) => s.scrollTop === at + 40)).toBe(true);

            room.iPadHide();
            await room.settle();
            expect(room.scrollTop).toBe(at + 40);
            expect(room.inline()).toEqual(NONE);
        });
    }
});

describe('what comes while the keyboard rises', () => {
    it('reads nothing while the overlay opens, holds the body meanwhile, and moves along once it has opened', async () => {
        const room = makeRoom({ shape: SHEET, content: 1000 });
        const field = room.field(450);
        room.open();
        room.focus(field);
        room.mount();
        const seen = watch(room, field, (frame) => {
            if (frame === 2) room.browserScroll(120); // the browser revealing the field on its way up
        });

        await room.advance(20);
        room.iPadShow(K);
        await room.settle();

        const opening = seen.filter((s) => s.t <= 150);
        expect(opening.length).toBeGreaterThan(3);
        expect(opening.slice(-1)[0].scrollTop).toBe(0);
        expect(nonDecreasing(seen.filter((s) => s.t > 150).map((s) => s.scrollTop))).toBe(true);
        expect(room.scrollTop).toBe(92);
    });

    it('goes back from where the body stands when the keyboard goes while it rises', async () => {
        const { room, field } = focused(BOX, 450);
        room.native('keyboardWillShow', K); // no did show: the keyboard turns back
        await room.advance(200);
        const at = room.scrollTop;
        expect(at).toBeGreaterThan(0);
        const seen = watch(room, field);

        room.iPadHide();
        await room.settle();

        expect(seen[0].scrollTop).toBeLessThanOrEqual(at);
        expect(nonIncreasing(seen.map((s) => s.scrollTop))).toBe(true);
        expect(room.scrollTop).toBe(0);
        expect(room.inline()).toEqual(NONE);
    });

    // Under 314 the field at 450 lacks 66, under 300 it lacks 52: the body comes to rest as it would under the last height alone.
    for (const c of [{ from: 314, to: 300, end: 52 }, { from: 300, to: 314, end: 66 }]) {
        it(`plans again from where the body stands when the keyboard changes height from ${c.from} to ${c.to} while it rises, coming to rest as under ${c.to} alone`, async () => {
            const { room, field } = focused(BOX, 450);
            const seen = watch(room, field);
            room.native('keyboardWillShow', c.from);
            await room.advance(200);
            expect(room.scrollTop).toBeGreaterThan(0);

            room.native('keyboardWillShow', c.to);
            room.native('keyboardDidShow', c.to);
            await room.settle();

            const tops = seen.map((s) => s.scrollTop);
            expect(tops.every((top, i) => i === 0 || Math.abs(top - tops[i - 1]) <= 20)).toBe(true);
            expect(room.scrollTop).toBe(c.end);
            expect(room.bottomOf(field)).toBe(800 - c.to - 10);
        });
    }

    it('goes back to where the body stood as the keyboard rose when it goes after changing height while it rose', async () => {
        const { room } = focused(BOX, 450, { scrollTop: 7 });
        room.native('keyboardWillShow', 314);
        await room.advance(200);
        room.native('keyboardWillShow', 300);
        await room.advance(100);

        room.iPadHide();
        await room.settle();

        expect(room.scrollTop).toBe(7);
        expect(room.inline()).toEqual(NONE);
    });

    it('comes to rest as under the new height alone when the keyboard comes back lower while it goes', async () => {
        // Under 200 the box stands at 32, its body from 92 to 572: the field at 542 lacks nothing.
        const { room, field } = focused(BOX, 450);
        room.iPadShow(K);
        await room.settle();
        room.native('keyboardWillHide');
        await room.advance(20); // the overlap still past 248: the body under way back
        expect(room.scrollTop).toBeGreaterThan(0);

        room.iPadShow(200);
        await room.settle();

        expect(room.scrollTop).toBe(0);
        expect(room.bottomOf(field)).toBe(542);
        expect(room.inline()).toEqual(NONE);
    });

    it('locks and pads nothing once at rest when the keyboard turns lower while it rises, the field no longer hidden', async () => {
        const { room, field } = focused(BOX, 450);
        room.native('keyboardWillShow', K);
        await room.advance(200);
        expect(room.inline().height).toBe('480px');

        room.native('keyboardWillShow', 200);
        room.native('keyboardDidShow', 200);
        await room.settle();

        expect(room.scrollTop).toBe(0);
        expect(room.bottomOf(field)).toBe(542);
        expect(room.inline()).toEqual(NONE);
    });

    // 40 of scroll room: the field at 500 lacks 102 under 340 and 62 under 300, and 30 under 150, the body's bottom then in sight.
    for (const c of [
        { from: 340, to: 300, top: 102, inline: { height: '480px', maxHeight: '480px', paddingBottom: '62px' } },
        { from: 300, to: 150, top: 30, inline: NONE },
    ]) {
        it(`locks and pads the body once at rest as under ${c.to} alone when the keyboard changes from ${c.from} while it rises`, async () => {
            const room = makeRoom({ shape: BOX, content: 520 });
            const field = room.field(500);
            room.focus(field);
            room.mount();
            room.native('keyboardWillShow', c.from);
            await room.advance(200);

            room.native('keyboardWillShow', c.to);
            room.native('keyboardDidShow', c.to);
            await room.settle();

            expect(room.scrollTop).toBe(c.top);
            expect(room.inline()).toEqual(c.inline);
        });
    }

    it('keeps the body locked where it stands when the keyboard turns lower once it is up', async () => {
        const { room } = focused(BOX, 450);
        room.iPadShow(K);
        await room.settle();

        room.iPadShow(200);
        await room.settle();

        expect(room.scrollTop).toBe(52);
        expect(room.inline().height).toBe('480px');
    });

    it('puts the body back once the keyboard is up when the focus left the fields while it rose', async () => {
        const { room } = focused(BOX, 450, { scrollTop: 7 });
        room.iPadShow(K);
        await room.advance(200); // the overlap past 248: the body under way and locked
        expect(room.scrollTop).toBeGreaterThan(7);
        expect(room.inline().height).toBe('480px');

        room.blur();
        await room.settle();

        expect(room.scrollTop).toBe(7);
        expect(room.inline()).toEqual(NONE);
    });

    it('keeps the body moved for the field the focus moved to while the keyboard rose', async () => {
        const room = makeRoom({ shape: BOX, content: 1000 });
        const a = room.field(450);
        const b = room.field(460);
        room.focus(a);
        room.mount();
        room.iPadShow(K);
        await room.advance(200);

        room.focus(b);
        await room.settle();

        expect(room.scrollTop).toBe(62);
        expect(room.inline().height).toBe('480px');
    });

    it('plans for a field focused while the keyboard rises', async () => {
        const room = makeRoom({ shape: SHEET, content: 1000 });
        const a = room.field(200);
        const b = room.field(450);
        room.focus(a);
        room.mount();
        room.iPadShow(K);
        await room.advance(100);
        expect(room.scrollTop).toBe(0);

        room.focus(b);
        await room.settle();

        expect(room.scrollTop).toBe(92);
        expect(room.bottomOf(b)).toBe(430);
    });

    it('follows the caret moving on to the next line while the keyboard rises', async () => {
        const room = makeRoom({ shape: BOX, content: 1500 });
        const field = room.editable(1400, 450);
        room.focus(field);
        room.mount();
        room.iPadShow(K);
        await room.advance(100);

        field.caretTo(470);
        await room.settle();

        expect(field.caretBottom()).toBe(490);
    });

    it('starts nothing on a field focused after a keyboard rose and went while the overlay opened', async () => {
        // Under no keyboard the sheet's body runs from 160 to 740: the field at 800 stands below it.
        const room = makeRoom({ shape: SHEET, content: 1000 });
        const a = room.field(450);
        const b = room.field(800);
        room.open();
        room.focus(a);
        room.mount();
        room.native('keyboardWillShow', K);
        await room.advance(60);
        room.native('keyboardWillHide');
        await room.settle();

        room.focus(b);
        await room.settle();

        expect(room.writtenOverlap()).toBeUndefined();
        expect(room.scrollTop).toBe(0);
        expect(room.inline()).toEqual(NONE);
    });
});

describe('where the move ends against where the body rests', () => {
    /**
     * The box over 600 of content, 120 of scroll room: under 100 its body
     * runs from 128 to 608 and the keyboard's top is at 700, so the field
     * at 595 lacks 125 from 0 and the body goes as far as it scrolls, 120,
     * the field at 603.
     */
    function lowFields() {
        const room = makeRoom({ shape: BOX, content: 600 });
        const a = room.field(500);
        const b = room.field(595);
        room.focus(a);
        room.mount();
        return { room, a, b };
    }

    it('ends as far as the locked body scrolls, the field focused as the keyboard lowers, rising only', async () => {
        const { room, b } = lowFields();
        room.iPadShow(K);
        await room.settle();
        expect(room.scrollTop).toBe(102);
        const seen = watch(room, b);

        room.native('keyboardWillShow', 100);
        await room.advance(50);
        room.focus(b);
        await room.settle();

        expect(room.scrollTop).toBe(120);
        expect(room.inline()).toEqual({ height: '480px', maxHeight: '480px', paddingBottom: '' });
        expect(room.bottomOf(b)).toBe(603);
        expect(nonDecreasing(seen.map((s) => s.scrollTop))).toBe(true);
    });

    it('ends as far as the body scrolls, unlocked, a field focused on the way and the keyboard lowered after, rising only', async () => {
        const { room, b } = lowFields();
        const seen = watch(room, b);

        room.native('keyboardWillShow', K);
        await room.advance(100);
        room.focus(b);
        await room.advance(30);
        room.native('keyboardWillShow', 100);
        room.native('keyboardDidShow', 100);
        await room.settle();

        expect(room.scrollTop).toBe(120);
        expect(room.inline()).toEqual(NONE);
        expect(room.bottomOf(b)).toBe(603);
        expect(nonDecreasing(seen.map((s) => s.scrollTop))).toBe(true);
    });
});

describe('a field in sight focused once the body has moved into its padding', () => {
    it('moves the body back from where it stands, its padding kept until the keyboard is up', async () => {
        // 40 of scroll room: the body padded by 62 for the field at 500 is past it by 200ms.
        const room = makeRoom({ shape: BOX, content: 520 });
        const a = room.field(500);
        const b = room.field(100);
        room.focus(a);
        room.mount();
        room.iPadShow(K);
        await room.advance(200);
        const before = room.scrollTop;
        expect(before).toBeGreaterThan(60);
        const seen = watch(room, b);

        room.focus(b);
        await room.settle();

        const tops = [before, ...seen.map((s) => s.scrollTop)];
        expect(tops.every((top, i) => i === 0 || top >= tops[i - 1] - 20)).toBe(true);
        expect(room.scrollTop).toBe(0);
        expect(room.inline()).toEqual(NONE);
    });
});

describe('the body at rest under the keyboard', () => {
    it('leaves a field lacking 1px, and scrolls one lacking 2px', async () => {
        const room = makeRoom({ shape: BOX, content: 1500 });
        const field = room.editable(1400, 300);
        room.focus(field);
        room.mount();
        room.iPadShow(K);
        await room.settle();

        field.caretTo(399); // 92 + 399 = 491, 1px past 490
        await room.settle();
        expect(room.scrollTop).toBe(0);

        field.caretTo(400);
        await room.settle();
        expect(room.scrollTop).toBe(2);
    });

    it('scrolls for a field focused at the next frame', async () => {
        const room = makeRoom({ shape: BOX, content: 1000 });
        const a = room.field(200);
        const b = room.field(450);
        room.focus(a);
        room.mount();
        room.iPadShow(K);
        await room.settle();

        room.focus(b);
        await room.advance(16);

        expect(room.scrollTop).toBe(52);
    });

    it('starts nothing on a field focused while the keyboard is closed', async () => {
        const room = makeRoom({ shape: BOX, content: 1000 });
        const field = room.field(700);
        room.mount();

        room.focus(field);

        expect(room.framesAsked()).toBe(0);
        await room.settle();
        expect(room.scrollTop).toBe(0);
    });

    it('measures a panel placed by script once, at the frame after the keyboard is told', async () => {
        const room = makeRoom({ shape: BOX, content: 1000 });
        const field = room.field(450);
        room.focus(field);
        room.mount({ movesWithOverlap: false });
        const seen = watch(room, field);

        room.iPadShow(K);
        await room.settle();

        const moved = seen.filter((s, i) => s.scrollTop !== (i === 0 ? 0 : seen[i - 1].scrollTop));
        expect(moved.map((s) => s.frame)).toEqual([0]);
        expect(room.scrollTop).toBeGreaterThan(0);
    });
});

describe('where the keyboard is told otherwise', () => {
    it('moves along the overlap where only the visualViewport tells the keyboard, ending with its transition', async () => {
        const { room, field } = focused(BOX, 450);
        const seen = watch(room, field);

        room.viewport(800 - K);
        await room.settle();

        expect(Math.max(...seen.map((s) => s.t))).toBeLessThan(250 + 20);
        expect(nonDecreasing(seen.map((s) => s.scrollTop))).toBe(true);
        expect(room.scrollTop).toBe(52);
        expect(room.bottomOf(field)).toBe(490);
    });

    it('moves at once to where the body goes where the overlap moves over no transition', async () => {
        const { room, field } = focused(BOX, 450, { transitions: false, viewport: false });
        const seen = watch(room, field);

        room.native('keyboardWillShow', K);
        room.native('keyboardDidShow', K);
        await room.settle();

        expect(seen[0].scrollTop).toBe(52);
        expect(room.bottomOf(field)).toBe(490);
        expect(room.inline().height).toBe('480px');
    });
});

describe('a read that throws', () => {
    it('gives the root its transition back and has the overlap move from where it was shown', async () => {
        const { room, field } = focused(BOX, 450);
        // Read where it stands, then thrown on where it will stand.
        const read = field.getBoundingClientRect.bind(field);
        let reads = 0;
        field.getBoundingClientRect = () => {
            if (++reads > 1) throw new Error('no rect');
            return read();
        };

        room.native('keyboardWillShow', K);

        expect(room.root.style.transition).toBe('');
        expect(room.writtenOverlap()).toBe(`${K}px`);
        expect(room.overlapMoving()).toBe(true);
        expect(room.shownOverlap()).toBe(0);
    });
});

describe('detach', () => {
    it('removes every listener it registered in attach(), the window\'s keyboard staying listened to', () => {
        const room = makeRoom({ shape: BOX, content: 1000 });
        room.mount();
        const vv = room.win.visualViewport!;
        expect(vv.listenerCount('resize')).toBe(1);
        expect(room.win.listenerCount('keyboardWillShow')).toBe(1);
        for (const type of ['focusin', 'focusout']) expect(room.root.listenerCount(type)).toBe(1);
        expect(room.doc.listenerCount('selectionchange')).toBe(1);
        for (const type of ['wheel', 'touchmove']) expect(room.body.listenerCount(type)).toBe(1);

        room.detach();

        // The window is let go only by untrackAllKeyboards (the plugin unloading).
        expect(vv.listenerCount('resize')).toBe(1);
        expect(room.win.listenerCount('keyboardWillShow')).toBe(1);
        for (const type of ['focusin', 'focusout']) expect(room.root.listenerCount(type)).toBe(0);
        expect(room.doc.listenerCount('selectionchange')).toBe(0);
        for (const type of ['wheel', 'touchmove']) expect(room.body.listenerCount(type)).toBe(0);
    });

    it('stops the move under way and asks for no frame once detached', async () => {
        const { room } = focused(BOX, 450);
        room.iPadShow(K);
        await room.advance(200);

        room.detach();

        expect(room.framesAsked()).toBe(0);
        expect(room.scrollTop).toBe(0);
        expect(room.inline()).toEqual(NONE);
    });
});

describe('the body\'s way along the overlap (no DOM)', () => {
    /**
     * A window 1000 tall, a box 900 tall centred at 50 (32 kept above and
     * below, 18 more on each side), the field ending at 800 and the body at
     * 930: under an overlap o the box stands at 32 + max(0, min(18, 36 - o)).
     */
    function placeAt(o: number): Place {
        const top = 32 + Math.max(0, Math.min(18, 36 - o));
        return {
            overlap: o, edge: 1000 - o, field: top + 750, bodyTop: top + 50, bodyBottom: top + 880,
            bodyHeight: 830, scrollTop: 0, scrollRange: 1000,
        };
    }
    const move: Along = {
        fromTop: 0, toTop: lack(placeAt(300), 0), lackFrom: lack(placeAt(0), 0), lackTo: lack(placeAt(300), 0),
        overlapFrom: 0, overlapTo: 300,
    };

    it('lacks nothing until the overlap is 208, and 92 under 300', () => {
        expect(lack(placeAt(0), 0)).toBe(0);
        expect(lack(placeAt(208), 0)).toBe(0);
        expect(lack(placeAt(250), 0)).toBe(42);
        expect(move.toTop).toBe(92);
    });

    it('keeps the body still until the overlap is 208, then moves it with the overlap', () => {
        for (let o = 0; o <= 300; o += 4) {
            expect(scrollAlong(move, lack(placeAt(o), 0), o)).toBeCloseTo(Math.max(0, o - 208), 6);
        }
    });

    it('moves the body from the first frame by the overlap\'s way where the field lacks the same at both ends', () => {
        const same: Along = { ...move, lackFrom: 30, lackTo: 30, toTop: 60 };
        expect(alongLack(same, 30, 150)).toBe(0.5);
        expect(alongOverlap(move, 0, 150)).toBe(0.5);
        expect(alongOverlap({ ...move, overlapTo: 0 }, 0, 0)).toBe(1);
    });

    it('stays where the move begins where what is read is no number', () => {
        expect(scrollAlong(move, NaN, 150)).toBe(0);
        expect(scrollAlong({ ...move, fromTop: 20, lackFrom: 30, lackTo: 30 }, 30, NaN)).toBe(20);
        expect(scrollAlong({ ...move, fromTop: 20, toTop: NaN }, 40, 150)).toBe(20);
    });

    it('reckons what the field lacks from the scrollTop given, the field read where it is scrolled', () => {
        const place: Place = { ...placeAt(300), scrollTop: 40, field: placeAt(300).field! - 40 };
        expect(lack(place, 0)).toBe(92);
        expect(lack(place, 40)).toBe(52);
        expect(lack({ ...place, field: null }, 0)).toBe(0);
    });
});
