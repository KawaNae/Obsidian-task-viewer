import { describe, it, expect, afterEach, vi } from 'vitest';
import { openLiveVault, makeFile, type VaultSession } from '../helpers/vaultSession';
import { NoteOps } from '../../../src/services/data/NoteOps';
import { TimerWidget } from '../../../src/timer/TimerWidget';
import type { TimerState } from '../../../src/timer/TimerState';
import { DEFAULT_SETTINGS } from '../../../src/types';
import { getDisplayFileName } from '../../../src/services/display/TaskContent';

/**
 * widget の見出しのファイル名はタイマーの `file` に追随する。行を別のノートへ
 * 送ったとき（`TimerWidget.follow`）もノートの名前を変えたとき
 * （`handleFileRename`）も、`followed` で書き換わった `file` は索引の変化
 * （`refreshFromIndex`）で見出しに届く。見出しを組み直す（中断する）のを待たない。
 */

const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1, clearInterval: () => { },
    addEventListener: () => { }, removeEventListener: () => { },
    localStorage: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
    },
};
const at = (h: number, m: number) => new Date(2026, 8, 30, h, m, 0);
const SECTION = { heading: 'Tasks', level: 2, side: 'head' as const };

/** 見出しの名前の器（`.timer-widget__title`）だけを持つ widget の DOM の代わり。 */
class FakeSpan {
    textContent = '';
    constructor(readonly cls: string, private parent: FakeTitle) { }
    setText(text: string): void { this.textContent = text; }
    remove(): void { this.parent.children = this.parent.children.filter(one => one !== this); }
}
class FakeTitle {
    children: FakeSpan[] = [];
    createSpan(cls: string): FakeSpan {
        const span = new FakeSpan(cls, this);
        this.children.push(span);
        return span;
    }
    querySelector(selector: string): FakeSpan | null {
        return this.children.find(one => `.${one.cls}` === selector) ?? null;
    }
}

let live: VaultSession | undefined;
afterEach(() => {
    live?.dispose();
    live = undefined;
    vi.useRealTimers();
});

async function open(files: Record<string, string[]>) {
    store.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at(9, 0));
    const { contents, session } = await openLiveVault(files, s => { live = s; });
    Object.assign(session.app.vault, { getName: () => 'test-vault' });
    const plugin = {
        settings: { ...DEFAULT_SETTINGS },
        getIndex: () => session.index,
        getOperations: () => session.ops,
        registerEvent: () => { },
    };
    const widget = new TimerWidget(session.app, plugin as never);
    const titles = new Map<string, FakeTitle>();
    const titleOf = (timerId: string) => titles.get(timerId) ?? titles.set(timerId, new FakeTitle()).get(timerId)!;
    const container = {
        querySelector: (selector: string) => {
            const id = /data-timer-id="([^"]+)"/.exec(selector)?.[1];
            if (!id) return null;
            return { querySelector: (inner: string) => (inner === '.timer-widget__title' ? titleOf(id) : null) };
        },
    };
    widget.render = () => { };
    widget.ensureContainer = () => container as unknown as HTMLElement;
    widget.activate();
    const ops = new NoteOps(session.app, session.ops, () => ({ ...DEFAULT_SETTINGS }), {
        getTask: (id) => session.index.getTask(id),
        timers: () => widget,
    });
    const task = (content: string) => session.index.getTasks().find(one => one.content === content)!;
    const settle = async () => {
        for (let i = 0; i < 3; i++) {
            await new Promise(r => setTimeout(r, 0));
            for (const path of contents.keys()) await session.settle(path);
        }
    };
    /**
     * Start a count-up on the row `content`, wait until its first line is
     * written, and draw its header's file name as the header is built.
     */
    const start = async (content: string): Promise<TimerState> => {
        const row = task(content);
        const before = new Set(widget.board.values().map(one => one.id));
        widget.startTimer(row, 'child', { kind: 'countup' });
        const timer = widget.board.values().find(one => !before.has(one.id))!;
        const fileName = getDisplayFileName(timer.name, timer.file);
        if (fileName) titleOf(timer.id).createSpan('timer-widget__title-file').setText(fileName);
        await vi.waitFor(() => expect(timer.tail).not.toBeNull());
        await settle();
        return timer;
    };
    /** The file name the header of `timer` shows, or null when it shows none. */
    const shown = (timer: TimerState) => titleOf(timer.id).querySelector('.timer-widget__title-file')?.textContent ?? null;
    /** Rename the note `from` to `to`, as the vault tells the index and the plugin (`main.ts`) of it. */
    const rename = async (from: string, to: string) => {
        contents.set(to, contents.get(from)!);
        contents.delete(from);
        await Promise.all([
            session.fireVault('rename', makeFile(to), from),
            widget.handleFileRename(from, to),
        ]);
        await settle();
    };
    const row = (content: string) => ({ taskId: task(content).id, base: task(content).subtreeLines! });
    return { session, widget, ops, start, settle, shown, rename, row };
}

describe('the file name a timer\'s header shows follows its file', () => {
    it('its rows sent to another note: the header names that note', async () => {
        const note = await open({ 'a.md': ['- [ ] 計る', ''] });
        const timer = await note.start('計る');
        expect(note.shown(timer)).toBe('a');

        const sent = await note.ops.send({ rows: [note.row('計る')], to: { note: { kind: 'new', folder: '', name: 'X' }, section: SECTION }, frontmatter: [] });
        await note.settle();

        expect(sent.kind).toBe('done');
        expect(timer.file).toBe('X.md');
        await vi.waitFor(() => expect(note.shown(timer)).toBe('X'));
    });

    it('its note renamed: the header names the note by its new name', async () => {
        const note = await open({ 'a.md': ['- [ ] 計る', ''] });
        const timer = await note.start('計る');
        expect(note.shown(timer)).toBe('a');

        await note.rename('a.md', 'b.md');

        expect(timer.file).toBe('b.md');
        await vi.waitFor(() => expect(note.shown(timer)).toBe('b'));
    });

    it('sent to a note of its own name: the file name is taken away', async () => {
        const note = await open({ 'a.md': ['- [ ] X', ''] });
        const timer = await note.start('X');
        expect(note.shown(timer)).toBe('a');

        await note.ops.send({ rows: [note.row('X')], to: { note: { kind: 'new', folder: '', name: 'X' }, section: SECTION }, frontmatter: [] });
        await note.settle();

        expect(timer.file).toBe('X.md');
        await vi.waitFor(() => expect(note.shown(timer)).toBeNull());
    });

    it('a note of the row\'s own name renamed: a file name it did not show is shown', async () => {
        const note = await open({ '設計.md': ['- [ ] 設計', ''] });
        const timer = await note.start('設計');
        expect(note.shown(timer)).toBeNull();

        await note.rename('設計.md', 'b.md');

        await vi.waitFor(() => expect(note.shown(timer)).toBe('b'));
    });
});
