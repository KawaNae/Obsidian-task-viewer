import { describe, it, expect, afterEach, vi } from 'vitest';
import { TFile } from 'obsidian';
import { openLiveVault, type VaultSession } from '../helpers/vaultSession';
import { t } from '../../../src/i18n';
import { DEFAULT_SETTINGS } from '../../../src/types';
import { NoteOps } from '../../../src/services/data/NoteOps';
import { NotePlaces } from '../../../src/services/data/NotePlaces';
import { RowHost, type MoveOpening } from '../../../src/modals/hub/RowHost';
import { TaskHubSource, type SourceViewState } from '../../../src/modals/hub/TaskHubSource';
import type { SubtreeFrame } from '../../../src/services/persistence/utils/SubtreeFrame';
import type { DraftEditor, SourceDraft } from '../../../src/modals/form/source/SourceEditor';
import type { HubForm, HubPanel } from '../../../src/modals/hub/HubHost';
import type { FormIssue } from '../../../src/modals/form/FormIssue';

/**
 * The source mode while the hub moves a row (`MoveSource`, the move's seat):
 * the real host, move, draft and send over a vault, the real switch
 * (`TaskHubSource`) on an editor the test types in, and a form that records
 * what it was told. The text is the move's draft: it opens on it, goes back
 * into it, and is written with the move, never by itself.
 */

const FILE = 'note.md';
const NOTE = ['# Tasks', '- [ ] Row @2026-11-26', '    - [ ] a', '    - [ ] b', '# Done', '- [ ] Other', ''];

let live: VaultSession | undefined;
afterEach(() => { live?.dispose(); live = undefined; vi.restoreAllMocks(); });

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

/** An editor the test types in: each line says the line it was opened as, until the test says otherwise. */
class FakeEditor implements DraftEditor {
    parent: string;
    children: SourceDraft['children'];
    completing = false;
    focused = 0;
    destroyed = false;
    constructor(readonly frame: SubtreeFrame, readonly hooks: { submit(): void; edited(): void; linkSource(): string }) {
        this.parent = frame.parent;
        this.children = frame.children.map((text, i) => ({ text, was: i + 1 }));
    }
    draft(): SourceDraft { return { parent: this.parent, children: this.children.map(line => ({ ...line })) }; }
    isCompleting(): boolean { return this.completing; }
    closeCompletion(): boolean { const was = this.completing; this.completing = false; return was; }
    focus(): void { this.focused++; }
    destroy(): void { this.destroyed = true; }
    /** Type: the text as given, and the editor tells of it. */
    type(change: { parent?: string; children?: SourceDraft['children'] }): void {
        if (change.parent !== undefined) this.parent = change.parent;
        if (change.children !== undefined) this.children = change.children;
        this.hooks.edited();
    }
}

async function open(lines: string[] = NOTE, opts: { opening?: boolean } = {}) {
    const { contents, session } = await openLiveVault({ [FILE]: lines }, s => { live = s; });
    const writeOutside = async (next: string[]) => {
        contents.set(FILE, next.join('\n'));
        await session.fireVault('modify', session.app.vault.getAbstractFileByPath(FILE));
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
    if (opts.opening) opening = { preview: (await noteOps.previewSend([row.id]))!, start: 'here' };

    let source: TaskHubSource | null = null;
    const link = { redraw: vi.fn(() => source?.redraw()), hold: vi.fn((held: boolean) => source?.hold(held)) };
    const host = new RowHost(row, {
        app: app as never,
        plugin: { settings: DEFAULT_SETTINGS } as never,
        index: session.index,
        operations: session.ops,
        noteOps,
        indentUnit: () => '    ',
    }, link, opening);
    const states: SourceViewState[] = [];
    const editors: FakeEditor[] = [];
    source = new TaskHubSource({ seat: () => host.seat(), indentUnit: () => '    ' }, {
        openEditor: (frame, hooks) => { const editor = new FakeEditor(frame, hooks); editors.push(editor); return editor; },
        render: (state) => { states.push(state); },
        asked: vi.fn(),
    });
    let typed = true;
    const put: (string | null)[] = [];
    const place: (readonly FormIssue<never>[])[] = [];
    const told: string[] = [];
    const form: HubForm = {
        refresh: vi.fn(() => { told.push('refresh'); }),
        showShut: vi.fn(() => { told.push('shut'); }),
        sayPut: (why) => { put.push(why); },
        sayWrite: vi.fn(),
        sayPlace: (issues) => { place.push(issues); },
        showDraft: vi.fn(),
        write: vi.fn(() => { if (host.draft()?.canWrite()) host.draft()!.write(); }),
        putTyped: vi.fn(() => typed),
        notWritten: vi.fn(),
        edited: vi.fn(),
    };
    host.bind(form);
    const panel: HubPanel = { redrawPreview: vi.fn(() => { told.push('card'); }), close: vi.fn() };
    host.attach(panel);
    await settle();
    const move = () => host.moving()!;
    return {
        session, noteOps, host, form, panel, link, source: source!, row, put, place, told, writeOutside,
        lines: () => contents.get(FILE)!.split('\n'),
        state: () => states[states.length - 1],
        editor: () => editors[editors.length - 1],
        editors,
        typedFails: () => { typed = false; },
        move,
        begin: async () => { await host.beginMove('here'); await settle(); },
        /** Where the row goes: the note's other heading, a move that can be asked. */
        toDone: async () => { move().fieldsChanged({ ...move().initial, heading: 'Done' }); await settle(); },
        lastSaid: () => {
            const said = states[states.length - 1].issues;
            return said.length === 0 ? null : said[0].text;
        },
    };
}

describe('opening the source in a move', () => {
    it('opens on the draft as the fields left it, once what is typed is put in, the fields of the row\'s values shut', async () => {
        const h = await open();
        await h.begin();
        await h.host.put({ content: 'Renamed' });
        await h.source.enter();
        expect(h.form.putTyped).toHaveBeenCalled();
        expect(h.state().phase).toBe('source');
        expect(h.editor().frame.base).toEqual(['- [ ] Renamed @2026-11-26', '    - [ ] a', '    - [ ] b']);
        expect(h.host.shut()).toEqual({ reach: 'values', why: t('modal.hub.move.sourceShut') });
        expect(h.told.at(-1)).toBe('shut');
    });

    it('does not open while a value typed cannot be put in', async () => {
        const h = await open();
        await h.begin();
        h.typedFails();
        await h.source.enter();
        expect(h.state().phase).toBe('view');
        expect(h.editors).toHaveLength(0);
    });

    it('does not open while the move is begun, nor while it is under way', async () => {
        const h = await open();
        let release!: () => void;
        const read = h.noteOps.previewSend.bind(h.noteOps);
        vi.spyOn(h.noteOps, 'previewSend').mockImplementationOnce(async (ids) => {
            const preview = await read(ids);
            await new Promise<void>(resolve => { release = resolve; });
            return preview;
        });
        const begun = h.host.beginMove('here');
        await settle();
        expect(h.state().held).toBe(true);
        await h.source.enter();
        expect(h.editors).toHaveLength(0);
        release();
        await begun;
        await settle();
        expect(h.state().held).toBe(false);

        await h.toDone();
        const send = h.noteOps.send.bind(h.noteOps);
        let sent!: () => void;
        vi.spyOn(h.noteOps, 'send').mockImplementationOnce(async (...args) => {
            await new Promise<void>(resolve => { sent = resolve; });
            return send(...args);
        });
        h.form.write();
        expect(h.state().held).toBe(true);
        await h.source.enter();
        expect(h.editors).toHaveLength(0);
        sent();
        await vi.waitFor(() => expect(h.panel.close).toHaveBeenCalled());
    });

    it('on a row whose subtree it cannot open, says why as out of a move; the fields and the move are offered', async () => {
        const h = await open(['# Tasks', '- [ ] Row', '  going on', '    - [ ] child', '# Done', '']);
        await h.begin();
        expect(h.state().shut).toBe(t('modal.hub.source.shallow', { line: '1' }));
        expect(h.host.shut()).toBeNull();
        await h.toDone();
        expect(h.host.draft()!.canWrite()).toBe(true);
    });

    it('in a hub opened in a move, on the move\'s seat from the start', async () => {
        const h = await open(NOTE, { opening: true });
        expect(h.host.seat()).toBe(h.move().seat);
        expect(h.link.hold).not.toHaveBeenCalled();
        await h.source.enter();
        expect(h.state().phase).toBe('source');
    });

    it('has no row of buttons of its own: the form holds cancel and [Move]', async () => {
        const h = await open();
        await h.begin();
        await h.source.enter();
        expect(h.state().seat).toEqual({ foot: null, busy: false, asking: false, lost: null });
    });

    it('takes no change of the fields while it is open', async () => {
        const h = await open();
        await h.begin();
        await h.source.enter();
        expect(await h.host.put({ content: 'Field' })).toBe(false);
        expect(h.host.task().content).toBe('Row');
    });
});

describe('back to the card', () => {
    it('takes the text into the draft, asking nothing: the card, the fields and the move read it, and the fields open again', async () => {
        const h = await open();
        await h.begin();
        await h.source.enter();
        h.editor().type({ children: [{ text: '- [ ] a', was: 1 }, { text: '- [x] b', was: 2 }, { text: '- [ ] c', was: null }] });
        h.told.length = 0;
        h.source.back();
        expect(h.state().phase).toBe('view');
        expect(h.host.shut()).toBeNull();
        expect(h.told).toEqual(expect.arrayContaining(['refresh', 'card', 'shut']));
        const rows = h.host.cardRows()!;
        const children = h.host.task().childIds.map(id => rows(id)!);
        expect(children.map(child => [child.content, child.statusChar])).toEqual([['a', ' '], ['b', 'x'], ['c', ' ']]);
        expect(h.lines()).toEqual(NOTE);
    });

    it('stays on a text that does not take, why said under the editor, the focus in it, and the draft as it was', async () => {
        // A paragraph right under the subtree: a child line that is no item takes it in.
        const FENCED = ['# Tasks', '- [ ] Row', '\t```', '\tcode', '\t```', 'para', ''];
        const cases: [string[], Partial<{ parent: string; children: SourceDraft['children'] }>, string][] = [
            [NOTE, { parent: 'just a line' }, t('modal.hub.source.notTask')],
            [NOTE, { parent: '- [ ] Row\nmore' }, t('modal.hub.source.parentBreak')],
            [FENCED, { children: [{ text: 'text', was: null }] }, t('notice.refusedDisturbs')],
        ];
        for (const [note, change, why] of cases) {
            const h = await open(note);
            const before = h.host.task().subtreeLines;
            await h.begin();
            await h.source.enter();
            const focused = h.editor().focused;
            h.editor().type(change);
            h.source.back();
            expect(h.state().phase).toBe('source');
            expect(h.lastSaid()).toContain(why);
            expect(h.editor().focused).toBeGreaterThan(focused);
            expect(h.host.task().subtreeLines).toEqual(before);
            live?.dispose();
            live = undefined;
        }
    });

    it('a text typed back to the lines it opened on takes those lines again', async () => {
        const h = await open();
        await h.begin();
        await h.source.enter();
        const opened = h.editor().draft();
        h.editor().type({ children: [{ text: '- [ ] b', was: 2 }] });
        // Taken in, as [Move] does before a move not made.
        expect(h.move().seat.take()).toBe(true);
        expect(h.host.task().subtreeLines).toEqual(['- [ ] Row @2026-11-26', '    - [ ] b']);
        h.editor().type({ children: opened.children });
        expect(h.move().changed()).toBe(true);
        h.source.back();
        expect(h.host.task().subtreeLines).toEqual(NOTE.slice(1, 4));
        expect(h.move().changed()).toBe(false);
    });
});

describe('[Move] with the source open', () => {
    it('takes the text in first and writes it with the row where it goes; the source stays until the hub closes', async () => {
        const h = await open();
        await h.begin();
        await h.toDone();
        await h.source.enter();
        h.editor().type({ children: [{ text: '- [ ] a changed', was: 1 }] });
        const send = vi.spyOn(h.noteOps, 'send');
        h.form.write();
        expect(send).toHaveBeenCalled();
        expect(send.mock.calls[0][0].rows[0].draft).toEqual({
            text: '- [ ] Row @2026-11-26',
            children: [{ text: '    - [ ] a changed', was: 1 }],
        });
        await vi.waitFor(() => expect(h.panel.close).toHaveBeenCalled());
        expect(h.lines()).toEqual(['# Tasks', '# Done', '- [ ] Row @2026-11-26', '    - [ ] a changed', '- [ ] Other', '']);
    });

    it('is not asked on a text that does not take: why said under the editor, the focus in it, nothing sent', async () => {
        const h = await open();
        await h.begin();
        await h.toDone();
        await h.source.enter();
        h.editor().type({ parent: 'just a line' });
        const send = vi.spyOn(h.noteOps, 'send');
        const focused = h.editor().focused;
        h.form.write();
        expect(send).not.toHaveBeenCalled();
        expect(h.lastSaid()).toBe(t('modal.hub.source.notTask'));
        expect(h.editor().focused).toBeGreaterThan(focused);
        expect(h.host.draft()!.writing()).toBe(false);
    });

    it('Mod+Enter in the editor is the form\'s write', async () => {
        const h = await open();
        await h.begin();
        await h.source.enter();
        h.editor().hooks.submit();
        expect(h.form.write).toHaveBeenCalled();
    });

    it('not made: the source stays open, and the text mended after is taken in again on the mark it opened on', async () => {
        const h = await open();
        await h.begin();
        await h.toDone();
        await h.source.enter();
        h.editor().type({ children: [{ text: '- [ ] b', was: 2 }] });
        vi.spyOn(h.noteOps, 'send').mockResolvedValueOnce({ kind: 'not-done', why: 'refused here' });
        h.form.write();
        await vi.waitFor(() => expect(h.place.at(-1)!.map(issue => issue.text)).toContain('refused here'));
        expect(h.state().phase).toBe('source');
        h.editor().type({ children: [{ text: '- [ ] b mended', was: 2 }, { text: '- [ ] a', was: 1 }] });
        const send = vi.spyOn(h.noteOps, 'send');
        h.form.write();
        expect(send.mock.calls.at(-1)![0].rows[0].draft!.children).toEqual([
            { text: '    - [ ] b mended', was: 2 },
            { text: '    - [ ] a', was: 1 },
        ]);
        await vi.waitFor(() => expect(h.panel.close).toHaveBeenCalled());
    });
});

describe('throwing the move away with the source open', () => {
    it('counts the text not taken in as a change, and nothing once it is the draft\'s', async () => {
        const h = await open();
        await h.begin();
        await h.source.enter();
        expect(h.move().changed()).toBe(false);
        h.editor().type({ children: [{ text: '- [ ] a', was: 1 }] });
        expect(h.move().changed()).toBe(true);
        h.editor().type({ children: [{ text: '- [ ] a', was: 1 }, { text: '- [ ] b', was: 2 }] });
        expect(h.move().changed()).toBe(false);
        h.editor().type({ parent: 'just a line' });
        expect(h.move().changed()).toBe(true);
    });

    it('thrown away closes the source, and the hub writes each change as it comes again, the seat the row\'s', async () => {
        const h = await open();
        await h.begin();
        await h.source.enter();
        h.editor().type({ children: [] });
        h.host.draft()!.discard!();
        expect(h.state().phase).toBe('view');
        expect(h.editor().destroyed).toBe(true);
        expect(h.host.draft()).toBeNull();
        expect(h.host.seat()).toBe(h.host.sourceApply);
        expect(h.host.shut()).toBeNull();
        expect(h.lines()).toEqual(NOTE);
    });

    it('kept, as asked: the editor takes the focus; an edit of the text is told to the form', async () => {
        const h = await open();
        await h.begin();
        expect(h.host.draft()!.keep!()).toBe(false);
        await h.source.enter();
        const focused = h.editor().focused;
        expect(h.host.draft()!.keep!()).toBe(true);
        expect(h.editor().focused).toBe(focused + 1);
        h.editor().type({ children: [] });
        expect(h.form.edited).toHaveBeenCalled();
    });

    it('a close asks nothing of the source: the form asks', async () => {
        const h = await open();
        await h.begin();
        await h.source.enter();
        h.editor().type({ children: [] });
        expect(h.source.beforeClose()).toBe(true);
        expect(h.state().phase).toBe('source');
    });
});

describe('the row changed outside while the source is open', () => {
    it('keeps the text, offers no move, says it with a button to copy and none to throw away, and goes back to the card', async () => {
        const h = await open();
        await h.begin();
        await h.toDone();
        await h.source.enter();
        h.editor().type({ children: [{ text: '- [ ] a', was: 1 }] });
        await h.session.ops.updateTask(h.row.id, { startDate: '2026-11-27' });
        await new Promise(resolve => setTimeout(resolve, 40));
        expect(h.host.draft()!.canWrite()).toBe(false);
        expect(h.state().seat!.lost).toEqual({ why: t('modal.hub.move.sourceLost'), discard: false });
        expect(h.source.draftText()).toBe(['- [ ] Row @2026-11-26', '    - [ ] a'].join('\n'));
        h.source.back();
        expect(h.state().phase).toBe('view');
        expect(h.host.task().subtreeLines).toEqual(['- [ ] Row @2026-11-26', '    - [ ] a']);
    });
});

describe('a link typed in the source', () => {
    it('is spelt from the note the move goes to while the fields name one, else from the row\'s', async () => {
        const h = await open(NOTE);
        await h.begin();
        await h.source.enter();
        const linkSource = () => h.editor().hooks.linkSource();
        expect(linkSource()).toBe(FILE);
        h.move().fieldsChanged({ note: { text: 'Elsewhere', picked: null }, heading: '' });
        // Being read: the row's note.
        expect(linkSource()).toBe(FILE);
        await settle();
        expect(linkSource()).toBe('Elsewhere.md');
        h.move().fieldsChanged({ note: { text: '', picked: null }, heading: '' });
        await settle();
        expect(linkSource()).toBe(FILE);
    });
});

describe('a field\'s change refused over a property in a move', () => {
    it('tells the property\'s line by where it stands under the row, to mend in the source, or, where it does not open, in the editor once cancelled', async () => {
        const h = await open(['# Tasks', '- [ ] Row', '\t- tv-color:: red', '\t- tv-color:: green', '# Done', '']);
        await h.begin();
        expect(await h.host.put({ color: 'blue' })).toBe(false);
        expect(h.put.at(-1)).toBe(t('modal.hub.move.refusedProperty', { key: 'tv-color', line: '1' }));

        const g = await open(['# Tasks', '- [ ] Row', '  going on', '\t- tv-color:: red', '\t- tv-color:: green', '# Done', '']);
        await g.begin();
        expect(await g.host.put({ color: 'blue' })).toBe(false);
        expect(g.put.at(-1)).toBe(t('modal.hub.move.refusedPropertyShut', { key: 'tv-color', line: '2' }));
    });
});
