import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { t } from '../../../src/i18n';
import { SendDialog, initialAsk, lineValue, yamlValue, type SendHost, type SendOptions, type SendViewState } from '../../../src/modals/noteops/SendDialog';
import type { SubtreeReplacement } from '../../../src/services/persistence/TaskOps';
import type { InheritedValue } from '../../../src/services/data/InheritedValues';
import type {
    DestinationFacts, NoteFacts, SendingLines, SendPreview, SendRequest, SendResult,
} from '../../../src/services/data/NoteOps';
import type { DestinationAsk } from '../../../src/services/data/NotePlaces';
import { makeTask } from '../helpers/makeTask';

/**
 * The send dialog as logic (`SendDialog`), apart from the DOM: the host holds
 * the rows' drafts as the test says, answers the destination and the send as
 * told, and the surface records what it was told to show.
 */

const SUBTREE = ['- [ ] A', '    - [ ] a'];
const SECTION = { heading: 'Tasks', level: 2, side: 'head' as const };

/** A value the rows inherit: a frontmatter key by default, a line above the first heading when `to` says so. */
function value(key: string, opts: Partial<InheritedValue> = {}): InheritedValue {
    const to = opts.to ?? 'frontmatter';
    return {
        key,
        to,
        lines: to === 'frontmatter' ? [`${key}: v`] : [`- ${key}:: v`],
        from: [to === 'frontmatter' ? { kind: 'frontmatter', line: null } : { kind: 'section', line: 0, heading: null }],
        ...opts,
    };
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
type CommonFacts = Omit<Extract<NoteFacts, { kind: 'existing' | 'same' }>, 'kind'>;

/** The facts of a note: a new one by a name in `Inbox` unless `overrides` say otherwise. */
function facts(overrides: Partial<CommonFacts> & (
    | { kind?: 'new'; by?: 'name' | 'path'; folderMade?: string | null; namesakes?: TFile[] }
    | { kind: 'existing' | 'same' }
) = {}): NoteFacts {
    const kind = overrides.kind ?? 'new';
    const path = overrides.path ?? 'Inbox/A.md';
    const common: CommonFacts = {
        path,
        to: { note: { kind: kind === 'new' ? 'new' : 'existing', path }, spot: SECTION },
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

function setUp(opts: { preview?: SendPreview; results?: SendResult[]; timers?: (sending: SendingLines) => string | null; options?: SendOptions } = {}) {
    const preview = opts.preview ?? previewOf();
    const states: SendViewState[] = [];
    const asks: { ask: DestinationAsk; answer(f: DestinationFacts): Promise<void> }[] = [];
    const results = [...(opts.results ?? [])];
    const send = vi.fn(async (_req: SendRequest): Promise<SendResult> => results.shift() ?? { kind: 'done', note: new TFile() });
    const close = vi.fn();
    /** Each row's draft as the host holds it: none for any at first. */
    let drafts: (SubtreeReplacement | null)[] | null = preview.rows.map(() => null);
    const host: SendHost = {
        facts: (ask) => new Promise<DestinationFacts>((resolve) => {
            asks.push({
                ask,
                answer: async (f) => { resolve(f); await Promise.resolve(); await Promise.resolve(); },
            });
        }),
        timers: opts.timers ?? (() => null),
        send,
        drafts: () => drafts,
        draftsTaken: () => true,
        close,
    };
    const dialog = new SendDialog(preview, host, {
        render: (state) => { states.push(state); },
    }, opts.options);
    return {
        dialog, send, close, asks,
        /** Send as the send button does. */
        sendNow: () => dialog.send(),
        /** The host holds `next` now, and tells the dialog. */
        hold: (next: typeof drafts) => { drafts = next; dialog.draftsChanged(); },
        /** How many times the dialog was drawn. */
        drawn: () => states.length,
        /** What was drawn last. */
        state: () => states[states.length - 1],
        /** Answer the last asking of the destination. */
        answer: (f: DestinationFacts) => asks[asks.length - 1].answer(f),
    };
}

/** A draft of the row `- [ ] A` with its child as `child` reads. */
const draftOf = (text: string, child = '    - [ ] a'): SubtreeReplacement => ({ text, children: [{ text: child, was: 1 }] });

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
    it('asks the default note under the settings\' heading, and offers no send until answered', async () => {
        const h = setUp();

        expect(h.asks.map(one => one.ask)).toEqual([{ note: typed('A'), heading: 'Tasks' }]);
        expect(h.state().canSend).toBe(false);
        expect(destination(h.state())).toBeNull();

        await h.answer(facts());
        expect(h.state().canSend).toBe(true);
    });

    it('opens the note field as the preview says, a note picked kept picked, and the heading field on the settings\' heading', () => {
        const preview = previewOf({ defaults: { note: { text: 'Plan', picked: 'Projects/Plan.md' }, section: { ...SECTION, heading: 'Log' } } });
        expect(initialAsk(preview)).toEqual({ note: { text: 'Plan', picked: 'Projects/Plan.md' }, heading: 'Log' });
    });

    it('asks the destination with the heading field as it holds it: the settings\' heading untouched, nothing once emptied', async () => {
        const h = setUp();
        h.dialog.fieldsChanged({ note: typed('A'), heading: '' });

        expect(h.asks.map(one => one.ask.heading)).toEqual(['Tasks', '']);
    });

});

describe('which note the send goes to, said under the note field', () => {
    const says = async (f: NoteFacts) => noteSays((await answered(f)).state());
    const note = (path: string) => ({ note: path });

    it('a note there is: a warning, as the send writes into another note', async () => {
        expect(await says(facts({ kind: 'existing', path: 'Plan.md' }))).toEqual([{ text: t('modal.destination.noteExisting', note('Plan.md')), tone: 'warning' }]);
    });

    it('the rows\' own note', async () => {
        expect(await says(facts({ kind: 'same', path: 'note.md' }))).toEqual([{ text: t('modal.send.noteSame', note('note.md')), tone: 'info' }]);
    });

    it('a new note: a warning, by a name that no note has, or by a path', async () => {
        expect(await says(facts())).toEqual([{ text: t('modal.destination.noteNewByName', note('Inbox/A.md')), tone: 'warning' }]);
        expect(await says(facts({ by: 'path', path: 'P/A.md' }))).toEqual([{ text: t('modal.destination.noteNew', note('P/A.md')), tone: 'warning' }]);
    });

    it('a new note in a folder the vault does not have: the folder it makes too', async () => {
        expect(await says(facts({ by: 'path', path: 'P/Q/A.md', folderMade: 'P' }))).toEqual([
            { text: t('modal.destination.noteNew', note('P/Q/A.md')), tone: 'warning' },
            { text: t('modal.destination.noteFolderMade', { folder: 'P' }), tone: 'warning' },
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
        expect(await says({ ...existing, to: { ...existing.to, spot: { ...SECTION, side: 'end' } } }))
            .toEqual({ text: t('modal.send.toEnd', vars), tone: 'warning' });
        expect(await says({ ...existing, heading: { kind: 'none' } })).toEqual({ text: t('modal.send.toMade', vars), tone: 'warning' });
    });

    it('the rows\' own note: moved within it', async () => {
        const same = facts({ kind: 'same', path: 'note.md' });
        expect(await says(same)).toEqual({ text: t('modal.send.withinHead', vars), tone: 'info' });
        expect(await says({ ...same, heading: { kind: 'none' } })).toEqual({ text: t('modal.send.withinMade', vars), tone: 'info' });
    });

    it('the note\'s end, under no heading: in a new note, a note there is, or the rows\' own note', async () => {
        const toEnd = (f: NoteFacts): NoteFacts => ({ ...f, to: { ...f.to, spot: 'end' }, heading: null });

        expect(await says(toEnd(facts()))).toEqual({ text: t('modal.send.toNewEnd'), tone: 'info' });
        expect(await says(toEnd(facts({ kind: 'existing', path: 'Plan.md' })))).toEqual({ text: t('modal.send.toNoteEnd'), tone: 'warning' });
        expect(await says(toEnd(facts({ kind: 'same', path: 'note.md' })))).toEqual({ text: t('modal.send.withinNoteEnd'), tone: 'info' });
    });

    it('the note\'s end: a send asked there, with nothing said of a heading', async () => {
        const f: NoteFacts = { ...facts({ kind: 'existing', path: 'Plan.md' }), heading: null };
        const h = await answered({ ...f, to: { ...f.to, spot: 'end' } });

        expect(errors(h.state())).toEqual([]);
        expect(h.state().canSend).toBe(true);
        await h.sendNow();
        expect(h.send.mock.calls[0][0].to).toEqual({ note: { kind: 'existing', path: 'Plan.md' }, spot: 'end' });
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

describe('the values offered to write into the note', () => {
    const candidates = [value('tv-color'), value('aliases', { to: 'root' }), value('時給', { to: 'root' })];

    it('are checked, each saying where it is written, and the checked ones sent', async () => {
        const h = await answered(facts(), { preview: previewOf({ candidates }) });

        expect(h.state().candidates?.map(one => [one.key, one.to, one.checked, one.shut])).toEqual([
            ['tv-color', 'frontmatter', true, null], ['aliases', 'root', true, null], ['時給', 'root', true, null],
        ]);
        expect(h.dialog.request()?.values.map(one => one.key)).toEqual(['tv-color', 'aliases', '時給']);
        h.dialog.check('aliases', false);
        expect(h.dialog.request()?.values).toEqual([candidates[0], candidates[2]]);
    });

    it('a key the note has already: not to be chosen, saying why, and not sent', async () => {
        const h = await answered(facts({ kind: 'existing', path: 'Plan.md', present: ['tv-color'] }), { preview: previewOf({ candidates }) });

        expect(h.state().candidates?.[0]).toMatchObject({ key: 'tv-color', checked: false, shut: t('modal.send.present', { note: 'Plan.md' }) });
        h.dialog.check('aliases', false);
        expect(h.dialog.request()?.values.map(one => one.key)).toEqual(['時給']);
    });

    it('none for the rows\' own note, and none sent', async () => {
        const h = await answered(facts({ kind: 'same', path: 'note.md' }), { preview: previewOf({ candidates }) });

        expect(h.state().candidates).toBeNull();
        expect(h.dialog.request()?.values).toEqual([]);
    });

    it('none when the rows inherit nothing', async () => {
        expect((await answered()).state().candidates).toBeNull();
    });

    it('keep the user\'s checks whichever note the fields name', async () => {
        const h = await answered(facts(), { preview: previewOf({ candidates }) });
        h.dialog.check('tv-color', false);
        h.dialog.check('aliases', false);
        h.dialog.check('aliases', true);
        h.dialog.fieldsChanged({ note: typed('Plan'), heading: '' });
        await h.answer(facts({ kind: 'existing', path: 'Plan.md' }));

        expect(h.state().candidates?.map(one => [one.key, one.checked])).toEqual([['tv-color', false], ['aliases', true], ['時給', true]]);
    });

    it('show the value a line above the first heading will hold, read as the note reads it', async () => {
        const h = await answered(facts(), {
            preview: previewOf({
                candidates: [
                    value('id', { to: 'root', lines: ['- id:: "123"'], from: [{ kind: 'section', line: 3, heading: { level: 2, text: '設計', line: 2, end: 3 } }] }),
                    value('who', { to: 'root', lines: ['- who::', '    - a', '    - "b"'] }),
                    value('none', { to: 'root', lines: ['- none::'] }),
                ],
            }),
        });

        expect(h.state().candidates?.map(one => [one.value, one.from])).toEqual([
            ['123', t('modal.send.fromHeading', { heading: '設計' })],
            ['a, b', t('modal.send.fromTop')],
            ['', t('modal.send.fromTop')],
        ]);
        expect(lineValue(['- n:: 0x1F'])).toBe('0x1F');
    });

    it('show the value the frontmatter will hold, and where it came from', async () => {
        const h = await answered(facts(), {
            preview: previewOf({
                candidates: [
                    value('tv-start', { lines: ['tv-start: "2026-09-29"'], from: [{ kind: 'section', line: 3, heading: { level: 2, text: '設計', line: 2, end: 3 } }] }),
                    value('tags', { lines: ['tags:', '  - a', '  - b'], from: [{ kind: 'frontmatter', line: null }, { kind: 'section', line: 1, heading: null }] }),
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
        expect(h.state().issues).toEqual([{ at: 'note', tone: 'error', text: t('modal.destination.nameChars', { chars: '|' }) }]);
        expect(h.dialog.request()).toBeNull();
    });

    it('a folder no folder can be: said as the folder\'s', async () => {
        const chars = await answered({ kind: 'unnamed', why: { ok: false, why: 'chars', chars: ':', at: 'folder' } });
        expect(errors(chars.state())).toEqual([t('modal.destination.folderChars', { chars: ':' })]);
        const dot = await answered({ kind: 'unnamed', why: { ok: false, why: 'dot', at: 'folder' } });
        expect(errors(dot.state())).toEqual([t('modal.destination.folderDot')]);
    });

    it('more than one note the field points at: said with their paths, to pick one from the list, and nothing asked of the timers', async () => {
        const timers = vi.fn(() => 'kept');
        const files = ['a/本.md', 'b/本.md'].map(path => Object.assign(new TFile(), { path }));
        const h = await answered({ kind: 'ambiguous', name: '本', files }, { timers });

        expect(h.state().canSend).toBe(false);
        expect(h.state().issues).toEqual([{ at: 'note', tone: 'error', text: t('modal.noteAmbiguous', { name: '本', count: '2', notes: 'a/本.md, b/本.md' }) }]);
        expect(h.state().headings).toEqual([]);
        expect(h.dialog.request()).toBeNull();
        expect(timers).not.toHaveBeenCalled();
        await h.sendNow();
        expect(h.send).not.toHaveBeenCalled();
    });

    it('two headings of the name in the note: said, the heading field wrong', async () => {
        const h = await answered(facts({ kind: 'existing', path: 'Plan.md', heading: { kind: 'many', count: 2 } }));

        expect(h.state().canSend).toBe(false);
        expect(h.state().issues.filter(one => one.tone === 'error')).toEqual([{ at: 'heading', tone: 'error', text: t('modal.send.headings', { note: 'Plan.md', heading: 'Tasks', count: '2' }) }]);
        // The note is said all the same; where in it, not.
        expect(noteSays(h.state())).toEqual([{ text: t('modal.destination.noteExisting', { note: 'Plan.md' }), tone: 'warning' }]);
        expect(destination(h.state())).toBeNull();
    });

    it('two headings of a name not the settings\': the error names the heading the send goes to', async () => {
        const h = await answered(facts({
            kind: 'existing', path: 'Plan.md',
            to: { note: { kind: 'existing', path: 'Plan.md' }, spot: { ...SECTION, heading: 'Done' } },
            heading: { kind: 'many', count: 3 },
        }));

        expect(h.state().issues.filter(one => one.tone === 'error')).toEqual([{ at: 'heading', tone: 'error', text: t('modal.send.headings', { note: 'Plan.md', heading: 'Done', count: '3' }) }]);
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

        h.hold([draftOf('- [ ] A ^t')]);
        expect(h.state().canSend).toBe(false);
        expect(said(h.state(), { at: 'form', tone: 'error' })).toEqual(['lost']);
        await h.sendNow();
        expect(h.send).not.toHaveBeenCalled();
    });

    it('not asked of the timers while the fields name no note, or a draft cannot be written', async () => {
        const timers = vi.fn(() => 'kept');
        const h = await answered({ kind: 'unnamed', why: { ok: false, why: 'empty', at: 'name' } }, { timers });
        expect(timers).not.toHaveBeenCalled();
        await h.dialog.fieldsChanged({ note: typed('Plan'), heading: '' });
        await h.answer(facts());
        expect(errors(h.state())).toEqual(['kept']);
        h.hold(null);
        expect(errors(h.state())).toEqual([]);
    });

    it('an answer for fields that changed since: not taken, and no send until the last is answered', async () => {
        const h = await answered();
        h.dialog.fieldsChanged({ note: typed('Plan'), heading: '' });
        expect(h.state().canSend).toBe(false);
        h.dialog.fieldsChanged({ note: typed('a|b'), heading: '' });

        await h.asks[2].answer({ kind: 'unnamed', why: { ok: false, why: 'chars', chars: '|', at: 'name' } });
        await h.asks[1].answer(facts({ kind: 'existing', path: 'Plan.md' }));

        expect(h.state().canSend).toBe(false);
        expect(said(h.state(), { at: 'note', tone: 'error' })).toEqual([t('modal.destination.nameChars', { chars: '|' })]);
        await h.sendNow();
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
        expect(said(byPath.state(), { at: 'note', tone: 'warning' })).toContain(t('modal.destination.namesakes', { notes: 'Old/A.md' }));
        expect(byPath.state().canSend).toBe(true);

        const byName = await answered(facts({ by: 'name', namesakes }));
        expect(said(byName.state(), { at: 'note', tone: 'warning' })).not.toContain(t('modal.destination.namesakes', { notes: 'Old/A.md' }));
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
        h.hold([draftOf('- [ ] A2')]);

        await h.sendNow();

        expect(h.send).toHaveBeenCalledWith({
            rows: [{ taskId: 'row-1', base: SUBTREE, draft: { text: '- [ ] A2', children: [{ text: '    - [ ] a', was: 1 }] } }],
            to: f.to,
            values: [value('project')],
        });
    });

    it('with no draft, the row as opened alone', async () => {
        const h = await answered();
        await h.sendNow();
        expect(h.send.mock.calls[0][0].rows).toEqual([{ taskId: 'row-1', base: SUBTREE }]);
    });

    it('made: the dialog closes', async () => {
        const h = await answered(facts(), { results: [{ kind: 'done', note: new TFile() }] });
        h.hold([draftOf('- [ ] A2')]);

        await h.sendNow();

        expect(h.close).toHaveBeenCalledTimes(1);
    });

    it('not made: the draft kept with why under it, the destination asked again, and sent again when asked', async () => {
        const h = await answered(facts(), { results: [{ kind: 'not-done', why: 'Not sent: changed' }] });
        h.hold([draftOf('- [ ] A2')]);

        const sending = h.sendNow();
        expect(h.state()).toMatchObject({ phase: 'sending', canSend: false });
        await sending;

        expect(h.close).not.toHaveBeenCalled();
        expect(h.state()).toMatchObject({ phase: 'open', canSend: false });
        expect(said(h.state(), { at: 'form', tone: 'error' })).toEqual(['Not sent: changed']);
        expect(h.asks).toHaveLength(2);
        await h.answer(facts());
        // The last send's answer is still said, and keeps no send from being asked again.
        expect(h.state().canSend).toBe(true);
        expect(said(h.state(), { at: 'form', tone: 'error' })).toEqual(['Not sent: changed']);
        expect(h.send.mock.calls[0][0].rows[0].draft).toEqual(draftOf('- [ ] A2'));

        await h.sendNow();
        expect(h.send).toHaveBeenCalledTimes(2);
        expect(h.close).toHaveBeenCalledTimes(1);
    });

    it('made for some rows: why said, open, and no send again', async () => {
        const h = await answered(facts(), { results: [{ kind: 'partly', note: new TFile(), refused: ['b.md'], why: 'Sent some' }] });

        await h.sendNow();

        expect(h.close).not.toHaveBeenCalled();
        expect(h.state()).toMatchObject({ phase: 'spent', canSend: false });
        expect(said(h.state(), { at: 'form', tone: 'error' })).toEqual(['Sent some']);
    });

    it('that threw: as one not made, open again with why said, and sent again when asked', async () => {
        const h = await answered();
        h.hold([draftOf('- [ ] A2')]);
        h.send.mockRejectedValueOnce(new Error('the disk did not answer'));

        await h.sendNow();

        expect(h.close).not.toHaveBeenCalled();
        expect(h.state().phase).toBe('open');
        expect(said(h.state(), { at: 'form', tone: 'error' })).toEqual([t('notice.notSent')]);
        await h.answer(facts());
        expect(h.state().canSend).toBe(true);

        await h.sendNow();
        expect(h.send).toHaveBeenCalledTimes(2);
        expect(h.close).toHaveBeenCalledTimes(1);
    });

});

describe('closing', () => {
    it('once closed, an answer or a result comes to nothing', async () => {
        const h = setUp();
        h.dialog.dispose();
        const drawn = h.drawn();
        await h.answer(facts());
        expect(h.drawn()).toBe(drawn);
    });
});

describe('drafts its host holds', () => {
    /** A dialog with no editor: its host holds the drafts, as `held` says when asked. */
    async function held(initial: ReturnType<SendHost['drafts']>) {
        let drafts = initial;
        const states: SendViewState[] = [];
        const send = vi.fn(async (_req: SendRequest): Promise<SendResult> => ({ kind: 'done', note: new TFile() }));
        let answer: (f: DestinationFacts) => void = () => { };
        let taken = true;
        const timers = vi.fn((_sending: SendingLines): string | null => null);
        const dialog = new SendDialog(previewOf(), {
            facts: () => new Promise<DestinationFacts>((resolve) => { answer = resolve; }),
            timers,
            send,
            drafts: () => drafts,
            draftsTaken: () => taken,
            close: () => { },
        }, { render: (state) => { states.push(state); } });
        answer(facts());
        await Promise.resolve();
        await Promise.resolve();
        return {
            dialog, send, timers, states,
            hold: (next: typeof drafts) => { drafts = next; },
            /** Whether the host holds a text not taken into its drafts. */
            untaken: (untaken: boolean) => { taken = !untaken; },
        };
    }

    it('are asked as they are now: as a send is asked, and as the timers are', async () => {
        const h = await held([null]);
        expect(h.dialog.request()?.rows).toEqual([{ taskId: 'row-1', base: SUBTREE }]);

        const draft = { text: '- [ ] A2', children: [{ text: '    - [ ] a', was: 1 }] };
        h.hold([draft]);
        h.dialog.draftsChanged();
        expect(h.timers.mock.calls.at(-1)![0].from[0].sent).toEqual(['- [ ] A2', '    - [ ] a']);
        await h.dialog.send();
        expect(h.send.mock.calls[0][0].rows).toEqual([{ taskId: 'row-1', base: SUBTREE, draft }]);
    });

    it('none while one cannot be written: no send asked, and nothing said of it by the dialog', async () => {
        const h = await held(null);
        h.dialog.draftsChanged();
        expect(h.states.at(-1)!.canSend).toBe(false);
        expect(h.states.at(-1)!.issues.filter(one => one.tone === 'error')).toEqual([]);
        expect(h.dialog.request()).toBeNull();
        await h.dialog.send();
        expect(h.send).not.toHaveBeenCalled();
    });

    it('while the host holds a text not taken into them, a send is asked as where it goes says, the timers not asked; once taken, as the timers say', async () => {
        const h = await held([null]);
        h.timers.mockReturnValue('kept');
        h.untaken(true);
        h.timers.mockClear();
        h.dialog.draftsChanged();
        expect(h.timers).not.toHaveBeenCalled();
        expect(h.states.at(-1)!.canSend).toBe(true);
        expect(h.states.at(-1)!.issues.map(one => one.text)).not.toContain('kept');
        h.untaken(false);
        await h.dialog.send();
        expect(h.send).not.toHaveBeenCalled();
        h.dialog.draftsChanged();
        expect(h.states.at(-1)!.canSend).toBe(false);
        expect(h.states.at(-1)!.issues).toContainEqual({ at: 'form', tone: 'error', text: 'kept' });
    });

    it('a change of them drawn again as the host tells it', async () => {
        const h = await held([null]);
        const drawn = h.states.length;
        h.dialog.draftsChanged();
        expect(h.states.length).toBe(drawn + 1);
    });
});

describe('what a dialog opens with besides its rows', () => {
    it('opens its fields as it is told, and asks of them first', async () => {
        const initial = { note: { text: 'note', picked: 'note.md' }, heading: 'Done' };
        const h = setUp({ options: { initial } });
        expect(h.asks[0].ask).toEqual(initial);
    });

    it('sends no row to where it stands: its note under the heading it stands under, said under the note in place of where it goes', async () => {
        const stands = { note: 'note.md', heading: 'Tasks' };
        const h = await answered(facts({ kind: 'same', path: 'note.md' }), { options: { stands } });
        expect(h.state().canSend).toBe(false);
        expect(h.state().issues.filter(one => one.at === 'note' || one.at === 'heading')).toEqual([
            { at: 'note', tone: 'info', text: t('modal.send.samePlace') },
        ]);
    });

    it('sends it under another heading of its note, and to another note under the same heading', async () => {
        const stands = { note: 'note.md', heading: 'Tasks' };
        const other = await answered(facts({ kind: 'same', path: 'note.md', to: { note: { kind: 'existing', path: 'note.md' }, spot: { ...SECTION, heading: 'Done' } } }), { options: { stands } });
        expect(other.state().canSend).toBe(true);
        const away = await answered(facts({ kind: 'existing', path: 'Plan.md' }), { options: { stands } });
        expect(away.state().canSend).toBe(true);
    });

    it('a row in a note with no heading stands where the heading field names the note\'s end', async () => {
        const stands = { note: 'note.md', heading: null };
        const end = await answered(facts({ kind: 'same', path: 'note.md', to: { note: { kind: 'existing', path: 'note.md' }, spot: 'end' }, heading: null }), { options: { stands } });
        expect(end.state().canSend).toBe(false);
        const under = await answered(facts({ kind: 'same', path: 'note.md' }), { options: { stands } });
        expect(under.state().canSend).toBe(true);
    });

    it('a row above the first heading of a note with headings is sent to the note\'s end: the end is in the last heading\'s section', async () => {
        const stands = { note: 'note.md', heading: null };
        const end = await answered(facts({ kind: 'same', path: 'note.md', to: { note: { kind: 'existing', path: 'note.md' }, spot: 'end' }, heading: null, headings: ['Tasks'] }), { options: { stands } });
        expect(end.state().canSend).toBe(true);
        expect(end.state().issues).not.toContainEqual({ at: 'note', tone: 'info', text: t('modal.send.samePlace') });
    });
});
