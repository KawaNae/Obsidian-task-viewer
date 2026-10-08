import { describe, it, expect, afterEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import { openLiveVault, type VaultSession } from '../helpers/vaultSession';
import { widgetOver } from '../helpers/timerRig';
import { NoteOps, type SendDestination } from '../../../src/services/data/NoteOps';
import { TimerPersistence } from '../../../src/timer/TimerPersistence';
import type { RecordMode, TimerState } from '../../../src/timer/TimerState';
import { DEFAULT_SETTINGS } from '../../../src/types';
import { t } from '../../../src/i18n';

/**
 * A send and the open timers (`archive/2026-09-send.md`, 開いているタイマー), with the real widget
 * over a live vault: a timer whose lines all go follows them to the note as
 * the write of their note lands (`followed`), and records there; one of a
 * note whose write was refused stays; one the send would leave without its
 * lines keeps the send from being made.
 */

const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1, clearInterval: () => { }, setTimeout, clearTimeout,
    addEventListener: () => { }, removeEventListener: () => { },
    localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
    },
};
const at = (h: number, m: number) => new Date(2026, 8, 30, h, m, 0);
const SECTION = { heading: 'Tasks', level: 2, side: 'head' as const };
const NEW = (name: string): SendDestination => ({ note: { kind: 'new', path: `${name}.md` }, section: SECTION });

let live: VaultSession | undefined;
afterEach(() => {
    live?.dispose();
    live = undefined;
    vi.useRealTimers();
    Notice.messages.length = 0;
    store.clear();
});

async function open(files: Record<string, string[]>) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at(9, 0));
    const { contents, session } = await openLiveVault(files, s => { live = s; });
    const widget = widgetOver(session);
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
    const start = async (content: string, mode: RecordMode): Promise<TimerState> => {
        const before = new Set(widget.board.values());
        widget.startTimer(task(content), mode, { kind: 'countup' });
        const timer = widget.board.values().find(one => !before.has(one))!;
        await vi.waitFor(() => {
            expect(timer.tail).not.toBeNull();
            expect(session.index.getTaskByAnchor(timer.file, timer.tail!)).toBeDefined();
        });
        await settle();
        return timer;
    };
    /** What the widget saved of `timer`, once the board has saved. */
    const saved = (timer: TimerState) => {
        widget.board.flush();
        return new TimerPersistence(session.app).restore().timers.find(one => one.id === timer.id);
    };
    const row = (content: string) => ({ taskId: task(content).id, base: task(content).subtreeLines! });
    return { session, contents, widget, ops, start, settle, saved, row, text: (path: string) => contents.get(path) };
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

const targetOf = (timer: TimerState) => (timer.subject.kind === 'task' ? timer.subject.anchor : '');

describe('a timer whose lines all go', () => {
    it('follows them to the note, is saved there, and its ■ records there', async () => {
        const note = await open({ 'a.md': ['- [ ] 器', ''] });
        const timer = await note.start('器', 'child');
        const tail = timer.tail!;

        const sent = await note.ops.send({ rows: [note.row('器')], to: NEW('X'), frontmatter: [] });
        await note.settle();

        expect(sent.kind).toBe('done');
        expect(timer.file).toBe('X.md');
        expect(note.saved(timer)?.file).toBe('X.md');
        expect(note.text('a.md')).toBe('- [[X]]\n');
        expect(note.text('X.md')).toContain(`^${tail}`);

        vi.setSystemTime(at(9, 30));
        await note.widget.lifecycle.stop(timer, 'close');
        await note.settle();

        expect(note.widget.board.has(timer)).toBe(false);
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
        expect(ta.file).toBe('X.md');
        expect(tb.file).toBe('b.md');
        expect(note.session.index.getTaskByAnchor('X.md', ta.tail!)).toBeDefined();
        expect(note.session.index.getTaskByAnchor('b.md', tb.tail!)).toBeDefined();
    });
});

describe('follow, asked as the write lands', () => {
    it('a timer only some of whose ^ids went is left in its note', async () => {
        const note = await open({ 'a.md': ['- [ ] 器', ''] });
        const timer = await note.start('器', 'child');

        note.widget.follow('a.md', 'X.md', [timer.tail!]);

        expect(timer.file).toBe('a.md');
        note.widget.follow('a.md', 'X.md', [targetOf(timer), timer.tail!]);
        expect(timer.file).toBe('X.md');
    });
});

describe('a note renamed', () => {
    it('its timers follow it, and are saved there', async () => {
        const note = await open({ 'a.md': ['- [ ] 器', ''], 'b.md': ['- [ ] B', ''] });
        const ta = await note.start('器', 'child');
        const tb = await note.start('B', 'child');

        note.widget.handleFileRename('a.md', 'notes/a2.md');

        expect(ta.file).toBe('notes/a2.md');
        expect(tb.file).toBe('b.md');
        expect(note.saved(ta)?.file).toBe('notes/a2.md');
    });
});

describe('a timer the send would leave without its lines', () => {
    it('some of its lines staying: not sent, nothing written, why answered — a timer waiting to record as well', async () => {
        const note = await open({ 'a.md': ['- [x] 器', ''] });
        const timer = await note.start('器', 'sibling');
        // ⏸ を押したが記録はまだ書いていない（記録待ち）。
        vi.setSystemTime(at(9, 10));
        note.widget.board.dispatch(timer, { type: 'stopped', then: 'suspend' });
        expect(timer.session.kind).toBe('pending');
        const before = note.text('a.md');

        const sent = await note.ops.send({ rows: [note.row('器')], to: NEW('X'), frontmatter: [] }, { tellRefusal: false });

        const why = [t('notice.notSent'), t('notice.sendTimerSplit', { timer: '器', sent: targetOf(timer), kept: timer.tail! })].join(' ');
        expect(sent).toEqual({ kind: 'not-done', why });
        expect(note.contents.has('X.md')).toBe(false);
        expect(note.text('a.md')).toBe(before);
        expect(timer.file).toBe('a.md');
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
        note.contents.set('X.md', `- 写し ^${timer.tail}\n`);

        const sent = await note.ops.send({ rows: [note.row('器')], to: { note: { kind: 'existing', path: 'X.md' }, section: SECTION }, frontmatter: [] }, { tellRefusal: false });

        expect(sent).toEqual({
            kind: 'not-done',
            why: [t('notice.notSent'), t('notice.sendTimerShared', { timer: '器', anchor: timer.tail!, note: 'X.md' })].join(' '),
        });
        expect(timer.file).toBe('a.md');
    });
});
