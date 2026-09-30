import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { t } from '../../../src/i18n';
import { SendDialog, initialAsk, yamlValue, type SendHost, type SendViewState } from '../../../src/modals/noteops/SendDialog';
import type { DraftEditor, SourceDraft } from '../../../src/modals/form/source/SourceEditor';
import type { SubtreeFrame } from '../../../src/services/persistence/utils/SubtreeFrame';
import type { InheritedValue } from '../../../src/services/data/InheritedValues';
import type {
    DestinationAsk, DestinationFacts, NoteFacts, SendPreview, SendRequest, SendResult,
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
    isDirty(): boolean { return this.parent !== this.frame.parent; }
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
        defaults: opts.defaults ?? { note: { kind: 'new', folder: 'Inbox', name: 'A' }, section: SECTION },
        candidates: opts.candidates ?? [],
        links: opts.links ?? [],
    };
}

function facts(overrides: Partial<NoteFacts> = {}): NoteFacts {
    const kind = overrides.kind ?? 'new';
    const path = overrides.path ?? 'Inbox/A.md';
    return {
        kind,
        path,
        to: {
            note: kind === 'new' ? { kind: 'new', folder: 'Inbox', name: 'A' } : { kind: 'existing', path },
            section: SECTION,
        },
        heading: kind === 'new' ? { kind: 'none' } : { kind: 'one', heading: { level: 2, text: 'Tasks', line: 0 } as never },
        headings: [],
        present: [],
        ignored: false,
        namesakes: [],
        shared: [],
        unresolved: [],
        ...overrides,
    };
}

function setUp(opts: { preview?: SendPreview; results?: SendResult[] } = {}) {
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

describe('opening', () => {
    it('opens the row in the editor, asks the default note with the heading field empty, and offers no send until answered', async () => {
        const h = setUp();

        expect(h.editor().draft()).toEqual({ parent: '- [ ] A', children: [{ text: '- [ ] a', was: 1 }] });
        expect(h.asks.map(one => one.ask)).toEqual([{ folder: 'Inbox', name: 'A', heading: '' }]);
        expect(h.state()).toMatchObject({ canSend: false, destination: null });

        await h.answer(facts());
        expect(h.state().canSend).toBe(true);
    });

    it('names a note there is by its folder and name', () => {
        const preview = previewOf({ defaults: { note: { kind: 'existing', path: 'Projects/Plan.md' }, section: SECTION } });
        expect(initialAsk(preview)).toEqual({ folder: 'Projects', name: 'Plan', heading: '' });
        const atRoot = previewOf({ defaults: { note: { kind: 'existing', path: 'Plan.md' }, section: SECTION } });
        expect(initialAsk(atRoot)).toEqual({ folder: '', name: 'Plan', heading: '' });
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

describe('what the send does', () => {
    const says = async (f: NoteFacts) => (await answered(f)).state().destination;
    const vars = (path: string) => ({ note: path, heading: 'Tasks' });

    it('a new note', async () => {
        expect(await says(facts())).toEqual({ text: t('modal.send.toNew', vars('Inbox/A.md')), tone: 'info' });
    });

    it('a note there is: to the top or the end of its heading, or under one it makes', async () => {
        const existing = facts({ kind: 'existing', path: 'Plan.md' });
        expect(await says(existing)).toEqual({ text: t('modal.send.toHead', vars('Plan.md')), tone: 'warning' });
        expect(await says({ ...existing, to: { ...existing.to, section: { ...SECTION, side: 'end' } } }))
            .toEqual({ text: t('modal.send.toEnd', vars('Plan.md')), tone: 'warning' });
        expect(await says({ ...existing, heading: { kind: 'none' } })).toEqual({ text: t('modal.send.toMade', vars('Plan.md')), tone: 'warning' });
    });

    it('the rows\' own note: moved within it', async () => {
        const same = facts({ kind: 'same', path: 'note.md' });
        expect(await says(same)).toEqual({ text: t('modal.send.withinHead', vars('note.md')), tone: 'info' });
        expect(await says({ ...same, heading: { kind: 'none' } })).toEqual({ text: t('modal.send.withinMade', vars('note.md')), tone: 'info' });
    });

    it('follows the fields: asked again as they change', async () => {
        const h = await answered();
        h.dialog.fieldsChanged({ folder: '', name: 'note', heading: 'Done' });

        expect(h.asks[1].ask).toEqual({ folder: '', name: 'note', heading: 'Done' });
        await h.answer(facts({ kind: 'same', path: 'note.md' }));
        expect(h.state().destination?.text).toBe(t('modal.send.withinHead', vars('note.md')));
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
        h.dialog.fieldsChanged({ folder: '', name: 'Plan', heading: '' });
        await h.answer(facts({ kind: 'existing', path: 'Plan.md' }));

        expect(h.state().candidates?.map(one => [one.key, one.checked])).toEqual([['project', false], ['aliases', true], ['cssclasses', false]]);
    });

    it('show their value as the frontmatter says it, and where it came from', async () => {
        const h = await answered(facts(), {
            preview: previewOf({
                candidates: [
                    value('tv-start', { yaml: ['tv-start: "2026-09-29"'], from: [{ kind: 'section', line: 3, heading: { level: 2, text: '設計', line: 2 } }] }),
                    value('tags', { yaml: ['tags:', '  - a', '  - b'], from: [{ kind: 'frontmatter' }, { kind: 'section', line: 1, heading: null }] }),
                ],
            }),
        });

        expect(h.state().candidates?.map(one => [one.value, one.from])).toEqual([
            ['"2026-09-29"', t('modal.send.fromHeading', { heading: '設計' })],
            ['a, b', [t('modal.send.fromFrontmatter'), t('modal.send.fromTop')].join(t('modal.send.fromJoin'))],
        ]);
        expect(yamlValue(['"a: b": c'])).toBe('c');
    });
});

describe('what keeps a send from being asked', () => {
    it('a name no note can have: said, the name field wrong', async () => {
        const h = await answered({ kind: 'unnamed', why: { ok: false, why: 'chars', chars: '|' } });

        expect(h.state()).toMatchObject({
            canSend: false,
            destination: null,
            errors: [t('modal.send.nameChars', { chars: '|' })],
            invalid: { name: true, heading: false },
        });
        expect(h.dialog.request()).toBeNull();
    });

    it('two headings of the name in the note: said, the heading field wrong', async () => {
        const h = await answered(facts({ kind: 'existing', path: 'Plan.md', heading: { kind: 'many', count: 2 } }));

        expect(h.state()).toMatchObject({
            canSend: false,
            errors: [t('modal.send.headings', { note: 'Plan.md', heading: 'Tasks', count: '2' })],
            invalid: { name: false, heading: true },
        });
    });

    it('a draft that cannot be written: said as it is edited', async () => {
        const h = await answered();
        h.editor().type('- [ ] A\nB');

        expect(h.state()).toMatchObject({ canSend: false, errors: [t('modal.send.parentBreak')] });
        expect(h.dialog.request()).toBeNull();

        h.editor().type('plain');
        expect(h.state().errors).toEqual([t('modal.send.notTask')]);
        h.editor().type('- [ ] A!');
        expect(h.state()).toMatchObject({ canSend: true, errors: [] });
    });

    it('an answer for fields that changed since: not taken, and no send until the last is answered', async () => {
        const h = await answered();
        h.dialog.fieldsChanged({ folder: '', name: 'Plan', heading: '' });
        expect(h.state().canSend).toBe(false);
        h.dialog.fieldsChanged({ folder: '', name: 'a|b', heading: '' });

        await h.asks[2].answer({ kind: 'unnamed', why: { ok: false, why: 'chars', chars: '|' } });
        await h.asks[1].answer(facts({ kind: 'existing', path: 'Plan.md' }));

        expect(h.state()).toMatchObject({ canSend: false, invalid: { name: true, heading: false } });
        await h.dialog.send();
        expect(h.send).not.toHaveBeenCalled();
    });
});

describe('what the send tells', () => {
    it('the links that break, not for the rows\' own note; the ^ids the note shares; a note the views skip; namesakes', async () => {
        const links = [
            { anchor: 'x', from: 'a.md', line: 1 }, { anchor: 'x', from: 'a.md', line: 5 }, { anchor: 'x', from: 'b.md', line: 0 },
        ];
        const namesake = Object.assign(new TFile(), { path: 'Old/A.md' });
        const h = await answered(facts({ shared: ['y'], ignored: true, namesakes: [namesake] }), { preview: previewOf({ links }) });

        expect(h.state().warnings).toEqual([
            t('modal.send.links', { anchor: 'x', count: '2', notes: 'a.md, b.md' }),
            t('modal.send.shared', { anchor: 'y', note: 'Inbox/A.md' }),
            t('modal.send.ignored', { note: 'Inbox/A.md' }),
            t('modal.send.namesakes', { notes: 'Old/A.md' }),
        ]);
        expect(h.state().canSend).toBe(true);

        const within = await answered(facts({ kind: 'same', path: 'note.md' }), { preview: previewOf({ links }) });
        expect(within.state().warnings).toEqual([]);
    });

    it('the commands the note does not resolve', async () => {
        const task = makeTask();
        const h = await answered(facts({ unresolved: [
            { kind: 'heading', task, name: 'Done', found: 'none' },
            { kind: 'heading', task, name: 'Log', found: 'many' },
            { kind: 'block', task, name: '週報' },
        ] }));

        expect(h.state().warnings).toEqual([
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
        expect(h.state()).toMatchObject({ phase: 'open', message: 'Not sent: changed', canSend: false });
        expect(h.asks).toHaveLength(2);
        await h.answer(facts());
        expect(h.state().canSend).toBe(true);
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
        expect(h.state()).toMatchObject({ phase: 'spent', message: 'Sent some', canSend: false });
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
