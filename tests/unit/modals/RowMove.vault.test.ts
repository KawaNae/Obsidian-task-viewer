import { describe, it, expect, afterEach, vi } from 'vitest';
import { openLiveVault, type VaultSession } from '../helpers/vaultSession';
import { t } from '../../../src/i18n';
import { DEFAULT_SETTINGS } from '../../../src/types';
import { NoteOps } from '../../../src/services/data/NoteOps';
import { NotePlaces } from '../../../src/services/data/NotePlaces';
import { RowMove, type MoveHost, type MoveStart } from '../../../src/modals/hub/RowMove';
import type { FormIssue } from '../../../src/modals/form/FormIssue';
import type { SendViewState } from '../../../src/modals/noteops/SendDialog';

/**
 * The hub moving a row (`RowMove`) over a vault: the draft is a real
 * `RowDraft`, where the row goes is a real `SendDialog`, and the move is the
 * real send (`NoteOps.send`). The host records what it was told; a view of
 * where the row goes records what it was drawn.
 */

const FILE = 'note.md';
const NOTE = ['# Tasks', '- [ ] Parent', '    - [ ] Row @2026-11-26', '# Done', '- [ ] Other', ''];

let live: VaultSession | undefined;
afterEach(() => { live?.dispose(); live = undefined; });

/** Let the asks of where the fields name answer. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

async function open(lines: string[] = NOTE, start: MoveStart = 'here', files: Record<string, string[]> = {}) {
    const { contents, session } = await openLiveVault({ [FILE]: lines, ...files }, s => { live = s; });
    const getSettings = () => ({ ...DEFAULT_SETTINGS });
    const ops = new NoteOps(session.app, session.ops, getSettings, {
        places: new NotePlaces(session.app, getSettings),
        getTask: (id) => session.index.getTask(id),
        timers: () => null,
    });
    const row = session.index.getTasks().find(one => one.content === 'Row')!;
    const preview = (await ops.previewSend([row.id]))!;
    const said: (readonly FormIssue<never>[])[] = [];
    const refused: (string | null)[] = [];
    const host: MoveHost & Record<string, unknown> = {
        say: (issues) => { said.push(issues); },
        refuse: (why) => { refused.push(why); },
        drafted: vi.fn(),
        underWay: vi.fn(),
        showDraft: vi.fn(),
        submit: vi.fn(),
        leave: vi.fn(),
        close: vi.fn(),
        putTyped: vi.fn(() => true),
        sourceChanged: vi.fn(),
        edited: vi.fn(),
    };
    const move = new RowMove(preview, start, { settings: DEFAULT_SETTINGS, unit: '    ', ops, host });
    const drawn: SendViewState[] = [];
    move.show({ render: (state) => { drawn.push(state); } });
    await settle();
    return {
        session, move, host, said, refused, drawn, row, preview,
        lines: () => contents.get(FILE)!.split('\n'),
        file: (path: string) => contents.get(path)?.split('\n'),
        lastSaid: () => said[said.length - 1].map(issue => issue.text),
        noteSays: () => drawn[drawn.length - 1].issues.filter(issue => issue.at === 'note').map(issue => [issue.tone, issue.text]),
    };
}

describe('opening', () => {
    it('here: the fields name the row\'s note, picked, and the heading it stands under', async () => {
        const m = await open();
        expect(m.move.initial).toEqual({ note: { text: 'note', picked: FILE }, heading: 'Tasks' });
        expect(m.move.task()).toMatchObject({ id: m.row.id, content: 'Row', startDate: '2026-11-26' });
        expect(m.move.changed()).toBe(false);
    });

    it('here, on a row above the note\'s first heading: the heading field is empty, the note\'s end, which is in the last heading\'s section', async () => {
        const m = await open(['- [ ] Row', '# Tasks', '- [ ] Other', '']);
        expect(m.move.initial.heading).toBe('');
        expect(m.move.canWrite()).toBe(true);
    });

    it('here, on a row of a note with no heading: the note\'s end is where it stands, no move', async () => {
        const m = await open(['- [ ] Row', '- [ ] Other', '']);
        expect(m.move.initial.heading).toBe('');
        expect(m.move.canWrite()).toBe(false);
        expect(m.noteSays()).toEqual([['info', t('modal.send.samePlace')]]);
    });

    it('defaults: the fields open as a send of the row does', async () => {
        const m = await open(NOTE, 'defaults');
        expect(m.move.initial).toEqual({ note: { text: 'Row', picked: null }, heading: DEFAULT_SETTINGS.taskHeading });
    });

    it('the view drawn later is drawn what the move says now', async () => {
        const m = await open();
        const later: SendViewState[] = [];
        m.move.show({ render: (state) => { later.push(state); } });
        expect(later).toEqual([m.drawn[m.drawn.length - 1]]);
    });
});

describe('where the row stands', () => {
    it('is no move, even with the draft changed: said under the note, in the tone of what the move does', async () => {
        const m = await open();
        expect(m.move.put({ content: 'Renamed' })).toBe(true);
        await settle();
        expect(m.move.canWrite()).toBe(false);
        expect(m.noteSays()).toEqual([['info', t('modal.send.samePlace')]]);
    });

    it('another heading of the note is a move', async () => {
        const m = await open();
        m.move.fieldsChanged({ ...m.move.initial, heading: 'Done' });
        await settle();
        expect(m.move.canWrite()).toBe(true);
        expect(m.noteSays()).not.toContainEqual(['info', t('modal.send.samePlace')]);
        expect(m.move.changed()).toBe(true);
    });
});

describe('a field\'s change', () => {
    it('is taken into the draft and written to no note: the card and the fields are told, the last refusal taken back', async () => {
        const m = await open();
        const before = m.lines();
        expect(m.move.put({ content: 'Renamed' })).toBe(true);
        expect(m.move.task().content).toBe('Renamed');
        expect(m.lines()).toEqual(before);
        expect(m.host.drafted).toHaveBeenCalledTimes(1);
        expect(m.refused).toEqual([null]);
        expect(m.move.changed()).toBe(true);
    });

    it('over a property whose lines are wrong is refused as a write is, and the draft is as it was', async () => {
        const m = await open(['# Tasks', '- [ ] Row', '\t- tv-color:: red', '\t- tv-color:: green', '# Done', '']);
        expect(m.move.put({ content: 'Renamed', color: 'blue' })).toBe(false);
        expect(m.refused[0]).toContain('tv-color');
        expect(m.move.task().content).toBe('Row');
        expect(m.host.drafted).not.toHaveBeenCalled();
        expect(m.move.changed()).toBe(false);
    });
});

describe('the move', () => {
    it('writes the draft where the fields name in one send, and closes the hub', async () => {
        const m = await open();
        m.move.put({ content: 'Renamed' });
        m.move.fieldsChanged({ ...m.move.initial, heading: 'Done' });
        await settle();
        m.move.write();
        expect(m.move.writing()).toBe(true);
        expect(m.host.underWay).toHaveBeenCalledTimes(1);
        const made = m.move.moving();
        await vi.waitFor(() => expect(m.host.close).toHaveBeenCalled());
        expect(await made).toBe(true);
        expect(m.lines()).toEqual(['# Tasks', '- [ ] Parent', '# Done', '- [ ] Renamed @2026-11-26', '- [ ] Other', '']);
    });

    it('to another note carries the draft there', async () => {
        const m = await open(NOTE, 'here', { 'Plan.md': ['# Tasks', ''] });
        m.move.put({ content: 'Renamed' });
        m.move.fieldsChanged({ note: { text: 'Plan', picked: 'Plan.md' }, heading: 'Tasks' });
        await settle();
        m.move.write();
        await vi.waitFor(() => expect(m.host.close).toHaveBeenCalled());
        expect(m.file('Plan.md')!.join('\n')).toContain('- [ ] Renamed @2026-11-26');
        expect(m.lines()).not.toContain('    - [ ] Row @2026-11-26');
    });

    it('not made keeps the draft, says why above the write, and may be asked again', async () => {
        const m = await open();
        m.move.put({ content: 'Renamed' });
        m.move.fieldsChanged({ ...m.move.initial, heading: 'Done' });
        await settle();
        // The send answers as one the operations refused.
        const send = vi.spyOn(NoteOps.prototype, 'send').mockResolvedValueOnce({ kind: 'not-done', why: 'refused here' });
        m.move.write();
        await vi.waitFor(() => expect(m.lastSaid()).toContain('refused here'));
        send.mockRestore();
        await settle();
        expect(m.host.close).not.toHaveBeenCalled();
        expect(m.move.writing()).toBe(false);
        expect(m.move.task().content).toBe('Renamed');
        expect(m.move.canWrite()).toBe(true);
    });
});

describe('the row changed outside', () => {
    it('keeps the draft and asks no move, why said above the write, as the index\'s row is compared, not the telling', async () => {
        const m = await open();
        m.move.put({ content: 'Renamed' });
        m.move.fieldsChanged({ ...m.move.initial, heading: 'Done' });
        await settle();
        m.move.follow(m.session.index.getTask(m.row.id));
        expect(m.move.canWrite()).toBe(true);

        m.move.follow({ ...m.row, subtreeLines: ['    - [ ] Row @2026-11-27'] });
        expect(m.move.canWrite()).toBe(false);
        expect(m.lastSaid()).toContain(t('modal.hub.move.changed'));
        expect(m.move.task().content).toBe('Renamed');
    });

    it('lost: the same, said as lost', async () => {
        const m = await open();
        m.move.fieldsChanged({ ...m.move.initial, heading: 'Done' });
        await settle();
        m.move.follow(undefined);
        expect(m.move.canWrite()).toBe(false);
        expect(m.lastSaid()).toContain(t('modal.hub.move.lost'));
    });
});

describe('throwing it away', () => {
    it('is the host\'s leave; a field changed back to where it opened leaves nothing to lose', async () => {
        const m = await open();
        m.move.fieldsChanged({ ...m.move.initial, heading: 'Done' });
        expect(m.move.changed()).toBe(true);
        m.move.fieldsChanged({ ...m.move.initial });
        expect(m.move.changed()).toBe(false);
        m.move.discard();
        expect(m.host.leave).toHaveBeenCalledTimes(1);
    });
});

describe('the card\'s rows', () => {
    const TREE = ['# Tasks', '- [ ] Row', '    - [x] Child', '        - [ ] Grandchild', '    - note line', '# Done', ''];

    it('are the draft\'s: the row, its children by the names its row names them, and theirs', async () => {
        const m = await open(TREE);
        const rows = m.move.cardRows();
        const row = rows(m.row.id)!;
        expect(row).toEqual(m.move.task());
        expect(row.childIds).toHaveLength(1);
        const child = rows(row.childIds[0])!;
        expect(child).toMatchObject({ content: 'Child', statusChar: 'x', parentId: m.row.id });
        expect(rows(child.childIds[0])).toMatchObject({ content: 'Grandchild', statusChar: ' ' });
        expect(row.childLines.map(line => line.text.trim())).toEqual(['- note line']);
        // Named outside the index: the index's child is none of these.
        const indexChild = m.session.index.getTasks().find(task => task.content === 'Child')!;
        expect(rows(indexChild.id)).toBeUndefined();
    });

    it('read the draft as a field\'s change left it', async () => {
        const m = await open(TREE);
        expect(m.move.put({ content: 'Renamed', color: 'blue' })).toBe(true);
        const row = m.move.cardRows()(m.row.id)!;
        expect(row.content).toBe('Renamed');
        expect(row.childLines.map(line => line.propertyKey)).toContain('tv-color');
        expect(m.move.cardRows()(row.childIds[0])).toMatchObject({ content: 'Child' });
    });
});
