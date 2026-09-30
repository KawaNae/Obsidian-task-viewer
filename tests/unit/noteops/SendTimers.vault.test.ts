import { describe, it, expect, afterEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import { openLiveVault, type VaultSession } from '../helpers/vaultSession';
import { NoteOps, type SendDestination } from '../../../src/services/data/NoteOps';
import { TimerWidget } from '../../../src/timer/TimerWidget';
import { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import { IDLE_TIMER_ID } from '../../../src/timer/TimerContext';
import type { TimerInstance, TimerRecordMode } from '../../../src/timer/TimerInstance';
import { DEFAULT_SETTINGS } from '../../../src/types';
import { t } from '../../../src/i18n';

/**
 * A send and the open timers (`archive/2026-09-send.md`, 開いているタイマー), with the real widget
 * over a live vault: a timer whose lines all go follows them to the note as
 * the write of their note lands, and records there; one of a note whose
 * write was refused stays; one the send would leave without its lines keeps
 * the send from being made.
 */

(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1, clearInterval: () => { },
    addEventListener: () => { }, removeEventListener: () => { },
};
const at = (h: number, m: number) => new Date(2026, 8, 30, h, m, 0);
const SECTION = { heading: 'Tasks', level: 2, side: 'head' as const };
const NEW = (name: string): SendDestination => ({ note: { kind: 'new', folder: '', name }, section: SECTION });

let live: VaultSession | undefined;
afterEach(() => {
    live?.dispose();
    live = undefined;
    vi.useRealTimers();
    Notice.messages.length = 0;
});

async function open(files: Record<string, string[]>) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at(9, 0));
    const { contents, session } = await openLiveVault(files, s => { live = s; });
    Object.assign(session.app.vault, { getName: () => 'test-vault' });
    const plugin = {
        settings: { ...DEFAULT_SETTINGS },
        getIndex: () => session.index,
        getOperations: () => session.ops,
        getTaskReadService: () => ({ getTask: (id: string) => session.index.getTask(id) }),
    };
    const ticker = vi.spyOn(TimerLifecycle.prototype, 'startTimerTicker');
    const widget = new TimerWidget(session.app, plugin as never);
    widget.render = () => { };
    widget.renderTimerItem = () => { };
    widget.persistTimersToStorage = () => { };
    const ops = new NoteOps(session.app, session.ops, () => ({ ...DEFAULT_SETTINGS }), {
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
    /** Start a count-up on the row `content`, and wait until its first line is written. */
    const start = async (content: string, recordMode: TimerRecordMode): Promise<TimerInstance> => {
        const row = task(content);
        const before = new Set(widget.timers.keys());
        widget.startTimer({
            taskId: row.id, taskName: row.content, taskFile: row.file, taskOriginalText: row.originalText,
            timerTargetId: row.anchor, timerType: 'countup', recordMode, autoStart: true,
        });
        const timer = [...widget.timers.values()].find(one => one.id !== IDLE_TIMER_ID && !before.has(one.id))!;
        await vi.waitFor(() => {
            expect(timer.tailRecordBlockId).toBeDefined();
            expect(session.index.getTaskByAnchor(timer.taskFile, timer.tailRecordBlockId!)).toBeDefined();
        });
        await settle();
        return timer;
    };
    const lifecycle = () => ticker.mock.contexts[0] as TimerLifecycle;
    const row = (content: string) => ({ taskId: task(content).id, base: task(content).subtreeLines! });
    return { session, contents, widget, ops, start, settle, lifecycle, row, text: (path: string) => contents.get(path) };
}

/** Before the next write to `path`, edit it from outside, so that write is refused (`changed`). */
function refuseNext(note: { contents: Map<string, string>; session: VaultSession }, path: string): void {
    const vault = note.session.app.vault as unknown as { process: (file: { path: string }, fn: (data: string) => string) => Promise<string> };
    const process = vault.process.bind(vault);
    let armed = true;
    vault.process = async (file, fn) => {
        if (armed && file.path === path) {
            armed = false;
            note.contents.set(path, note.contents.get(path) + '- [ ] typed\n');
        }
        return process(file, fn);
    };
}

describe('a timer whose lines all go', () => {
    it('follows them to the note, and its ■ records there', async () => {
        const note = await open({ 'a.md': ['- [ ] 器', ''] });
        const timer = await note.start('器', 'child');
        const tail = timer.tailRecordBlockId!;

        const sent = await note.ops.send({ rows: [note.row('器')], to: NEW('X'), frontmatter: [] });
        await note.settle();

        expect(sent.kind).toBe('done');
        expect(timer.taskFile).toBe('X.md');
        expect(note.text('a.md')).toBe('- [[X]]\n');
        expect(note.text('X.md')).toContain(`^${tail}`);

        vi.setSystemTime(at(9, 30));
        await note.lifecycle().finishTimer(timer);
        await note.settle();

        expect(note.widget.timers.has(timer.id)).toBe(false);
        expect(note.text('X.md')).toMatch(/@2026-09-30T09:00>09:30/);
        expect(note.text('a.md')).toBe('- [[X]]\n');
    });

    it('of rows from two notes, one refused: only the timer of the note that went follows', async () => {
        const note = await open({ 'a.md': ['- [ ] A', ''], 'b.md': ['- [ ] B', ''] });
        const ta = await note.start('A', 'child');
        const tb = await note.start('B', 'child');
        refuseNext(note, 'b.md');

        const sent = await note.ops.send({ rows: [note.row('A'), note.row('B')], to: NEW('X'), frontmatter: [] });
        await note.settle();

        expect(sent.kind === 'partly' && sent.refused).toEqual(['b.md']);
        expect(ta.taskFile).toBe('X.md');
        expect(tb.taskFile).toBe('b.md');
        expect(note.session.index.getTaskByAnchor('X.md', ta.tailRecordBlockId!)).toBeDefined();
        expect(note.session.index.getTaskByAnchor('b.md', tb.tailRecordBlockId!)).toBeDefined();
    });
});

describe('a timer the send would leave without its lines', () => {
    it('some of its lines staying: not sent, nothing written, why answered — a timer waiting to record as well', async () => {
        const note = await open({ 'a.md': ['- [x] 器', ''] });
        const timer = await note.start('器', 'sibling');
        timer.pendingRecord = { endMs: at(9, 10).getTime(), seconds: 600, then: 'suspend' };
        const before = note.text('a.md');

        const sent = await note.ops.send({ rows: [note.row('器')], to: NEW('X'), frontmatter: [] }, { tellRefusal: false });

        const why = [t('notice.notSent'), t('notice.sendTimerSplit', { timer: '器', sent: timer.timerTargetId!, kept: timer.tailRecordBlockId! })].join(' ');
        expect(sent).toEqual({ kind: 'not-done', why });
        expect(note.contents.has('X.md')).toBe(false);
        expect(note.text('a.md')).toBe(before);
        expect(timer.taskFile).toBe('a.md');
        expect(Notice.messages).toEqual([]);
    });

    it('told when the caller does not show it', async () => {
        const note = await open({ 'a.md': ['- [x] 器', ''] });
        await note.start('器', 'sibling');

        const sent = await note.ops.send({ rows: [note.row('器')], to: NEW('X'), frontmatter: [] });

        expect(sent.kind).toBe('not-done');
        expect(Notice.messages).toEqual([sent.kind === 'not-done' && sent.why]);
    });

    it('its ^id on a line of the note sent to already: not sent', async () => {
        const note = await open({ 'a.md': ['- [ ] 器', ''], 'X.md': [''] });
        const timer = await note.start('器', 'child');
        note.contents.set('X.md', `- 写し ^${timer.tailRecordBlockId}\n`);

        const sent = await note.ops.send({ rows: [note.row('器')], to: { note: { kind: 'existing', path: 'X.md' }, section: SECTION }, frontmatter: [] }, { tellRefusal: false });

        expect(sent).toEqual({
            kind: 'not-done',
            why: [t('notice.notSent'), t('notice.sendTimerShared', { timer: '器', anchor: timer.tailRecordBlockId!, note: 'X.md' })].join(' '),
        });
        expect(timer.taskFile).toBe('a.md');
    });
});
