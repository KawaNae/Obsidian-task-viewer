import { describe, it, expect, vi } from 'vitest';
import { TabStrip } from '../../../../src/views/sharedUI/TabStrip';
import { FocusDoc, asEl, type FocusEl } from '../../helpers/focusDom';

/**
 * A row of tabs over the panes they choose between, in a stand-in DOM
 * (`focusDom`). Each tab is a button: chosen by a click, by the arrows (round
 * at the ends), Home and End, its own button then taking the focus; the
 * tab chosen alone is in the Tab order. Every pane is built and kept, the
 * panes not chosen marked off (`inert`, `is-hidden`); the stand-in DOM keeps
 * no focus out of an `inert` pane, so the marks are what is read. A focus
 * in the pane left goes to the button of the tab chosen; one on the row
 * stays. A tab is chosen for an element in its pane (`reveal`), the focus
 * left to the caller who puts it there.
 */

type Tab = 'one' | 'two' | 'three';

function setUp(initial: Tab = 'one') {
    const doc = new FocusDoc();
    const root = doc.root();
    const before = root.createDiv();
    const onSelect = vi.fn();
    const strip = new TabStrip<Tab>(asEl(root), [
        { id: 'one', label: '一', icon: 'list' },
        { id: 'two', label: '二' },
        { id: 'three', label: '三' },
    ], { initial, onSelect });
    const list = root.find('tv-tabs')!;
    const panes = root.find('tv-tabs__panes')!;
    const buttons = list.findAll('tv-tabs__tab');
    const paneEls = panes.findAll('tv-tabs__pane');
    const key = (target: FocusEl, name: string) => {
        const e = Object.assign(new Event('keydown', { cancelable: true }), { key: name });
        target.dispatchEvent(e);
        return e;
    };
    const press = (target: FocusEl) => target.dispatchEvent(new Event('click'));
    return { doc, root, before, panes, strip, list, buttons, paneEls, onSelect, key, press };
}

/** Which tabs read as chosen, by their marks: the class, `aria-selected`, the Tab order, and the pane's marks. */
function marks(s: ReturnType<typeof setUp>) {
    return s.buttons.map((button, i) => ({
        active: button.classes.has('is-active'),
        selected: button.attrs.get('aria-selected'),
        tabindex: button.attrs.get('tabindex'),
        hidden: s.paneEls[i].classes.has('is-hidden'),
        inert: s.paneEls[i].attrs.has('inert'),
    }));
}

const ON = { active: true, selected: 'true', tabindex: '0', hidden: false, inert: false };
const OFF = { active: false, selected: 'false', tabindex: '-1', hidden: true, inert: true };

describe('TabStrip', () => {
    it('builds a tablist of buttons, each naming the pane it controls, and a tabpanel for each', () => {
        const s = setUp();
        expect(s.list.attrs.get('role')).toBe('tablist');
        expect(s.panes.classes.has('tv-tabs__panes')).toBe(true);
        expect(s.buttons).toHaveLength(3);
        s.buttons.forEach((button, i) => {
            const pane = s.paneEls[i];
            expect(button.attrs.get('role')).toBe('tab');
            expect(button.attrs.get('type')).toBe('button');
            expect(pane.attrs.get('role')).toBe('tabpanel');
            expect(button.attrs.get('aria-controls')).toBe(pane.attrs.get('id'));
            expect(pane.attrs.get('aria-labelledby')).toBe(button.attrs.get('id'));
        });
        expect(new Set(s.buttons.map(b => b.attrs.get('id'))).size).toBe(3);
        expect(s.buttons[0].find('tv-tabs__label')!.text).toBe('一');
        expect(s.buttons[0].find('tv-tabs__icon')).not.toBeNull();
        expect(s.buttons[1].find('tv-tabs__icon')).toBeNull();
    });

    it('builds the row and then the panes at the end of its parent', () => {
        const s = setUp();
        expect(s.root.children).toEqual([s.before, s.list, s.panes]);
    });

    it('names each tab\'s id on its button, for a tab to be found by what it is', () => {
        const s = setUp();
        expect(s.buttons.map(b => b.attrs.get('data-tab'))).toEqual(['one', 'two', 'three']);
    });

    it('gives each strip ids of its own', () => {
        const a = setUp();
        const b = setUp();
        expect(a.buttons[0].attrs.get('id')).not.toBe(b.buttons[0].attrs.get('id'));
    });

    it('opens on the tab it is told, the others off', () => {
        const s = setUp('two');
        expect(s.strip.selected).toBe('two');
        expect(marks(s)).toEqual([OFF, ON, OFF]);
        expect(s.onSelect).not.toHaveBeenCalled();
    });

    it('hands each pane out by its tab', () => {
        const s = setUp();
        expect(s.strip.pane('three')).toBe(asEl(s.paneEls[2]));
    });

    it('chooses a tab by a click, and tells it once it is chosen', () => {
        const s = setUp();
        s.press(s.buttons[2]);
        expect(s.strip.selected).toBe('three');
        expect(marks(s)).toEqual([OFF, OFF, ON]);
        expect(s.onSelect).toHaveBeenCalledTimes(1);
        expect(s.onSelect).toHaveBeenCalledWith('three');
    });

    it('tells nothing when the tab chosen is the one chosen already', () => {
        const s = setUp();
        s.strip.select('one');
        s.press(s.buttons[0]);
        expect(s.onSelect).not.toHaveBeenCalled();
        expect(marks(s)).toEqual([ON, OFF, OFF]);
    });

    it('goes to the next and the previous tab by the arrows, round at the ends, the button taking the focus', () => {
        const s = setUp();
        s.buttons[0].focus();
        const right = s.key(s.buttons[0], 'ArrowRight');
        expect(right.defaultPrevented).toBe(true);
        expect(s.strip.selected).toBe('two');
        expect(s.doc.activeElement).toBe(s.buttons[1]);

        s.key(s.buttons[1], 'ArrowRight');
        s.key(s.buttons[2], 'ArrowRight');
        expect(s.strip.selected).toBe('one');
        expect(s.doc.activeElement).toBe(s.buttons[0]);

        s.key(s.buttons[0], 'ArrowLeft');
        expect(s.strip.selected).toBe('three');
        expect(s.doc.activeElement).toBe(s.buttons[2]);
        expect(marks(s)).toEqual([OFF, OFF, ON]);
    });

    it('goes to the first and the last tab by Home and End', () => {
        const s = setUp('two');
        s.buttons[1].focus();
        s.key(s.buttons[1], 'End');
        expect(s.strip.selected).toBe('three');
        expect(s.doc.activeElement).toBe(s.buttons[2]);
        s.key(s.buttons[2], 'Home');
        expect(s.strip.selected).toBe('one');
        expect(s.doc.activeElement).toBe(s.buttons[0]);
    });

    it('leaves the other keys to the button', () => {
        const s = setUp();
        const enter = s.key(s.buttons[0], 'Enter');
        expect(enter.defaultPrevented).toBe(false);
        expect(s.strip.selected).toBe('one');
    });

    it('moves a focus in the pane it leaves to the button of the tab chosen', () => {
        const s = setUp();
        const input = s.paneEls[0].createEl('input');
        input.focus();
        s.press(s.buttons[1]);
        expect(s.doc.activeElement).toBe(s.buttons[1]);

        const other = s.paneEls[1].createEl('input');
        other.focus();
        s.strip.select('three');
        expect(s.doc.activeElement).toBe(s.buttons[2]);
    });

    it('leaves a focus on its row, or outside the panes, where it is', () => {
        const s = setUp();
        s.buttons[0].focus();
        s.press(s.buttons[2]);
        expect(s.doc.activeElement).toBe(s.buttons[0]);

        const outside = s.doc.root().createEl('input');
        outside.focus();
        s.strip.select('one');
        expect(s.doc.activeElement).toBe(outside);
    });

    it('chooses the tab whose pane holds an element, moving no focus, and tells whether it did', () => {
        const s = setUp();
        const input = s.paneEls[0].createEl('input');
        input.focus();
        const deep = s.paneEls[2].createDiv().createEl('input');

        expect(s.strip.reveal(asEl(deep))).toBe(true);
        expect(s.strip.selected).toBe('three');
        expect(s.doc.activeElement).toBe(input);
        expect(s.onSelect).toHaveBeenCalledWith('three');

        // In the pane chosen already: chosen, nothing told.
        expect(s.strip.reveal(asEl(deep))).toBe(true);
        expect(s.onSelect).toHaveBeenCalledTimes(1);
    });

    it('chooses nothing for an element in no pane', () => {
        const s = setUp();
        const outside = s.doc.root().createEl('input');
        expect(s.strip.reveal(asEl(outside))).toBe(false);
        expect(s.strip.reveal(asEl(s.buttons[2]))).toBe(false);
        expect(s.strip.selected).toBe('one');
        expect(s.onSelect).not.toHaveBeenCalled();
    });
});
