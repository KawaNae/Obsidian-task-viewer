import { describe, it, expect, afterEach } from 'vitest';
import { PopoverSuggest, historyStack } from 'obsidian';
import { holdHistoryBack } from '../../../src/views/sharedUI/HistoryBack';

/**
 * `holdHistoryBack` against a `PopoverSuggest` whose `open` and `close` are
 * written as Obsidian's (the mock): the stand-in goes onto the stack of what
 * takes the back, and comes off it, with no scope pushed and no DOM touched.
 */

const suggest = PopoverSuggest.prototype as unknown as { open: () => void; close: () => void };
const { open, close } = suggest;

afterEach(() => {
    suggest.open = open;
    suggest.close = close;
    historyStack.length = 0;
});

describe('holdHistoryBack', () => {
    it('stands on top of the stack while held, so the back comes to it, and comes off once let go', () => {
        const backs: string[] = [];
        const under = holdHistoryBack(() => backs.push('under'));
        const release = holdHistoryBack(() => backs.push('top'));
        expect(historyStack).toHaveLength(2);

        historyStack[historyStack.length - 1].onHistoryBack();
        expect(backs).toEqual(['top']);
        // Refused (the overlay stays open), it keeps its place.
        expect(historyStack).toHaveLength(2);

        release();
        release();
        expect(historyStack).toHaveLength(1);
        historyStack[historyStack.length - 1].onHistoryBack();
        expect(backs).toEqual(['top', 'under']);
        under();
        expect(historyStack).toHaveLength(0);
    });

    it('pushes nothing, and throws nothing, when Obsidian\'s open no longer runs on the stand-in', () => {
        suggest.open = function (this: { missing: { el: unknown } }) { void this.missing.el; };
        const release = holdHistoryBack(() => {});
        expect(historyStack).toHaveLength(0);
        expect(() => release()).not.toThrow();
    });
});
