import { describe, it, expect } from 'vitest';
import { isFormEnter, onFormEnter } from '../../../src/modals/form/formEnter';

/**
 * Every field's Enter goes through `onFormEnter`: an Enter an IME uses to
 * commit a conversion is not the form's, and the next Enter is. The
 * browsers send that Enter in their own ways, which the table lays side by
 * side.
 */
interface Key {
    key: string;
    isComposing: boolean;
    keyCode: number;
}

function key(init: Partial<Key> = {}): KeyboardEvent & { prevented: boolean } {
    const e = {
        key: 'Enter', isComposing: false, keyCode: 13, prevented: false,
        preventDefault() { e.prevented = true; },
        ...init,
    };
    return e as unknown as KeyboardEvent & { prevented: boolean };
}

/** A field that records its listeners, and fires them as the browser would. */
class FakeField {
    private listeners = new Map<string, ((e: unknown) => void)[]>();
    addEventListener(type: string, fn: (e: unknown) => void): void {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
    }
    removeEventListener(type: string, fn: (e: unknown) => void): void {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter(l => l !== fn));
    }
    fire(type: string, e: unknown = {}): void {
        for (const fn of this.listeners.get(type) ?? []) fn(e);
    }
    count(type: string): number {
        return this.listeners.get(type)?.length ?? 0;
    }
    get el(): HTMLElement {
        return this as unknown as HTMLElement;
    }
}

describe('isFormEnter', () => {
    const table: [string, Partial<Key>, boolean][] = [
        ['Chromium on macOS: the Enter that commits a conversion carries isComposing', { isComposing: true, keyCode: 229 }, false],
        ['Safari and WebKit (iPad): the composition has ended, the Enter still carries keyCode 229', { isComposing: false, keyCode: 229 }, false],
        ['Chromium on Windows: a key pressed while composing is Process', { key: 'Process', keyCode: 229 }, false],
        ['the Enter after the conversion: keyCode 13, not composing', {}, true],
        ['an Enter dispatched with no keyCode (a script)', { keyCode: 0 }, true],
        ['another key', { key: 'a', keyCode: 65 }, false],
    ];
    it.each(table)('%s', (_name, init, expected) => {
        expect(isFormEnter(key(init))).toBe(expected);
    });

    it('a field composing by its own flag holds the Enter back', () => {
        expect(isFormEnter(key(), true)).toBe(false);
    });
});

describe('onFormEnter', () => {
    it('runs on the form\'s Enter, preventing its default, and on no other key', () => {
        const field = new FakeField();
        const ran: KeyboardEvent[] = [];
        onFormEnter(field.el, (e) => ran.push(e));

        const ime = key({ isComposing: true, keyCode: 229 });
        field.fire('keydown', ime);
        field.fire('keydown', key({ key: 'a', keyCode: 65 }));
        expect(ran).toHaveLength(0);
        expect(ime.prevented).toBe(false);

        const enter = key();
        field.fire('keydown', enter);
        expect(ran).toEqual([enter]);
        expect(enter.prevented).toBe(true);
    });

    it('holds back an Enter between compositionstart and compositionend, whatever the event says', () => {
        const field = new FakeField();
        let runs = 0;
        onFormEnter(field.el, () => runs++);
        field.fire('compositionstart');
        field.fire('keydown', key());
        expect(runs).toBe(0);
        field.fire('compositionend');
        field.fire('keydown', key());
        expect(runs).toBe(1);
    });

    it('leaves the Enter to a list open on the field, and the next one is the form\'s', () => {
        const field = new FakeField();
        let shown = true;
        let runs = 0;
        onFormEnter(field.el, () => runs++, { takesEnter: () => shown });
        const picked = key();
        field.fire('keydown', picked);
        expect(runs).toBe(0);
        expect(picked.prevented).toBe(false);
        shown = false;
        field.fire('keydown', key());
        expect(runs).toBe(1);
    });

    it('runs several handlers of one field in the order they were put on, keeping one composition flag', () => {
        const field = new FakeField();
        const order: string[] = [];
        onFormEnter(field.el, () => order.push('first'));
        onFormEnter(field.el, () => order.push('second'));
        expect(field.count('compositionstart')).toBe(1);
        field.fire('keydown', key());
        expect(order).toEqual(['first', 'second']);
    });

    it('is taken off by what it returns', () => {
        const field = new FakeField();
        let runs = 0;
        const off = onFormEnter(field.el, () => runs++);
        off();
        field.fire('keydown', key());
        expect(runs).toBe(0);
    });
});
