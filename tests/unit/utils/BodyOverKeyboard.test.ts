/**
 * Where a dialog's body stands once everything has come to rest while the
 * on-screen keyboard covers the window: its scrollTop, the height and the
 * padding written on it, and where the field typed at ends against the
 * keyboard's top; and that each is put back as the keyboard goes.
 *
 * The rooms are laid out by the stylesheet's rules (`keyboardRoomHarness`),
 * so what is expected is worked out from where the field stands under the
 * keyboard, not from how the body was moved there or when.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, useKeyboardRoomHarness, type Room, type RoomShape } from './keyboardRoomHarness';

useKeyboardRoomHarness();

/** The desktop's box in an 800px window: at rest from 100 to 700, its body from 160 to 640; under a keyboard of 300 at 32, its body from 92 to 572. */
const BOX: RoomShape = { kind: 'centered', panel: 600, bodyOffset: 60, bodyHeight: 480 };
/** The phone's sheet in an 800px window, a head of 40 above its body and a row of buttons of 60 under it: under a keyboard of 300 its body runs from 72 to 440. */
const SHEET: RoomShape = { kind: 'sheet', above: 40, below: 60 };
/** A sheet with nothing under its body: the body ends right on the keyboard, 640 tall, from 160 to 800 with none. */
const FLAT_SHEET: RoomShape = { kind: 'sheet', above: 40, below: 0 };

/** The room, its part mounted, a field focused `at` px into the body's content. */
function focused(shape: RoomShape, at: number, opts: { content?: number; fills?: number; padding?: number; scrollTop?: number; viewport?: boolean; height?: number } = {}) {
    const room = makeRoom({ shape, content: opts.content ?? 1000, fills: opts.fills, padding: opts.padding, viewport: opts.viewport, height: opts.height });
    if (opts.scrollTop !== undefined) room.scrollTop = opts.scrollTop;
    const field = room.field(at);
    room.focus(field);
    room.mount();
    return { room, field };
}

/** The keyboard covering the window's lower `k` px, told by the visualViewport. */
function viewportKeyboard(room: Room, k: number) {
    room.viewport(room.H - k);
}

const NONE = { height: '', maxHeight: '', paddingBottom: '' };

describe('the body at rest while the keyboard is up', () => {
    describe('the keyboard told by the visualViewport', () => {
        it('locks the box\'s body at its height, pads what it lacks of the scroll room and scrolls the field 10px above the keyboard', async () => {
            // 40 of scroll room; the field at 92 + 500 = 592 under the keyboard's top at 500.
            const { room, field } = focused(BOX, 500, { content: 520 });

            viewportKeyboard(room, 300);
            await room.settle();

            expect(room.scrollTop).toBe(102);
            expect(room.inline()).toEqual({ height: '480px', maxHeight: '480px', paddingBottom: '62px' });
            expect(room.bottomOf(field)).toBe(490);
        });

        it('scrolls the sheet\'s body by its own visible bottom, the field above the keyboard, padding nothing and locking no height', async () => {
            // The field at 72 + 385 = 457: above the keyboard's top (500), below the body's bottom (440).
            const { room, field } = focused(SHEET, 385, { content: 900 });

            viewportKeyboard(room, 300);
            await room.settle();

            expect(room.scrollTop).toBe(27);
            expect(room.inline()).toEqual(NONE);
            expect(room.bottomOf(field)).toBe(430);
        });

        it('does nothing to the box\'s body the keyboard covers while the field is above the keyboard', async () => {
            const { room } = focused(BOX, 200);

            viewportKeyboard(room, 300);
            await room.settle();

            expect(room.scrollTop).toBe(0);
            expect(room.inline()).toEqual(NONE);
        });

        it('does nothing when the field stands well above the sheet\'s visible bottom', async () => {
            const { room } = focused(SHEET, 100, { content: 900 });

            viewportKeyboard(room, 300);
            await room.settle();

            expect(room.scrollTop).toBe(0);
            expect(room.inline()).toEqual(NONE);
        });

        it('does not take a viewport less than a pixel short of the window as a keyboard', async () => {
            const { room } = focused(FLAT_SHEET, 636, { content: 900 });

            room.viewport(799.4); // what a zoom leaves between the two heights
            await room.settle();

            expect(room.writtenOverlap()).toBeUndefined();
            expect(room.scrollTop).toBe(0);
        });

        it('takes a viewport a pixel short of the window as a keyboard, and keeps the field 10px above it', async () => {
            // Under 1px the body ends at 799 and the field at 795.
            const { room, field } = focused(FLAT_SHEET, 636, { content: 900 });

            room.viewport(799);
            await room.settle();

            expect(room.writtenOverlap()).toBe('1px');
            expect(room.scrollTop).toBe(6);
            expect(room.bottomOf(field)).toBe(789);
        });

        it('puts the body\'s height, padding and scrollTop back as the keyboard closes', async () => {
            const room = makeRoom({ shape: BOX, content: 520 });
            room.body.style.height = 'auto';
            room.body.style.maxHeight = '90%';
            room.body.style.paddingBottom = '8px';
            room.scrollTop = 5;
            const field = room.field(500);
            room.focus(field);
            room.mount();

            viewportKeyboard(room, 300);
            await room.settle();
            // 92 + 500 - 5 - 500 + 10 = 97 lacking, 43 of scroll room: 54 padded on the 8.
            expect(room.inline()).toEqual({ height: '480px', maxHeight: '480px', paddingBottom: '62px' });
            expect(room.scrollTop).toBe(102);

            room.viewport(800);
            await room.settle();

            expect(room.inline()).toEqual({ height: 'auto', maxHeight: '90%', paddingBottom: '8px' });
            expect(room.scrollTop).toBe(5);
        });

        it('pads only what the body lacks of the scroll room, on the stylesheet\'s padding', async () => {
            // 568 + 12 of content in 480: 100 of scroll room; the field 162 below the keyboard's top less 10.
            const { room, field } = focused(BOX, 560, { content: 568, padding: 12 });

            viewportKeyboard(room, 300);
            await room.settle();

            expect(room.scrollTop).toBe(162);
            expect(room.inline().paddingBottom).toBe('74px');
            expect(room.bottomOf(field)).toBe(490);
        });

        it('pads as far as the body then scrolls where its content gives way to the padding, the field 10px above the keyboard', async () => {
            // A part of the content cut to the room above the padding (to 478, 468 at rest) fills the
            // 480: no scroll room. The field at 92 + 420 = 512 lacks 22. A padding of 22 shortens the
            // part by as much and scrolls nothing; twice that, 66, cuts it under the content's 430 and
            // gives 430 + 78 - 480 = 28.
            const { room, field } = focused(BOX, 420, { content: 430, fills: 478, padding: 12 });

            viewportKeyboard(room, 300);
            await room.settle();

            expect(room.scrollTop).toBe(22);
            expect(room.inline()).toEqual({ height: '480px', maxHeight: '480px', paddingBottom: '78px' });
            expect(room.bottomOf(field)).toBe(490);

            room.viewport(800);
            await room.settle();

            expect(room.inline()).toEqual(NONE);
            expect(room.scrollTop).toBe(0);
        });

        it('pads nothing where the body has the scroll room, its height still locked', async () => {
            const { room, field } = focused(BOX, 560);

            viewportKeyboard(room, 300);
            await room.settle();

            expect(room.scrollTop).toBe(162);
            expect(room.inline()).toEqual({ height: '480px', maxHeight: '480px', paddingBottom: '' });
            expect(room.bottomOf(field)).toBe(490);
        });

        it('locks, pads and puts back afresh on a second opening of the keyboard, from where the body stands then', async () => {
            const { room, field } = focused(BOX, 590, { content: 600, scrollTop: 5 });

            viewportKeyboard(room, 300);
            await room.settle();
            expect(room.inline().paddingBottom).toBe('72px'); // 187 lacking, 115 of scroll room
            room.viewport(800);
            await room.settle();
            expect(room.scrollTop).toBe(5);
            expect(room.inline()).toEqual(NONE);

            room.scrollTop = 40; // scrolled with the keyboard closed
            room.body.style.paddingBottom = '8px';
            viewportKeyboard(room, 300);
            await room.settle();

            // 152 lacking, 88 of scroll room: 64 padded on the 8.
            expect(room.inline()).toEqual({ height: '480px', maxHeight: '480px', paddingBottom: '72px' });
            expect(room.bottomOf(field)).toBe(490);

            room.viewport(800);
            await room.settle();

            expect(room.inline()).toEqual({ height: '', maxHeight: '', paddingBottom: '8px' });
            expect(room.scrollTop).toBe(40);
        });

        it('adds to the padding across measures, and puts back the body as it stood before the first', async () => {
            const { room, field } = focused(BOX, 500, { content: 520 });

            viewportKeyboard(room, 300);
            await room.settle();
            expect(room.inline().paddingBottom).toBe('62px');

            field.moveTo(520); // what is above it grew: 20 more lacking, no scroll room left
            viewportKeyboard(room, 300);
            await room.settle();

            expect(room.inline()).toEqual({ height: '480px', maxHeight: '480px', paddingBottom: '82px' });
            expect(room.bottomOf(field)).toBe(490);

            room.viewport(800);
            await room.settle();

            expect(room.inline()).toEqual(NONE);
            expect(room.scrollTop).toBe(0);
        });
    });

    describe('the room above the keyboard', () => {
        it('gives the root how much of the window the keyboard covers while it is open', async () => {
            const { room } = focused(BOX, 100);

            viewportKeyboard(room, 300);
            await room.settle();

            expect(room.writtenOverlap()).toBe('300px');
            expect(room.shownOverlap()).toBe(300);
        });

        it('gives the native keyboard\'s height, where the viewport does not shrink', async () => {
            const { room } = focused(BOX, 100, { viewport: false });

            room.native('keyboardWillShow', 336);
            await room.settle();

            expect(room.writtenOverlap()).toBe('336px');
            expect(room.shownOverlap()).toBe(336);
        });

        it('takes the overlap off once the keyboard closes', async () => {
            const { room } = focused(BOX, 100, { viewport: false });

            room.native('keyboardWillShow', 336);
            room.native('keyboardWillHide');
            await room.settle();

            expect(room.writtenOverlap()).toBeUndefined();
            expect(room.shownOverlap()).toBe(0);
        });

        it('takes the overlap off on a show of height 0, the window no longer over the keyboard', async () => {
            const { room } = focused(BOX, 100, { viewport: false });

            room.native('keyboardDidShow', 340);
            room.native('keyboardDidShow', 0);
            await room.settle();

            expect(room.writtenOverlap()).toBeUndefined();
            expect(room.shownOverlap()).toBe(0);
        });

        it('gives a show told a height of 31 its overlap and keeps the field above it, and takes it off on the hide', async () => {
            // With none the field ends at the body's bottom (800); under 31 at 769, on the body's bottom.
            const { room, field } = focused(FLAT_SHEET, 680, { content: 900, scrollTop: 40, viewport: false });

            room.native('keyboardWillShow', 31);
            await room.settle();

            expect(room.writtenOverlap()).toBe('31px');
            expect(room.scrollTop).toBe(50);
            expect(room.bottomOf(field)).toBe(759);

            room.native('keyboardWillHide');
            await room.settle();

            expect(room.writtenOverlap()).toBeUndefined();
            expect(room.scrollTop).toBe(40);
        });

        it('sets nothing while no keyboard covers the window', async () => {
            const { room } = focused(BOX, 100);

            room.viewport(800);
            await room.settle();

            expect(room.writtenOverlap()).toBeUndefined();
            expect(room.shownOverlap()).toBe(0);
        });

        it('takes the body back where it stood each time an overlap of 5px comes and goes', async () => {
            // Under 5px the body ends at 795 and the field there.
            const { room, field } = focused(FLAT_SHEET, 680, { content: 900, scrollTop: 40 });

            for (let i = 0; i < 2; i++) {
                room.viewport(795);
                await room.settle();

                expect(room.writtenOverlap()).toBe('5px');
                expect(room.scrollTop).toBe(50);
                expect(room.bottomOf(field)).toBe(785);

                room.viewport(800);
                await room.settle();

                expect(room.writtenOverlap()).toBeUndefined();
                expect(room.scrollTop).toBe(40);
                expect(room.inline()).toEqual(NONE);
            }
        });

        it('takes the keyboard as gone once the viewport, scrolled down, ends at the window\'s bottom', async () => {
            const { room } = focused(BOX, 500, { scrollTop: 40 });

            viewportKeyboard(room, 300);
            await room.settle();
            expect(room.writtenOverlap()).toBe('300px');
            expect(room.scrollTop).not.toBe(40);

            // The viewport, no taller, scrolled down by 300px: its bottom is the window's.
            room.viewportScroll(300);
            await room.settle();

            expect(room.writtenOverlap()).toBeUndefined();
            expect(room.scrollTop).toBe(40);
            expect(room.inline()).toEqual(NONE);
        });

        it('lays out above a keyboard already open as it attaches', async () => {
            const room = makeRoom({ shape: BOX, content: 1000 });
            viewportKeyboard(room, 300);
            room.mount();

            expect(room.writtenOverlap()).toBe('300px');
            expect(room.shownOverlap()).toBe(300);
        });
    });

    describe('editable fields (contenteditable)', () => {
        /** The box, an editor running from the body's content top to 1400, its caret on the line ending at `caret`. */
        function editor(caret: number, opts: { empty?: boolean } = {}) {
            const room = makeRoom({ shape: BOX, content: 1500 });
            const field = room.editable(1400, caret, opts);
            room.focus(field);
            room.mount();
            return { room, field };
        }

        it('keeps the caret above the keyboard, not the field\'s bottom', async () => {
            const { room, field } = editor(600); // under the keyboard at 92 + 600 = 692

            viewportKeyboard(room, 300);
            await room.settle();

            expect(room.scrollTop).toBe(202);
            expect(room.bottomOf(field)).toBe(490);
        });

        it('does nothing while the caret is above the keyboard, however far the field runs below it', async () => {
            const { room } = editor(300);

            viewportKeyboard(room, 300);
            await room.settle();

            expect(room.scrollTop).toBe(0);
            expect(room.inline()).toEqual(NONE);
        });

        it('follows the caret as the selection moves while the keyboard is open', async () => {
            const { room, field } = editor(300);
            viewportKeyboard(room, 300);
            await room.settle();
            expect(room.scrollTop).toBe(0);

            field.caretTo(460); // typed on to a line under the keyboard's edge, at 552
            await room.settle();

            expect(room.scrollTop).toBe(62);
            expect(room.bottomOf(field)).toBe(490);
        });

        it('does not follow the caret while the keyboard is closed', async () => {
            const { room, field } = editor(300);

            field.caretTo(900); // below the body's bottom, no keyboard up
            await room.settle();

            expect(room.scrollTop).toBe(0);
            expect(room.inline()).toEqual(NONE);
        });

        it('takes the line the caret is in where the caret has no box of its own (an empty line)', async () => {
            const { room, field } = editor(568, { empty: true }); // the line ending at 660

            viewportKeyboard(room, 300);
            await room.settle();

            expect(room.scrollTop).toBe(170);
            expect(room.bottomOf(field)).toBe(490);
        });
    });

    describe('native (Capacitor) keyboard events', () => {
        it('opens on keyboardWillShow with a keyboardHeight, with no visualViewport', async () => {
            const { room, field } = focused(BOX, 500, { viewport: false });

            room.native('keyboardWillShow', 300);
            await room.settle();

            expect(room.scrollTop).toBe(102);
            expect(room.bottomOf(field)).toBe(490);
        });

        it('closes and puts the body back on keyboardWillHide', async () => {
            const { room } = focused(BOX, 500, { viewport: false, scrollTop: 3 });

            room.native('keyboardWillShow', 300);
            await room.settle();
            room.native('keyboardWillHide');
            await room.settle();

            expect(room.scrollTop).toBe(3);
            expect(room.inline()).toEqual(NONE);
        });
    });

    describe('the focus moving', () => {
        it('scrolls for a field focused while the keyboard is already open', async () => {
            const room = makeRoom({ shape: BOX, content: 1000 });
            const a = room.field(200);
            const b = room.field(500);
            room.focus(a);
            room.mount();
            viewportKeyboard(room, 300);
            await room.settle();
            expect(room.scrollTop).toBe(0);

            room.focus(b);
            await room.settle();

            expect(room.scrollTop).toBe(102);
            expect(room.bottomOf(b)).toBe(490);
        });

        it('puts the body back where it was as the keyboard opened, when focusing a field had the browser scroll it first', async () => {
            // Under 336 the sheet's body runs from 72 to 404.
            const room = makeRoom({ shape: SHEET, content: 900, viewport: false });
            const field = room.field(364);
            room.mount();

            room.native('keyboardWillShow', 336); // nothing focused yet
            room.focus(field);
            room.browserScroll(32); // the browser shows the field at the body's bottom
            await room.settle();
            expect(room.scrollTop).toBe(42);
            expect(room.bottomOf(field)).toBe(394);

            room.native('keyboardWillHide');
            await room.settle();

            expect(room.scrollTop).toBe(0);
        });

        it('puts the body back where it stood as the part attached over an open keyboard, when the first focus scrolled it', async () => {
            const room = makeRoom({ shape: SHEET, content: 900, viewport: false });
            const field = room.field(374);
            room.native('keyboardDidShow', 336); // typing elsewhere before the dialog opens
            room.mount();

            room.focus(field);
            room.browserScroll(32);
            await room.settle();
            expect(room.scrollTop).toBe(52);

            room.native('keyboardDidHide');
            await room.settle();

            expect(room.scrollTop).toBe(0);
        });

        // Under 300 the sheet's body runs from 72 to 440 and the box's from 92 to 572, its keyboard's top at 500.
        for (const c of [{ name: 'the sheet', shape: SHEET, top: 92, end: 430 }, { name: 'the box', shape: BOX, top: 52, end: 490 }]) {
            for (const at of [50, 160]) {
                it(`${c.name}: scrolls for where the field comes to rest, focused ${at < 150 ? 'as' : 'once'} it opens over an open keyboard and laid out as it is built, the overlap moving in from none`, async () => {
                    const room = makeRoom({ shape: c.shape, content: 1000, viewport: false });
                    const field = room.field(450);
                    room.native('keyboardWillShow', 300);
                    room.native('keyboardDidShow', 300);
                    room.mount({ laidOut: true });
                    room.open();
                    expect(room.overlapMoving()).toBe(true);

                    await room.advance(at);
                    room.focus(field);
                    await room.settle();
                    expect(room.scrollTop).toBe(c.top);
                    expect(room.bottomOf(field)).toBe(c.end);

                    room.native('keyboardWillHide');
                    await room.settle();
                    expect(room.scrollTop).toBe(0);
                    expect(room.inline()).toEqual(NONE);
                });
            }
        }

        it('puts the body back where it was as the keyboard opened, a field in sight when it opened, when focusing a hidden one had the browser scroll it first', async () => {
            const room = makeRoom({ shape: BOX, content: 1000 });
            const a = room.field(200);
            const b = room.field(500);
            room.focus(a);
            room.mount();
            room.iPadShow(300);
            await room.settle();
            expect(room.scrollTop).toBe(0);

            room.focus(b);
            room.browserScroll(32); // the browser shows the field before it is measured
            await room.settle();
            expect(room.bottomOf(b)).toBe(490);

            room.iPadHide();
            await room.settle();

            expect(room.scrollTop).toBe(0);
        });

        it('puts the body back 200ms after the focus leaves the fields, and not before', async () => {
            const { room } = focused(BOX, 500, { scrollTop: 7 });
            viewportKeyboard(room, 300);
            await room.settle();
            expect(room.inline().height).toBe('480px');

            room.blur();
            await room.advance(199);
            expect(room.inline().height).toBe('480px');
            expect(room.scrollTop).toBe(102);

            await room.advance(1);
            expect(room.inline()).toEqual(NONE);
            expect(room.scrollTop).toBe(7);
        });

        it('does not put the body back when the focus moves to another field in the dialog', async () => {
            const room = makeRoom({ shape: BOX, content: 1000 });
            const a = room.field(500);
            const b = room.field(490);
            room.focus(a);
            room.mount();
            viewportKeyboard(room, 300);
            await room.settle();

            room.focus(b);
            await room.settle();

            expect(room.scrollTop).toBe(102);
            expect(room.inline().height).toBe('480px');
        });
    });

    describe('the user scrolling the body while the keyboard is open', () => {
        /** The box: the keyboard opened over a field, the body locked and scrolled 97 for it from 5. */
        async function openedOverField() {
            const room = makeRoom({ shape: BOX, content: 1000 });
            room.body.style.paddingBottom = '8px';
            room.scrollTop = 5;
            const field = room.field(500);
            room.focus(field);
            room.mount();
            viewportKeyboard(room, 300);
            await room.settle();
            expect(room.scrollTop).toBe(102);
            return { room, field };
        }

        for (const gesture of ['wheel', 'touchmove'] as const) {
            it(`leaves the body where the user took it by a ${gesture} on it, the height and the padding put back`, async () => {
                const { room } = await openedOverField();

                room.userScroll(gesture, 120);
                room.viewport(800);
                await room.settle();

                expect(room.scrollTop).toBe(120);
                expect(room.inline()).toEqual({ height: '', maxHeight: '', paddingBottom: '8px' });
            });
        }

        it('leaves the body where the user took it when the focus leaves the fields', async () => {
            const { room } = await openedOverField();

            room.userScroll('touchmove', 120);
            room.blur();
            await room.settle();

            expect(room.scrollTop).toBe(120);
            expect(room.inline()).toEqual({ height: '', maxHeight: '', paddingBottom: '8px' });
        });

        it('leaves the body flinging on after the user scrolled it as the keyboard goes', async () => {
            const { room } = await openedOverField();

            room.userScroll('touchmove', 150);
            room.viewport(800);
            await room.advance(50);
            room.browserScroll(200); // the fling going on after the finger has left
            await room.settle();

            expect(room.scrollTop).toBe(200);
        });

        it('leaves the body where the user took it when the part detaches', async () => {
            const { room } = await openedOverField();

            room.userScroll('wheel', 120);
            room.detach();
            await room.settle();

            expect(room.scrollTop).toBe(120);
            expect(room.inline()).toEqual({ height: '', maxHeight: '', paddingBottom: '8px' });
        });

        it('goes back to where the user took the body when it is scrolled for a field afterwards', async () => {
            const { room } = await openedOverField();

            room.userScroll('wheel', 120);
            const below = room.field(600); // at 92 + 600 - 120 = 572, under the keyboard's top
            room.focus(below);
            await room.settle();
            expect(room.scrollTop).toBe(202);

            room.viewport(800);
            await room.settle();

            expect(room.scrollTop).toBe(120);
        });

        it('leaves the body where it last stood when, after the user scrolled it, the keyboard changes height and the body flings on by itself', async () => {
            // Under 314 the keyboard's top is at 486: the field at 592 is scrolled 116 to 476.
            const { room, field } = focused(BOX, 500);
            room.iPadShow(314);
            await room.settle();
            expect(room.scrollTop).toBe(116);

            room.userScroll('wheel', 150); // the field at 442, in sight
            room.iPadShow(300);
            await room.settle();
            expect(room.scrollTop).toBe(150);
            expect(room.bottomOf(field)).toBe(442);

            room.browserScroll(180); // the fling going on after the finger has left
            room.iPadHide();
            await room.settle();

            expect(room.scrollTop).toBe(180);
            expect(room.inline()).toEqual(NONE);
        });
    });

    describe('the user scrolling the body while the keyboard rises', () => {
        // Under 300 the box's body runs from 92 to 572 and the keyboard's top is at 500.
        it('measures the body from where the user took it once the keyboard is up, the field hidden there', async () => {
            const { room, field } = focused(BOX, 450);
            room.iPadShow(300);
            await room.advance(100);

            room.userScroll('touchmove', 0); // the field at 542 at rest, 52 short
            await room.settle();

            expect(room.scrollTop).toBe(52);
            expect(room.inline()).toEqual({ height: '480px', maxHeight: '480px', paddingBottom: '' });
            expect(room.bottomOf(field)).toBe(490);
        });

        for (const at of [60, 200]) {
            it(`leaves the body unlocked where the user took it to ${at} once the keyboard is up, the field in sight there`, async () => {
                const { room, field } = focused(BOX, 450);
                room.iPadShow(300);
                await room.advance(100);

                room.userScroll('touchmove', at);
                await room.settle();

                expect(room.scrollTop).toBe(at);
                expect(room.inline()).toEqual(NONE);
                expect(room.bottomOf(field)).toBe(92 + 450 - at);
            });
        }

        for (const at of [20, 0]) {
            it(`pads from the scroll room the body had before the keyboard, the user having taken it to ${at}`, async () => {
                // 40 of scroll room: the field at 92 + 500 less where the user took the body lacks 102 from 0, 62 past the room.
                const { room, field } = focused(BOX, 500, { content: 520 });
                room.iPadShow(300);
                await room.advance(150);

                room.userScroll('wheel', at);
                await room.settle();

                expect(room.scrollTop).toBe(102);
                expect(room.inline()).toEqual({ height: '480px', maxHeight: '480px', paddingBottom: '62px' });
                expect(room.bottomOf(field)).toBe(490);
            });
        }

        it('plans from where the user took the body when the field moves after it', async () => {
            // From 10 the field moved to 100 stands at 92 + 100 - 10 = 182, in sight.
            const { room, field } = focused(BOX, 500, { content: 520 });
            room.iPadShow(300);
            await room.advance(120);
            room.userScroll('wheel', 10);
            await room.advance(30);

            field.moveTo(100);
            await room.settle();

            expect(room.scrollTop).toBe(10);
            expect(room.inline()).toEqual(NONE);
        });

        it('measures from as far as the body scrolled before the keyboard, the user having taken it into the padding and the field moved after', async () => {
            // 40 of scroll room before the keyboard: from 40 the field moved to 498 stands at 550, 60 short.
            const { room, field } = focused(BOX, 500, { content: 520 });
            room.iPadShow(300);
            await room.advance(120);
            room.userScroll('wheel', 102);
            await room.advance(30);

            field.moveTo(498);
            await room.settle();

            expect(room.scrollTop).toBe(100);
            expect(room.inline()).toEqual({ height: '480px', maxHeight: '480px', paddingBottom: '60px' });
            expect(room.bottomOf(field)).toBe(490);
        });
    });

    describe('the keyboard rising again with no field focused', () => {
        it('leaves the body as it stood before the keyboard, the focus having left as it rose and the keyboard gone and back', async () => {
            const { room } = focused(BOX, 500, { content: 520 });
            room.iPadShow(300);
            await room.advance(50);
            room.blur();
            await room.advance(260);

            room.iPadHide(); // the did show still to come at 440ms
            await room.settle();

            expect(room.writtenOverlap()).toBe('300px');
            expect(room.scrollTop).toBe(0);
            expect(room.inline()).toEqual(NONE);
        });
    });

    describe('the keyboard changing height once up', () => {
        it('keeps the padding the body has, and pads what it lacks further', async () => {
            // Under 360 the keyboard's top is at 440: from 102 the field at 490 lacks 60, all past the scroll room.
            const { room, field } = focused(BOX, 500, { content: 520 });
            room.iPadShow(300);
            await room.settle();
            expect(room.inline().paddingBottom).toBe('62px');

            room.iPadShow(360);
            await room.settle();

            expect(room.scrollTop).toBe(162);
            expect(room.inline()).toEqual({ height: '480px', maxHeight: '480px', paddingBottom: '122px' });
            expect(room.bottomOf(field)).toBe(430);
        });

        it('measures a field focused once a read that threw on the keyboard\'s change has left the body at rest', async () => {
            // Under 360 the keyboard's top is at 440: from 52 the field at 600 stands at 640, 210 short.
            const { room, field } = focused(BOX, 450);
            room.iPadShow(300);
            await room.settle();
            expect(room.scrollTop).toBe(52);
            const below = room.field(600);
            const read = field.getBoundingClientRect.bind(field);
            let reads = 0;
            field.getBoundingClientRect = () => {
                if (++reads > 1) throw new Error('no rect');
                return read();
            };

            try { room.native('keyboardWillShow', 360); } catch { /* the read's throw */ }
            field.getBoundingClientRect = read;
            room.focus(below);
            await room.settle();

            expect(room.scrollTop).toBe(262);
            expect(room.bottomOf(below)).toBe(430);
        });
    });

    describe('reading the field where it comes to rest', () => {
        it('does not read the sheet as it slides up, and scrolls for where the field comes to rest', async () => {
            // At rest under 300 the field ends at 72 + 400 = 472, below the body's bottom (440).
            const room = makeRoom({ shape: SHEET, content: 900 });
            const field = room.field(400);
            room.open();
            room.focus(field, { ring: true });
            room.mount();

            await room.advance(30);
            viewportKeyboard(room, 300); // the field still far below the window
            await room.settle();

            expect(room.scrollTop).toBe(42);
            expect(room.inline()).toEqual(NONE);
            expect(room.bottomOf(field)).toBe(430);
        });

        it('scrolls the box for where the field comes to rest, its focus ring and the overlap moving as the keyboard opens', async () => {
            const room = makeRoom({ shape: BOX, content: 1000 });
            const field = room.field(500);
            room.mount();
            room.focus(field, { ring: true });

            viewportKeyboard(room, 300);
            await room.settle();

            expect(room.scrollTop).toBe(102);
            expect(room.bottomOf(field)).toBe(490);
        });

        it('leaves a low sheet unlocked, unpadded and unscrolled when its field is focused as it opens and the keyboard shows while the field\'s focus ring runs', async () => {
            // A 978px window, the sheet's body 134 tall: at rest under 288 it runs from 506 to 640,
            // above the keyboard's top (690), the field ending at 566.
            const room = makeRoom({ height: 978, shape: { kind: 'sheet', above: 40, below: 50 }, content: 134, viewport: false });
            const field = room.field(60);
            room.open();
            room.mount();
            room.focus(field, { ring: true });

            await room.advance(110);
            room.iPadShow(288);
            await room.settle();

            expect(room.inline()).toEqual(NONE);
            expect(room.scrollTop).toBe(0);
            expect(room.bottomOf(field)).toBe(566);
            expect(room.layout().bodyTop).toBe(506);
        });

        it('puts the box\'s body back as it stood when the keyboard opened, the browser having scrolled it to the field before it was read', async () => {
            // Under 428 the keyboard's top is at 372 and the body runs from 92.
            const { room, field } = focused(BOX, 500);

            room.iPadShow(428);
            await room.advance(20);
            room.browserScroll(150); // the browser keeps the focused field in sight
            await room.settle();

            expect(room.scrollTop).toBe(230);
            expect(room.bottomOf(field)).toBe(362);
            expect(room.inline()).toEqual({ height: '480px', maxHeight: '480px', paddingBottom: '' });

            room.iPadHide();
            await room.settle();

            expect(room.inline()).toEqual(NONE);
            expect(room.scrollTop).toBe(0);
        });

        it('scrolls for the field focused once things have come to rest, not the one focused as the keyboard opened', async () => {
            // At rest under 300: `first` would end at 522, `second` ends at 272, in sight.
            const room = makeRoom({ shape: SHEET, content: 900 });
            const first = room.field(450);
            const second = room.field(200);
            room.open();
            room.focus(first);
            room.mount();

            viewportKeyboard(room, 300);
            await room.advance(30);
            room.focus(second);
            await room.settle();

            expect(room.scrollTop).toBe(0);
            expect(room.inline()).toEqual(NONE);
        });

        it('moves nothing when the keyboard closes before things come to rest', async () => {
            const room = makeRoom({ shape: SHEET, content: 900 });
            const field = room.field(400);
            room.open();
            room.focus(field);
            room.mount();

            viewportKeyboard(room, 300);
            await room.advance(30);
            room.viewport(800);
            await room.settle();

            expect(room.scrollTop).toBe(0);
            expect(room.inline()).toEqual(NONE);
        });

        it('moves nothing when the part detaches (the dialog closing) before things come to rest', async () => {
            const room = makeRoom({ shape: SHEET, content: 900 });
            const field = room.field(400);
            room.open();
            room.focus(field);
            room.mount();

            viewportKeyboard(room, 300);
            await room.advance(30);
            room.detach();
            await room.settle();

            expect(room.scrollTop).toBe(0);
            expect(room.inline()).toEqual(NONE);
        });
    });

    describe('a field hidden or not, in the sheet and in the box', () => {
        const K = 300;
        const S0 = 30;
        const cases: { name: string; shape: RoomShape; at: number; hidden: boolean }[] = [
            { name: 'the sheet, a field the keyboard would hide', shape: SHEET, at: 450, hidden: true },
            { name: 'the sheet, a field in sight above the keyboard', shape: SHEET, at: 300, hidden: false },
            { name: 'the box, a field the keyboard would hide', shape: BOX, at: 500, hidden: true },
            { name: 'the box, a field in sight above the keyboard', shape: BOX, at: 300, hidden: false },
        ];

        /** The room, and how much the field would lack of standing 10px above the keyboard and the body's bottom at rest, unscrolled. */
        function roomFor(shape: RoomShape, at: number) {
            const room = makeRoom({ shape, content: 1000 });
            room.scrollTop = S0;
            const field = room.field(at);
            const rest = room.layoutAt(K);
            const edge = Math.min(room.H - K, rest.bodyBottom);
            const lack = rest.bodyTop + at - S0 - edge + 10;
            room.focus(field);
            room.mount();
            return { room, field, edge, lack };
        }

        for (const c of cases) {
            it(`${c.name}: ${c.hidden ? 'scrolled 10px above the higher of the keyboard\'s top and the body\'s bottom' : 'left where it stood'}`, async () => {
                const { room, field, edge, lack } = roomFor(c.shape, c.at);
                expect(lack > 0).toBe(c.hidden);

                room.iPadShow(K);
                await room.settle();

                expect(room.edge()).toBe(edge);
                if (c.hidden) {
                    expect(room.bottomOf(field)).toBeLessThanOrEqual(edge - 10);
                    expect(room.scrollTop).toBe(S0 + lack);
                } else {
                    expect(room.bottomOf(field)).toBeLessThanOrEqual(edge - 10);
                    expect(room.scrollTop).toBe(S0);
                    expect(room.inline()).toEqual(NONE);
                }
            });

            it(`${c.name}: the body back as it stood once the keyboard has gone`, async () => {
                const { room } = roomFor(c.shape, c.at);

                room.iPadShow(K);
                await room.settle();
                room.iPadHide();
                await room.settle();

                expect(room.scrollTop).toBe(S0);
                expect(room.inline()).toEqual(NONE);
                expect(room.shownOverlap()).toBe(0);
            });
        }
    });

    describe('detach', () => {
        it('puts the body back, and moves nothing on the keyboard\'s events afterwards', async () => {
            const { room } = focused(BOX, 500);
            viewportKeyboard(room, 300);
            await room.settle();
            expect(room.scrollTop).toBe(102);

            room.detach();
            await room.settle();

            expect(room.scrollTop).toBe(0);
            expect(room.inline()).toEqual(NONE);

            room.viewport(300);
            await room.settle();

            expect(room.scrollTop).toBe(0);
            expect(room.inline()).toEqual(NONE);
            expect(room.writtenOverlap()).toBe('300px'); // left on the root as it closes over the keyboard
        });
    });
});
