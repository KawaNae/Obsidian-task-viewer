import { describe, it, expect, vi } from 'vitest';
import { t } from '../../../src/i18n';
import { TaskHubSource, type ReplaceAnswer, type SourceHost, type SourceViewState } from '../../../src/modals/hub/TaskHubSource';
import type { SubtreeFrame } from '../../../src/services/persistence/utils/SubtreeFrame';
import type { SubtreeReplacement } from '../../../src/services/persistence/TaskOps';
import type { DraftEditor, SourceDraft } from '../../../src/modals/form/source/SourceEditor';
import type { Task } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';

/**
 * The hub's source mode as logic (`TaskHubSource`), apart from the DOM: the
 * editor is a stand-in holding a draft, the host answers as the hub would,
 * and the surface records what it was told to show. `SubtreeFrame` is the
 * real one, so a draft comes to what the write would be handed.
 */

const SUBTREE = ['- [ ] P', '    - [ ] a', '    - [ ] b'];

class FakeEditor implements DraftEditor {
    parent: string;
    children: SourceDraft['children'];
    completing = false;
    destroyed = false;
    focused = 0;
    constructor(private readonly frame: SubtreeFrame, private readonly hooks: { edited(): void }) {
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

function rowOf(overrides: Partial<Task> = {}): Task {
    return makeTask({ id: 'row-1', content: 'P', subtreeLines: SUBTREE, ...overrides });
}

function setUp(opts: { task?: Task; answers?: ReplaceAnswer[]; confirm?: boolean; drained?: Promise<void> } = {}) {
    let row: Task | undefined = opts.task ?? rowOf();
    const answers = [...(opts.answers ?? [])];
    const states: SourceViewState[] = [];
    const editors: FakeEditor[] = [];
    let asked = 0;
    const replace = vi.fn(async (_id: string, _base: readonly string[], _r: SubtreeReplacement): Promise<ReplaceAnswer> => answers.shift() ?? { written: true });
    const confirm = vi.fn(async () => opts.confirm ?? true);
    const lockForm = vi.fn();
    const closeHub = vi.fn();
    const host: SourceHost = {
        drained: () => opts.drained ?? Promise.resolve(),
        confirm,
        reread: () => row,
        replace,
        indentUnit: () => '    ',
        lockForm,
        closeHub,
    };
    const source = new TaskHubSource(row!, host, {
        openEditor: (frame, hooks) => { const editor = new FakeEditor(frame, hooks); editors.push(editor); return editor; },
        render: (state) => { states.push(state); },
        asked: () => { asked++; },
    });
    return {
        source,
        replace,
        confirm,
        lockForm,
        closeHub,
        editor: () => editors[editors.length - 1],
        editors,
        state: () => states[states.length - 1],
        /** How many times the question was put, the focus taken to its answer. */
        asked: () => asked,
        /** The row as the index holds it now: gone when undefined. */
        setRow: (next: Task | undefined) => { row = next; },
    };
}

async function opened(opts: Parameters<typeof setUp>[0] = {}) {
    const h = setUp(opts);
    await h.source.enter();
    return h;
}

describe('entering the source', () => {
    it('opens the subtree the index holds once the form\'s writes are done, and shuts the form', async () => {
        let drain!: () => void;
        const h = setUp({ drained: new Promise<void>(resolve => { drain = resolve; }) });
        const entering = h.source.enter();
        expect(h.state().phase).toBe('entering');
        expect(h.confirm).not.toHaveBeenCalled();

        drain();
        await entering;

        expect(h.confirm).toHaveBeenCalledWith('row-1');
        expect(h.state().phase).toBe('source');
        expect(h.lockForm).toHaveBeenCalledWith(true);
        expect(h.editor().draft()).toEqual({ parent: '- [ ] P', children: [{ text: '- [ ] a', was: 1 }, { text: '- [ ] b', was: 2 }] });
        expect(h.editor().focused).toBe(1);
    });

    it('stays on the card when the index\'s copy is not the row on the disk', async () => {
        const h = await opened({ confirm: false });
        expect(h.state().phase).toBe('view');
        expect(h.editors).toEqual([]);
        expect(h.lockForm).not.toHaveBeenCalled();
    });

    it('is not offered for a read-only row, saying why', async () => {
        const h = await opened({ task: rowOf({ isReadOnly: true }) });
        expect(h.state()).toMatchObject({ phase: 'view', shut: t('modal.hub.source.readOnly') });
        expect(h.confirm).not.toHaveBeenCalled();
    });

    it('is not offered for a subtree with a line shallower than its children, saying which', async () => {
        const h = await opened({ task: rowOf({ subtreeLines: ['- [ ] P', '  going on', '    - [ ] a'] }) });
        expect(h.state()).toMatchObject({ phase: 'view', shut: t('modal.hub.source.shallow', { line: '1' }) });
        expect(h.confirm).not.toHaveBeenCalled();
    });

    it('is not offered once the hub lost the row', async () => {
        const h = setUp();
        h.source.follow(undefined);
        await h.source.enter();
        expect(h.state()).toMatchObject({ phase: 'view', shut: t('modal.hub.taskMissing'), lost: true });
    });

    it('gives up quietly when the hub closes while it waits', async () => {
        let drain!: () => void;
        const h = setUp({ drained: new Promise<void>(resolve => { drain = resolve; }) });
        const entering = h.source.enter();
        expect(h.source.beforeClose()).toBe(true);
        h.source.dispose();
        drain();
        await entering;
        expect(h.editors).toEqual([]);
        expect(h.confirm).not.toHaveBeenCalled();
    });
});

describe('applying a draft', () => {
    it('writes the parent and the children in one write, on the subtree opened, and goes back to the card', async () => {
        const h = await opened();
        h.editor().parent = '- [x] P';
        h.editor().children[0].text = '- [ ] a2';

        await h.source.apply();

        expect(h.replace).toHaveBeenCalledTimes(1);
        expect(h.replace).toHaveBeenCalledWith('row-1', SUBTREE, {
            text: '- [x] P',
            children: [{ text: '    - [ ] a2', was: 1 }, { text: '    - [ ] b', was: 2 }],
        });
        expect(h.state().phase).toBe('view');
        expect(h.editor().destroyed).toBe(true);
        expect(h.lockForm).toHaveBeenLastCalledWith(false);
    });

    it('writes to the row by the name the hub follows it by', async () => {
        const h = await opened();
        h.source.follow(rowOf({ id: 'row-2' }));
        h.editor().parent = '- [x] P';
        await h.source.apply();
        expect(h.replace.mock.calls[0][0]).toBe('row-2');
    });

    it('writes nothing for a draft that is the subtree opened, and goes back to the card', async () => {
        const h = await opened();
        await h.source.apply();
        expect(h.replace).not.toHaveBeenCalled();
        expect(h.state().phase).toBe('view');
    });

    it('keeps a refused draft, with why under it', async () => {
        const refused = { file: 'note.md', reason: { kind: 'disturbs' as const, fence: null }, subject: 'P' };
        const h = await opened({ answers: [{ written: false, refused }] });
        h.editor().parent = '- [x] P';

        await h.source.apply();

        expect(h.state()).toMatchObject({
            phase: 'source',
            issues: [{ at: 'form', tone: 'error', text: t('notice.notWritten', { reason: t('notice.refusedDisturbs'), subject: 'P' }) }],
        });
        expect(h.editor().destroyed).toBe(false);
        expect(h.editor().draft().parent).toBe('- [x] P');
        expect(h.lockForm).not.toHaveBeenCalledWith(false);
    });

    it('does not write the draft refused last again, and says why again; a changed draft is written', async () => {
        const refused = { file: 'note.md', reason: { kind: 'disturbs' as const, fence: null }, subject: 'P' };
        const h = await opened({ answers: [{ written: false, refused }, { written: true }] });
        h.editor().parent = '- [x] P';
        await h.source.apply();
        const why = h.state().issues;

        await h.source.apply();
        expect(h.replace).toHaveBeenCalledTimes(1);
        expect(h.state()).toMatchObject({ phase: 'source', issues: why });

        h.editor().parent = '- [x] P2';
        await h.source.apply();
        expect(h.replace).toHaveBeenCalledTimes(2);
        expect(h.state().phase).toBe('view');
    });

    it('tells the same lines with other lines kept apart from the draft refused', async () => {
        const refused = { file: 'note.md', reason: { kind: 'changed' as const }, subject: 'P' };
        const h = await opened({ answers: [{ written: false, refused }, { written: true }] });
        h.editor().children[0].text = '- [ ] b';
        h.editor().children[1].text = '- [ ] a';
        await h.source.apply();
        // The same text, but each line a new one: another write.
        h.editor().children = [{ text: '- [ ] b', was: null }, { text: '- [ ] a', was: null }];
        await h.source.apply();
        expect(h.replace).toHaveBeenCalledTimes(2);
    });

    it('refuses a first line that is no task line, writing nothing', async () => {
        const h = await opened();
        h.editor().parent = 'P';
        await h.source.apply();
        expect(h.replace).not.toHaveBeenCalled();
        expect(h.state()).toMatchObject({ phase: 'source', issues: [{ at: 'form', tone: 'error', text: t('modal.hub.source.notTask') }] });
    });

    it('is not made while a write of the draft is on its way', async () => {
        let answer!: (a: ReplaceAnswer) => void;
        const h = await opened();
        h.replace.mockImplementationOnce(() => new Promise<ReplaceAnswer>(resolve => { answer = resolve; }));
        h.editor().parent = '- [x] P';
        const first = h.source.apply();
        expect(h.state().phase).toBe('applying');
        await h.source.apply();
        expect(h.replace).toHaveBeenCalledTimes(1);
        answer({ written: true });
        await first;
        expect(h.state().phase).toBe('view');
    });
});

describe('cancelling', () => {
    it('goes back to the card at once when there is no draft', async () => {
        const h = await opened();
        h.source.cancel();
        expect(h.state()).toMatchObject({ phase: 'view', asking: false });
        expect(h.lockForm).toHaveBeenLastCalledWith(false);
    });

    it('asks whether to throw a draft away; back keeps it, discard throws it away', async () => {
        const h = await opened();
        h.editor().parent = '- [ ] P2';

        h.source.cancel();
        expect(h.state()).toMatchObject({ phase: 'source', asking: true });

        h.source.keep();
        expect(h.state()).toMatchObject({ phase: 'source', asking: false });
        expect(h.editor().draft().parent).toBe('- [ ] P2');
        expect(h.replace).not.toHaveBeenCalled();

        h.source.cancel();
        h.source.discard();
        expect(h.state()).toMatchObject({ phase: 'view', asking: false });
        expect(h.editor().destroyed).toBe(true);
        expect(h.closeHub).not.toHaveBeenCalled();
    });
});

describe('closing the hub (beforeClose)', () => {
    it('lets it close over an edit that writes nothing: a blank line added at the end of the children (論点2)', async () => {
        const h = await opened();
        h.editor().children.push({ text: '', was: null });
        expect(h.source.beforeClose()).toBe(true);
        expect(h.asked()).toBe(0);
        // Back to the card, too, without asking.
        h.source.cancel();
        expect(h.state()).toMatchObject({ phase: 'view', asking: false });
    });

    it('lets it close on the card, and in the source without a draft', async () => {
        const h = setUp();
        expect(h.source.beforeClose()).toBe(true);
        await h.source.enter();
        expect(h.source.beforeClose()).toBe(true);
    });

    it('keeps it open over a draft and asks; asked again, it stays open and puts the same question again', async () => {
        const h = await opened();
        h.editor().parent = '- [ ] P2';
        expect(h.source.beforeClose()).toBe(false);
        expect(h.state().asking).toBe(true);
        expect(h.asked()).toBe(1);
        const drawn = h.state();
        // The focus may have gone back to the editor meanwhile: the question takes it to its answer again.
        expect(h.source.beforeClose()).toBe(false);
        expect(h.asked()).toBe(2);
        expect(h.state()).toBe(drawn);
        expect(h.closeHub).not.toHaveBeenCalled();
    });

    it('closes the hub once the draft is thrown away, as asked', async () => {
        const h = await opened();
        h.editor().parent = '- [ ] P2';
        h.source.beforeClose();
        h.source.discard();
        expect(h.closeHub).toHaveBeenCalledTimes(1);
    });

    it('closes once the draft is thrown away, when a close is asked for while the switch to the card is asking', async () => {
        const h = await opened();
        h.editor().parent = '- [ ] P2';
        h.source.cancel();
        expect(h.state().asking).toBe(true);
        expect(h.asked()).toBe(1);
        expect(h.source.beforeClose()).toBe(false);
        expect(h.asked()).toBe(2);
        h.source.discard();
        expect(h.closeHub).toHaveBeenCalledTimes(1);
    });

    it('keeps a refused draft from a close as any draft', async () => {
        const refused = { file: 'note.md', reason: { kind: 'changed' as const }, subject: 'P' };
        const h = await opened({ answers: [{ written: false, refused }] });
        h.editor().parent = '- [x] P';
        await h.source.apply();
        expect(h.source.beforeClose()).toBe(false);
    });
});

describe('going back to the draft while asked', () => {
    it('withdraws the question on an edit, the close asked about given up', async () => {
        const h = await opened();
        h.editor().type('- [ ] P2');
        expect(h.source.beforeClose()).toBe(false);
        expect(h.state().asking).toBe(true);

        h.editor().type('- [ ] P3');
        expect(h.state()).toMatchObject({ phase: 'source', asking: false });
        expect(h.closeHub).not.toHaveBeenCalled();
        expect(h.editor().destroyed).toBe(false);
    });

    it('withdraws it on an apply, which writes the draft and goes back to the card with the hub open', async () => {
        const h = await opened();
        h.editor().type('- [x] P');
        h.source.beforeClose();
        expect(h.state().asking).toBe(true);

        await h.source.apply();
        expect(h.replace).toHaveBeenCalledTimes(1);
        expect(h.state()).toMatchObject({ phase: 'view', asking: false });
        expect(h.closeHub).not.toHaveBeenCalled();
    });

    it('withdraws it on an apply that is refused, the draft and why kept', async () => {
        const h = await opened();
        h.editor().type('text');
        h.source.cancel();
        await h.source.apply();
        expect(h.replace).not.toHaveBeenCalled();
        expect(h.state()).toMatchObject({ phase: 'source', asking: false, issues: [{ at: 'form', tone: 'error', text: t('modal.hub.source.notTask') }] });
    });

    it('forgets the close given up on back: a discard asked later by cancel goes back to the card, the hub open', async () => {
        const h = await opened();
        h.editor().type('- [ ] P2');
        h.source.beforeClose();
        h.source.keep();
        expect(h.state().asking).toBe(false);

        h.source.cancel();
        h.source.discard();
        expect(h.state()).toMatchObject({ phase: 'view', asking: false });
        expect(h.closeHub).not.toHaveBeenCalled();
    });
});

describe('a row the hub lost', () => {
    it('keeps the draft and offers no apply; the draft can be copied as the file\'s lines', async () => {
        const h = await opened();
        h.editor().parent = '- [x] P';
        h.editor().children.push({ text: '    - [ ] c', was: null });

        h.source.follow(undefined);
        expect(h.state()).toMatchObject({ phase: 'source', lost: true });
        await h.source.apply();
        expect(h.replace).not.toHaveBeenCalled();
        expect(h.source.draftText()).toBe(['- [x] P', '    - [ ] a', '    - [ ] b', '        - [ ] c'].join('\n'));

        h.source.discard();
        expect(h.state().phase).toBe('view');
    });
});

describe('Escape', () => {
    it('is the editor\'s while it shows a completion list, else the hub\'s', async () => {
        const h = await opened();
        expect(h.source.yieldsEscape()).toBe(false);
        h.editor().completing = true;
        expect(h.source.yieldsEscape()).toBe(true);
    });
});

describe('back', () => {
    it('closes a completion list the editor shows, taking the back, else leaves it to the hub', async () => {
        const h = await opened();
        expect(h.source.takesBack()).toBe(false);
        h.editor().completing = true;
        expect(h.source.takesBack()).toBe(true);
        expect(h.editor().completing).toBe(false);
        expect(h.state().asking).toBe(false);
    });
});
