import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { t } from '../../../src/i18n';
import { SendDialog, initialAsk, yamlValue, type SendHost, type SendViewState } from '../../../src/modals/noteops/SendDialog';
import type { DraftEditor, SourceDraft } from '../../../src/modals/form/source/SourceEditor';
import type { SubtreeFrame } from '../../../src/services/persistence/utils/SubtreeFrame';
import type { InheritedValue } from '../../../src/services/data/InheritedValues';
import type {
    DestinationAsk, DestinationFacts, NoteFacts, SendingLines, SendPreview, SendRequest, SendResult,
} from '../../../src/services/data/NoteOps';
import { makeTask } from '../helpers/makeTask';

/**
 * The send dialog as logic (`SendDialog`), apart from the DOM: the editor
 * is a stand-in holding a draft, the host answers the destination and the
 * send as told, and the surface records what it was told to show.
 * `SubtreeFrame` is the real one, so a draft comes to what the send would
 * be handed.
 */

const SUBTREE = ['- [ ] A', '    - [ ] a'];
const SECTION = { heading: 'Tasks', level: 2, side: 'head' as const };

class FakeEditor implements DraftEditor {
    parent: string;
    children: SourceDraft['children'];
    completing = false;
    focused = 0;
    destroyed = false;
    constructor(private readonly frame: SubtreeFrame, readonly hooks: { submit(): void; edited(): void }) {
        this.parent = frame.parent;
        this.children = frame.children.map((text, i) => ({ text, was: i + 1 }));
    }
    draft(): SourceDraft { return { parent: this.parent, children: this.children.map(line => ({ ...line })) }; }
    isCompleting(): boolean { return this.completing; }
    closeCompletion(): boolean {
        const was = this.completing;
        this.completing = false;
        return was;
    }
    focus(): void { this.focused++; }
    destroy(): void { this.destroyed = true; }
    /** Change the parent's text as the user would, the editor telling of it. */
    type(parent: string): void { this.parent = parent; this.hooks.edited(); }
}

function value(key: string, opts: Partial<InheritedValue> = {}): InheritedValue {
    return { key, yaml: [`${key}: v`], from: [{ kind: 'frontmatter' }], obsidian: false, ...opts };
}

function previewOf(opts: { subtree?: string[]; candidates?: InheritedValue[]; links?: SendPreview['links']; defaults?: SendPreview['defaults'] } = {}): SendPreview {
    const subtree = opts.subtree ?? SUBTREE;
    const task = makeTask({ id: 'row-1', file: 'note.md', line: 0, content: 'A', subtreeLines: subtree });
    return {
        rows: [{ task, lines: [...subtree, ''] }],
        defaults: opts.defaults ?? { note: { text: 'A', picked: null }, section: SECTION },
        candidates: opts.candidates ?? [],
        links: opts.links ?? [],
    };
}

/** What every note's facts hold, beside its kind's. */
type CommonFacts = Omit<Extract<NoteFacts, { kind: 'existing' }>, 'kind'>;

/** The facts of a note: a new one by a name in `Inbox` unless `overrides` say otherwise. */
function facts(overrides: Partial<CommonFacts> & (
    | { kind?: 'new'; by?: 'name' | 'path'; folderMade?: string | null; namesakes?: TFile[] }
    | { kind: 'existing' | 'same' }
) = {}): NoteFacts {
    const kind = overrides.kind ?? 'new';
    const path = overrides.path ?? 'Inbox/A.md';
    const common: CommonFacts = {
        path,
        to: { note: { kind: kind === 'new' ? 'new' : 'existing', path }, section: SECTION },
        heading: kind === 'new' ? { kind: 'none' } : { kind: 'one', heading: { level: 2, text: 'Tasks', line: 0 } as never },
        headings: [],
        present: [],
        ignored: false,
        shared: [],
        unresolved: [],
        anchors: new Map(),
    };
    if (overrides.kind === undefined || overrides.kind === 'new') {
        return { by: 'name', folderMade: null, namesakes: [], ...common, ...overrides, kind: 'new' };
    }
    return { ...common, ...overrides, kind: overrides.kind };
}

/** A note field holding `text`, nothing picked. */
function typed(text: string) {
    return { text, picked: null };
}

function setUp(opts: { preview?: SendPreview; results?: SendResult[]; timers?: (sending: SendingLines) => string | null } = {}) {
    const preview = opts.preview ?? previewOf();
    const states: SendViewState[] = [];
    const editors: FakeEditor[] = [];
    const fixed: { lines: readonly string[]; why: string }[] = [];
    const asks: { ask: DestinationAsk; answer(f: DestinationFacts): Promise<void> }[] = [];
    let asked = 0;
    const results = [...(opts.results ?? [])];
    const send = vi.fn(async (_req: SendRequest): Promise<SendResult> => results.shift() ?? { kind: 'done', note: new TFile() });
    const sent = vi.fn();
    const close = vi.fn();
    const host: SendHost = {
        facts: (ask) => new Promise<DestinationFacts>((resolve) => {
            asks.push({
                ask,
                answer: async (f) => { resolve(f); await Promise.resolve(); await Promise.resolve(); },
            });
        }),
        timers: opts.timers ?? (() => null),
        send,
        indentUnit: () => '    ',
        sent,
        close,
    };
    const dialog = new SendDialog(preview, host, {
        openEditor: (frame, hooks) => { const editor = new FakeEditor(frame, hooks); editors.push(editor); return editor; },
        showFixed: (lines, why) => { fixed.push({ lines, why }); },
        render: (state) => { states.push(state); },
        asked: () => { asked++; },
    });
    return {
        dialog, send, sent, close, editors, fixed, asks,
        editor: () => editors[0],
        state: () => states[states.length - 1],
        asked: () => asked,
        /** Answer the last asking of the destination. */
        answer: (f: DestinationFacts) => asks[asks.length - 1].answer(f),
    };
}

/** A dialog whose destination is answered: `f`, or a new note. */
async function answered(f: DestinationFacts = facts(), opts: Parameters<typeof setUp>[0] = {}) {
    const h = setUp(opts);
    await h.answer(f);
    return h;
}

/** The texts the dialog says of `at` (any place when none is named), of `tone` (any when none is named). */
function said(state: SendViewState, opts: { at?: string; tone?: 'error' | 'warning' | 'info' } = {}): string[] {
    return state.issues.filter(one => (opts.at === undefined || one.at === opts.at) && (opts.tone === undefined || one.tone === opts.tone)).map(one => one.text);
}
const errors = (state: SendViewState) => said(state, { tone: 'error' });
const warnings = (state: SendViewState) => said(state, { tone: 'warning', at: 'form' });
/** Where in the note the send puts the rows: what is said under the heading that is no error. */
function destination(state: SendViewState): { text: string; tone: string } | null {
    const one = state.issues.find(issue => issue.at === 'heading' && issue.tone !== 'error');
    return one ? { text: one.text, tone: one.tone } : null;
}

/** Which note the send goes to: what is said under the note field. */
function noteSays(state: SendViewState): { text: string; tone: string }[] {
    return state.issues.filter(issue => issue.at === 'note').map(issue => ({ text: issue.text, tone: issue.tone }));
}

describe('opening', () => {
    it('opens the row in the editor, asks the default note with the heading field empty, and offers no send until answered', async () => {
        const h = setUp();

        expect(h.editor().draft()).toEqual({ parent: '- [ ] A', children: [{ text: '- [ ] a', was: 1 }] });
        expect(h.asks.map(one => one.ask)).toEqual([{ note: typed('A'), heading: '' }]);
        expect(h.state().canSend).toBe(false);
        expect(destination(h.state())).toBeNull();

        await h.answer(facts());
        expect(h.state().canSend).toBe(true);
    });

    it('opens the note field as the preview says, a note picked kept picked', () => {
        const preview = previewOf({ defaults: { note: { text: 'Plan', picked: 'Projects/Plan.md' }, section: SECTION } });
        expect(initialAsk(preview)).toEqual({ note: { text: 'Plan', picked: 'Projects/Plan.md' }, heading: '' });
    });

    it('shows a subtree it cannot open as it stands, from the first column, and sends it so', async () => {
        const subtree = ['    - [ ] A', '      going on', '        - [ ] a'];
        const h = await answered(facts(), { preview: previewOf({ subtree }) });

        expect(h.editors).toEqual([]);
        expect(h.fixed).toEqual([{ lines: ['- [ ] A', '  going on', '    - [ ] a'], why: t('modal.send.shallow', { line: '1' }) }]);
        expect(h.state()).toMatchObject({ canSend: true });
        expect(h.dialog.request()?.rows).toEqual([{ taskId: 'row-1', base: subtree }]);
        expect(h.dialog.beforeClose()).toBe(true);
    });
});

describe('which note the send goes to, said under the note field', () => {
    const says = async (f: NoteFacts) => noteSays((await answered(f)).state());
    const note = (path: string) => ({ note: path });

    it('a note there is: a warning, as the send writes into another note', async () => {
        expect(await says(facts({ kind: 'existing', path: 'Plan.md' }))).toEqual([{ text: t('modal.send.noteExisting', note('Plan.md')), tone: 'warning' }]);
    });

    it('the rows\' own note', async () => {
        expect(await says(facts({ kind: 'same', path: 'note.md' }))).toEqual([{ text: t('modal.send.noteSame', note('note.md')), tone: 'info' }]);
    });

    it('a new note: a warning, by a name that no note has, or by a path', async () => {
        expect(await says(facts())).toEqual([{ text: t('modal.send.noteNewByName', note('Inbox/A.md')), tone: 'warning' }]);
        expect(await says(facts({ by: 'path', path: 'P/A.md' }))).toEqual([{ text: t('modal.send.noteNew', note('P/A.md')), tone: 'warning' }]);
    });

    it('a new note in a folder the vault does not have: the folder it makes too', async () => {
        expect(await says(facts({ by: 'path', path: 'P/Q/A.md', folderMade: 'P' }))).toEqual([
            { text: t('modal.send.noteNew', note('P/Q/A.md')), tone: 'warning' },
            { text: t('modal.send.noteFolderMade', { folder: 'P' }), tone: 'warning' },
        ]);
    });
});

describe('where in the note the send puts the rows, said under the heading', () => {
    const says = async (f: NoteFacts) => destination((await answered(f)).state());
    const vars = { heading: 'Tasks' };

    it('a new note', async () => {
        expect(await says(facts())).toEqual({ text: t('modal.send.toNew', vars), tone: 'info' });
    });

    it('a note there is: to the top or the end of its heading, or under one it makes', async () => {
        const existing = facts({ kind: 'existing', path: 'Plan.md' });
        expect(await says(existing)).toEqual({ text: t('modal.send.toHead', vars), tone: 'warning' });
        expect(await says({ ...existing, to: { ...existing.to, section: { ...SECTION, side: 'end' } } }))
            .toEqual({ text: t('modal.send.toEnd', vars), tone: 'warning' });
        expect(await says({ ...existing, heading: { kind: 'none' } })).toEqual({ text: t('modal.send.toMade', vars), tone: 'warning' });
    });

    it('the rows\' own note: moved within it', async () => {
        const same = facts({ kind: 'same', path: 'note.md' });
        expect(await says(same)).toEqual({ text: t('modal.send.withinHead', vars), tone: 'info' });
        expect(await says({ ...same, heading: { kind: 'none' } })).toEqual({ text: t('modal.send.withinMade', vars), tone: 'info' });
    });

    it('follows the fields: asked again as they change', async () => {
        const h = await answered();
        h.dialog.fieldsChanged({ note: typed('note'), heading: 'Done' });

        expect(h.asks[1].ask).toEqual({ note: typed('note'), heading: 'Done' });
        await h.answer(facts({ kind: 'same', path: 'note.md' }));
        expect(destination(h.state())?.text).toBe(t('modal.send.withinHead', vars));
        expect(noteSays(h.state())[0].text).toBe(t('modal.send.noteSame', { note: 'note.md' }));
    });
});

describe('the values offered for the frontmatter', () => {
    const candidates = [value('project'), value('aliases', { obsidian: true }), value('cssclasses', { obsidian: true })];

    it('are checked but Obsidian\'s own keys, and the checked ones sent', async () => {
        const h = await answered(facts(), { preview: previewOf({ candidates }) });

        expect(h.state().candidates?.map(one => [one.key, one.checked, one.shut])).toEqual([
            ['project', true, null], ['aliases', false, null], ['cssclasses', false, null],
        ]);
        expect(h.dialog.request()?.frontmatter.map(one => one.key)).toEqual(['project']);
    });

    it('a key the note has already: not to be chosen, saying why, and not sent', async () => {
        const h = await answered(facts({ kind: 'existing', path: 'Plan.md', present: ['project'] }), { preview: previewOf({ candidates }) });

        expect(h.state().candidates?.[0]).toMatchObject({ key: 'project', checked: false, shut: t('modal.send.present', { note: 'Plan.md' }) });
        h.dialog.check('aliases', true);
        expect(h.dialog.request()?.frontmatter.map(one => one.key)).toEqual(['aliases']);
    });

    it('none for the rows\' own note, and none sent', async () => {
        const h = await answered(facts({ kind: 'same', path: 'note.md' }), { preview: previewOf({ candidates }) });

        expect(h.state().candidates).toBeNull();
        expect(h.dialog.request()?.frontmatter).toEqual([]);
    });

    it('none when the rows inherit nothing', async () => {
        expect((await answered()).state().candidates).toBeNull();
    });

    it('keep the user\'s checks whichever note the fields name', async () => {
        const h = await answered(facts(), { preview: previewOf({ candidates }) });
        h.dialog.check('project', false);
        h.dialog.check('aliases', true);
        h.dialog.fieldsChanged({ note: typed('Plan'), heading: '' });
        await h.answer(facts({ kind: 'existing', path: 'Plan.md' }));

        expect(h.state().candidates?.map(one => [one.key, one.checked])).toEqual([['project', false], ['aliases', true], ['cssclasses', false]]);
    });

    it('show the value the frontmatter will hold, and where it came from', async () => {
        const h = await answered(facts(), {
            preview: previewOf({
                candidates: [
                    value('tv-start', { yaml: ['tv-start: "2026-09-29"'], from: [{ kind: 'section', line: 3, heading: { level: 2, text: '設計', line: 2 } }] }),
                    value('tags', { yaml: ['tags:', '  - a', '  - b'], from: [{ kind: 'frontmatter' }, { kind: 'section', line: 1, heading: null }] }),
                ],
            }),
        });

        expect(h.state().candidates?.map(one => [one.value, one.from])).toEqual([
            ['2026-09-29', t('modal.send.fromHeading', { heading: '設計' })],
            ['a, b', [t('modal.send.fromFrontmatter'), t('modal.send.fromTop')].join(t('modal.send.fromJoin'))],
        ]);
        expect(yamlValue(['"a: b": c'])).toBe('c');
    });

    it('read the lines written, however they spell the value', () => {
        expect(yamlValue(['tv-start: "2026-09-29T10:00"'])).toBe('2026-09-29T10:00');
        expect(yamlValue(['tv-start: 2026-09-29'])).toBe('2026-09-29');
        expect(yamlValue(['title: \'it\'\'s\''])).toBe("it's");
        expect(yamlValue(['done: true'])).toBe('true');
        expect(yamlValue(['n: 7'])).toBe('7');
        expect(yamlValue(['tags:', '  - "a b"', '  - c'])).toBe('a b, c');
        expect(yamlValue(['tags: [a, "b"]'])).toBe('a, b');
        expect(yamlValue(['tags: []'])).toBe('');
        expect(yamlValue(['note: |', '  line'])).toBe('line\n');
        expect(yamlValue(['empty:'])).toBe('');
    });

    it('show a mapping, or lines YAML does not read, as written after the key', () => {
        expect(yamlValue(['m:', '  a: 1'])).toBe('a: 1');
        expect(yamlValue(['bad: "open'])).toBe('"open');
    });
});

describe('what keeps a send from being asked', () => {
    it('a name no note can have: said, the note field wrong', async () => {
        const h = await answered({ kind: 'unnamed', why: { ok: false, why: 'chars', chars: '|', at: 'name' } });

        expect(h.state().canSend).toBe(false);
        expect(h.state().issues).toEqual([{ at: 'note', tone: 'error', text: t('modal.send.nameChars', { chars: '|' }) }]);
        expect(h.dialog.request()).toBeNull();
    });

    it('a folder no folder can be: said as the folder\'s', async () => {
        const chars = await answered({ kind: 'unnamed', why: { ok: false, why: 'chars', chars: ':', at: 'folder' } });
        expect(errors(chars.state())).toEqual([t('modal.send.folderChars', { chars: ':' })]);
        const dot = await answered({ kind: 'unnamed', why: { ok: false, why: 'dot', at: 'folder' } });
        expect(errors(dot.state())).toEqual([t('modal.send.folderDot')]);
    });

    it('more than one note the field points at: said with their paths, to pick one from the list, and nothing asked of the timers', async () => {
        const timers = vi.fn(() => 'kept');
        const files = ['a/本.md', 'b/本.md'].map(path => Object.assign(new TFile(), { path }));
        const h = await answered({ kind: 'ambiguous', name: '本', files }, { timers });

        expect(h.state().canSend).toBe(false);
        expect(h.state().issues).toEqual([{ at: 'note', tone: 'error', text: t('modal.send.noteAmbiguous', { name: '本', count: '2', notes: 'a/本.md, b/本.md' }) }]);
        expect(h.state().headings).toEqual([]);
        expect(h.dialog.request()).toBeNull();
        expect(timers).not.toHaveBeenCalled();
        await h.dialog.send();
        expect(h.send).not.toHaveBeenCalled();
    });

    it('two headings of the name in the note: said, the heading field wrong', async () => {
        const h = await answered(facts({ kind: 'existing', path: 'Plan.md', heading: { kind: 'many', count: 2 } }));

        expect(h.state().canSend).toBe(false);
        expect(h.state().issues.filter(one => one.tone === 'error')).toEqual([{ at: 'heading', tone: 'error', text: t('modal.send.headings', { note: 'Plan.md', heading: 'Tasks', count: '2' }) }]);
        // The note is said all the same; where in it, not.
        expect(noteSays(h.state())).toEqual([{ text: t('modal.send.noteExisting', { note: 'Plan.md' }), tone: 'warning' }]);
        expect(destination(h.state())).toBeNull();
    });

    it('a draft that cannot be written: said as it is edited', async () => {
        const h = await answered();
        h.editor().type('- [ ] A\nB');

        expect(h.state().canSend).toBe(false);
        expect(said(h.state(), { tone: 'error' })).toEqual([t('modal.send.parentBreak')]);
        expect(said(h.state(), { at: 'row:0' })).toEqual([t('modal.send.parentBreak')]);
        expect(h.dialog.request()).toBeNull();

        h.editor().type('plain');
        expect(errors(h.state())).toEqual([t('modal.send.notTask')]);
        h.editor().type('- [ ] A!');
        expect(h.state().canSend).toBe(true);
        expect(errors(h.state())).toEqual([]);
    });

    it('drafts of two rows that cannot be written for the same reason: said under each row', async () => {
        const two = previewOf();
        const second = makeTask({ id: 'row-2', file: 'note.md', line: 2, content: 'B', subtreeLines: ['- [ ] B'] });
        const preview = { ...two, rows: [...two.rows, { task: second, lines: ['- [ ] B', ''] }] };
        const h = await answered(facts(), { preview });
        h.editors[0].type('plain');
        h.editors[1].type('also plain');

        expect(h.state().issues.filter(one => one.tone === 'error')).toEqual([
            { at: 'row:0', tone: 'error', text: t('modal.send.notTask') },
            { at: 'row:1', tone: 'error', text: t('modal.send.notTask') },
        ]);
        expect(h.state().canSend).toBe(false);
    });

    it('a timer the send would leave without its lines: said, asked with the draft as it is and the note\'s ^ids', async () => {
        const asked: SendingLines[] = [];
        const h = await answered(facts({ kind: 'existing', path: 'Plan.md', anchors: new Map([['x', 1]]) }), {
            preview: previewOf({ subtree: ['- [ ] A ^t', '    - [ ] a ^r'] }),
            timers: (sending) => {
                asked.push(sending);
                return sending.from[0].sent.some(line => line.endsWith('^r')) ? null : 'lost';
            },
        });
        expect(h.state().canSend).toBe(true);
        expect(errors(h.state())).toEqual([]);
        expect(asked[asked.length - 1]).toEqual({
            to: 'Plan.md',
            inNote: new Map([['x', 1]]),
            from: [{ path: 'note.md', base: ['- [ ] A ^t', '    - [ ] a ^r'], sent: ['- [ ] A ^t', '    - [ ] a ^r'] }],
        });

        h.editor().children = [{ text: '- [ ] a', was: 1 }];
        h.editor().type('- [ ] A ^t');
        expect(h.state().canSend).toBe(false);
        expect(said(h.state(), { at: 'form', tone: 'error' })).toEqual(['lost']);
        await h.dialog.send();
        expect(h.send).not.toHaveBeenCalled();
    });

    it('not asked of the timers while the fields name no note, or a draft cannot be written', async () => {
        const timers = vi.fn(() => 'kept');
        const h = await answered({ kind: 'unnamed', why: { ok: false, why: 'empty' } }, { timers });
        expect(timers).not.toHaveBeenCalled();
        await h.dialog.fieldsChanged({ note: typed('Plan'), heading: '' });
        await h.answer(facts());
        expect(errors(h.state())).toEqual(['kept']);
        h.editor().type('plain');
        expect(errors(h.state())).toEqual([t('modal.send.notTask')]);
    });

    it('an answer for fields that changed since: not taken, and no send until the last is answered', async () => {
        const h = await answered();
        h.dialog.fieldsChanged({ note: typed('Plan'), heading: '' });
        expect(h.state().canSend).toBe(false);
        h.dialog.fieldsChanged({ note: typed('a|b'), heading: '' });

        await h.asks[2].answer({ kind: 'unnamed', why: { ok: false, why: 'chars', chars: '|', at: 'name' } });
        await h.asks[1].answer(facts({ kind: 'existing', path: 'Plan.md' }));

        expect(h.state().canSend).toBe(false);
        expect(said(h.state(), { at: 'note', tone: 'error' })).toEqual([t('modal.send.nameChars', { chars: '|' })]);
        await h.dialog.send();
        expect(h.send).not.toHaveBeenCalled();
    });
});

describe('what the send tells', () => {
    it('the links that break, not for the rows\' own note; the ^ids the note shares; a note the views skip', async () => {
        const links = [
            { anchor: 'x', from: 'a.md', line: 1 }, { anchor: 'x', from: 'a.md', line: 5 }, { anchor: 'x', from: 'b.md', line: 0 },
        ];
        const h = await answered(facts({ kind: 'existing', shared: ['y'], ignored: true }), { preview: previewOf({ links }) });

        expect(said(h.state(), { at: 'form', tone: 'warning' })).toEqual([
            t('modal.send.links', { anchor: 'x', count: '2', notes: 'a.md, b.md' }),
            t('modal.send.shared', { anchor: 'y', note: 'Inbox/A.md' }),
            t('modal.send.ignored', { note: 'Inbox/A.md' }),
        ]);
        expect(h.state().canSend).toBe(true);

        const within = await answered(facts({ kind: 'same', path: 'note.md' }), { preview: previewOf({ links }) });
        expect(warnings(within.state())).toEqual([]);
    });

    it('the notes by the name of a note made at a path typed, under the note field; none for a note made by a name alone', async () => {
        const namesakes = [Object.assign(new TFile(), { path: 'Old/A.md' })];
        const byPath = await answered(facts({ by: 'path', path: 'New/A.md', namesakes }));
        expect(said(byPath.state(), { at: 'note', tone: 'warning' })).toContain(t('modal.send.namesakes', { notes: 'Old/A.md' }));
        expect(byPath.state().canSend).toBe(true);

        const byName = await answered(facts({ by: 'name', namesakes }));
        expect(said(byName.state(), { at: 'note', tone: 'warning' })).not.toContain(t('modal.send.namesakes', { notes: 'Old/A.md' }));
    });

    it('the commands the note does not resolve', async () => {
        const task = makeTask();
        const h = await answered(facts({ unresolved: [
            { kind: 'heading', task, name: 'Done', found: 'none' },
            { kind: 'heading', task, name: 'Log', found: 'many' },
            { kind: 'block', task, name: '週報' },
        ] }));

        expect(warnings(h.state())).toEqual([
            t('modal.send.unresolvedHeading', { name: 'Done', note: 'Inbox/A.md' }),
            t('modal.send.unresolvedHeadings', { name: 'Log', note: 'Inbox/A.md' }),
            t('modal.send.unresolvedBlock', { name: '週報', note: 'Inbox/A.md' }),
        ]);
    });
});

describe('a send', () => {
    it('asks for the row as opened, its draft, where the fields name, and the values checked', async () => {
        const f = facts({ kind: 'existing', path: 'Plan.md' });
        const h = await answered(f, { preview: previewOf({ candidates: [value('project')] }) });
        h.editor().type('- [ ] A2');

        await h.dialog.send();

        expect(h.send).toHaveBeenCalledWith({
            rows: [{ taskId: 'row-1', base: SUBTREE, draft: { text: '- [ ] A2', children: [{ text: '    - [ ] a', was: 1 }] } }],
            to: f.to,
            frontmatter: [value('project')],
        });
    });

    it('with no draft, the row as opened alone', async () => {
        const h = await answered();
        await h.dialog.send();
        expect(h.send.mock.calls[0][0].rows).toEqual([{ taskId: 'row-1', base: SUBTREE }]);
    });

    it('made: told to the caller, and the dialog closes', async () => {
        const note = new TFile();
        const h = await answered(facts(), { results: [{ kind: 'done', note }] });
        h.editor().type('- [ ] A2');

        await h.dialog.send();

        expect(h.sent).toHaveBeenCalledWith({ kind: 'done', note });
        expect(h.close).toHaveBeenCalledTimes(1);
    });

    it('not made: the draft kept with why under it, the destination asked again, and sent again when asked', async () => {
        const h = await answered(facts(), { results: [{ kind: 'not-done', why: 'Not sent: changed' }] });
        h.editor().type('- [ ] A2');

        const sending = h.dialog.send();
        expect(h.state()).toMatchObject({ phase: 'sending', canSend: false });
        await sending;

        expect(h.sent).not.toHaveBeenCalled();
        expect(h.close).not.toHaveBeenCalled();
        expect(h.state()).toMatchObject({ phase: 'open', canSend: false });
        expect(said(h.state(), { at: 'form', tone: 'error' })).toEqual(['Not sent: changed']);
        expect(h.asks).toHaveLength(2);
        await h.answer(facts());
        // The last send's answer is still said, and keeps no send from being asked again.
        expect(h.state().canSend).toBe(true);
        expect(said(h.state(), { at: 'form', tone: 'error' })).toEqual(['Not sent: changed']);
        expect(h.editor().destroyed).toBe(false);

        await h.dialog.send();
        expect(h.send).toHaveBeenCalledTimes(2);
        expect(h.close).toHaveBeenCalledTimes(1);
    });

    it('made for some rows: told to the caller, why under the draft, open, and no send again', async () => {
        const h = await answered(facts(), { results: [{ kind: 'partly', note: new TFile(), refused: ['b.md'], why: 'Sent some' }] });

        await h.dialog.send();

        expect(h.sent).toHaveBeenCalledTimes(1);
        expect(h.close).not.toHaveBeenCalled();
        expect(h.state()).toMatchObject({ phase: 'spent', canSend: false });
        expect(said(h.state(), { at: 'form', tone: 'error' })).toEqual(['Sent some']);
    });

    it('Mod+Enter in the editor sends', async () => {
        const h = await answered();
        h.editor().hooks.submit();
        await Promise.resolve();
        expect(h.send).toHaveBeenCalledTimes(1);
    });
});

describe('closing', () => {
    it('closes at once with no draft', async () => {
        const h = await answered();
        expect(h.dialog.beforeClose()).toBe(true);
        expect(h.asked()).toBe(0);
    });

    it('a draft: asks, and asks again on another close; throwing it away closes', async () => {
        const h = await answered();
        h.editor().type('- [ ] A2');

        expect(h.dialog.beforeClose()).toBe(false);
        expect(h.state().asking).toBe(true);
        expect(h.dialog.beforeClose()).toBe(false);
        expect(h.asked()).toBe(2);

        h.dialog.discard();
        expect(h.close).toHaveBeenCalledTimes(1);
    });

    it('keeping the draft, or editing it, withdraws the question', async () => {
        const h = await answered();
        h.editor().type('- [ ] A2');
        h.dialog.beforeClose();

        h.dialog.keep();
        expect(h.state().asking).toBe(false);
        expect(h.editor().focused).toBe(1);

        h.dialog.beforeClose();
        h.editor().type('- [ ] A3');
        expect(h.state().asking).toBe(false);
    });

    it('a draft edited back to the lines opened is none', async () => {
        const h = await answered();
        h.editor().type('- [ ] A2');
        h.editor().type('- [ ] A');
        expect(h.dialog.beforeClose()).toBe(true);
    });

    it('a draft that cannot be written is a draft', async () => {
        const h = await answered();
        h.editor().type('plain');
        expect(h.dialog.beforeClose()).toBe(false);
    });

    it('an Escape or a back an editor\'s completion list takes', async () => {
        const h = await answered();
        expect(h.dialog.yieldsEscape()).toBe(false);
        h.editor().completing = true;
        expect(h.dialog.yieldsEscape()).toBe(true);
        expect(h.dialog.takesBack()).toBe(true);
        expect(h.dialog.takesBack()).toBe(false);
    });

    it('once closed, an answer or a result comes to nothing', async () => {
        const h = setUp();
        h.dialog.dispose();
        expect(h.editor().destroyed).toBe(true);
        const drawn = h.state();
        await h.answer(facts());
        expect(h.state()).toBe(drawn);
    });
});
