import { describe, it, expect, afterEach, vi } from 'vitest';
import { TFile } from 'obsidian';
import { openLiveVault, type VaultSession } from '../helpers/vaultSession';
import { t } from '../../../src/i18n';
import { DEFAULT_SETTINGS } from '../../../src/types';
import { NoteOps } from '../../../src/services/data/NoteOps';
import { NotePlaces } from '../../../src/services/data/NotePlaces';
import { RowHost, type MoveOpening } from '../../../src/modals/hub/RowHost';
import type { MoveStart } from '../../../src/modals/hub/RowMove';
import { initialAsk } from '../../../src/modals/noteops/SendDialog';
import { SubtreeFrame } from '../../../src/services/persistence/utils/SubtreeFrame';
import type { HubForm, HubPanel } from '../../../src/modals/hub/HubHost';
import type { FormIssue } from '../../../src/modals/form/FormIssue';
import type { Task } from '../../../src/types';

/**
 * The host of a hub on a row in its two states over a vault: writing each
 * change as it comes, and moving the row (`RowMove`), the changes held in
 * its draft until the move writes them with the row at once. The index, the
 * operations and the send are real; the form and the panel record what they
 * were told. The move itself (its draft, where the row goes, the send's
 * answers) is seen in RowMove.vault.test.ts: here, how the host goes into
 * it, what it answers meanwhile, and how it comes out, begun from the hub or
 * opened in it.
 */

const FILE = 'note.md';
const NOTE = ['# Tasks', '- [ ] Parent', '    - [ ] Row @2026-11-26', '# Done', '- [ ] Other', ''];

let live: VaultSession | undefined;
afterEach(() => { live?.dispose(); live = undefined; vi.restoreAllMocks(); });

/** Let the asks of where the fields name, and the scans, answer. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

/** A promise answered when the test says. */
function gate() {
    let open!: () => void;
    const shut = new Promise<void>(resolve => { open = resolve; });
    return { shut, open };
}

/** Hold the read of the row: it answers what it read once `wait` is open. */
function holdRead(noteOps: NoteOps, wait: Promise<void>) {
    const read = noteOps.previewSend.bind(noteOps);
    return vi.spyOn(noteOps, 'previewSend').mockImplementation(async (ids) => {
        const preview = await read(ids);
        await wait;
        return preview;
    });
}

/**
 * A host on the row `Row` of `lines`, its form bound and its hub attached.
 * `opening`: the hub opens in a move of the row from where it says, the row
 * read from the disk first, as the hub's entry reads it; `beforeAttach` runs
 * between that read and the hub opening.
 */
async function open(lines: string[] = NOTE, opts: { opening?: MoveStart; beforeAttach?: (session: VaultSession, row: Task) => Promise<void> } = {}) {
    const { contents, session } = await openLiveVault({ [FILE]: lines }, s => { live = s; });
    /** The note written from outside, and the index told. */
    const writeOutside = async (next: string[]) => {
        contents.set(FILE, next.join('\n'));
        await session.fireVault('modify', session.app.vault.getAbstractFileByPath(FILE));
        // The index tells its listeners once the changes of a moment are gathered (`NotifyCoalescer`).
        await new Promise(resolve => setTimeout(resolve, 40));
    };
    const getSettings = () => ({ ...DEFAULT_SETTINGS });
    const noteOps = new NoteOps(session.app, session.ops, getSettings, {
        places: new NotePlaces(session.app, getSettings),
        getTask: (id) => session.index.getTask(id),
        timers: () => null,
    });
    const vault = session.app.vault;
    const app = { ...session.app, vault: Object.assign(Object.create(vault), { cachedRead: (file: TFile) => vault.read(file) }) };
    const row = session.index.getTasks().find(one => one.content === 'Row')!;
    let opening: MoveOpening | null = null;
    if (opts.opening) {
        const preview = await noteOps.previewSend([row.id]);
        opening = { preview: preview!, start: opts.opening };
    }
    const source = { follow: vi.fn(), hold: vi.fn() };
    const host = new RowHost(row, {
        app: app as never,
        plugin: { settings: DEFAULT_SETTINGS } as never,
        index: session.index,
        operations: session.ops,
        noteOps,
        indentUnit: () => '    ',
    }, source, opening);
    const told: string[] = [];
    const put: (string | null)[] = [];
    const place: (readonly FormIssue<never>[])[] = [];
    let typed = true;
    const form: HubForm = {
        refresh: vi.fn(() => { told.push('refresh'); }),
        showShut: vi.fn(() => { told.push(`shut:${host.shut()}`); }),
        sayPut: (why) => { put.push(why); },
        sayWrite: vi.fn(),
        sayPlace: (issues) => { place.push(issues); },
        showDraft: vi.fn(() => { told.push(`draft:${host.draft() !== null}`); }),
        // The form's write, its fields all saved: it asks the host's.
        write: vi.fn(() => { if (host.draft()?.canWrite()) host.draft()!.write(); }),
        putTyped: vi.fn(() => { told.push('typed'); return typed; }),
        notWritten: vi.fn(),
    };
    host.bind(form);
    const panel: HubPanel = { redrawPreview: vi.fn(() => { told.push('card'); }), close: vi.fn() };
    await opts.beforeAttach?.(session, row);
    host.attach(panel);
    await settle();
    return {
        session, contents, noteOps, host, form, panel, source, told, put, place, row,
        typedFails: () => { typed = false; },
        lines: () => contents.get(FILE)!.split('\n'),
        writeOutside,
        /** Begin a move, and let where its fields name answer. */
        begin: async () => {
            await host.beginMove('here');
            await settle();
        },
        move: () => host.moving()!,
    };
}

describe('beginning a move', () => {
    it('puts in what is typed, waits for the writes asked, then reads the row as the disk holds it', async () => {
        const h = await open();
        const preview = vi.spyOn(h.noteOps, 'previewSend');
        void h.host.put({ content: 'Typed' });
        await h.begin();
        expect(h.told.indexOf('typed')).toBeLessThan(h.told.lastIndexOf('draft:true'));
        expect(preview).toHaveBeenCalledWith([h.row.id]);
        // The write asked before was on the disk when the row was read.
        expect(h.lines()).toContain('    - [ ] Typed @2026-11-26');
        expect(h.host.task().content).toBe('Typed');
        expect(h.host.draft()).not.toBeNull();
    });

    it('opens the fields of where the row goes on where it stands: its note and its heading', async () => {
        const h = await open();
        await h.begin();
        expect(h.move().initial).toEqual({ note: { text: 'note', picked: FILE }, heading: 'Tasks' });
    });

    it('draws the form, the card and the row of buttons once the host holds the move, which reads as the send dialog\'s', async () => {
        const h = await open();
        h.told.length = 0;
        await h.host.beginMove('here');
        expect(h.told.slice(-4)).toEqual(['shut:null', 'refresh', 'card', 'draft:true']);
        expect(h.put).toEqual([null]);
        expect(h.host.draft()).toMatchObject({ label: t('modal.send.send'), busyLabel: t('modal.send.sending') });
    });

    it('does not begin while a value typed cannot be saved, nor once the row is not the one on the disk', async () => {
        const h = await open();
        h.typedFails();
        const preview = vi.spyOn(h.noteOps, 'previewSend');
        await h.begin();
        expect(h.host.draft()).toBeNull();
        expect(preview).not.toHaveBeenCalled();
        expect(h.source.hold.mock.calls).toEqual([[true], [false]]);

        const g = await open();
        vi.spyOn(g.noteOps, 'previewSend').mockResolvedValueOnce(null);
        await g.begin();
        expect(g.host.draft()).toBeNull();
        expect(g.source.hold.mock.calls).toEqual([[true], [false]]);
    });

    it('does not begin while the source mode holds the row, nor once the row is lost', async () => {
        const h = await open();
        h.host.setSourceOpen(true);
        await h.begin();
        expect(h.host.draft()).toBeNull();
        expect(h.form.putTyped).not.toHaveBeenCalled();

        const g = await open();
        await g.writeOutside(['# Tasks', '- [ ] Other', '']);
        await g.begin();
        expect(g.host.draft()).toBeNull();
    });

    it('takes no change of the fields while it is begun, the fields shut with nothing said, and holds the move on the row as read', async () => {
        const h = await open();
        const wait = gate();
        holdRead(h.noteOps, wait.shut);
        const begun = h.host.beginMove('here');
        expect(h.host.shut()).toBe('');
        expect(h.told).toContain('shut:');
        expect(await h.host.put({ content: 'Typed' })).toBe(false);
        wait.open();
        await begun;
        await settle();
        expect(h.lines()).toEqual(NOTE);
        expect(h.host.task().content).toBe('Row');
        expect(h.host.shut()).toBeNull();
        expect(h.place.at(-1)).toEqual([]);
    });

    it('asked again while it is begun, reads the row once', async () => {
        const h = await open();
        const wait = gate();
        const read = holdRead(h.noteOps, wait.shut);
        const first = h.host.beginMove('here');
        const again = h.host.beginMove('defaults');
        wait.open();
        await Promise.all([first, again]);
        expect(read).toHaveBeenCalledTimes(1);
        expect(h.move().initial.heading).toBe('Tasks');
    });

    it('does not begin once a write asked before was refused, the fields open again', async () => {
        const h = await open();
        vi.spyOn(h.session.ops, 'updateTask').mockResolvedValueOnce({ written: false, refused: null });
        const read = vi.spyOn(h.noteOps, 'previewSend');
        void h.host.put({ content: 'Typed' });
        await h.begin();
        expect(h.host.draft()).toBeNull();
        expect(read).not.toHaveBeenCalled();
        expect(h.host.shut()).toBeNull();
        expect(h.told.at(-1)).toBe('shut:null');
        expect(h.source.hold.mock.calls).toEqual([[true], [false]]);
    });

    it('does not begin once the hub closed, or the row was lost, before the row is read', async () => {
        for (const meanwhile of ['closed', 'lost'] as const) {
            const h = await open();
            const wait = gate();
            const write = h.session.ops.updateTask.bind(h.session.ops);
            vi.spyOn(h.session.ops, 'updateTask').mockImplementationOnce(async (...args) => { await wait.shut; return write(...args); });
            const read = vi.spyOn(h.noteOps, 'previewSend');
            void h.host.put({ content: 'Typed' });
            const begun = h.host.beginMove('here');
            if (meanwhile === 'closed') h.host.dispose();
            else await h.writeOutside(['# Tasks', '- [ ] Other', '']);
            wait.open();
            await begun;
            expect(read).not.toHaveBeenCalled();
            expect(h.host.draft()).toBeNull();
            live?.dispose();
            live = undefined;
        }
    });

    it('does not begin once the hub closed, or the row was lost, after the row is read', async () => {
        for (const meanwhile of ['closed', 'lost'] as const) {
            const h = await open();
            const wait = gate();
            holdRead(h.noteOps, wait.shut);
            const begun = h.host.beginMove('here');
            await settle();
            if (meanwhile === 'closed') h.host.dispose();
            else await h.writeOutside(['# Tasks', '- [ ] Other', '']);
            wait.open();
            await begun;
            expect(h.host.draft()).toBeNull();
            expect(h.source.hold.mock.calls.at(-1)).toEqual([false]);
            if (meanwhile === 'lost') expect(h.host.shut()).toBe(t('modal.hub.taskMissing'));
            live?.dispose();
            live = undefined;
        }
    });
});

describe('while the row moves', () => {
    it('holds the source mode, and offers no line of the row to open', async () => {
        const h = await open();
        expect(h.host.openSource).not.toBeNull();
        await h.begin();
        expect(h.source.hold.mock.calls).toEqual([[true]]);
        expect(h.host.openSource).toBeNull();
    });

    it('has the card read the move\'s rows, the draft as it is now, and the index again once the move is thrown away', async () => {
        const h = await open();
        expect(h.host.cardRows()).toBeNull();
        await h.begin();
        await h.host.put({ content: 'Renamed' });
        expect(h.host.cardRows()!(h.row.id)).toEqual(h.host.task());
        expect(h.host.cardRows()!(h.row.id)!.content).toBe('Renamed');
        h.host.draft()!.discard!();
        expect(h.host.cardRows()).toBeNull();
    });

    it('takes a change of the fields into the draft and writes no note: the card and the fields draw the draft', async () => {
        const h = await open();
        await h.begin();
        const before = h.lines();
        h.told.length = 0;
        expect(await h.host.put({ content: 'Renamed' })).toBe(true);
        expect(h.lines()).toEqual(before);
        expect(h.host.task().content).toBe('Renamed');
        expect(h.told).toContain('refresh');
        expect(h.told).toContain('card');
    });

    it('says a change the draft refuses above the form\'s tabs, as a write refused', async () => {
        const h = await open(['# Tasks', '- [ ] Row', '\t- tv-color:: red', '\t- tv-color:: green', '# Done', '']);
        await h.begin();
        expect(await h.host.put({ color: 'blue' })).toBe(false);
        expect(h.put.at(-1)).toContain('tv-color');
    });

    it('offers no move to where the row stands, whatever the draft holds, and one to another heading', async () => {
        const h = await open();
        await h.begin();
        await h.host.put({ content: 'Renamed' });
        expect(h.host.draft()!.canWrite()).toBe(false);
        h.move().fieldsChanged({ ...h.move().initial, heading: 'Done' });
        await settle();
        expect(h.host.draft()!.canWrite()).toBe(true);
    });

    it('is not told of the index\'s changes as the value: the move compares the index\'s row with the one it opened on', async () => {
        const h = await open();
        await h.begin();
        await h.host.put({ content: 'Renamed' });
        h.move().fieldsChanged({ ...h.move().initial, heading: 'Done' });
        await settle();
        // Another row of the note written by the operations: told, and the row is the one opened on.
        const other = h.session.index.getTasks().find(one => one.content === 'Other')!;
        await h.session.ops.updateTask(other.id, { content: 'Other changed' });
        await new Promise(resolve => setTimeout(resolve, 40));
        expect(h.lines()).toContain('- [ ] Other changed');
        expect(h.host.draft()!.canWrite()).toBe(true);
        // The row itself changed: the draft stays, no move is asked, and why is said above the write.
        await h.session.ops.updateTask(h.row.id, { startDate: '2026-11-27' });
        await new Promise(resolve => setTimeout(resolve, 40));
        expect(h.host.task().content).toBe('Renamed');
        expect(h.host.draft()!.canWrite()).toBe(false);
        expect(h.place.at(-1)!.map(issue => issue.text)).toContain(t('modal.hub.move.changed'));
        expect(h.host.shut()).toBeNull();
    });

    it('lost, the same, said as lost', async () => {
        const h = await open();
        await h.begin();
        await h.writeOutside(['# Tasks', '- [ ] Other', '']);
        expect(h.host.draft()!.canWrite()).toBe(false);
        expect(h.place.at(-1)!.map(issue => issue.text)).toContain(t('modal.hub.move.lost'));
    });
});

describe('the move', () => {
    it('writes the draft and where the row goes at once, and closes the hub', async () => {
        const h = await open();
        await h.begin();
        await h.host.put({ content: 'Renamed' });
        h.move().fieldsChanged({ ...h.move().initial, heading: 'Done' });
        await settle();
        h.form.write();
        expect(h.host.shut()).toBe(t('modal.hub.move.formShut'));
        await vi.waitFor(() => expect(h.panel.close).toHaveBeenCalled());
        expect(h.lines()).toEqual(['# Tasks', '- [ ] Parent', '# Done', '- [ ] Renamed @2026-11-26', '- [ ] Other', '']);
    });

    it('not made keeps the move, why said above the write', async () => {
        const h = await open();
        await h.begin();
        h.move().fieldsChanged({ ...h.move().initial, heading: 'Done' });
        await settle();
        vi.spyOn(h.noteOps, 'send').mockResolvedValueOnce({ kind: 'not-done', why: 'refused here' });
        h.form.write();
        await vi.waitFor(() => expect(h.place.at(-1)!.map(issue => issue.text)).toContain('refused here'));
        expect(h.panel.close).not.toHaveBeenCalled();
        expect(h.host.draft()).not.toBeNull();
    });

    it('under way takes no change of the fields into the draft', async () => {
        const h = await open();
        await h.begin();
        h.move().fieldsChanged({ ...h.move().initial, heading: 'Done' });
        await settle();
        const wait = gate();
        const send = h.noteOps.send.bind(h.noteOps);
        vi.spyOn(h.noteOps, 'send').mockImplementationOnce(async (...args) => { await wait.shut; return send(...args); });
        h.form.write();
        expect(await h.host.put({ content: 'During' })).toBe(false);
        expect(h.host.task().content).toBe('Row');
        wait.open();
        await vi.waitFor(() => expect(h.panel.close).toHaveBeenCalled());
        expect(h.lines()).toContain('- [ ] Row @2026-11-26');
    });

    it('under way is waited for by a close; made, the hub closes', async () => {
        const h = await open();
        await h.begin();
        expect(h.host.closing()).toBe('close');
        h.move().fieldsChanged({ ...h.move().initial, heading: 'Done' });
        await settle();
        h.form.write();
        const answer = h.host.closing();
        expect(answer).toBeInstanceOf(Promise);
        expect(await answer).toBe('close');
    });
});

describe('throwing the move away', () => {
    it('writes each change as it comes again, from the index\'s copy, what was said of the move taken back', async () => {
        const h = await open();
        await h.begin();
        await h.host.put({ content: 'Renamed' });
        h.put.length = 0;
        h.place.length = 0;
        h.told.length = 0;
        h.host.draft()!.discard!();
        expect(h.host.draft()).toBeNull();
        expect(h.host.task().content).toBe('Row');
        expect(h.put).toEqual([null]);
        expect(h.place).toEqual([[]]);
        expect(h.told).toEqual(['shut:null', 'refresh', 'card', 'draft:false']);
        expect(h.source.hold.mock.calls).toEqual([[true], [false]]);
        expect(h.host.openSource).not.toBeNull();
        expect(h.lines()).toEqual(NOTE);

        await h.host.put({ content: 'Written' });
        expect(h.lines()).toContain('    - [ ] Written @2026-11-26');
    });

    it('takes the index\'s copy as it is now, the row written by the plugin meanwhile', async () => {
        const h = await open();
        await h.begin();
        await h.host.put({ content: 'Renamed' });
        await h.session.ops.updateTask(h.row.id, { startDate: '2026-11-27' }, { tellRefusal: false });
        await new Promise(resolve => setTimeout(resolve, 40));
        h.host.draft()!.discard!();
        expect(h.host.task()).toMatchObject({ content: 'Row', startDate: '2026-11-27' });
    });

    it('once the row was lost shuts the fields', async () => {
        const h = await open();
        await h.begin();
        await h.writeOutside(['# Tasks', '- [ ] Other', '']);
        h.host.draft()!.discard!();
        expect(h.host.shut()).toBe(t('modal.hub.taskMissing'));
    });
});

describe('the hub closed', () => {
    it('lets the move go: an answer that comes after draws nothing', async () => {
        const h = await open();
        await h.begin();
        const wait = gate();
        const facts = h.noteOps.destinationFacts.bind(h.noteOps);
        vi.spyOn(h.noteOps, 'destinationFacts').mockImplementationOnce(async (...args) => { await wait.shut; return facts(...args); });
        h.move().fieldsChanged({ ...h.move().initial, heading: 'Done' });
        h.host.dispose();
        const said = h.place.length;
        const drawn = h.told.length;
        wait.open();
        await settle();
        await settle();
        expect(h.place.length).toBe(said);
        expect(h.told.length).toBe(drawn);
    });
});

describe('a hub opened in a move', () => {
    it('holds the move as the hub opens, the form, the card and the row of buttons drawn, nothing put in first', async () => {
        const h = await open(NOTE, { opening: 'defaults' });
        expect(h.host.draft()).not.toBeNull();
        // The move draws itself as it is made, before the host holds it (`draft:false`), then is drawn again.
        expect(h.told.slice(0, 5)).toEqual(['draft:false', 'shut:null', 'refresh', 'card', 'draft:true']);
        expect(h.form.putTyped).not.toHaveBeenCalled();
        expect(h.source.hold.mock.calls).toEqual([[true]]);
        expect(h.host.openSource).toBeNull();
    });

    it('opens the fields of where the row goes where a send goes, as the send dialog opened them', async () => {
        const h = await open(NOTE, { opening: 'defaults' });
        const preview = await h.noteOps.previewSend([h.row.id]);
        expect(h.move().initial).toEqual(initialAsk(preview!));
        expect(h.move().initial).not.toEqual({ note: { text: 'note', picked: FILE }, heading: 'Tasks' });
    });

    it('compares the index\'s row as the hub opens with the one read: written since, no move is asked, and why is said', async () => {
        const h = await open(NOTE, {
            opening: 'here',
            beforeAttach: async (session, row) => {
                await session.ops.updateTask(row.id, { startDate: '2026-11-27' });
                await new Promise(resolve => setTimeout(resolve, 40));
            },
        });
        h.move().fieldsChanged({ ...h.move().initial, heading: 'Done' });
        await settle();
        expect(h.host.draft()!.canWrite()).toBe(false);
        expect(h.place.at(-1)!.map(issue => issue.text)).toContain(t('modal.hub.move.changed'));
    });

    it('begins no move again from the hub while it is in one', async () => {
        const h = await open(NOTE, { opening: 'defaults' });
        const move = h.move();
        const preview = vi.spyOn(h.noteOps, 'previewSend');
        await h.host.beginMove('defaults');
        expect(h.move()).toBe(move);
        expect(preview).not.toHaveBeenCalled();
    });

    it('thrown away, writes each change as it comes again, as a move begun from the hub', async () => {
        const h = await open(NOTE, { opening: 'defaults' });
        await h.host.put({ content: 'Renamed' });
        h.told.length = 0;
        h.host.draft()!.discard!();
        expect(h.host.draft()).toBeNull();
        expect(h.told).toEqual(['shut:null', 'refresh', 'card', 'draft:false']);
        expect(h.host.task().content).toBe('Row');
        await h.host.put({ content: 'Written' });
        expect(h.lines()).toContain('    - [ ] Written @2026-11-26');
    });

    it('made, writes the draft and where the row goes at once, and closes the hub', async () => {
        const h = await open(NOTE, { opening: 'here' });
        await h.host.put({ content: 'Renamed' });
        h.move().fieldsChanged({ ...h.move().initial, heading: 'Done' });
        await settle();
        h.form.write();
        await vi.waitFor(() => expect(h.panel.close).toHaveBeenCalled());
        expect(h.lines()).toEqual(['# Tasks', '- [ ] Parent', '# Done', '- [ ] Renamed @2026-11-26', '- [ ] Other', '']);
    });
});

describe('a row whose subtree the source cannot open', () => {
    /** A line under the row shallower than its child: the source mode does not open on the subtree. */
    const SHALLOW = ['# Tasks', '- [ ] Row', '  going on', '    - [ ] child', '# Done', ''];

    it('is moved with its lines as they stand, from a move begun in the hub and from a hub opened in one', async () => {
        const h = await open(SHALLOW);
        expect(SubtreeFrame.open(h.row.subtreeLines!, '    ')).toMatchObject({ open: false, reason: 'shallow' });
        await h.begin();
        await h.host.put({ content: 'Renamed' });
        h.move().fieldsChanged({ ...h.move().initial, heading: 'Done' });
        await settle();
        h.form.write();
        await vi.waitFor(() => expect(h.panel.close).toHaveBeenCalled());
        expect(h.lines()).toEqual(['# Tasks', '# Done', '- [ ] Renamed', '  going on', '    - [ ] child', '']);

        const g = await open(SHALLOW, { opening: 'here' });
        g.move().fieldsChanged({ ...g.move().initial, heading: 'Done' });
        await settle();
        g.form.write();
        await vi.waitFor(() => expect(g.panel.close).toHaveBeenCalled());
        expect(g.lines()).toEqual(['# Tasks', '# Done', '- [ ] Row', '  going on', '    - [ ] child', '']);
    });
});
