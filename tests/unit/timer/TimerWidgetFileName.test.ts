import { describe, it, expect, afterEach, vi } from 'vitest';
import { openLiveVault, makeFile, type VaultSession } from '../helpers/vaultSession';
import { NoteOps } from '../../../src/services/data/NoteOps';
import { TaskWriteService } from '../../../src/services/data/TaskWriteService';
import { TimerWidget } from '../../../src/timer/TimerWidget';
import { IDLE_TIMER_ID } from '../../../src/timer/TimerContext';
import type { TimerInstance } from '../../../src/timer/TimerInstance';
import { DEFAULT_SETTINGS } from '../../../src/types';
import { getDisplayFileName } from '../../../src/services/parsing/utils/TaskContent';

/**
 * widget の見出しのファイル名は `timer.taskFile` に追随する。行を別のノートへ
 * 送ったとき（`TimerWidget.follow`）もノートの名前を変えたとき
 * （`handleFileRename`）も、書き換わった `taskFile` は索引の変化
 * （`refreshFromIndex`）で見出しに届く。以前は見出しを組み直す（中断する）
 * まで古いファイル名が残った。
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
        getTaskIndex: () => session.index,
        getTaskWriteService: () => new TaskWriteService(session.index),
        getTaskReadService: () => ({
            getTask: (id: string) => session.index.getTask(id),
            onChange: (fn: () => void) => session.index.onChange(fn),
        }),
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
    widget.renderTimerItem = () => { };
    widget.ensureContainer = () => container as unknown as HTMLElement;
    widget.activate();
    const ops = new NoteOps(session.app, new TaskWriteService(session.index), () => ({ ...DEFAULT_SETTINGS }), {
        getTask: (id) => session.index.getTask(id),
        timers: () => widget,
    });
    const task = (content: string) => session.index.getTasks().find(one => one.content === content)!;
    const settle = async () => {
        for (let i = 0; i < 3; i++) {
            await new Promise(r => setTimeout(r, 0));
            await session.settle(...contents.keys());
        }
    };
    /**
     * Start a count-up on the row `content`, wait until its first line is
     * written, and draw its header's file name as the header is built.
     */
    const start = async (content: string): Promise<TimerInstance> => {
        const row = task(content);
        const before = new Set(widget.timers.keys());
        widget.startTimer({
            taskId: row.id, taskName: row.content, taskFile: row.file, taskOriginalText: row.originalText,
            timerTargetId: row.anchor, timerType: 'countup', recordMode: 'child', autoStart: true,
        });
        const timer = [...widget.timers.values()].find(one => one.id !== IDLE_TIMER_ID && !before.has(one.id))!;
        const fileName = getDisplayFileName(timer.taskName, timer.taskFile);
        if (fileName) titleOf(timer.id).createSpan('timer-widget__title-file').setText(fileName);
        await vi.waitFor(() => expect(timer.tailRecordBlockId).toBeDefined());
        await settle();
        return timer;
    };
    /** The file name the header of `timer` shows, or null when it shows none. */
    const shown = (timer: TimerInstance) => titleOf(timer.id).querySelector('.timer-widget__title-file')?.textContent ?? null;
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

describe('the file name a timer\'s header shows follows its taskFile', () => {
    it('its rows sent to another note: the header names that note', async () => {
        const note = await open({ 'a.md': ['- [ ] 計る', ''] });
        const timer = await note.start('計る');
        expect(note.shown(timer)).toBe('a');

        const sent = await note.ops.send({ rows: [note.row('計る')], to: { note: { kind: 'new', folder: '', name: 'X' }, section: SECTION }, frontmatter: [] });
        await note.settle();

        expect(sent.kind).toBe('done');
        expect(timer.taskFile).toBe('X.md');
        await vi.waitFor(() => expect(note.shown(timer)).toBe('X'));
    });

    it('its note renamed: the header names the note by its new name', async () => {
        const note = await open({ 'a.md': ['- [ ] 計る', ''] });
        const timer = await note.start('計る');
        expect(note.shown(timer)).toBe('a');

        await note.rename('a.md', 'b.md');

        expect(timer.taskFile).toBe('b.md');
        await vi.waitFor(() => expect(note.shown(timer)).toBe('b'));
    });

    it('sent to a note of its own name: the file name is taken away', async () => {
        const note = await open({ 'a.md': ['- [ ] X', ''] });
        const timer = await note.start('X');
        expect(note.shown(timer)).toBe('a');

        await note.ops.send({ rows: [note.row('X')], to: { note: { kind: 'new', folder: '', name: 'X' }, section: SECTION }, frontmatter: [] });
        await note.settle();

        expect(timer.taskFile).toBe('X.md');
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
