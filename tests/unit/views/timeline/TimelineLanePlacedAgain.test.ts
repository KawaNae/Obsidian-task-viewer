import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NO_TASK_LOOKUP, toDisplayTask } from '../../../../src/services/display/DisplayTaskConverter';
import { TimelineSectionRenderer } from '../../../../src/views/timelineview/renderers/TimelineSectionRenderer';
import { makeTask } from '../../helpers/makeTask';
import type { DisplayTask } from '../../../../src/types';

/**
 * A day column's cards are placed again, without a draw, when the column's
 * width changes or the view asks: the layout is taken again by the lane,
 * the zoom and the narrowest a card put side by side may be as they are
 * then, and the cards' places rewritten. This suite runs without a DOM, so
 * the column, its cards, the observer and the stylesheet's lengths are
 * stand-ins.
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

// What the stylesheet gives a band: a notch of 24px, a 4px halo.
const CSS_LENGTHS: Record<string, string> = {
    '--task-card-overflow-ext-offset': '24px',
    '--task-card-halo-inline': '4px',
};

function at(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(2026, 2, 11, h, m).getTime();
}

function card(id: string, start: string, end: string): DisplayTask {
    const task = toDisplayTask(makeTask({ id, content: id, startDate: '2026-03-11' }), 0, NO_TASK_LOOKUP);
    return { ...task, drawn: { startMs: at(start), endMs: at(end) } };
}

function renderer(narrowest: () => number | null = () => null): TimelineSectionRenderer {
    return new TimelineSectionRenderer(
        { settings: { startHour: 0 } } as never,
        { render: () => { } } as never,
        () => 1,
        narrowest,
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

// A is shifted right, B is the first of four that overlap. In a lane 40px
// wide A's band starts right of B's right edge, so B takes the gap from L;
// in one 400px wide the band lies over B.
const bandTasks = () => [
    card('L', '10:00', '11:05'), card('A', '11:00', '11:05'),
    card('B', '11:05', '12:00'), card('X', '11:10', '12:00'),
    card('Y', '11:15', '12:00'), card('Z', '11:20', '12:00'),
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
        expect(b.style.getPropertyValue('--band-gap-minutes')).toBe('65');

        col.clientWidth = 408;
        notify!([{ target: col }]);
        expect(b.style.getPropertyValue('--band-gap-minutes')).toBe('5');

        col.clientWidth = 48;
        notify!([{ target: col }]);
        expect(b.style.getPropertyValue('--band-gap-minutes')).toBe('65');
    });

    it('places every column again from one notice, every column being as wide', () => {
        const r = renderer();
        const cols = [column(48), column(48)];
        draw(r, cols, bandTasks);

        for (const col of cols) col.clientWidth = 408;
        notify!([{ target: cols[0] }]);
        expect(cols.map(col => col.children[B].style.getPropertyValue('--band-gap-minutes'))).toEqual(['5', '5']);
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

    it('places the cards by the narrowest as it is when asked, not as it was drawn', () => {
        let narrowest: number | null = 120;
        const r = renderer(() => narrowest);
        const col = column(408);
        draw(r, [col], () => [card('a', '10:00', '11:00'), card('b', '10:05', '11:00')]);
        const b = col.children[1];
        expect(b.dataset.cascadeOffset).toBeUndefined();

        narrowest = null;
        r.placeLanesAgain();
        expect(b.dataset.cascadeOffset).toBe('1');
    });

    it('writes nothing on a notice of the width it was drawn by', () => {
        const r = renderer();
        const col = column(48);
        draw(r, [col], bandTasks);
        for (const child of col.children) child.style.writes = 0;

        notify!([{ target: col }]);
        expect(col.children.map(child => child.style.writes)).toEqual(col.children.map(() => 0));
    });
});
