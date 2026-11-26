import { describe, it, expect, vi } from 'vitest';
import { t } from '../../../src/i18n';
import {
    TaskHubSource, type OpenSource, type SeatRow, type SeatView, type SourceOpening, type SourceSeat, type SourceViewState,
} from '../../../src/modals/hub/TaskHubSource';
import type { SubtreeFrame } from '../../../src/services/persistence/utils/SubtreeFrame';
import type { DraftEditor, SourceDraft } from '../../../src/modals/form/source/SourceEditor';
import { makeTask } from '../helpers/makeTask';

/**
 * The hub's switch between the card and the source (`TaskHubSource`), on a
 * seat that stands in for whose the text is: the seat answers what the test
 * sets, and records what the switch hands it. The switch opens on what the
 * seat hands, draws what the seat says, and hands the seat each step.
 */

const SUBTREE = ['- [ ] P', '    - [ ] a', '    - [ ] b'];

class FakeEditor implements DraftEditor {
    parent: string;
    children: SourceDraft['children'];
    completing = false;
    destroyed = false;
    focused = 0;
    constructor(frame: SubtreeFrame, readonly hooks: { submit(): void; edited(): void; linkSource(): string }) {
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
}

class TestSeat implements SourceSeat {
    current: SeatRow | undefined = { task: makeTask({ id: 'row-1', content: 'P', subtreeLines: SUBTREE }), lines: SUBTREE };
    /** What `open` hands, once `release` is called when `wait` is set. */
    opening: SourceOpening | null = { lines: SUBTREE, linkSource: () => 'note.md' };
    wait = false;
    release: () => void = () => { };
    /** Whether the opening was still wanted, as `live` said once the wait ended. */
    liveAfter: boolean | null = null;
    shown: SeatView = { foot: { act: true }, busy: false, asking: false, lost: null };
    closes = true;
    source: OpenSource | null = null;
    steps: string[] = [];

    row(): SeatRow | undefined { return this.current; }
    async open(live: () => boolean): Promise<SourceOpening | null> {
        this.steps.push('open');
        if (this.wait) {
            await new Promise<void>(resolve => { this.release = resolve; });
            this.liveAfter = live();
        }
        return this.opening;
    }
    opened(source: OpenSource): void { this.source = source; this.steps.push('opened'); }
    back(): void { this.steps.push('back'); }
    submit(): void { this.steps.push('submit'); }
    edited(): void { this.steps.push('edited'); }
    beforeClose(): boolean { this.steps.push('beforeClose'); return this.closes; }
    view(): SeatView { return this.shown; }
}

function setUp() {
    const seat = new TestSeat();
    const states: SourceViewState[] = [];
    const editors: FakeEditor[] = [];
    const asked = vi.fn();
    const source = new TaskHubSource({ seat: () => seat, indentUnit: () => '    ' }, {
        openEditor: (frame, hooks) => { const editor = new FakeEditor(frame, hooks); editors.push(editor); return editor; },
        render: (state) => { states.push(state); },
        asked,
    });
    return { seat, source, editors, asked, editor: () => editors[editors.length - 1], state: () => states[states.length - 1] };
}

async function opened() {
    const h = setUp();
    await h.source.enter();
    return h;
}

describe('opening the source', () => {
    it('opens on the lines the seat hands, tells the seat, and puts the focus in the editor', async () => {
        const h = await opened();
        expect(h.seat.steps).toEqual(['open', 'opened']);
        expect(h.state()).toMatchObject({ phase: 'source', shut: null, seat: h.seat.shown });
        expect(h.editor().draft()).toEqual({ parent: '- [ ] P', children: [{ text: '- [ ] a', was: 1 }, { text: '- [ ] b', was: 2 }] });
        expect(h.editor().hooks.linkSource()).toBe('note.md');
        expect(h.editor().focused).toBe(1);
        expect(h.seat.source?.frame.base).toEqual(SUBTREE);
        expect(h.seat.source?.editor).toBe(h.editor());
    });

    it('stays on the card when the seat gives up, or hands lines a frame cannot open on', async () => {
        const h = setUp();
        h.seat.opening = null;
        await h.source.enter();
        expect(h.state()).toMatchObject({ phase: 'view', seat: null });

        h.seat.opening = { lines: ['- [ ] P', '  going on', '    - [ ] a'], linkSource: () => 'note.md' };
        await h.source.enter();
        expect(h.state().phase).toBe('view');
        expect(h.editors).toEqual([]);
        expect(h.seat.steps).toEqual(['open', 'open']);
    });

    it('says why it cannot open from the seat\'s row: lost, read only, no lines, or a line shallower than the children', () => {
        const h = setUp();
        const task = h.seat.current!.task;
        const reasons = ([
            undefined,
            { task: { ...task, isReadOnly: true }, lines: SUBTREE },
            { task, lines: undefined },
            { task, lines: ['- [ ] P', '  going on', '    - [ ] a'] },
        ] as (SeatRow | undefined)[]).map((row) => {
            h.seat.current = row;
            h.source.redraw();
            return h.state().shut;
        });
        expect(reasons).toEqual([
            t('modal.hub.taskMissing'),
            t('modal.hub.source.readOnly'),
            t('modal.hub.source.notWritable'),
            t('modal.hub.source.shallow', { line: '1' }),
        ]);
    });

    it('asks the seat nothing while the hub holds the row, and gives up an opening held meanwhile, the seat told it is no longer wanted', async () => {
        const h = setUp();
        h.source.hold(true);
        expect(h.state()).toMatchObject({ phase: 'view', held: true, shut: null });
        await h.source.enter();
        expect(h.seat.steps).toEqual([]);
        h.source.hold(false);

        h.seat.wait = true;
        const entering = h.source.enter();
        expect(h.state().phase).toBe('entering');
        h.source.hold(true);
        expect(h.state().phase).toBe('view');
        h.seat.release();
        await entering;
        expect(h.seat.liveAfter).toBe(false);
        expect(h.editors).toEqual([]);
        expect(h.seat.steps).toEqual(['open']);
    });

    it('gives up an opening on the switch back, the seat not told of it', async () => {
        const h = setUp();
        h.seat.wait = true;
        const entering = h.source.enter();
        h.source.back();
        expect(h.state().phase).toBe('view');
        h.seat.release();
        await entering;
        expect(h.seat.steps).toEqual(['open']);
        expect(h.editors).toEqual([]);
    });

    it('opens nothing once disposed while the seat waits', async () => {
        const h = setUp();
        h.seat.wait = true;
        const entering = h.source.enter();
        expect(h.source.beforeClose()).toBe(true);
        h.source.dispose();
        h.seat.release();
        await entering;
        expect(h.seat.liveAfter).toBe(false);
        expect(h.editors).toEqual([]);
    });
});

describe('in the source', () => {
    it('hands the seat the switch back, Mod+Enter, each edit, and a close', async () => {
        const h = await opened();
        h.source.back();
        h.editor().hooks.submit();
        h.editor().hooks.edited();
        h.seat.closes = false;
        expect(h.source.beforeClose()).toBe(false);
        expect(h.seat.steps.slice(2)).toEqual(['back', 'submit', 'edited', 'beforeClose']);
    });

    it('draws what the seat says of it, again when the seat asks', async () => {
        const h = await opened();
        h.seat.shown = { foot: null, busy: true, asking: false, lost: { discard: false } };
        h.seat.source!.redraw();
        expect(h.state().seat).toEqual({ foot: null, busy: true, asking: false, lost: { discard: false } });
    });

    it('says under the editor what the seat says, until the seat takes it back', async () => {
        const h = await opened();
        h.seat.source!.say('why');
        expect(h.state().issues).toEqual([{ at: 'form', tone: 'error', text: 'why' }]);
        h.seat.source!.say(null);
        expect(h.state().issues).toEqual([]);
    });

    it('puts the focus where the seat asks: the editor, or the answer of its question', async () => {
        const h = await opened();
        h.seat.source!.focusEditor();
        expect(h.editor().focused).toBe(2);
        h.seat.source!.asked();
        expect(h.asked).toHaveBeenCalledTimes(1);
    });

    it('goes back to the card as the seat ends it, the editor and what was said gone, and asks no seat of a close after', async () => {
        const h = await opened();
        const source = h.seat.source!;
        source.say('why');
        source.end();
        expect(h.state()).toMatchObject({ phase: 'view', seat: null, issues: [] });
        expect(h.editor().destroyed).toBe(true);
        expect(h.source.draftText()).toBeNull();
        expect(h.source.beforeClose()).toBe(true);
        // A source ended says nothing more.
        source.say('late');
        expect(h.state().issues).toEqual([]);
    });

    it('lets the editor take Escape and the back for its completion list, not while the seat writes the draft', async () => {
        const h = await opened();
        expect(h.source.yieldsEscape()).toBe(false);
        h.editor().completing = true;
        expect(h.source.yieldsEscape()).toBe(true);
        h.seat.shown = { ...h.seat.shown, busy: true };
        expect(h.source.yieldsEscape()).toBe(false);
        expect(h.source.takesBack()).toBe(false);
        h.seat.shown = { ...h.seat.shown, busy: false };
        expect(h.source.takesBack()).toBe(true);
        expect(h.editor().completing).toBe(false);
    });

    it('copies the draft as the file\'s lines: the subtree as opened while it is the same', async () => {
        const h = await opened();
        expect(h.source.draftText()).toBe(SUBTREE.join('\n'));
        h.editor().parent = '- [x] P';
        expect(h.source.draftText()).toBe(['- [x] P', ...SUBTREE.slice(1)].join('\n'));
        h.editor().parent = 'P';
        expect(h.source.draftText()).toBe(['P', '- [ ] a', '- [ ] b'].join('\n'));
    });
});
