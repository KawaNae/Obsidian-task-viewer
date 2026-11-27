import { describe, it, expect } from 'vitest';
import { carryPressKeys, commitOf, holdPresses, leavePresses, menuOver, ownCommit, pressKey, pressUnderWay, takesTyped } from '../../../src/views/sharedUI/PressCommit';
import { bindField } from '../../../src/modals/form/bindField';
import { FocusDoc, asEl, type FocusEl } from '../helpers/focusDom';

/** A surface that holds its presses, with a text field bound to a value held here and a button beside it. */
function surface() {
    const doc = new FocusDoc();
    const panel = doc.root();
    holdPresses(asEl(panel));
    const field = panel.createEl('input', { type: 'text' });
    let value = 'a';
    field.value = value;
    const writes: string[] = [];
    bindField(asEl(field), {
        codec: { read: (text: string) => ({ ok: true as const, value: text }), show: (v: string) => v },
        current: () => value,
        commit: (next: string) => { value = next; writes.push(next); },
        issues: () => { },
    });
    const pressed: string[] = [];
    /** A button of the surface, its presses recorded with what was written by then. */
    const button = (name: string, at: FocusEl = panel) => {
        const el = at.createEl('button', { attr: { type: 'button' } });
        el.addEventListener('click', () => pressed.push(`${name} after ${writes.length}`));
        return el;
    };
    return { doc, panel, field, writes, pressed, button };
}

describe('a surface that holds the presses on its buttons', () => {
    it('leaves the focus in a text field in focus as a button is pressed, typed in or not, and commits what was typed first', () => {
        const s = surface();
        const other = s.button('other');
        s.field.focus();
        other.press();
        s.field.type('b');
        other.press();
        expect(s.pressed).toEqual(['other after 0', 'other after 1']);
        expect(s.writes).toEqual(['b']);
        expect(s.doc.activeElement).toBe(s.field);
    });

    it('lets a button take the focus as any while no text field of the surface holds it', () => {
        const s = surface();
        const other = s.button('other');
        const picker = s.panel.createEl('input', { type: 'date' });
        picker.focus();
        other.press();
        expect(s.doc.activeElement).toBe(other);
    });

    it('commits nothing first for a button that saves what is typed its own way, as a close does: saved once', () => {
        const s = surface();
        const close = s.panel.createEl('button');
        takesTyped(asEl(close));
        close.addEventListener('click', () => { commitOf(asEl(s.field))!.commit(); });
        s.field.focus();
        s.field.type('b');
        close.press();
        expect(s.writes).toEqual(['b']);
        expect(s.doc.activeElement).toBe(s.field);
    });

    it('lets a button that saves what is typed its own way act though what is typed would be refused, committing nothing first', () => {
        const doc = new FocusDoc();
        const panel = doc.root();
        holdPresses(asEl(panel));
        const field = panel.createEl('input', { type: 'text' });
        let commits = 0;
        ownCommit(asEl(field), { typed: () => true, commit: () => { commits++; return false; } });
        const close = panel.createEl('button');
        takesTyped(asEl(close));
        const pressed: string[] = [];
        close.addEventListener('click', () => pressed.push('close'));
        field.focus();
        close.press();
        expect(pressed).toEqual(['close']);
        expect(commits).toBe(0);
        expect(doc.activeElement).toBe(field);
    });

    it('opens a field\'s menu over the field whose text is refused, the text left as typed, and no menu over another field', () => {
        const doc = new FocusDoc();
        const panel = doc.root();
        holdPresses(asEl(panel));
        let value = 'a';
        const writes: string[] = [];
        const field = (at: string) => {
            const input = panel.createEl('input', { type: 'text' });
            input.value = value;
            bindField(asEl(input), {
                codec: { read: (text: string) => (text === 'bad' ? { ok: false as const, issue: { kind: 'format', format: 'x' } as never } : { ok: true as const, value: text }), show: (v: string) => v },
                current: () => value,
                commit: (next: string) => { value = next; writes.push(`${at} ${next}`); },
                issues: () => { },
            });
            return input;
        };
        const own = field('own');
        const other = field('other');
        const pressed: string[] = [];
        const menu = (name: string, over: FocusEl) => {
            const el = panel.createEl('button');
            menuOver(asEl(el), () => [asEl(over)]);
            el.addEventListener('click', () => pressed.push(name));
            return el;
        };
        const ownMenu = menu('own menu', own);
        own.focus();
        own.type('bad');
        ownMenu.press();
        expect(pressed).toEqual(['own menu']);
        expect([own.value, writes]).toEqual(['bad', []]);
        expect(doc.activeElement).toBe(own);
        // What a menu item that puts a value does first: the text refused is thrown away.
        commitOf(asEl(own))!.drop!();
        expect(own.value).toBe('a');
        other.focus();
        other.type('bad');
        ownMenu.press();
        expect(pressed).toEqual(['own menu']);
        expect(other.value).toBe('bad');
    });

    it('throws away nothing a commit handed on as a menu item drops what is typed', () => {
        const s = surface();
        s.field.focus();
        s.field.type('b');
        commitOf(asEl(s.field))!.commit();
        commitOf(asEl(s.field))!.drop!();
        expect([s.field.value, s.writes]).toEqual(['b', ['b']]);
    });

    it('reads no press in a part that keeps its own', () => {
        const s = surface();
        const card = s.panel.createDiv();
        leavePresses(asEl(card));
        const onCard = s.button('card', card);
        s.field.focus();
        s.field.type('b');
        onCard.press();
        expect(s.pressed).toEqual(['card after 1']);
        expect(s.doc.activeElement).toBe(onCard);
    });

    it('commits what the IME is converting as typed, and writes it no more as the conversion ends on it and the field is left', () => {
        const s = surface();
        const other = s.button('other');
        s.field.focus();
        s.field.dispatchEvent(new Event('compositionstart'));
        s.field.value = 'かい';
        s.field.dispatchEvent(Object.assign(new Event('input', { bubbles: true }), { isComposing: true }));
        other.press();
        s.field.dispatchEvent(new Event('compositionend'));
        s.field.blur();
        expect([s.writes, s.pressed]).toEqual([['かい'], ['other after 1']]);
    });

    it('writes the text the conversion ends on once more, as the field\'s next commit, when it is not what was committed', () => {
        const s = surface();
        const other = s.button('other');
        s.field.focus();
        s.field.dispatchEvent(new Event('compositionstart'));
        s.field.value = 'かい';
        s.field.dispatchEvent(Object.assign(new Event('input', { bubbles: true }), { isComposing: true }));
        other.press();
        s.field.value = '会';
        s.field.dispatchEvent(new Event('compositionend'));
        s.field.enter();
        s.field.blur();
        expect(s.writes).toEqual(['かい', '会']);
    });
});

describe('a commit drawn later than it is handed on', () => {
    /**
     * A surface whose commit has a keyed button built anew in a draw put off
     * for it, as a microtask the browser runs between two listeners of the
     * click: the listener after the surface's runs what is put off.
     */
    function later() {
        const doc = new FocusDoc();
        const panel = doc.root();
        let pending: (() => void) | null = null;
        const flush = () => { const draw = pending; pending = null; draw?.(); };
        holdPresses(asEl(panel), { drawNow: flush });
        panel.addEventListener('click', flush, { capture: true });
        const field = panel.createEl('input', { type: 'text' });
        let value = 'a';
        field.value = value;
        const pressed: string[] = [];
        let built = 0;
        let button: FocusEl;
        const build = () => {
            button?.detach();
            const n = ++built;
            button = panel.createEl('button', { attr: { type: 'button' } });
            pressKey(asEl(button), 'menu');
            button.addEventListener('click', () => pressed.push(`built ${n} on ${value}`));
        };
        build();
        bindField(asEl(field), {
            codec: { read: (text: string) => ({ ok: true as const, value: text }), show: (v: string) => v },
            current: () => value,
            commit: (next: string) => { value = next; pending = build; },
            issues: () => { },
        });
        return { doc, field, pressed, button: () => button };
    }

    it('looks for the button once the commit is drawn: the button built anew acts, once, and the one taken out does not', () => {
        const s = later();
        const first = s.button();
        s.field.focus();
        s.field.type('b');
        first.press();
        expect(s.pressed).toEqual(['built 2 on b']);
        expect(s.doc.activeElement).toBe(s.field);
    });

});

describe('the press under way and the keys of the buttons a commit builds anew', () => {
    const doc = new FocusDoc();
    const asDoc = doc as unknown as Document;

    it('gives back the key the button pressed has once the commit ran: moved, taken out, or as it was', () => {
        const moves = new Map([['list:item:2', 'list:item:1'], ['list:item:0', null]]);
        expect(pressUnderWay(asDoc, 'list:item:2', () => { carryPressKeys(asDoc, moves); return 'r'; })).toEqual({ result: 'r', key: 'list:item:1' });
        expect(pressUnderWay(asDoc, 'list:item:0', () => carryPressKeys(asDoc, moves)).key).toBeNull();
        expect(pressUnderWay(asDoc, 'tags:a:remove', () => carryPressKeys(asDoc, moves)).key).toBe('tags:a:remove');
    });

    it('moves no key while no press is under way', () => {
        expect(() => carryPressKeys(asDoc, new Map([['k', null]]))).not.toThrow();
    });

    it('lets a field\'s commit go once its signal aborts', () => {
        const field = asEl(doc.root().createEl('input'));
        const built = new AbortController();
        const commit = { typed: () => true, commit: () => true };
        ownCommit(field, commit, built.signal);
        expect(commitOf(field)).toBe(commit);
        built.abort();
        expect(commitOf(field)).toBeNull();
        expect(commitOf(null)).toBeNull();
    });
});
