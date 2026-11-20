import { describe, it, expect, vi } from 'vitest';
import { Notice } from '../mocks/obsidian';
import { RowHost, type RowPanel } from '../../../src/modals/hub/RowHost';
import type { HubForm } from '../../../src/modals/hub/HubHost';
import { t } from '../../../src/i18n';
import { refusalNotice, type IndexRefusal } from '../../../src/services/core/RefusalClause';
import type { WriteAnswer } from '../../../src/services/operations/WriteAnswer';
import { makeTask } from '../helpers/makeTask';
import type { Task } from '../../../src/types';

const { openSourceLine } = vi.hoisted(() => ({ openSourceLine: vi.fn(async () => { }) }));
vi.mock('../../../src/modals/hub/SourceLine', () => ({ openSourceLine }));

/**
 * The host of a hub on a row the note has. A change handed on (`put`) is put
 * over the host's value before `updateTask` is asked. Writes handed on one
 * after another are asked at once: the operations keep their order per row
 * (`onRow`, Names.vault.test.ts), so the host does not line them up. Each is
 * asked with no notice (`tellRefusal: false`); refused, why is said at the
 * form's end once, and the form takes the index's copy (`IndexReads.getTask`)
 * in place of what was put (the field refused keeps its text by `bindField`).
 * Written, the echo is waited for: nothing is taken here, and a refusal said
 * before is taken back. A refusal after the hub closed is told by a notice.
 *
 * The host follows the row in the index once the hub has opened: a change of
 * it is drawn in the card, then in the form, then followed by the source; a
 * row the index no longer holds shuts the form until it comes back.
 */

const REFUSED: IndexRefusal = { file: 'note.md', reason: { kind: 'changed' }, subject: '元の名前' };

/** A host on a row, its writes answered as `written` says; `bound` false for a hub with no form (a read-only row). */
function hostAnswering(written: boolean, fresh: Task | undefined, refused: IndexRefusal | null = REFUSED, bound = true) {
    const opened = makeTask({ id: 'task-1', content: '元の名前' });
    const updateTask = vi.fn(async (): Promise<WriteAnswer> => (written ? { written: true } : { written: false, refused }));
    /** The index's copy of the row; the host reads it once as it is made. */
    let copy: Task | undefined = opened;
    const getTask = vi.fn((_id: string) => copy);
    const listeners: ((taskId?: string) => void)[] = [];
    const onChange = vi.fn((listener: (taskId?: string) => void) => {
        listeners.push(listener);
        return () => { listeners.splice(listeners.indexOf(listener), 1); };
    });

    const host = new RowHost(opened, {
        app: {} as never,
        plugin: { settings: { reuseExistingTab: true } } as never,
        index: { getTask, onChange } as never,
        operations: { updateTask } as never,
    });
    copy = fresh;

    const told: string[] = [];
    const form: HubForm & { said: (string | null)[] } = {
        said: [],
        refresh: vi.fn(() => { told.push('form'); }),
        showShut: vi.fn(() => { told.push(`shut:${host.shut()}`); }),
        sayWrite(refusal) { this.said.push(refusal); },
    };
    if (bound) host.bind(form);
    const panel: RowPanel = {
        redrawPreview: vi.fn(() => { told.push('preview'); }),
        follow: vi.fn((row: Task | undefined) => { told.push(`follow:${row?.content ?? 'none'}`); }),
        close: vi.fn(),
    };

    /** The index changes the row to `row` (undefined: it holds it no more), and says so. */
    const change = (row: Task | undefined, taskId: string | undefined = 'task-1') => {
        copy = row;
        for (const listener of [...listeners]) listener(taskId);
    };
    return { host, form, panel, told, change, listeners, updateTask, getTask };
}

describe('RowHost.put', () => {
    it('takes the index copy into the form when the write was not made', async () => {
        const fresh = makeTask({ id: 'task-1', content: '元の名前' });
        const h = hostAnswering(false, fresh);

        void h.host.put({ content: '新しい名前' });
        // What is put is the value before the write is asked.
        expect(h.host.task().content).toBe('新しい名前');
        await h.host.drained();

        expect(h.updateTask).toHaveBeenCalledWith('task-1', { content: '新しい名前' }, { tellRefusal: false });
        expect(h.getTask).toHaveBeenLastCalledWith('task-1');
        expect(h.form.refresh).toHaveBeenCalledTimes(1);
        expect(h.host.task()).toBe(fresh);
    });

    it('says why the write was refused at the form\'s end, once, with no notice, and answers no', async () => {
        const h = hostAnswering(false, makeTask({ id: 'task-1' }));

        expect(await h.host.put({ content: '新しい名前' })).toBe(false);

        expect(h.form.said).toEqual([refusalNotice(REFUSED)]);
        expect(Notice.messages).toEqual([]);
    });

    it('takes back what it said of a refusal once a write is made', async () => {
        const h = hostAnswering(false, makeTask({ id: 'task-1' }));
        await h.host.put({ content: '新しい名前' });
        h.updateTask.mockResolvedValueOnce({ written: true });

        expect(await h.host.put({ content: '新しい名前' })).toBe(true);

        expect(h.form.said).toEqual([refusalNotice(REFUSED), null]);
    });

    it('tells a refusal that comes once the hub has closed by a notice, and tells the form nothing', async () => {
        const h = hostAnswering(false, makeTask({ id: 'task-1' }));
        const write = h.host.put({ content: '新しい名前' });
        h.host.dispose();
        await write;

        expect(Notice.messages).toEqual([refusalNotice(REFUSED)]);
        expect(h.form.said).toEqual([]);
        expect(h.form.refresh).not.toHaveBeenCalled();
    });

    it('takes nothing into the form when the write was made', async () => {
        const h = hostAnswering(true, makeTask({ id: 'task-1' }));

        void h.host.put({ content: '新しい名前' });
        await h.host.drained();

        expect(h.updateTask).toHaveBeenCalledTimes(1);
        expect(h.form.refresh).not.toHaveBeenCalled();
    });

    it('takes nothing into the form from nothing when the task is gone from the index', async () => {
        const h = hostAnswering(false, undefined);

        void h.host.put({ content: '新しい名前' });
        await h.host.drained();

        expect(h.getTask).toHaveBeenLastCalledWith('task-1');
        expect(h.form.refresh).not.toHaveBeenCalled();
    });

    it('writes nothing for no change, and answers yes', async () => {
        const h = hostAnswering(true, makeTask({ id: 'task-1' }));

        expect(await h.host.put(null)).toBe(true);
        expect(h.updateTask).not.toHaveBeenCalled();
    });
});

describe('RowHost.drained', () => {
    it('resolves once every write asked is answered, those asked while it waits too', async () => {
        const h = hostAnswering(true, makeTask({ id: 'task-1' }));
        const order: string[] = [];
        let release!: () => void;
        h.updateTask.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve; }); order.push('first'); return { written: true }; });
        let releaseSecond!: () => void;
        h.updateTask.mockImplementationOnce(async () => { await new Promise<void>(resolve => { releaseSecond = resolve; }); order.push('second'); return { written: true }; });

        void h.host.put({ content: 'A' });
        const drained = h.host.drained().then(() => { order.push('drained'); });
        await Promise.resolve();
        void h.host.put({ content: 'B' });
        // Both are asked at once: the order is the operations' to keep.
        expect(h.updateTask).toHaveBeenCalledTimes(2);
        release();
        await Promise.resolve();
        releaseSecond();
        await drained;

        expect(order).toEqual(['first', 'second', 'drained']);
    });
});

describe('RowHost.closing', () => {
    it('answers close at once when no write is under way', () => {
        const h = hostAnswering(true, makeTask({ id: 'task-1' }));
        expect(h.host.closing()).toBe('close');
    });

    it('waits for every write under way: close when all were written, stay when one was refused', async () => {
        const h = hostAnswering(true, makeTask({ id: 'task-1' }));
        void h.host.put({ content: 'A' });
        expect(await h.host.closing()).toBe('close');

        h.updateTask.mockResolvedValueOnce({ written: false, refused: REFUSED });
        void h.host.put({ content: 'B' });
        void h.host.put({ content: 'C' });
        expect(await h.host.closing()).toBe('stay');
    });
});

describe('RowHost following the row', () => {
    it('draws a change of the row in the card, then the form, then the source', () => {
        const h = hostAnswering(true, undefined);
        h.host.attach(h.panel);
        const fresh = makeTask({ id: 'task-1', content: '外の名前' });

        h.change(fresh);

        expect(h.host.task()).toBe(fresh);
        expect(h.told).toEqual(['preview', 'form', 'follow:外の名前']);
    });

    it('follows no other row, and every row when the index does not say which', () => {
        const h = hostAnswering(true, undefined);
        h.host.attach(h.panel);

        h.change(makeTask({ id: 'task-1', content: '外の名前' }), 'task-2');
        expect(h.told).toEqual([]);
        h.change(makeTask({ id: 'task-1', content: '外の名前' }), undefined);
        expect(h.told).toEqual(['preview', 'form', 'follow:外の名前']);
    });

    it('shuts the form once the index no longer holds the row, and opens it again when the row comes back', () => {
        const h = hostAnswering(true, undefined);
        h.host.attach(h.panel);

        h.change(undefined);
        h.change(undefined);
        expect(h.host.shut()).toBe(t('modal.hub.taskMissing'));
        expect(h.told).toEqual([`shut:${t('modal.hub.taskMissing')}`, 'follow:none', 'follow:none']);

        h.told.length = 0;
        h.change(makeTask({ id: 'task-1', content: '戻った' }));
        expect(h.host.shut()).toBeNull();
        expect(h.told).toEqual(['preview', 'shut:null', 'form', 'follow:戻った']);
    });

    it('does not show the shut again on a change while the row is held', () => {
        const h = hostAnswering(true, undefined);
        h.host.attach(h.panel);

        h.change(makeTask({ id: 'task-1', content: 'A' }));
        h.change(makeTask({ id: 'task-1', content: 'B' }));
        expect(h.form.showShut).not.toHaveBeenCalled();
    });

    it('draws the card and tells the source with no form to tell, as on a read-only row', () => {
        const h = hostAnswering(true, undefined, REFUSED, false);
        h.host.attach(h.panel);

        h.change(makeTask({ id: 'task-1', content: '外の名前' }));
        h.change(undefined);
        h.change(makeTask({ id: 'task-1', content: '戻った' }));

        expect(h.told).toEqual(['preview', 'follow:外の名前', 'follow:none', 'preview', 'follow:戻った']);
        expect(h.host.shut()).toBeNull();
    });

    it('no longer follows the row once the hub has closed', () => {
        const h = hostAnswering(true, undefined);
        h.host.attach(h.panel);
        h.host.dispose();

        expect(h.listeners).toHaveLength(0);
        h.change(makeTask({ id: 'task-1', content: '外の名前' }));
        expect(h.told).toEqual([]);
    });
});

describe('RowHost.shut', () => {
    it('shuts the form while the source holds the row, saying so before the row being gone, and shows it once per change', () => {
        const h = hostAnswering(true, undefined);
        h.host.attach(h.panel);

        h.host.setSourceOpen(true);
        h.host.setSourceOpen(true);
        h.change(undefined);
        expect(h.host.shut()).toBe(t('modal.hub.source.formShut'));
        expect(h.form.showShut).toHaveBeenCalledTimes(2);

        h.host.setSourceOpen(false);
        expect(h.host.shut()).toBe(t('modal.hub.taskMissing'));
    });
});

describe('RowHost.openSource', () => {
    it('opens the line on the value, and closes the hub, as for any navigation', () => {
        const h = hostAnswering(true, undefined);
        h.host.attach(h.panel);
        void h.host.put({ content: '打った名前' });
        const locate = () => null;

        h.host.openSource(locate);
        expect(openSourceLine).toHaveBeenCalledWith(expect.objectContaining({ reuseTab: true }), h.host.task(), locate);
        expect(h.panel.close).toHaveBeenCalledTimes(1);
    });
});
