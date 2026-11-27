import { describe, it, expect, afterEach } from 'vitest';
import { OverlayShell } from '../../../../src/views/sharedUI/OverlayShell';
import { closeAllOverlays } from '../../../../src/views/sharedUI/OverlayRegistry';
import { bindField } from '../../../../src/modals/form/bindField';
import { FocusDoc, asEl, type FocusEl } from '../../helpers/focusDom';

/**
 * The overlay's close pressed while a text field of its body holds the
 * focus, in a stand-in DOM (`focusDom`) whose document also has the window
 * the overlay listens on: the close commits no field before it acts, and
 * asks its body what to keep (`beforeClose`), what is typed read or not.
 */

/** A window that never draws a frame and hears nothing: the overlay opens, and its first focus is never placed. */
const still = { requestAnimationFrame: () => 0, cancelAnimationFrame: () => { }, addEventListener: () => { }, removeEventListener: () => { } };

class ShellDoc extends FocusDoc {
    readonly defaultView = still;
    addEventListener(): void { }
    removeEventListener(): void { }
}

const keymap = { pushScope: () => { }, popScope: () => { } };

afterEach(() => closeAllOverlays());

/** The overlay open with a date field in its body that reads only `YYYY-MM-DD`, its presses held. */
function open() {
    const doc = new ShellDoc();
    const shell = new OverlayShell();
    const writes: string[] = [];
    const asked: string[] = [];
    let field!: FocusEl;
    shell.open({
        mode: 'centered',
        hostDoc: doc as unknown as Document,
        keymap: keymap as never,
        holdsPresses: {},
        beforeClose: () => { asked.push(field.value); return 'stay'; },
        build: (body) => {
            field = (body as unknown as FocusEl).createEl('input', { type: 'text' });
            bindField(asEl(field), {
                codec: {
                    read: (text: string) => /^\d{4}-\d{2}-\d{2}$/.test(text) ? { ok: true as const, value: text } : { ok: false as const, issue: { text: 'unread' } as never },
                    show: (v: string) => v,
                },
                current: () => '',
                commit: (next: string) => { writes.push(next); },
                issues: () => { },
            });
        },
    });
    const close = (doc.body.find('tv-overlay__close'))!;
    return { doc, field, close, writes, asked };
}

describe('the overlay\'s close pressed with a field of its body typed in', () => {
    it('a text that does not read typed: the close acts, asking its body what to keep, the field committed nothing first', () => {
        const s = open();
        s.field.focus();
        s.field.type('あした');
        s.close.press();
        expect(s.asked).toEqual(['あした']);
        expect(s.writes).toEqual([]);
        expect(s.doc.activeElement).toBe(s.field);
    });

    it('a text that reads typed: the close asks its body what to keep, the field committed nothing first', () => {
        const s = open();
        s.field.focus();
        s.field.type('2026-01-02');
        s.close.press();
        expect(s.asked).toEqual(['2026-01-02']);
        expect(s.writes).toEqual([]);
    });
});
