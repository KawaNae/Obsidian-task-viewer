import { describe, it, expect } from 'vitest';
import { MarkdownView } from 'obsidian';
import { EditorObserver, pressesCheckbox } from '../../../../src/services/core/EditorObserver';
import { EditorSignal } from '../../../../src/services/core/EditorSignal';

/**
 * A mousedown raises the editor's signal only on a task's checkbox (F6).
 * Anywhere else in the editor it says nothing about the next change to the
 * file, and a sync that came after it used to fire as a hand completion.
 */

/** An element whose ancestors carry these classes, nearest first. */
function element(...classes: string[]): EventTarget {
    return {
        closest: (selector: string) => {
            const wanted = selector.replace(/^\./, '');
            return classes.includes(wanted) ? {} : null;
        },
    } as unknown as EventTarget;
}

describe('pressesCheckbox', () => {
    it('is true on the checkbox Live Preview draws for a task', () => {
        expect(pressesCheckbox(element('task-list-item-checkbox'))).toBe(true);
    });

    it('is false on text, on a line, and on nothing', () => {
        expect(pressesCheckbox(element('cm-line'))).toBe(false);
        expect(pressesCheckbox(element('cm-content', 'HyperMD-task-line'))).toBe(false);
        expect(pressesCheckbox(null)).toBe(false);
        expect(pressesCheckbox({} as EventTarget)).toBe(false);
    });
});

describe('EditorObserver: what raises the signal', () => {
    function observe() {
        const handlers = new Map<string, (e: unknown) => void>();
        const contentDOM = {
            addEventListener: (name: string, fn: (e: unknown) => void) => { handlers.set(name, fn); },
            removeEventListener: () => { },
        };
        const view = Object.create(MarkdownView.prototype) as Record<string, unknown>;
        view.editor = { cm: { contentDOM } };
        view.file = { path: 'note.md' };
        const app = { workspace: { on: () => ({}), offref: () => { }, activeLeaf: { view } } };
        const signal = new EditorSignal();
        new EditorObserver(app as never, signal).setupInteractionListeners();
        return { signal, fire: (name: string, e: unknown) => handlers.get(name)!(e) };
    }

    it('a press anywhere but a checkbox raises nothing', () => {
        const { signal, fire } = observe();
        fire('mousedown', { target: element('cm-line') });
        expect(signal.take('note.md')).toBe(false);
    });

    it('a press on a checkbox, or typing, raises it', () => {
        const { signal, fire } = observe();
        fire('mousedown', { target: element('task-list-item-checkbox') });
        expect(signal.take('note.md')).toBe(true);
        fire('beforeinput', { data: 'x', inputType: 'insertText' });
        expect(signal.take('note.md')).toBe(true);
    });
});
