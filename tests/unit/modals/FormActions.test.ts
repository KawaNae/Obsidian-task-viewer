import { describe, it, expect } from 'vitest';
import { FormActions } from '../../../src/modals/form/FormActions';
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
