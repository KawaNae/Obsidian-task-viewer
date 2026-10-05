import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Notice } from 'obsidian';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import { widgetOver } from '../helpers/timerRig';
import { TimerWidget } from '../../../src/timer/TimerWidget';
import { t } from '../../../src/i18n';

/**
 * タイマーの同一性はタスクから独立している。タイマーの id は対象から作らず、
 * 一生のあいだ変わらない。対象は行の錨（`subject.anchor`）で追い、行の名前
 * （`task.id`）は持たない。二重起動の判定は `(file, anchor)` とデイリーノートの日で
 * 行うので、ノートの改名や行の移動のあとも同じ行への二重起動を断る。表示の写し
 * （名前と色）は索引が変わるたびに錨で引き直す。
 */
const FILE = 'notes/a.md';
const at = (h: number, m: number) => new Date(2026, 8, 21, h, m, 0);

function stubWindow(): void {
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
}

describe('timer identity', () => {
    let s: VaultSession;
    let contents: Map<string, string>;

    beforeEach(async () => {
        stubWindow();
        Notice.messages = [];
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(at(9, 0));
        contents = new Map([[FILE, ['- [ ] 器 @2026-09-21 ^box', '- [ ] 別 @2026-09-21 ^other', ''].join('\n')]]);
        s = vaultSession(contents);
        await s.scanAll();
    });
    afterEach(() => {
        s.dispose();
        vi.useRealTimers();
    });

    const task = (content: string) => s.index.getTasks().find(one => one.content === content)!;
    const settle = async () => {
        for (let i = 0; i < 3; i++) {
            await new Promise(r => setTimeout(r, 0));
            for (const path of contents.keys()) await s.settle(path);
        }
    };

    it('gives each timer its own id, made from nothing of its task', () => {
        const widget = widgetOver(s);
        widget.startTimer(task('器'), 'child', { kind: 'countup' });
        widget.startTimer(task('別'), 'child', { kind: 'countup' });

        const [a, b] = widget.board.values();
        expect(a.id).toMatch(/^timer-/);
        expect(a.id).not.toBe(b.id);
        expect(a.id).not.toContain(task('器').id);
        expect(a.subject).toEqual({ kind: 'task', anchor: 'box' });
        expect(b.subject).toEqual({ kind: 'task', anchor: 'other' });
    });

    it('refuses a second timer on the same row, found by its anchor', async () => {
        const widget = widgetOver(s);
        widget.startTimer(task('器'), 'child', { kind: 'countup' });
        await vi.waitFor(() => expect(widget.board.values()[0].tail).not.toBeNull());
        await settle();

        // 子の行が書かれて行の名前は替わっているが、錨は同じ。
        widget.startTimer(task('器'), 'self', { kind: 'pomodoro' });

        expect(widget.board.size).toBe(1);
        expect(Notice.messages).toContain(t('timer.alreadyActive'));
    });

    it('still refuses the same row after its note is renamed', async () => {
        const widget = widgetOver(s);
        widget.startTimer(task('器'), 'child', { kind: 'countup' });
        const [timer] = widget.board.values();
        await vi.waitFor(() => expect(timer.tail).not.toBeNull());
        await settle();

        contents.set('notes/b.md', contents.get(FILE)!);
        contents.delete(FILE);
        await s.fireVault('rename', s.app.vault.getAbstractFileByPath('notes/b.md'), FILE);
        widget.handleFileRename(FILE, 'notes/b.md');
        await settle();

        expect(timer.file).toBe('notes/b.md');
        expect(task('器').file).toBe('notes/b.md');
        widget.startTimer(task('器'), 'child', { kind: 'countup' });
        expect(widget.board.values()).toEqual([timer]);
    });

    it('refuses a second timer on the same day, and takes one on another day', () => {
        const widget = widgetOver(s);
        s.ops.putInDailyNote = async () => ({ written: false, refused: null });

        widget.startTimer({ daily: '2026-09-21' }, 'child', { kind: 'countup' });
        widget.startTimer({ daily: '2026-09-21' }, 'child', { kind: 'pomodoro' });
        expect(widget.board.size).toBe(1);
        expect(Notice.messages).toContain(t('timer.alreadyActive'));

        widget.startTimer({ daily: '2026-09-22' }, 'child', { kind: 'countup' });
        expect(widget.board.size).toBe(2);
    });

    it('takes its name from the row its anchor finds, after the row is rewritten', async () => {
        const widget = new TimerWidget(s.app, { ...s.plugin, registerEvent: () => { } } as never);
        widget.render = () => { };
        // 項目は見つかるが、名前欄と見出しは無い器。
        widget.ensureContainer = () => ({ querySelector: () => ({ querySelector: () => null }) }) as unknown as HTMLElement;
        widget.activate();

        widget.startTimer(task('器'), 'child', { kind: 'countup' });
        const [timer] = widget.board.values();
        await vi.waitFor(() => expect(timer.tail).not.toBeNull());
        await settle();
        expect(timer.name).toBe('器');

        // 行を書き換える（行の名前は読み直しで替わる）。
        await s.ops.updateByAnchor(timer.file, 'box', { content: '新しい器' });
        await settle();

        // 索引の変化の知らせはまとめて遅れて届く。
        await vi.waitFor(() => expect(timer.name).toBe('新しい器'));
        widget.destroy();
    });
});
