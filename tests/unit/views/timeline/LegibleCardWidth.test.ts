import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { legibleCardPx, measureLegibleCardPx } from '../../../../src/views/timelineview/LegibleCardWidth';
import type { TaskViewerSettings } from '../../../../src/types';

/**
 * The narrowest legible card from the lengths read off a card in the
 * column. Reading them takes a DOM laid out by a stylesheet, which this
 * suite has not; the lengths below are those of the default stylesheet on
 * the desktop: start and end 67.03125px, the time row 6px in from each
 * side, the name's box 38px in from the left and 2px from the right.
 */
describe('legibleCardPx', () => {
    it('adds to the times the wider of the time row\'s sides and the name box\'s', () => {
        expect(legibleCardPx({ timeUnitsPx: 67.03125, timeRowSidesPx: 12, nameBoxSidesPx: 40 })).toBe(107.03125);
        // A stylesheet that put the name's box further out than the time row
        // would still have the times whole.
        expect(legibleCardPx({ timeUnitsPx: 67.03125, timeRowSidesPx: 12, nameBoxSidesPx: 8 })).toBe(79.03125);
    });

    it('is 0 where the times were not laid out, whatever the sides', () => {
        expect(legibleCardPx({ timeUnitsPx: 0, timeRowSidesPx: 12, nameBoxSidesPx: 40 })).toBe(0);
        expect(legibleCardPx({ timeUnitsPx: Number.NaN, timeRowSidesPx: 12, nameBoxSidesPx: 40 })).toBe(0);
    });
});

/**
 * How the column lays out what a card holds: the width of each glyph of
 * the time row's font, and where the box of a task's name stands in from
 * the card's sides.
 */
interface ColumnLayout {
    widthPx: number;
    glyphPx: (glyph: string) => number;
    nameBoxInsetPx: [number, number];
}

/**
 * An element of a stand-in DOM: what drawing the time row and the frame of
 * a task's line touches, laid out by the column it is in. A card is as
 * wide as the column, a name's box stands in from it, and a text is as
 * wide as its glyphs.
 */
class El {
    readonly children: El[] = [];
    parent: El | null = null;
    readonly style: Record<string, string> = {};
    textContent = '';
    constructor(readonly cls: string, private readonly layout: ColumnLayout) { }
    createEl(_tag: string, options: { cls?: string } = {}): El {
        const child = new El(options.cls ?? '', this.layout);
        child.parent = this;
        this.children.push(child);
        return child;
    }
    createDiv(cls = ''): El { return this.createEl('div', { cls }); }
    createSpan(cls = ''): El { return this.createEl('span', { cls }); }
    get lastElementChild(): El | null { return this.children[this.children.length - 1] ?? null; }
    remove(): void {
        if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
        this.parent = null;
    }
    getBoundingClientRect(): { left: number; right: number; width: number } {
        const { widthPx, nameBoxInsetPx: [inLeft, inRight] } = this.layout;
        if (this.cls === 'task-card') return { left: 0, right: widthPx, width: widthPx };
        if (this.cls === 'task-list-item') return { left: inLeft, right: widthPx - inRight, width: widthPx - inLeft - inRight };
        const width = this.textWidth();
        return { left: 0, right: width, width };
    }
    private textWidth(): number {
        if (this.children.length > 0) return this.children.reduce((sum, child) => sum + child.textWidth(), 0);
        return [...this.textContent].reduce((sum, glyph) => sum + this.layout.glyphPx(glyph), 0);
    }
}

/**
 * What the stylesheet gives a card and its time row: a border of 1px each
 * side, and the row 6px in from each.
 */
function computedStyleOf(el: El): Partial<CSSStyleDeclaration> {
    if (el.cls === 'task-card') return { borderLeftWidth: '1px', borderRightWidth: '1px' };
    if (el.cls === 'task-card__time') return { left: '6px', right: '6px' };
    return {};
}

// A font whose digits differ: '8' the widest, '1' the narrowest.
const GLYPH_PX: Record<string, number> = { ':': 4, '>': 5, '1': 5, '8': 7.5 };
const glyphPx = (glyph: string) => GLYPH_PX[glyph] ?? 6;

function measure(col: El): number {
    return measureLegibleCardPx(col as unknown as HTMLElement, {} as TaskViewerSettings);
}

describe('measureLegibleCardPx', () => {
    beforeEach(() => vi.stubGlobal('getComputedStyle', computedStyleOf));
    afterEach(() => vi.unstubAllGlobals());

    it('takes the times of the widest digit, and the name box\'s sides where they are the wider', () => {
        const col = new El('', { widthPx: 300, glyphPx, nameBoxInsetPx: [38, 2] });
        // '88:88' and '>88:88' are 34 + 39 = 73px; the name's box stands
        // 38 + 2 = 40px in, more than the row's 6 + 6 and the borders' 1 + 1.
        expect(measure(col)).toBe(113);
    });

    it('takes the time row\'s sides and the card\'s borders where the name\'s box stands less far in', () => {
        const col = new El('', { widthPx: 300, glyphPx, nameBoxInsetPx: [4, 2] });
        // The row's 6 + 6 and the borders' 1 + 1 are 14px, more than 4 + 2.
        expect(measure(col)).toBe(87);
    });

    it('leaves nothing in the column it measures in', () => {
        const col = new El('', { widthPx: 300, glyphPx, nameBoxInsetPx: [38, 2] });
        measure(col);
        expect(col.children).toEqual([]);
    });
});
