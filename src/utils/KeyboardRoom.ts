import { logDebug } from '../log/log';
import { watchKeyboard, keyboardOverlap, keyboardMoving, nativeKeyboardHeight, type KeyboardChange } from './KeyboardWatch';
import { RoomLayout, type Place } from './RoomLayout';

/** The room kept between what is typed at and the keyboard's top, or the body's bottom (px). */
const ABOVE = 10;

/** What a field may lack where the body rests before the body is scrolled for it (px): a pixel is left as it stands. */
const REST_SLACK = 1;

/**
 * How long the body is moved along with the keyboard at most (ms): far past
 * the overlap's transition (250ms) and the keyboard's own slide (on iPad its
 * did show comes about 440ms after the will show), so it is reached only
 * where the overlap never gets where it was given.
 */
const MOVE_LIMIT_MS = 1000;

/** What `OverlayShell` tells the room of the overlay. */
export interface KeyboardRoomOptions {
    /** While the overlay opens (its panel sliding up or popping in), what settles once it has opened; null once it has. */
    opening?: () => Promise<void> | null;
    /**
     * Whether the panel's place follows the overlap alone (the box, the
     * sheet). Not for a panel placed by script on the keyboard's events (an
     * anchored popover), which is measured a frame after each.
     */
    movesWithOverlap?: () => boolean;
}

// --- The core: where the body is scrolled to along a move ---

/**
 * What a field lacks of standing 10px above the keyboard's top and the
 * body's visible bottom, the higher of the two, in `place`, with the body
 * scrolled to `ref` (px; 0 while it lacks nothing). `place` is read at the
 * scrollTop it holds, and the field moved by the difference.
 */
export function lack(place: Place, ref: number): number {
    if (place.field === null) return 0;
    const field = place.field + place.scrollTop - ref;
    return Math.max(0, field - Math.min(place.edge, place.bodyBottom) + ABOVE);
}

/** Whether the keyboard covers the body's bottom in `place` (a box taller than the room above the keyboard). */
export function covered(place: Place): boolean {
    return place.edge < place.bodyBottom;
}

/** One move of the body along the overlap's: from where it stands to where it goes. */
export interface Along {
    fromTop: number;
    toTop: number;
    /** What the field lacks, the body at the scrollTop the move reckons from, as it begins and where it ends. */
    lackFrom: number;
    lackTo: number;
    overlapFrom: number;
    overlapTo: number;
}

/**
 * How far along its move the body is (0 to 1), by what the field lacks now
 * against what it lacked as the move began and will lack at its end. The
 * stylesheet lays out the box and the sheet so that what the field lacks
 * stays the same, or grows as fast as the overlap, as the keyboard rises:
 * the body stays while the keyboard is short of the field, and then rises
 * with it, the field riding 10px above the keyboard's top. Where the field
 * lacks the same at both ends, by how far the overlap has come.
 */
export function alongLack(m: Along, lackNow: number, shown: number): number {
    const span = m.lackTo - m.lackFrom;
    if (Math.abs(span) < 1) return alongOverlap(m, lackNow, shown);
    return clamp01((lackNow - m.lackFrom) / span);
}

/** How far along its move the body is (0 to 1), by how far the overlap has come. */
export function alongOverlap(m: Along, _lackNow: number, shown: number): number {
    const span = m.overlapTo - m.overlapFrom;
    if (span === 0) return 1;
    return clamp01((shown - m.overlapFrom) / span);
}

/**
 * The body's scrollTop at a frame of `m`, what the field lacks and the
 * overlap shown being as they are now. Where what is read is no number,
 * where the move begins: a NaN given to the body would scroll it to its top.
 */
export function scrollAlong(m: Along, lackNow: number, shown: number): number {
    const top = m.fromTop + (m.toTop - m.fromTop) * alongLack(m, lackNow, shown);
    return Number.isNaN(top) ? m.fromTop : top;
}

function clamp01(x: number): number {
    return Math.min(1, Math.max(0, x));
}

/** A scrollTop for the log, to a tenth of a px: a browser keeping whole px shows against what it was given. */
function tenth(px: number): string {
    return px.toFixed(1);
}

// --- The room ---

/**
 * - `closed`: no keyboard
 * - `showing`: the keyboard rising or changing height, the body moved along
 * - `shown`: the keyboard up and at rest
 * - `hiding`: the keyboard going, the body moved back along
 */
type State = 'closed' | 'showing' | 'shown' | 'hiding';

/** A move of the body under way, a frame at a time. */
interface Run extends Along {
    kind: 'show' | 'hide';
    /** The scrollTop what the field lacks is reckoned from. */
    ref: number;
    /** When the keyboard began to move (ms): kept across the moves planned again on its way. */
    since: number;
    frame: number | null;
    /** Whether the body is written each frame: not once the user scrolls it, nor going back to nowhere. */
    writes: boolean;
    /** The user scrolled the body while it moved. */
    user: boolean;
    /** Waits for the overlay to open before it reads where things go. */
    deferred: boolean;
    /** Where the field the move was planned for stands in the body's content (px), to tell it moved. */
    subjectAt: number | null;
    /**
     * The body's lock and padding as the keyboard began to move (none
     * where it rises again as it goes: they were to be put back), kept
     * across the moves planned again on its way.
     */
    roomBefore: Room;
    /** The body's lock and padding where the move ends, written once it has. */
    roomAfter: Room;
    /** The scrollTop last written. */
    written: number;
    // For the log.
    frames: number;
    foreign: number;
    foreignAt: number[];
    maxDiff: number;
    readMs: number;
}

/** The body's height locked or not, and the padding added to its bottom (px). */
interface Room {
    locked: boolean;
    pad: number;
}

/** Where the body comes to rest: its scrollTop and its room, and what the field lacked of it (0 where it is left). */
interface Rest extends Room {
    top: number;
    lack: number;
}

/**
 * Where the body comes to rest under `place`, measured once as at rest
 * from the body scrolled to `from` with `room`, `range` being how far it
 * scrolls so (`from` within it). A field lacking more than a pixel has the
 * body scrolled by what it lacks; where the keyboard covers the body's
 * bottom, its height is locked and its bottom padded by what it lacks of
 * the scroll room (less than a pixel is left: the browser gives the scroll
 * room in whole px), else the body goes as far as it scrolls. Otherwise the
 * body is left at `from` with `room`.
 */
function restOf(place: Place, from: number, room: Room, range: number): Rest {
    const need = lack(place, from);
    if (need <= REST_SLACK) return { top: from, lack: 0, ...room };
    let { locked, pad } = room;
    if (covered(place)) {
        locked = true;
        const short = from + need - range;
        if (short >= 1) pad += short;
    }
    return { top: Math.min(from + need, range + pad - room.pad), lack: need, locked, pad };
}

/**
 * Keeps the field typed at in a dialog's body in sight over the on-screen
 * keyboard, the body moving along with the keyboard.
 *
 * While the keyboard covers the window, a pixel of it or more, the overlay's
 * root is told how much of it the keyboard covers, as the CSS variable
 * `--tv-keyboard-overlap` (`keyboardOverlap`: `innerHeight - keyboardTop` in
 * whole px), written as the keyboard is told. The stylesheet lays out the
 * sheet and the box by it, and moves it over a transition of 250ms, so they
 * move with the keyboard. With no keyboard, nothing is set.
 *
 * Where the body rests once the keyboard is up (its scrollTop, its height
 * locked or not and its padding) is the body as it last stood at rest, the
 * keyboard closed or up, measured once as at rest where things stand then
 * (`restOf`): a field lacking more than a pixel of standing 10px above the
 * keyboard's top and the body's visible bottom has the body scrolled by
 * what it lacks, and where the keyboard covers the body's bottom (a box
 * taller than the room above the keyboard), the body's height is locked
 * as it stands, and its bottom padded by what it lacks of the scroll room.
 * It does not hang on what came while the keyboard rose, but where the user
 * scrolled the body meanwhile: that is where it is measured from.
 *
 * As the keyboard begins to rise, where things will stand once the overlap
 * has come is read (`RoomLayout.readAt`), and so where the body rests. The
 * body is moved there along with the overlap, frame by frame, by what the
 * field lacks at each frame (`scrollAlong`): the position is laid out by
 * the stylesheet alone, and read at each frame. On the way, the body keeps
 * the lock and the padding that reach both where it stands and where it
 * rests, and is given those it rests with once there, so it does not move
 * as they are. A field the keyboard will not hide has the body
 * held where it stood: the browser scrolling it meanwhile (on iPad, by tens
 * of px as the keyboard rises) is written over at the next frame. The body
 * is held so from the keyboard's will show until its did show and the
 * overlap's transition have both ended, at most 1000ms. While the overlay
 * still opens (its panel sliding up), the body is held and nothing is read,
 * since the field stands midway; once it has opened, the body moves along
 * from there.
 *
 * Once the keyboard is up, a field focused or a caret moving below the
 * keyboard's top has the body measured so at the next frame, and scrolled
 * at once.
 *
 * As the keyboard goes, the body moves back along with the overlap to where
 * it stood as the keyboard rose, and its height and padding are put back
 * once the overlap is gone. So is the body as the focus leaves the fields
 * (200ms after, or once the keyboard is up where it still rises) and as the
 * overlay closes, at once. Once the user scrolls the body (a wheel, a finger
 * moving on it), the move stops writing it and that place is dropped: the
 * body stays where the user took it, given back the lock and the padding
 * it had as the keyboard began to move and measured from there once the
 * keyboard is up; as the keyboard goes, it is left there, or brought back
 * there where it was scrolled for a field afterwards. A `scroll`
 * event cannot tell the user's scroll from the browser's, so the gestures
 * are listened to.
 *
 * A field is an input, a textarea, or an editable element (contenteditable:
 * a CodeMirror editor's content). What is typed at is the field's bottom,
 * and an editable element's caret (`selectionchange`, which the DOM fires for
 * any editable element, CodeMirror's own selection among them).
 *
 * The keyboard is told two ways, both followed through `KeyboardWatch`:
 * the visualViewport resizing or scrolling (Windows, Safari), and
 * Capacitor's events on the window (`keyboardWillShow` and the like, with a
 * `keyboardHeight`) on Obsidian mobile, where the WebView is not resized.
 */
export class KeyboardRoom {
    private readonly layout: RoomLayout;
    private state: State = 'closed';
    /** The body's scrollTop as the keyboard rose, gone back to as it goes; null once the user scrolls. */
    private returnTo: number | null = null;
    /** The field the move under way was planned for. */
    private subject: HTMLElement | null = null;
    private run: Run | null = null;
    /** The scroll room added to the body's bottom while it is locked (px). */
    private extraPad = 0;
    /** Where the body was last put for the keyboard, for the log as it goes. */
    private planned: number | null = null;
    /** The focus left the fields 200ms ago or more while the keyboard rose: the body is put back once it is up. */
    private restoreWhenShown = false;
    private attached = false;

    private unwatch: (() => void) | null = null;
    private blurTimer: ReturnType<typeof setTimeout> | null = null;
    private restFrame: number | null = null;
    private readonly focusHandler = (e: FocusEvent) => this.onFocus(e);
    private readonly blurHandler = () => this.onBlur();
    private readonly selectionHandler = () => this.onSelection();
    private readonly gestureHandler = () => this.onGesture();

    /**
     * `body` is the body that scrolls in the overlay `root`. It is given
     * here, before `attach`, so a keyboard already open as the overlay
     * attaches has the body's scrollTop kept from the start.
     */
    constructor(
        private readonly root: HTMLElement,
        private readonly win: Window,
        private readonly body: HTMLElement,
        private readonly options: KeyboardRoomOptions = {},
    ) {
        this.layout = new RoomLayout(root, win, body);
    }

    attach(): void {
        this.attached = true;
        // The keyboard's height is kept by KeyboardWatch before this is
        // told, so it is laid out again for the height just told.
        this.unwatch = watchKeyboard(this.win, (change) => this.onKeyboard(change));
        this.root.addEventListener('focusin', this.focusHandler);
        this.root.addEventListener('focusout', this.blurHandler);
        this.root.ownerDocument.addEventListener('selectionchange', this.selectionHandler);
        this.body.addEventListener('wheel', this.gestureHandler, { passive: true });
        this.body.addEventListener('touchmove', this.gestureHandler, { passive: true });

        // A keyboard already open as the overlay attaches (a dialog opened
        // from another while typing) is laid out above at once where the
        // root has not been laid out yet. Where it has (the body built
        // reading the layout), the overlap moves in from none over its
        // transition, and the body moves along with it as with a keyboard
        // rising.
        const overlap = keyboardOverlap(this.win);
        if (overlap > 0) {
            this.logState(overlap);
            this.layout.writeOverlap(overlap);
            this.returnTo = this.layout.scrollTop;
            if (this.movesWithOverlap() && this.layout.shownOverlap() !== overlap) {
                this.show(overlap);
            } else {
                this.state = 'shown';
                this.measureSoon();
            }
        }
    }

    detach(): void {
        this.attached = false;
        this.unwatch?.();
        this.unwatch = null;
        this.root.removeEventListener('focusin', this.focusHandler);
        this.root.removeEventListener('focusout', this.blurHandler);
        this.root.ownerDocument.removeEventListener('selectionchange', this.selectionHandler);
        this.body.removeEventListener('wheel', this.gestureHandler);
        this.body.removeEventListener('touchmove', this.gestureHandler);
        if (this.blurTimer) clearTimeout(this.blurTimer);
        this.blurTimer = null;
        if (this.restFrame !== null) this.win.cancelAnimationFrame?.(this.restFrame);
        this.restFrame = null;
        this.stopRun('detached');
        // The overlap given to the root is left on it: an overlay closing
        // over the open keyboard leaves where it stands.
        this.restore();
        this.state = 'closed';
        this.subject = null;
        this.restoreWhenShown = false;
    }

    // --- What is told ---

    private onKeyboard(change: KeyboardChange): void {
        if (change.cause !== 'viewportResize' && change.cause !== 'viewportScroll') {
            logDebug(`[kb] ${change.cause} h=${change.height ?? '-'} ih=${this.win.innerHeight}`);
        }
        const overlap = keyboardOverlap(this.win);
        if ((overlap > 0) !== (this.state !== 'closed' && this.state !== 'hiding')) this.logState(overlap);

        if (!this.movesWithOverlap()) {
            this.placedByScript(overlap);
            return;
        }
        if (overlap > 0) {
            if (this.state === 'closed') {
                this.returnTo ??= this.layout.scrollTop;
                this.show(overlap);
            } else if (overlap !== this.layout.writtenOverlap()) {
                this.show(overlap);
            } else if (this.state === 'shown') {
                this.measureSoon();
            }
        } else if (this.state === 'showing' || this.state === 'shown') {
            this.hide();
        } else if (this.layout.writtenOverlap() !== 0) {
            this.layout.writeOverlap(0);
        }
    }

    private logState(overlap: number): void {
        logDebug(
            `[kb] ${overlap > 0 ? 'open' : 'close'}` +
            ` overlap=${overlap} native=${nativeKeyboardHeight(this.win)}` +
            ` ih=${this.win.innerHeight}`);
    }

    private onFocus(e: FocusEvent): void {
        if (!isField(e.target)) return;
        if (this.blurTimer) { clearTimeout(this.blurTimer); this.blurTimer = null; }
        this.restoreWhenShown = false;
        // While the body moves, each frame reads the field focused.
        if (this.state === 'shown') this.measureSoon();
    }

    private onBlur(): void {
        if (this.blurTimer) clearTimeout(this.blurTimer);
        this.blurTimer = setTimeout(() => {
            this.blurTimer = null;
            if (this.activeField()) return;
            if (this.state === 'shown') this.restore();
            // While the keyboard rises, the body is put back once it is up,
            // so where it rests is the same whenever the focus left.
            else if (this.state === 'showing') this.restoreWhenShown = true;
        }, 200);
    }

    /** The caret of an editable field moving (typing on to a new line, a tap further down). */
    private onSelection(): void {
        if (this.state === 'shown') this.measureSoon();
    }

    /** The user scrolling the body: where it stood for the keyboard is no longer where it goes back to. */
    private onGesture(): void {
        this.returnTo = null;
        if (this.run) {
            this.run.writes = false;
            this.run.user = true;
        }
    }

    // --- The keyboard rising ---

    /**
     * The keyboard rising to `overlap`, or changing height: give the root
     * the overlap, and plan the body's move along with it, from where it
     * stands now to where it comes to rest.
     *
     * Where it comes to rest is the body as it last stood at rest (the
     * keyboard closed, or up), measured once as at rest where things will
     * stand (`restOf`), whatever came on the way: kept across the moves
     * planned again while it rises (another height, another field), its
     * scrollTop taken where the user took it meanwhile; where it goes back
     * to, while the keyboard goes. So a field the body was moved for and the
     * keyboard no longer hides has the body moved back there. On the way,
     * the body keeps the lock and the padding that reach both where it
     * stands and where it ends, and is given those it rests with once the
     * move has ended.
     */
    private show(overlap: number): void {
        const before = this.run;
        const fromTop = before?.writes ? before.written : this.layout.scrollTop;
        const rising = this.state === 'showing' && before !== null;
        const since = rising ? before.since : this.now();
        const roomBefore: Room = rising ? before.roomBefore
            : this.state === 'hiding' ? { locked: false, pad: 0 }
            : this.room();
        const ref = rising && !before.user ? before.ref
            : this.state === 'hiding' ? this.returnTo ?? fromTop
            : fromTop;
        // Everything is read before the move under way is stopped, so a
        // read that throws leaves it running.
        const field = this.activeField();
        const shown = this.layout.shownOverlap();
        const opening = this.opening();
        const read = field === null || opening !== null ? null
            : { now: this.layout.read(field), rest: this.layout.readAt(overlap, field) };
        this.stopRun('replaced');
        this.state = 'showing';
        this.subject = field;

        if (read === null) {
            this.layout.writeOverlap(overlap);
            const run = this.startRun('show', {
                fromTop, toTop: fromTop, ref, lackFrom: 0, lackTo: 0,
                overlapFrom: shown, overlapTo: overlap, since, deferred: opening !== null, subjectAt: null,
                // Nothing read: the body is held where it stands, and rests
                // with the room it had as the keyboard began to move.
                roomBefore, roomAfter: roomBefore,
            });
            if (opening) {
                logDebug(`[kb] plan deferred opening overlap=${Math.round(shown)}->${overlap}`);
                void opening.then(() => {
                    if (this.run === run && this.attached) this.show(this.layout.writtenOverlap());
                });
            }
            return;
        }

        const { now, rest } = read;
        const range = Math.max(0, rest.scrollRange - this.extraPad + roomBefore.pad);
        const from = Math.min(Math.max(0, ref), range);
        const end = restOf(rest, from, roomBefore, range);
        this.setRoom({ locked: end.locked || this.layout.locked(), pad: Math.max(end.pad, this.extraPad) }, rest.bodyHeight);
        if (end.lack > 0) {
            this.returnTo ??= from;
            this.planned = end.top;
            logDebug(
                `[kb] plan lack=${Math.round(end.lack)} covered=${covered(rest)} pad=${Math.round(end.pad)}` +
                ` scroll=${tenth(fromTop)}->${tenth(end.top)} overlap=${Math.round(shown)}->${overlap}`);
        } else {
            logDebug(`[kb] plan none overlap=${Math.round(shown)}->${overlap}`);
        }
        this.startRun('show', {
            fromTop, toTop: end.top, ref: from, lackFrom: lack(now, from), lackTo: lack(rest, from),
            overlapFrom: shown, overlapTo: overlap, since, deferred: false,
            subjectAt: contentAt(rest), roomBefore, roomAfter: { locked: end.locked, pad: end.pad },
        });
    }

    /** The body's lock and padding as they stand. */
    private room(): Room {
        return { locked: this.layout.locked(), pad: this.extraPad };
    }

    /** Give the body `room`: locked at `height` where it is not yet, and padded; or let go. */
    private setRoom(room: Room, height: number): void {
        if (!room.locked) {
            this.layout.release();
            this.extraPad = 0;
            return;
        }
        this.layout.lock(height);
        if (room.pad === this.extraPad) return;
        this.extraPad = room.pad;
        this.layout.pad(room.pad);
    }

    // --- The keyboard going ---

    /** The keyboard going: take the overlap off, and move the body back along with it. */
    private hide(): void {
        const before = this.run;
        const fromTop = before?.writes ? before.written : this.layout.scrollTop;
        this.stopRun('replaced');
        this.state = 'hiding';
        this.restoreWhenShown = false;
        const ref = this.returnTo;
        logDebug(
            `[kb] back from=${tenth(this.layout.scrollTop)} to=${ref === null ? 'none' : tenth(ref)}` +
            ` planned=${this.planned === null ? 'none' : tenth(this.planned)}`);
        const shown = this.layout.shownOverlap();
        const field = this.activeField();
        this.subject = field;
        // Read only once the overlay has opened, where the field stands at rest.
        if (ref === null || field === null || this.opening() !== null) {
            this.layout.writeOverlap(0);
            this.startRun('hide', {
                fromTop, toTop: ref ?? fromTop, ref: ref ?? fromTop, lackFrom: 0, lackTo: 0,
                overlapFrom: shown, overlapTo: 0, since: this.now(), deferred: false, subjectAt: null,
                roomBefore: { locked: false, pad: 0 }, roomAfter: { locked: false, pad: 0 },
            }, ref !== null);
            return;
        }
        const now = this.layout.read(field);
        const rest = this.layout.readAt(0, field);
        this.startRun('hide', {
            fromTop, toTop: ref, ref, lackFrom: lack(now, ref), lackTo: lack(rest, ref),
            overlapFrom: shown, overlapTo: 0, since: this.now(), deferred: false, subjectAt: null,
            roomBefore: { locked: false, pad: 0 }, roomAfter: { locked: false, pad: 0 },
        });
    }

    // --- A move, frame by frame ---

    private startRun(
        kind: Run['kind'],
        plan: Along & Pick<Run, 'ref' | 'since' | 'deferred' | 'subjectAt' | 'roomBefore' | 'roomAfter'>,
        writes = true,
    ): Run {
        const run: Run = {
            ...plan, kind, frame: null, writes, user: false, written: plan.fromTop,
            frames: 0, foreign: 0, foreignAt: [], maxDiff: 0, readMs: 0,
        };
        this.run = run;
        if (typeof this.win.requestAnimationFrame !== 'function') {
            // No frames to move over: where the move ends, at once.
            if (run.writes) this.layout.scrollTop = run.toTop;
            this.finishRun('done');
            return run;
        }
        run.frame = this.win.requestAnimationFrame(this.step);
        return run;
    }

    private readonly step = (): void => {
        const run = this.run;
        if (!run) return;
        run.frame = null;
        const t0 = this.now();
        const field = run.kind === 'show' ? this.activeField() : this.subject;
        const place = this.layout.read(field);
        run.readMs = Math.max(run.readMs, this.now() - t0);

        // The field the move was planned for, focused elsewhere or moved in
        // the body (a caret on to another line): planned again from here.
        if (run.kind === 'show' && !run.deferred
            && (field !== this.subject || moved(run.subjectAt, contentAt(place)))) {
            this.show(this.layout.writtenOverlap());
            return;
        }

        if (run.frames > 0 && run.writes) {
            const diff = Math.abs(place.scrollTop - run.written);
            if (diff >= 1) {
                run.foreign++;
                run.foreignAt.push(Math.round(this.now() - run.since));
                run.maxDiff = Math.max(run.maxDiff, diff);
            }
        }
        run.frames++;

        const capped = this.now() - run.since > MOVE_LIMIT_MS;
        const arrived = !run.deferred
            && Math.abs(place.overlap - run.overlapTo) < 0.5
            && (run.kind === 'hide' || !keyboardMoving(this.win));
        const done = capped || arrived;
        if (run.writes) {
            const top = done ? run.toTop : scrollAlong(run, lack(place, run.ref), place.overlap);
            if (place.scrollTop !== top) this.layout.scrollTop = top;
            run.written = top;
        }
        if (done) {
            this.finishRun(capped ? 'cap' : run.user ? 'user' : 'done');
        } else {
            run.frame = this.win.requestAnimationFrame(this.step);
        }
    };

    /** The move under way has ended: the keyboard up, or gone. */
    private finishRun(how: string): void {
        const run = this.run;
        if (!run) return;
        this.run = null;
        this.logRun(run, how);
        if (run.kind === 'show') {
            this.state = 'shown';
            // Where the user took the body, it is measured from there with
            // the room it had as the keyboard began to move, as at rest.
            const room = run.writes ? run.roomAfter : run.roomBefore;
            this.setRoom(room, this.layout.read(null).bodyHeight);
            if (this.restoreWhenShown) {
                this.restoreWhenShown = false;
                if (!this.activeField()) this.restore();
            }
            // Capped while the overlay still opened: measured once it has.
            if (!run.writes || run.deferred) this.measureSoon();
            return;
        }
        this.layout.release();
        this.extraPad = 0;
        if (run.writes && this.returnTo !== null) this.layout.scrollTop = this.returnTo;
        this.returnTo = null;
        this.planned = null;
        this.subject = null;
        this.state = 'closed';
    }

    /** Stop the move under way where it stands: another takes over, or the overlay closes. */
    private stopRun(how: 'replaced' | 'detached'): void {
        const run = this.run;
        if (!run) return;
        if (run.frame !== null) this.win.cancelAnimationFrame(run.frame);
        run.frame = null;
        this.run = null;
        this.logRun(run, how);
    }

    private logRun(run: Run, how: string): void {
        const outer = this.layout.outerScroll();
        logDebug(
            `[kb] ${run.toTop === run.fromTop ? 'held' : 'moved'}${run.kind === 'hide' ? ' back' : ''}` +
            ` frames=${run.frames} foreign=${run.foreign}` +
            (run.foreignAt.length > 0 ? ` foreignAt=${run.foreignAt.join(',')}ms` : '') +
            ` maxDiff=${Math.round(run.maxDiff)}px readMs=${run.readMs.toFixed(1)}` +
            ` end=${how} doc=${Math.round(outer.doc)} root=${Math.round(outer.root)}`);
    }

    // --- The keyboard at rest ---

    /** Measure the field focused at the next frame, once the overlay has opened. */
    private measureSoon(): void {
        if (this.restFrame !== null) return;
        const measure = () => {
            this.restFrame = null;
            const opening = this.opening();
            if (opening) {
                void opening.then(() => { if (this.attached) this.measureSoon(); });
                return;
            }
            this.measureAtRest();
        };
        if (typeof this.win.requestAnimationFrame !== 'function') {
            measure();
            return;
        }
        this.restFrame = this.win.requestAnimationFrame(measure);
    }

    /**
     * Scroll the body at once by what the field lacks of standing 10px above
     * the keyboard's top, while the keyboard is up and at rest; nothing while
     * it lacks a pixel or less.
     */
    private measureAtRest(): void {
        if (this.state !== 'shown') return;
        const field = this.activeField();
        if (!field) return;
        const place = this.layout.read(field, this.layout.writtenOverlap());
        const end = restOf(place, place.scrollTop, this.room(), place.scrollRange);
        if (end.lack === 0) return;
        this.returnTo ??= place.scrollTop;
        this.setRoom(end, place.bodyHeight);
        this.layout.scrollTop = end.top;
        this.planned = end.top;
        logDebug(`[kb] rest lack=${Math.round(end.lack)} covered=${covered(place)} pad=${Math.round(end.pad)}`);
    }

    /** A panel placed by script on the keyboard's events: given the overlap, and measured a frame after, once placed. */
    private placedByScript(overlap: number): void {
        this.stopRun('replaced');
        this.layout.writeOverlap(overlap);
        if (overlap > 0) {
            if (this.state === 'closed') this.returnTo ??= this.layout.scrollTop;
            this.state = 'shown';
            this.measureSoon();
        } else if (this.state !== 'closed') {
            this.restore();
            this.state = 'closed';
        }
    }

    /** Put the body's height, padding and scroll back where they were before the keyboard moved them. */
    private restore(): void {
        this.layout.release();
        this.extraPad = 0;
        this.planned = null;
        if (this.returnTo === null) return;
        logDebug('[kb] restore');
        this.layout.scrollTop = this.returnTo;
        this.returnTo = null;
    }

    // --- What is read ---

    private opening(): Promise<void> | null {
        return this.options.opening?.() ?? null;
    }

    private movesWithOverlap(): boolean {
        return this.options.movesWithOverlap?.() ?? true;
    }

    /** The field focused in the root, if any. */
    private activeField(): HTMLElement | null {
        const active = this.root.ownerDocument.activeElement;
        return this.root.contains(active) && isField(active) ? active : null;
    }

    /** The window's clock (ms). */
    private now(): number {
        return this.win.performance?.now() ?? Date.now();
    }
}

/** Where what is typed at stands in the body's content (px), whatever it is scrolled by; null with nothing. */
function contentAt(place: Place): number | null {
    return place.field === null ? null : place.field - place.bodyTop + place.scrollTop;
}

function moved(before: number | null, now: number | null): boolean {
    if (before === null || now === null) return before !== now;
    return Math.abs(now - before) > 1;
}

/** An input, a textarea, or an editable element (contenteditable, and what is in one). */
function isField(node: EventTarget | null): node is HTMLElement {
    return node instanceof HTMLInputElement
        || node instanceof HTMLTextAreaElement
        || (node as HTMLElement | null)?.isContentEditable === true;
}
