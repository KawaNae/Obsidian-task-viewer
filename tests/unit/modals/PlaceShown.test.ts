import { describe, it, expect, vi } from 'vitest';
import { t } from '../../../src/i18n';
import { PlaceShown, type ShownPlace } from '../../../src/modals/place/PlaceShown';
import { FocusDoc, type FocusEl } from '../helpers/focusDom';

// The icon a label shows, read back from its element.
vi.mock('obsidian', async (importOriginal) => ({
    ...await importOriginal<typeof import('obsidian')>(),
    setIcon: (el: FocusEl, icon: string) => { el.setAttribute('data-icon', icon); },
}));

/**
 * A place shown with no field (`PlaceShown`), a group of the form's basic
 * tab: the note, the heading and the parent task, each a row with no field,
 * as the value it is handed says them, and, where the hub says it, why the
 * place cannot be changed. The parent's row is there while the value names a
 * parent. It reads the value as it is built and again when told to.
 */

const UNDER: ShownPlace = { note: 'f/n.md', heading: 'Work', parent: '親' };
const FIXED = { why: t('modal.newTask.childFixed') };

function rig(first: ShownPlace | null, options: { why?: string } = FIXED) {
    let now = first;
    const pane = new FocusDoc().root();
    const read = vi.fn(() => now);
    const shown = new PlaceShown(pane as unknown as HTMLElement, read, options);
    const rows = () => pane.findAll('tv-form__row').filter(row => row.style.display !== 'none').map(row => ({
        icon: row.find('tv-form__label-icon')?.attrs.get('data-icon'),
        label: row.find('tv-form__label')!.children.map(c => c.text).join(''),
        value: row.find('task-hub__shown-value')!.text,
    }));
    return { pane, read, shown, rows, set: (to: ShownPlace | null) => { now = to; } };
}

describe('PlaceShown', () => {
    it('shows the note, the heading and the parent task, each labelled as the place fields are, and why they cannot be changed', () => {
        const r = rig(UNDER);
        expect(r.rows()).toEqual([
            { icon: 'file-text', label: t('modal.note'), value: 'f/n.md' },
            { icon: 'heading', label: t('modal.heading'), value: 'Work' },
            { icon: 'arrow-up', label: t('modal.parentTask'), value: '親' },
        ]);
        const says = r.pane.find('tv-form__says')!;
        expect(says.find('tv-form__info')!.text).toBe(t('modal.newTask.childFixed'));
    });

    it('builds them as one group at the end of what it is given, why they cannot be changed its last', () => {
        const r = rig(UNDER);
        expect(r.pane.children.map(child => [...child.classes].join(' '))).toEqual(['tv-form__group task-hub__place task-hub__shown']);
        const group = r.pane.children[0];
        expect(group.children.map(child => [...child.classes].join(' '))).toEqual(['tv-form__row', 'tv-form__row', 'tv-form__row', 'tv-form__says']);
    });

    it('shows a parent above the note\'s first heading as under none', () => {
        const r = rig({ ...UNDER, heading: null });
        expect(r.rows()[1].value).toBe(t('modal.newTask.noHeading'));
    });

    it('keeps its rows with no values while there is nothing to show', () => {
        const r = rig(null);
        expect(r.rows().map(row => [row.label, row.value])).toEqual([[t('modal.note'), ''], [t('modal.heading'), ''], [t('modal.parentTask'), '']]);
    });

    it('reads what it shows again when refreshed, and only then', () => {
        const r = rig(null);
        r.set(UNDER);
        expect(r.rows()[0].value).toBe('');
        r.shown.refresh();
        expect(r.rows().map(row => row.value)).toEqual(['f/n.md', 'Work', '親']);
        r.set(null);
        r.shown.refresh();
        expect(r.rows().map(row => row.value)).toEqual(['', '', '']);
        expect(r.read).toHaveBeenCalledTimes(3);
    });

    it('says nothing under the rows where the hub gives no reason', () => {
        const r = rig(UNDER, {});
        expect(r.pane.find('tv-form__says')).toBeNull();
        expect(r.pane.children[0].children.map(child => [...child.classes].join(' '))).toEqual(['tv-form__row', 'tv-form__row', 'tv-form__row']);
    });

    it('has no row of the parent for a task with none, and has it again once there is one', () => {
        const r = rig({ ...UNDER, parent: null }, {});
        expect(r.rows().map(row => row.label)).toEqual([t('modal.note'), t('modal.heading')]);
        r.set(UNDER);
        r.shown.refresh();
        expect(r.rows().map(row => row.value)).toEqual(['f/n.md', 'Work', '親']);
    });

    it('keeps the rows as they were, with no values, while there is nothing to show, the parent\'s row as it was', () => {
        const r = rig({ ...UNDER, parent: null }, {});
        r.set(null);
        r.shown.refresh();
        expect(r.rows().map(row => [row.label, row.value])).toEqual([[t('modal.note'), ''], [t('modal.heading'), '']]);
    });

    it('keeps the parent\'s row with no value while the parent the task names is not known', () => {
        const r = rig({ note: 'f/n.md', heading: 'Work' }, {});
        expect(r.rows().map(row => [row.label, row.value])).toEqual([[t('modal.note'), 'f/n.md'], [t('modal.heading'), 'Work'], [t('modal.parentTask'), '']]);
    });

    it('shows a heading not read yet with no value', () => {
        const r = rig({ note: 'f/n.md', parent: null }, {});
        expect(r.rows().map(row => row.value)).toEqual(['f/n.md', '']);
    });

    it('has no field to focus', () => {
        const r = rig(UNDER);
        expect(r.shown.focus()).toBeNull();
        r.shown.setEnabled(false);
        r.shown.dispose();
        expect(r.rows()[0].value).toBe('f/n.md');
    });
});
