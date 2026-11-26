import { vi } from 'vitest';
import { TFile } from 'obsidian';
import { openLiveVault, type VaultSession } from './vaultSession';
import { DEFAULT_SETTINGS } from '../../../src/types';
import { NoteOps, type SendingLines } from '../../../src/services/data/NoteOps';
import { NotePlaces } from '../../../src/services/data/NotePlaces';
import { RowHost } from '../../../src/modals/hub/RowHost';
import { TaskHubForm } from '../../../src/modals/hub/TaskHubForm';
import { TaskHubSource, type SourceViewState } from '../../../src/modals/hub/TaskHubSource';
import type { SubtreeFrame } from '../../../src/services/persistence/utils/SubtreeFrame';
import type { DraftEditor, SourceDraft } from '../../../src/modals/form/source/SourceEditor';
import { FocusDoc, FocusEl, asEl } from './focusDom';

/**
 * A hub on a row of a live vault, whole but for its DOM and its editor: the
 * real host (`RowHost`), its move (`RowMove`, `MoveSource`), the source mode
 * (`TaskHubSource`) and the form (`TaskHubForm`) on a document that follows
 * the focus (`FocusDoc`), the index, the operations and the send real. The
 * source's editor is a stand-in typed into by the test (`MoveHubEditor`),
 * and the panel records whether the hub closed.
 */

export const MOVE_HUB_FILE = 'note.md';
export const MOVE_HUB_NOTE = ['# Tasks', '- [ ] Row @2026-11-26', '    - [ ] a', '    - [ ] b', '# Done', '- [ ] Other', ''];

/** Let the asks of where the fields name, and the scans, answer. */
export const settle = () => new Promise(resolve => setTimeout(resolve, 0));
/** Wait out the index's gathering of the changes of a moment (`NotifyCoalescer`). */
export const tick = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));

/** The source's editor: the text it holds is what the test types, each change told as the editor tells it. */
export class MoveHubEditor implements DraftEditor {
    parent: string;
    children: SourceDraft['children'];
    focused = 0;
    constructor(readonly frame: SubtreeFrame, private readonly hooks: { submit(): void; edited(): void; linkSource(): string }) {
        this.parent = frame.parent;
        this.children = frame.children.map((text, i) => ({ text, was: i + 1 }));
    }
    draft(): SourceDraft { return { parent: this.parent, children: this.children.map(line => ({ ...line })) }; }
    isCompleting(): boolean { return false; }
    closeCompletion(): boolean { return false; }
    focus(): void { this.focused++; }
    destroy(): void { }
    type(change: { parent?: string; children?: SourceDraft['children'] }): void {
        if (change.parent !== undefined) this.parent = change.parent;
        if (change.children !== undefined) this.children = change.children;
        this.hooks.edited();
    }
}

/** The globals the form's fields reach for: `Element`, and the document a canvas is asked of. */
export function stubMoveHubGlobals(): void {
    vi.stubGlobal('Element', FocusEl);
    vi.stubGlobal('document', {
        createDocumentFragment: () => ({ appendChild: () => { } }),
        createElement: () => ({ style: {}, classList: { add: () => { } }, setAttribute: () => { }, appendChild: () => { }, getContext: () => null }),
    });
}

/**
 * A hub on the row of `lines` whose text starts with `rowName` (`Row`), its
 * form built and the hub attached. `onSession` is given the vault, to be let
 * go after the test. The open timers keep a send from being made as the
 * test says (`setTimers`).
 */
export async function openMoveHub(onSession: (session: VaultSession) => void, lines: string[] = MOVE_HUB_NOTE, opts: { rowName?: string } = {}) {
    const { contents, session } = await openLiveVault({ [MOVE_HUB_FILE]: lines }, onSession);
    const getSettings = () => ({ ...DEFAULT_SETTINGS });
    let timers: ((sending: SendingLines) => string | null) | null = null;
    const noteOps = new NoteOps(session.app, session.ops, getSettings, {
        places: new NotePlaces(session.app, getSettings),
        getTask: (id) => session.index.getTask(id),
        timers: () => (timers === null ? null : { refuse: timers, follow: () => { } }),
    });
    const vault = session.app.vault;
    const app = {
        ...session.app,
        keymap: { pushScope: () => { }, popScope: () => { } },
        vault: Object.assign(Object.create(vault), { cachedRead: (file: TFile) => vault.read(file) }),
    };
    const row = session.index.getTasks().find(one => one.content.startsWith(opts.rowName ?? 'Row'))!;
    let source: TaskHubSource | null = null;
    const link = { redraw: () => source?.redraw(), hold: (held: boolean) => source?.hold(held) };
    const plugin = { settings: DEFAULT_SETTINGS, menuPresenter: { present: () => { } } };
    const host = new RowHost(row, {
        app: app as never, plugin: plugin as never, index: session.index, operations: session.ops, noteOps, indentUnit: () => '    ',
    }, link);
    const states: SourceViewState[] = [];
    const editors: MoveHubEditor[] = [];
    source = new TaskHubSource({ seat: () => host.seat(), indentUnit: () => '    ' }, {
        openEditor: (frame, hooks) => { const editor = new MoveHubEditor(frame, hooks); editors.push(editor); return editor; },
        render: (state) => { states.push(state); },
        asked: vi.fn(),
    });
    const doc = new FocusDoc();
    Object.assign(doc, { createElement: () => ({ getContext: () => null }) });
    const root = doc.root();
    const foot = doc.root();
    let closed = false;
    const panel = { redrawPreview: vi.fn(), close: vi.fn(() => { closed = true; }) };
    const form: TaskHubForm = new TaskHubForm(asEl(root), host, {
        app: app as never, plugin: plugin as never, index: session.index as never, foot: asEl(foot),
        // The panel's close: the source asked first, then the form.
        requestClose: () => {
            const answer = source!.beforeClose() ? form.beforeClose() : 'stay';
            void Promise.resolve(answer).then(goes => { if (goes === 'close') closed = true; });
        },
    });
    host.attach(panel);
    await settle();
    const click = (el: FocusEl | null | undefined) => {
        if (!el) throw new Error('no such button');
        el.dispatchEvent(new Event('click'));
    };
    return {
        session, contents, noteOps, host, form, source: source!, row, panel, root, foot, editors,
        lines: () => contents.get(MOVE_HUB_FILE)!.split('\n'),
        /** The source as it was last drawn. */
        state: () => states[states.length - 1],
        editor: () => editors[editors.length - 1],
        move: () => host.moving(),
        closed: () => closed,
        field: (at: Parameters<TaskHubForm['fieldElement']>[0]) => form.fieldElement(at) as unknown as FocusEl,
        /** The open timers: why they keep the send of the lines from being made, null where nothing keeps it; none open, null. */
        setTimers: (rule: ((sending: SendingLines) => string | null) | null) => { timers = rule; },
        act: () => foot.findAll('mod-cta')[0],
        cancelButton: () => foot.find('tv-form__cancel'),
        /** The question the row of buttons puts; null while none is. */
        ask: () => {
            const el = foot.find('tv-form__ask');
            return el && el.style.display !== 'none' && el.text ? el.text : null;
        },
        /** What is said above the form's tabs. */
        formSays: () => root.find('tv-form__says--form')?.children.map(child => child.text) ?? [],
        click,
        /** Begin a move from where the row stands, and let where its fields name answer. */
        begin: async () => { await host.beginMove('here'); await settle(); },
        /** Send the row under Done. */
        toDone: async () => { host.moving()!.fieldsChanged({ ...host.moving()!.initial, heading: 'Done' }); await settle(); await settle(); },
        /** What is said under the editor; null while nothing is. */
        sourceSays: () => {
            const issues = states[states.length - 1].issues;
            return issues.length === 0 ? null : issues[0].text;
        },
        /** The note written from outside, and the index told. */
        writeOutside: async (next: string[]) => {
            contents.set(MOVE_HUB_FILE, next.join('\n'));
            await session.fireVault('modify', session.app.vault.getAbstractFileByPath(MOVE_HUB_FILE));
            await tick(50);
        },
    };
}

export type MoveHub = Awaited<ReturnType<typeof openMoveHub>>;
