import { describe, it, expect } from 'vitest';
import { ShownSuggest } from '../../../src/suggest/ShownSuggest';

/**
 * `ShownSuggest` over Obsidian's input suggest (the mock's, which holds the
 * list's keys in its scope as Obsidian's does): every key the list does not
 * take stops at its scope, and an Enter an IME commits a conversion with
 * picks nothing.
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
        // Obsidian's own keys come first.
        expect(keys.slice(0, -1).map(k => k.key)).toEqual(['Escape', 'Enter']);
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
});
