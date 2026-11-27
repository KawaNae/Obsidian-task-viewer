import { describe, it, expect } from 'vitest';
import { FormActions } from '../../../src/modals/form/FormActions';
import { holdPresses, ownCommit } from '../../../src/views/sharedUI/PressCommit';
import { FocusDoc, asEl } from '../helpers/focusDom';

/**
 * The row of buttons that ends a form, in a stand-in DOM (`focusDom`): what
 * takes the focus when the form asks, the answer that keeps as a question
 * is put, and the form's act.
 */

function setUp() {
    const doc = new FocusDoc();
    const root = doc.root();
    const actions = new FormActions(asEl(root), {
        cancel: { run: () => { } },
        actions: [{ label: '作成', tone: 'cta', run: () => { } }],
        ask: { discardLabel: '捨てる', keepLabel: '戻る', discard: () => { }, keep: () => { } },
    });
    return { doc, root, actions, act: () => root.findAll('mod-cta')[0] };
}

describe('FormActions', () => {
    it('puts the focus on the form\'s act when the form asks', () => {
        const s = setUp();
        s.actions.render({ busy: false, ctaEnabled: true });
        s.actions.focusAct();
        expect(s.doc.activeElement).toBe(s.act());
    });

    it('puts the focus on the answer that keeps as a question is put', () => {
        const s = setUp();
        s.actions.focusKeep();
        expect(s.doc.activeElement).toBe(s.root.find('tv-form__cancel'));
    });
});

describe('FormActions in a surface that holds its presses, a field of it typed in', () => {
    /** The row in a surface that holds its presses, beside a field whose commit refuses what is typed; what each button ran is recorded. */
    function inSurface() {
        const doc = new FocusDoc();
        const panel = doc.root();
        holdPresses(asEl(panel));
        const field = panel.createEl('input', { type: 'text' });
        let commits = 0;
        ownCommit(asEl(field), { typed: () => true, commit: () => { commits++; return false; } });
        const ran: string[] = [];
        new FormActions(asEl(panel.createDiv()), {
            cancel: { run: () => ran.push('cancel') },
            actions: [{ label: '作成', tone: 'cta', run: () => ran.push('act') }],
            ask: { discardLabel: '捨てる', keepLabel: '戻る', discard: () => ran.push('discard'), keep: () => ran.push('keep') },
        }).render({ busy: false, ctaEnabled: true });
        field.focus();
        return { doc, panel, field, ran, commits: () => commits };
    }

    it('each button acts on its own way, committing nothing first, though the commit would be refused: the focus stays in the field', () => {
        for (const cls of ['tv-form__cancel', 'mod-cta', 'mod-warning']) {
            const s = inSurface();
            s.panel.find(cls)!.press();
            expect(s.ran).toHaveLength(1);
            expect(s.commits()).toBe(0);
            expect(s.doc.activeElement).toBe(s.field);
        }
    });
});
