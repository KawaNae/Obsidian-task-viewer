import { describe, it, expect } from 'vitest';
import type { Keymap } from 'obsidian';
import { HotkeyShield } from '../../../../src/views/sharedUI/HotkeyShield';

/**
 * `HotkeyShield` follows where the focus last went: into the surface pushes
 * a scope with no parent, to an element outside pops it, and a focus that
 * goes to no element leaves it as it was. The document and the keymap are
 * stand-ins that record what they were told.
 */

class FakeDoc {
    activeElement: object | null = null;
    private listeners: ((e: { target: object | null }) => void)[] = [];
    /** How each listener was put on: its event and whether in the capture phase. */
    ways: string[] = [];
    addEventListener(type: string, fn: (e: { target: object | null }) => void, capture?: boolean): void { this.listeners.push(fn); this.ways.push(`${type} ${capture ? 'capture' : 'bubble'}`); }
    removeEventListener(_type: string, fn: (e: { target: object | null }) => void): void { this.listeners = this.listeners.filter(l => l !== fn); }
    focus(target: object): void { this.activeElement = target; this.listeners.forEach(l => l({ target })); }
    get listening(): number { return this.listeners.length; }
}

function setUp(activeInside = false) {
    const inside = { name: 'field in the panel' };
    const outside = { name: 'note editor' };
    const doc = new FakeDoc();
    if (activeInside) doc.activeElement = inside;
    const stack: unknown[] = [];
    const keymap = {
        pushScope: (scope: unknown) => { stack.push(scope); },
        popScope: (scope: unknown) => { const i = stack.indexOf(scope); if (i >= 0) stack.splice(i, 1); },
    } as unknown as Keymap;
    const shield = new HotkeyShield(keymap, doc as unknown as Document, (node) => node === (inside as unknown));
    return { shield, doc, stack, inside, outside };
}

describe('HotkeyShield', () => {
    it('pushes a scope while the focus is in the surface, and pops it once the focus goes to an element outside', () => {
        const h = setUp();
        expect(h.stack).toHaveLength(0);
        h.doc.focus(h.inside);
        expect(h.stack).toHaveLength(1);
        expect((h.stack[0] as { parent?: unknown }).parent).toBeUndefined();
        h.doc.focus(h.inside);
        expect(h.stack).toHaveLength(1);
        h.doc.focus(h.outside);
        expect(h.stack).toHaveLength(0);
    });

    it('follows the focus in the capture phase of focus: before a field\'s own focus listeners, where an input suggest opens its list and pushes its scope above this one', () => {
        expect(setUp().doc.ways).toEqual(['focus capture']);
    });

    it('pushes at once when the focus is in the surface already', () => {
        expect(setUp(true).stack).toHaveLength(1);
    });

    it('pops and stops following the focus once detached', () => {
        const h = setUp(true);
        h.shield.detach();
        expect(h.stack).toHaveLength(0);
        expect(h.doc.listening).toBe(0);
    });
});
