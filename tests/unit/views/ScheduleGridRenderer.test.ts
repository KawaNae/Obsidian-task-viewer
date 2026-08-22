import { describe, it, expect, afterEach, vi } from 'vitest';
import { ScheduleGridRenderer } from '../../../src/views/scheduleview/renderers/ScheduleGridRenderer';
import { ScheduleGridCalculator } from '../../../src/views/scheduleview/utils/ScheduleGridCalculator';
import type { GridRow } from '../../../src/views/scheduleview/ScheduleTypes';

/**
 * Minimal `createDiv`/`querySelector`/`remove` shim — this suite runs in the
 * `node` vitest environment (no jsdom), so we model just enough of
 * HTMLElement to exercise ScheduleGridRenderer's DOM calls. Mirrors the
 * "plain object, no jsdom" pattern used in tests/unit/drag/GridMoveGesture.test.ts.
 */
class MiniElement {
    className: string;
    style: Record<string, string> = {};
    textContent = '';
    children: MiniElement[] = [];
    private parent: MiniElement | null = null;

    constructor(className = '') {
        this.className = className;
    }

    createDiv(cls: string): MiniElement {
        const el = new MiniElement(cls);
        el.parent = this;
        this.children.push(el);
        return el as unknown as MiniElement;
    }

    setText(text: string): void {
        this.textContent = text;
    }

    querySelector(selector: string): MiniElement | null {
        const cls = selector.replace(/^\./, '');
        return this.children.find(c => c.className.split(' ').includes(cls)) ?? null;
    }

    querySelectorAll(selector: string): MiniElement[] {
        const cls = selector.replace(/^\./, '');
        return this.children.filter(c => c.className.split(' ').includes(cls));
    }

    remove(): void {
        if (this.parent) {
            this.parent.children = this.parent.children.filter(c => c !== this);
            this.parent = null;
        }
    }
}

function asContainer(el: MiniElement): HTMLElement {
    return el as unknown as HTMLElement;
}

describe('ScheduleGridRenderer.updateNowLine', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    const calculator = new ScheduleGridCalculator({
        getStartHour: () => 0,
        hoursPerDay: 24,
        minGapHeightPx: 30,
        maxGapHeightPx: 100,
    });
    const timelineTopPaddingPx = 16;
    const renderer = new ScheduleGridRenderer(calculator, timelineTopPaddingPx);

    // Two hourly rows spanning 09:00–11:00, hand-built so the interpolation
    // math in getTopForMinute is easy to check by hand.
    const rows: GridRow[] = [
        { time: '09:00', minute: 540, index: 0, top: 0, height: 100 },
        { time: '10:00', minute: 600, index: 1, top: 100, height: 100 },
        { time: '11:00', minute: 660, index: 2, top: 200, height: 0 },
    ];
    const timelineHeight = 250;

    it('replaces the now-line in place (no accumulation) and moves top with the clock', () => {
        const container = new MiniElement('schedule-grid');

        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 7, 22, 9, 15, 30)); // 09:15:30 → minute 555.5
        renderer.renderNowLine(asContainer(container), rows, timelineHeight);

        let lines = container.querySelectorAll('.schedule-grid__now-line');
        expect(lines).toHaveLength(1);

        // ratio = (555.5 - 540) / 60 = 0.2583..; top = 25.83 + 16 padding
        const topA = parseFloat(lines[0].style.top);
        expect(topA).toBeCloseTo(41.83, 1);

        vi.setSystemTime(new Date(2026, 7, 22, 9, 45, 0)); // 09:45:00 → minute 585
        renderer.updateNowLine(asContainer(container), rows, timelineHeight);

        lines = container.querySelectorAll('.schedule-grid__now-line');
        // Still exactly one — the old element was removed, not left in place
        // alongside a new one.
        expect(lines).toHaveLength(1);

        // ratio = (585 - 540) / 60 = 0.75; top = 75 + 16 padding
        const topB = parseFloat(lines[0].style.top);
        expect(topB).toBeCloseTo(91, 1);
        expect(topB).not.toBeCloseTo(topA, 1);
    });
});
