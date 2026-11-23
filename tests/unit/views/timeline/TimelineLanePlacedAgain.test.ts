import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NO_TASK_LOOKUP, toDisplayTask } from '../../../../src/services/display/DisplayTaskConverter';
import { TimelineSectionRenderer } from '../../../../src/views/timelineview/renderers/TimelineSectionRenderer';
import { makeTask } from '../../helpers/makeTask';
import type { DisplayTask, TimelineOverlapMode } from '../../../../src/types';

/**
 * A day column's cards are placed again, without a draw, when the column's
 * width changes or the view asks: the layout is taken again by the lane,
 * the zoom and the view's way of laying out as they are then, and the
 * cards' places rewritten. This suite runs without a DOM, so the column,
 * its cards, the observer, the stylesheet's lengths and the width a card
 * shows its times in are stand-ins.
 */

/** Counts what is written to it, so a pass that writes nothing shows. */
class Style {
    readonly props = new Map<string, string>();
    writes = 0;
    private w = '';
    private l = '';
    get width(): string { return this.w; }
    set width(value: string) { this.w = value; this.writes++; }
    get left(): string { return this.l; }
    set left(value: string) { this.l = value; this.writes++; }
    setProperty(name: string, value: string): void { this.props.set(name, value); this.writes++; }
    removeProperty(name: string): void { this.props.delete(name); this.writes++; }
    getPropertyValue(name: string): string { return this.props.get(name) ?? ''; }
}

class Lane {
    readonly style = new Style();
    readonly dataset: Record<string, string> = {};
    readonly children: Lane[] = [];
    parentElement: Lane | null = null;
    clientWidth = 0;
    addClass(): void { }
    removeClass(): void { }
    createDiv(): Lane {
        const child = new Lane();
        child.parentElement = this;
        this.children.push(child);
        return child;
    }
    appendChild(child: Lane): Lane {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }
}

let notify: ((entries: { target: unknown }[]) => void) | null = null;
let observing: unknown[] = [];

class FakeResizeObserver {
    constructor(callback: (entries: { target: unknown }[]) => void) { notify = callback; }
    observe(target: unknown): void { observing.push(target); }
    unobserve(target: unknown): void { observing = observing.filter(t => t !== target); }
    disconnect(): void { observing = []; }
}

// What the stylesheet gives a band: a notch of 24px, a halo reaching 4px
// left of the notch and 3px below the band.
const CSS_LENGTHS: Record<string, string> = {
    '--task-card-overflow-ext-offset': '24px',
    '--task-card-halo-inline': '4px',
    '--task-card-halo-block': '3px',
};

function at(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(2026, 2, 11, h, m).getTime();
}

function card(id: string, start: string, end: string): DisplayTask {
    const task = toDisplayTask(makeTask({ id, content: id, startDate: '2026-03-11' }), 0, NO_TASK_LOOKUP);
    return { ...task, drawn: { startMs: at(start), endMs: at(end) } };
}

/**
 * A renderer of the view's way of laying out (`mode`), its zoom, and the
 * width a card shows its start and end time whole in (`fullTime`), which
 * the stylesheet and the font decide and a DOM would measure.
 */
function renderer(
    mode: () => TimelineOverlapMode = () => 'cascade',
    zoom: () => number = () => 1,
    fullTime: (col: HTMLElement) => number = () => 120,
): TimelineSectionRenderer {
    return new TimelineSectionRenderer(
        { settings: { startHour: 0 } } as never,
        { render: () => { } } as never,
        zoom,
        mode,
        fullTime,
    );
}

function column(width: number): Lane {
    const col = new Lane();
    col.clientWidth = width;
    return col;
}

/** Draw `cols` as GridRenderer does: begin them, then each one's cards. */
function draw(r: TimelineSectionRenderer, cols: Lane[], tasks: () => DisplayTask[]): void {
    r.beginLanes(cols as unknown as HTMLElement[]);
    for (const col of cols) {
        r.render(col as unknown as HTMLElement, '2026-03-11', tasks(), { acquire: () => null } as never);
    }
}

// A is shifted right, its band going down from near the lane's top, where
// it cannot go up; B is the first of four that overlap. In a lane 40px wide
// A's band starts right of B's right edge, so no band hangs over B; in one
// 400px wide the band lies over B.
const bandTasks = () => [
    card('L', '00:00', '00:25'), card('A', '00:15', '00:20'),
    card('B', '00:25', '02:00'), card('X', '00:30', '02:00'),
    card('Y', '00:35', '02:00'), card('Z', '00:40', '02:00'),
];
const B = bandTasks().findIndex(t => t.id === 'B');

describe('TimelineSectionRenderer placing a column again without a draw', () => {
    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
        vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (name: string) => CSS_LENGTHS[name] ?? '' }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        notify = null;
        observing = [];
    });

    it('rewrites the gap to the name band above a card by the new width', () => {
        const r = renderer();
        const col = column(48);
        draw(r, [col], bandTasks);
        const b = col.children[B];
        expect(b.style.props.has('--band-gap-minutes')).toBe(false);

        col.clientWidth = 408;
        notify!([{ target: col }]);
        expect(b.style.getPropertyValue('--band-gap-minutes')).toBe('10');

        col.clientWidth = 48;
        notify!([{ target: col }]);
        expect(b.style.props.has('--band-gap-minutes')).toBe(false);
    });

    it('places every column again from one notice, every column being as wide', () => {
        const r = renderer();
        const cols = [column(48), column(48)];
        draw(r, cols, bandTasks);

        for (const col of cols) col.clientWidth = 408;
        notify!([{ target: cols[0] }]);
        expect(cols.map(col => col.children[B].style.getPropertyValue('--band-gap-minutes'))).toEqual(['10', '10']);
    });

    it('watches only the first column of a draw, and the last draw\'s no more', () => {
        const r = renderer();
        const first = [column(48), column(48), column(48)];
        draw(r, first, bandTasks);
        expect(observing).toEqual([first[0]]);

        const next = [column(48), column(48)];
        draw(r, next, bandTasks);
        expect(observing).toEqual([next[0]]);

        r.beginLanes([]);
        expect(observing).toEqual([]);
    });

    it('lays the cards out by the halo the stylesheet traces, its reach below a band and left and right of a card', () => {
        // In a column of 330px, g's band, going down from the lane's top,
        // and its halo cover 22 + 3 - 10 = 15px of L's top, more than the
        // 13.2px L can move its content down, so the band would hide L's
        // name and the two are put side by side, 4px apart: 159px each.
        const r = renderer(() => 'auto');
        const col = column(330);
        draw(r, [col], () => [card('g', '00:00', '00:05'), card('L', '00:10', '01:03')]);
        const [g, l] = col.children;
        const lanePx = (value: string) => Number(/\* ([\d.e-]+)\)$/.exec(value)![1]) * 322;
        expect([lanePx(g.style.left), lanePx(g.style.width)].map(px => Number(px.toFixed(1)))).toEqual([0, 159]);
        expect([lanePx(l.style.left), lanePx(l.style.width)].map(px => Number(px.toFixed(1)))).toEqual([163, 159]);
        expect(l.style.props.has('--band-gap-minutes')).toBe(false);
    });

    it('places the cards by the way of laying out as it is when asked, not as it was drawn', () => {
        let mode: TimelineOverlapMode = 'auto';
        const r = renderer(() => mode);
        const col = column(408);
        draw(r, [col], () => [card('a', '10:00', '11:00'), card('b', '10:05', '11:00')]);
        const b = col.children[1];
        expect(b.dataset.cascadeOffset).toBeUndefined();

        mode = 'cascade';
        r.placeLanesAgain();
        expect(b.dataset.cascadeOffset).toBe('1');

        // Side by side again, b stands 4px right of a with no card behind
        // it, and its halo goes.
        mode = 'auto';
        r.placeLanesAgain();
        expect(b.dataset.cascadeOffset).toBeUndefined();
    });

    it('marks a short card whose band goes up, and marks it again or no more when placed again at another zoom', () => {
        // At 1px a minute g is 2px high and its band goes up, clear of v's
        // name; at 5px a minute it is 22px high and shows its name inside.
        let zoom = 1;
        const r = renderer(() => 'cascade', () => zoom);
        const col = column(330);
        draw(r, [col], () => [card('g', '10:30', '10:35'), card('v', '10:40', '12:00')]);
        const [g, v] = col.children;
        expect(g.dataset.band).toBe('up');
        expect(v.dataset.band).toBeUndefined();

        zoom = 5;
        r.placeLanesAgain();
        expect(g.dataset.band).toBeUndefined();

        zoom = 1;
        r.placeLanesAgain();
        expect(g.dataset.band).toBe('up');
        expect(v.dataset.band).toBeUndefined();
    });

    it('marks a right edge over a card behind, and marks it again or no more when placed again', () => {
        // Shifted right, D, of no length, stands a level right of A as C
        // does, in front of B, which stands a level further right: D's
        // right edge lies over B. Side by side, D reaches the lane's right
        // edge and no right edge lies over a card.
        let mode: TimelineOverlapMode = 'cascade';
        const r = renderer(() => mode);
        const col = column(330);
        draw(r, [col], () => [
            card('A', '09:10', '09:45'), card('B', '09:25', '11:45'),
            card('C', '09:25', '12:25'), card('D', '09:25', '09:25'),
        ]);
        const d = col.children[3];
        expect(col.children.map(c => c.dataset.haloRight)).toEqual([undefined, undefined, undefined, '1']);

        mode = 'sideBySide';
        r.placeLanesAgain();
        expect(col.children.map(c => c.dataset.haloRight)).toEqual([undefined, undefined, undefined, undefined]);

        mode = 'cascade';
        r.placeLanesAgain();
        expect(d.dataset.haloRight).toBe('1');
    });

    it('marks a band\'s right edge over a card behind, and marks it again or no more when placed again at another zoom', () => {
        // At 1px a minute k3's band hangs over T, ending left of T's right
        // edge; at 5px a minute k3 shows its name inside and has no band.
        let zoom = 1;
        const r = renderer(() => 'auto', () => zoom);
        const col = column(330);
        draw(r, [col], () => [
            card('k1', '10:30', '10:35'), card('k2', '10:35', '10:40'),
            card('k3', '10:40', '10:45'), card('k4', '10:45', '10:50'),
            card('T', '10:50', '12:00'),
        ]);
        const k3 = col.children[2];
        const k4 = col.children[3];
        expect(k3.dataset.bandHaloRight).toBe('1');
        expect(k4.dataset.bandHaloRight).toBeUndefined();

        zoom = 5;
        r.placeLanesAgain();
        expect(k3.dataset.bandHaloRight).toBeUndefined();

        zoom = 1;
        r.placeLanesAgain();
        expect(k3.dataset.bandHaloRight).toBe('1');
    });

    it('writes nothing on a notice of the width it was drawn by', () => {
        const r = renderer();
        const col = column(48);
        draw(r, [col], bandTasks);
        for (const child of col.children) child.style.writes = 0;

        notify!([{ target: col }]);
        expect(col.children.map(child => child.style.writes)).toEqual(col.children.map(() => 0));
    });

    describe('by the width a card shows its start and end time whole in', () => {
        // Two cards whose times overlap. Side by side, 4px apart, b starts
        // at its column's left; shifted right, it starts 15% of the lane in.
        const pair = () => [card('a', '10:00', '11:00'), card('b', '10:05', '11:00')];
        /** Where b starts, in px of the lane (the column less 8px). */
        const bLeftPx = (col: Lane) =>
            Number(/\* ([\d.e-]+)\)$/.exec(col.children[1].style.left)![1]) * (col.clientWidth - 8);
        const SIDE_BY_SIDE = (col: Lane) => (col.clientWidth - 8 - 4) / 2 + 4;
        const SHIFTED = (col: Lane) => 0.15 * (col.clientWidth - 8);

        it('puts two cards side by side under auto where each column is as wide as that, and shifts them where narrower', () => {
            // A lane of 164px makes two columns of 80px; one of 163px, 79.5px.
            const at = renderer(() => 'auto', () => 1, () => 80);
            const wide = column(172);
            draw(at, [wide], pair);
            expect(bLeftPx(wide)).toBeCloseTo(SIDE_BY_SIDE(wide), 6);

            const below = renderer(() => 'auto', () => 1, () => 80);
            const narrow = column(171);
            draw(below, [narrow], pair);
            expect(bLeftPx(narrow)).toBeCloseTo(SHIFTED(narrow), 6);
        });

        it('measures it once a draw, not again when only the column\'s width changes', () => {
            const fullTime = vi.fn(() => 80);
            const r = renderer(() => 'auto', () => 1, fullTime);
            const col = column(172);
            draw(r, [col], pair);
            expect(fullTime).toHaveBeenCalledTimes(1);
            expect(fullTime).toHaveBeenCalledWith(col);

            // Placed again by the new width and the width measured at the draw.
            col.clientWidth = 171;
            notify!([{ target: col }]);
            expect(bLeftPx(col)).toBeCloseTo(SHIFTED(col), 6);
            col.clientWidth = 400;
            notify!([{ target: col }]);
            expect(bLeftPx(col)).toBeCloseTo(SIDE_BY_SIDE(col), 6);
            expect(fullTime).toHaveBeenCalledTimes(1);
        });

        it('measures it as a column drawn before it was laid out first has a width, and keeps it from then on', () => {
            // A column with no width shows no time row, so it measures 0.
            const fullTime = vi.fn((col: HTMLElement) => ((col as unknown as Lane).clientWidth > 0 ? 80 : 0));
            const r = renderer(() => 'auto', () => 1, fullTime);
            const col = column(0);
            draw(r, [col], pair);

            col.clientWidth = 172;
            notify!([{ target: col }]);
            expect(bLeftPx(col)).toBeCloseTo(SIDE_BY_SIDE(col), 6);
            expect(fullTime).toHaveBeenCalledTimes(2);

            col.clientWidth = 400;
            notify!([{ target: col }]);
            expect(fullTime).toHaveBeenCalledTimes(2);
        });

        it('measures it again when the stylesheet changes, and places the cards by the new width', () => {
            // A larger font: the times need 100px, wider than a column of 80px.
            let needs = 80;
            const fullTime = vi.fn(() => needs);
            const r = renderer(() => 'auto', () => 1, fullTime);
            const col = column(172);
            draw(r, [col], pair);
            expect(bLeftPx(col)).toBeCloseTo(SIDE_BY_SIDE(col), 6);

            needs = 100;
            r.measureLanesAgain();
            expect(fullTime).toHaveBeenCalledTimes(2);
            expect(bLeftPx(col)).toBeCloseTo(SHIFTED(col), 6);
        });

        it('writes nothing when the stylesheet changes nothing the lane is measured by', () => {
            const r = renderer(() => 'auto', () => 1, () => 80);
            const col = column(172);
            draw(r, [col], pair);
            for (const child of col.children) child.style.writes = 0;

            r.measureLanesAgain();
            expect(col.children.map(child => child.style.writes)).toEqual([0, 0]);
        });

        it('puts no cards side by side under auto where it measures 0 in a column with a width, and side by side still under side by side', () => {
            const auto = renderer(() => 'auto', () => 1, () => 0);
            const col = column(400);
            draw(auto, [col], pair);
            expect(bLeftPx(col)).toBeCloseTo(SHIFTED(col), 6);

            const sideBySide = renderer(() => 'sideBySide', () => 1, () => 0);
            const other = column(400);
            draw(sideBySide, [other], pair);
            expect(bLeftPx(other)).toBeCloseTo(SIDE_BY_SIDE(other), 6);
        });
    });
});
