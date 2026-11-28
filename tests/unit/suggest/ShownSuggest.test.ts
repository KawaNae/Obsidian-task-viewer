import { describe, it, expect, afterEach, vi } from 'vitest';
import { ShownSuggest } from '../../../src/suggest/ShownSuggest';
import { onFormEnter } from '../../../src/modals/form/formEnter';

/**
 * `ShownSuggest` over Obsidian's input suggest (the mock's, which holds the
 * list's keys in its scope as Obsidian's does, and puts the list by the
 * field's place on every open): every key the list does not take stops at
 * its scope, an empty field opens the list with nothing selected and its
 * Enter is the field's, an Enter an IME commits a conversion with picks nothing, and
 * the list is placed again on the frame after the field moved, or the room
 * Obsidian keeps it in changed.
 */

class Picks extends ShownSuggest<string> {
    picked: string[] = [];
    protected getSuggestions(): string[] { return ['a']; }
    renderSuggestion(): void {}
    protected pick(value: string): void { this.picked.push(value); }
}

function field(): HTMLInputElement {
    const listeners: Record<string, (() => void)[]> = {};
    return {
        value: '',
        addEventListener: (type: string, fn: () => void) => { (listeners[type] ??= []).push(fn); },
    } as unknown as HTMLInputElement;
}

/**
 * A window whose frames run when the test says, with the room Obsidian
 * keeps a list in: its size, and the safe areas its root holds. It is the
 * main window too (`window`), as Obsidian's placement reads its height.
 */
function frames() {
    let next = 1;
    const pending = new Map<number, () => void>();
    const vars: Record<string, string> = { '--safe-area-inset-bottom': '336px' };
    const win = {
        pending,
        vars,
        innerWidth: 400,
        innerHeight: 900,
        requestAnimationFrame: (fn: () => void) => { pending.set(next, fn); return next++; },
        cancelAnimationFrame: (id: number) => { pending.delete(id); },
        getComputedStyle: () => ({ getPropertyValue: (name: string) => vars[name] ?? '' }),
        /** Run the frames asked for so far, as the next paint does. */
        paint: () => { const now = [...pending.values()]; pending.clear(); now.forEach(fn => fn()); },
    };
    vi.stubGlobal('window', win);
    return win;
}

afterEach(() => { vi.unstubAllGlobals(); });

/** A field on the page at a place the test moves, in a window of its own. */
function placedField(win: ReturnType<typeof frames>) {
    const at = { top: 100, bottom: 130, left: 10, right: 210 };
    const root = {
        scrollTop: 0, scrollLeft: 0,
        get clientWidth() { return win.innerWidth; },
        get clientHeight() { return win.innerHeight; },
        getBoundingClientRect: () => ({ top: 0, bottom: win.innerHeight, left: 0, right: win.innerWidth }),
    };
    const input = {
        value: '',
        isConnected: true,
        ownerDocument: { defaultView: win, documentElement: root },
        addEventListener: () => {},
        getBoundingClientRect: () => ({ ...at }),
    };
    return { input: input as unknown as HTMLInputElement, at, move: (dy: number) => { at.top += dy; at.bottom += dy; } };
}

const openApp = { scope: {}, keymap: { pushScope: () => {}, popScope: () => {} } } as never;

/** A list over `input`, with what Obsidian's close empties. */
function openable(input: HTMLInputElement): Picks {
    const suggest = new Picks(openApp, input);
    (suggest as unknown as { suggestions: unknown }).suggestions = { setSuggestions: () => {} };
    return suggest;
}

const placedBy = (suggest: Picks) => (suggest as unknown as { placements: { top: number }[] }).placements.map(r => r.top);

const key = (init: Partial<KeyboardEvent>) => ({ type: 'keydown', key: 'Enter', keyCode: 13, isComposing: false, ...init }) as KeyboardEvent;

describe('ShownSuggest', () => {
    it('takes every key its list does not, last: the hotkeys behind are not looked up, and the key is not prevented', () => {
        const suggest = new Picks({ scope: {} } as never, field());
        const keys = (suggest.scope as unknown as { keys: { modifiers: unknown; key: string | null; func: () => unknown }[] }).keys;
        const last = keys[keys.length - 1];
        expect(last.modifiers).toBeNull();
        expect(last.key).toBeNull();
        // true: the lookup stops here; not false, which would prevent the key's default.
        expect(last.func()).toBe(true);
        // Obsidian's own keys come between the first and the last.
        expect(keys.slice(1, -1).map(k => k.key)).toEqual(['ArrowUp', 'ArrowDown', 'Enter', 'Escape']);
    });

    it('looks first at an Enter with nothing selected, a handler on no key and no modifiers, so Obsidian\'s keys are looked up after it', () => {
        const suggest = new Picks({ scope: {} } as never, field());
        const keys = (suggest.scope as unknown as { keys: { modifiers: unknown; key: string | null; func: (evt: unknown) => unknown }[] }).keys;
        expect(keys[0].modifiers).toBeNull();
        expect(keys[0].key).toBeNull();
        // undefined on any other key: the lookup goes on to Obsidian's.
        expect(keys[0].func(key({ key: 'ArrowDown', keyCode: 40 }))).toBeUndefined();
    });

    it.each([
        ['Safari and WebKit: after the composition, keyCode 229', key({ keyCode: 229 })],
        ['Chromium on macOS: isComposing', key({ isComposing: true, keyCode: 229 })],
    ])('picks nothing on an Enter an IME commits with (%s)', (_name, evt) => {
        const suggest = new Picks({ scope: {} } as never, field());
        suggest.selectSuggestion('a', evt);
        expect(suggest.picked).toEqual([]);
    });

    it('picks on the form\'s Enter, and on a click', () => {
        const suggest = new Picks({ scope: {} } as never, field());
        suggest.selectSuggestion('a', key({}));
        suggest.selectSuggestion('b', { type: 'click' } as MouseEvent);
        expect(suggest.picked).toEqual(['a', 'b']);
    });

    describe('on an empty field, no item is selected as the list opens, and an Enter with none selected is the field\'s', () => {
        /** A list of two items over a field the test types in, open as Obsidian opens it on what the field holds. */
        function typed(text: string) {
            const win = frames();
            const at = placedField(win);
            const listeners: Record<string, ((evt: unknown) => void)[]> = {};
            const input = at.input as unknown as { value: string; addEventListener: unknown };
            input.addEventListener = (type: string, fn: (evt: unknown) => void) => { (listeners[type] ??= []).push(fn); };
            const suggest = new Picks(openApp, at.input);
            const runs: string[] = [];
            onFormEnter(at.input, () => runs.push(input.value));
            /** What the field holds now, the list opened again on it, as typing does. */
            const type = (value: string) => { input.value = value; suggest.showSuggestions(['a', 'b']); };
            /**
             * A keydown as Obsidian's keymap takes it while the list is open
             * (its scope first, in the capture phase), then on to the field
             * unless the scope answered `false`.
             */
            const press = (init: Partial<KeyboardEvent> = {}) => {
                const evt = key({ preventDefault: () => {}, ...init });
                const answer = suggest.listShown ? (suggest.scope as unknown as { handleKey(e: unknown): unknown }).handleKey(evt) : undefined;
                if (answer !== false) (listeners['keydown'] ?? []).forEach(fn => fn(evt));
                return answer;
            };
            const selected = () => (suggest as unknown as { suggestions: { selectedItem: number } }).suggestions.selectedItem;
            type(text);
            return { suggest, type, press, selected, runs };
        }

        it('opens with no item selected', () => {
            const { suggest, selected } = typed('');
            expect(suggest.listShown).toBe(true);
            expect(selected()).toBe(-1);
        });

        it('closes the list on an Enter, puts nothing in, and the Enter goes on to the field, not prevented', () => {
            const { suggest, press, runs } = typed('');
            // true: the lookup stops, and the keymap prevents nothing.
            expect(press()).toBe(true);
            expect(suggest.listShown).toBe(false);
            expect(suggest.picked).toEqual([]);
            expect(runs).toEqual(['']);
        });

        it('puts the first item in on an Enter after an ArrowDown, and the field takes no Enter', () => {
            const { suggest, press, selected, runs } = typed('');
            press({ key: 'ArrowDown', keyCode: 40 });
            expect(selected()).toBe(0);
            expect(press()).toBe(false);
            expect(suggest.picked).toEqual(['a']);
            expect(runs).toEqual([]);
        });

        it('puts the first item in on an Enter in a field that holds text', () => {
            const { suggest, press, selected, runs } = typed('a');
            expect(selected()).toBe(0);
            expect(press()).toBe(false);
            expect(suggest.picked).toEqual(['a']);
            expect(runs).toEqual([]);
        });

        it('selects none again once what was typed is deleted, and the Enter is the field\'s', () => {
            const { suggest, type, press, selected, runs } = typed('');
            type('x');
            expect(selected()).toBe(0);
            type('');
            expect(selected()).toBe(-1);
            expect(press()).toBe(true);
            expect(suggest.picked).toEqual([]);
            expect(runs).toEqual(['']);
        });

        it.each([
            ['spaces', '   '],
            ['a line break, as Obsidian\'s property value keeps once its text is deleted', '\n'],
        ])('reads a field of %s alone as empty', (_name, text) => {
            const { press, selected, runs } = typed(text);
            expect(selected()).toBe(-1);
            expect(press()).toBe(true);
            expect(runs).toEqual([text]);
        });

        it.each([
            ['Safari and WebKit: after the composition, keyCode 229', { keyCode: 229 }],
            ['Chromium on macOS: isComposing', { isComposing: true, keyCode: 229 }],
        ])('on an Enter an IME commits with (%s), puts nothing in, keeps the list open, and the field does not act', (_name, init) => {
            for (const text of ['', 'a']) {
                const { suggest, press, runs } = typed(text);
                press(init);
                expect(suggest.picked).toEqual([]);
                expect(suggest.listShown).toBe(true);
                expect(runs).toEqual([]);
                suggest.close();
            }
        });
    });

    describe('the list stays on its field while the field, or the room the list is kept in, changes', () => {
        it('reads the field\'s place on the field\'s window\'s frames while the list is open, and on none once it closed', () => {
            const win = frames();
            const suggest = openable(placedField(win).input);
            expect(win.pending.size).toBe(0);
            suggest.open();
            expect(win.pending.size).toBe(1);
            win.paint();
            expect(win.pending.size).toBe(1);
            suggest.close();
            expect(win.pending.size).toBe(0);
        });

        it('puts the list by the field again on the frame after the field moved, and once only', () => {
            const win = frames();
            const field = placedField(win);
            const suggest = openable(field.input);
            suggest.open();
            win.paint();
            expect(placedBy(suggest)).toEqual([100]);
            field.move(-194);
            win.paint();
            expect(placedBy(suggest)).toEqual([100, -94]);
            // The open the frame made is no move: the next frames put nothing.
            win.paint();
            win.paint();
            expect(placedBy(suggest)).toEqual([100, -94]);
            field.move(194);
            win.paint();
            expect(placedBy(suggest)).toEqual([100, -94, 100]);
        });

        it('places the list again on the frame after the room it is kept in changed, the field where it was', () => {
            const win = frames();
            const field = placedField(win);
            const suggest = openable(field.input);
            suggest.open();
            // Android's keyboard closing: the bottom safe area shrinks a frame after the field moved down.
            field.move(194);
            win.paint();
            win.vars['--safe-area-inset-bottom'] = '24px';
            win.paint();
            win.paint();
            expect(placedBy(suggest)).toEqual([100, 294, 294]);
            win.innerHeight = 600;
            win.paint();
            expect(placedBy(suggest)).toEqual([100, 294, 294, 294]);
        });

        it('opens the list again through open, so what a subclass does as the list opens is done again', () => {
            class Counts extends Picks {
                opens = 0;
                open(): void { super.open(); this.opens++; }
            }
            const win = frames();
            const field = placedField(win);
            const suggest = new Counts(openApp, field.input);
            (suggest as unknown as { suggestions: unknown }).suggestions = { setSuggestions: () => {} };
            suggest.open();
            field.move(10);
            win.paint();
            expect(suggest.opens).toBe(2);
            expect(suggest.listShown).toBe(true);
        });

        it('begins no second run of frames as the list is opened again by typing, and compares with the place typing put it by', () => {
            const win = frames();
            const field = placedField(win);
            const suggest = openable(field.input);
            suggest.open();
            field.move(10);
            // Obsidian opens the list on every key typed: it is put by the field there.
            suggest.open();
            suggest.open();
            expect(win.pending.size).toBe(1);
            win.paint();
            expect(placedBy(suggest)).toEqual([100, 110, 110]);
        });

        it('puts the list by no field that was taken out of the page', () => {
            const win = frames();
            const field = placedField(win);
            const suggest = openable(field.input);
            suggest.open();
            (field.input as unknown as { isConnected: boolean }).isConnected = false;
            field.move(-100);
            win.paint();
            expect(placedBy(suggest)).toEqual([100]);
        });

        it('follows again when the list opens after it closed', () => {
            const win = frames();
            const field = placedField(win);
            const suggest = openable(field.input);
            suggest.open();
            suggest.close();
            field.move(20);
            suggest.open();
            field.move(20);
            win.paint();
            expect(placedBy(suggest)).toEqual([100, 120, 140]);
        });
    });
});
