import { describe, it, expect, vi } from 'vitest';
import { t } from '../../../src/i18n';
import { SectionModal } from '../../../src/modals/section/SectionModal';
import { TimerStartOffsetModal } from '../../../src/modals/TimerStartOffsetModal';
import type { OverlayOpenOpts } from '../../../src/views/sharedUI/OverlayShell';
import { FakeEl, asEl } from '../helpers/fakeDom';

/**
 * Where the section dialog and the start-offset dialog put the focus as
 * they open, and how the field's text is met there (`initialFocus`): the
 * caret after a note's or a heading's name, which has no fixed shape; a
 * number of minutes selected whole, to be typed over. The overlay is a
 * stand-in that keeps what it was opened with and builds the body.
 */

const opened: OverlayOpenOpts[] = [];
/** Whether the stand-in builds the body: the start-offset dialog's needs more of a DOM than the stand-in's, and its focus is told without it. */
let builds = true;

vi.mock('../../../src/views/sharedUI/OverlayShell', () => ({
    OverlayShell: class {
        private opts: OverlayOpenOpts | null = null;
        isOpen(): boolean { return this.opts !== null; }
        open(opts: OverlayOpenOpts): void {
            this.opts = opts;
            opened.push(opts);
            if (builds) opts.build(asEl(new FakeEl()), { head: asEl(new FakeEl()), foot: asEl(new FakeEl()) });
        }
        /** A panel in a window whose timers do nothing: the start-offset dialog ticks there. */
        getPanel(): unknown { return { nodeType: 1, ownerDocument: { defaultView: { setInterval: () => 0, clearInterval: () => { } } } }; }
        close(): void { this.opts = null; }
        requestClose(): Promise<boolean> { this.opts = null; return Promise.resolve(true); }
    },
}));

const APP = {
    keymap: { pushScope() { }, popScope() { } },
    scope: {},
    vault: { getAbstractFileByPath: () => null, getMarkdownFiles: () => [], getFiles: () => [], getAllFolders: () => [] },
    metadataCache: { getFirstLinkpathDest: () => null, unresolvedLinks: {} },
} as never;

const lastFocus = () => {
    const focus = opened[opened.length - 1].initialFocus!();
    return { selection: focus?.selection, placeholder: (focus?.to as unknown as FakeEl | undefined)?.attrs.get('placeholder') };
};

describe('the focus the section dialog opens with', () => {
    it('is the note field\'s, the caret after its text, while no note is picked', () => {
        new SectionModal(APP, {
            purpose: 'relink',
            initial: { note: { text: 'Plan', picked: null }, heading: { text: '', picked: null } },
            chosen: () => { },
        }).open();

        expect(lastFocus()).toEqual({ selection: 'end', placeholder: t('modal.notePlaceholder') });
    });

    it('is the heading field\'s, the caret after its text, once a note is picked', () => {
        new SectionModal(APP, {
            purpose: 'relink',
            initial: { note: { text: 'Plan', picked: 'Plan.md' }, heading: { text: 'Tasks', picked: null } },
            chosen: () => { },
        }).open();

        expect(lastFocus()).toEqual({ selection: 'end', placeholder: t('modal.section.wholeNote') });
    });
});

describe('the focus the start-offset dialog opens with', () => {
    it('selects the number of minutes whole, to be typed over', () => {
        builds = false;
        new TimerStartOffsetModal(APP, async () => ({ kind: 'written' }) as never).open();
        builds = true;

        expect(lastFocus().selection).toBe('all');
    });
});
