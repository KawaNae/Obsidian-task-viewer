import { describe, it, expect, afterEach, vi } from 'vitest';
import { TimerWidget } from '../../../src/timer/TimerWidget';
import { DEFAULT_SETTINGS } from '../../../src/types';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import { FakeEl } from '../helpers/fakeEl';
import type { TimerTitle } from '../../../src/timer/TimerTitle';

vi.mock('../../../src/views/taskcard/CardMarkdown', async () => {
    const { drawMarkdown } = await import('../helpers/fakeEl');
    return { renderCardMarkdown: drawMarkdown };
});

/**
 * widget の表示は索引の読みから作り、索引が変わるたびに描き直す。tick は時間の
 * 表示だけを進める。
 *
 * 見出しの名前は尻尾の行の名前で、索引がその行を持つ間だけハブを開くボタンになる。
 * 開始の書き込みが返る前と、再読み込みのあとの最初のスキャンの前は、対象の名前の
 * 写しを出すただの文字で、書き込みかスキャンの後の索引の変化でボタンになる。行を
 * 消されれば、次の索引の変化でただの文字に戻る。止まっている widget には時間の表示を
 * 進める tick しか来ないので、名前を合わせ直すのは索引の変化（`refreshFromIndex`）である。
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
const FILE = 'notes/a.md';
const at = (h: number, m: number) => new Date(2026, 8, 21, h, m, 0);

/**
 * 見出しの名前だけを持つ widget の DOM の代わり。組み直しは描かないので、名前は
 * 見出しを組むときと同じ手（`mount`）で、初めて引かれたときに置く。
 */
function fakeContainer(mount: (titleEl: FakeEl, timerId: string) => void) {
    const titles = new Map<string, FakeEl>();
    const titleOf = (timerId: string): FakeEl => {
        let title = titles.get(timerId);
        if (!title) {
            title = new FakeEl('timer-widget__title');
            titles.set(timerId, title);
            mount(title, timerId);
        }
        return title;
    };
    const container = {
        querySelector: (selector: string) => {
            const id = /data-timer-id="([^"]+)"/.exec(selector)?.[1];
            if (!id) return null;
            return {
                querySelector: (inner: string) => (inner === '.timer-widget__title' ? titleOf(id) : null),
            };
        },
    };
    const nameOf = (timerId: string): FakeEl => titleOf(timerId).querySelector('.timer-widget__title-name--row')!;
    return { container: container as unknown as HTMLElement, nameOf };
}

/** vaultSession の上の、実物の TimerWidget。描画の器だけは置き換える。 */
function widgetOver(s: VaultSession) {
    Object.assign(s.app.vault, { getName: () => 'test-vault' });
    const opened: string[] = [];
    const plugin = {
        settings: { ...DEFAULT_SETTINGS },
        getIndex: () => s.index,
        getOperations: () => s.ops,
        registerEvent: () => { },
        openTaskHub: (taskId: string) => { opened.push(taskId); },
    };
    const widget = new TimerWidget(s.app, plugin as never);
    const title = (widget as unknown as { renderer: { title: TimerTitle } }).renderer.title;
    const dom = fakeContainer((titleEl, timerId) => title.mount(titleEl as unknown as HTMLElement, widget.board.get(timerId)!));
    widget.render = () => { };
    widget.ensureContainer = () => dom.container;
    return { widget, nameOf: dom.nameOf, opened };
}

async function settleAll(s: VaultSession) {
    for (let i = 0; i < 3; i++) {
        await new Promise(r => setTimeout(r, 0));
        await s.settle(FILE);
    }
}

const isButton = (name: FakeEl): boolean => name.getAttribute('role') === 'button';

describe('a restored widget that is not running takes its name from the index once it is read', () => {
    afterEach(() => vi.useRealTimers());

    it('suspended, then a reload: before the first scan the name is the subject\'s, not a button; after it the tail\'s, a button to its hub', async () => {
        store.clear();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(at(9, 0));
        const contents = new Map([[FILE, ['- [ ] 設計メモ @2026-09-21', '- [ ] 下のタスク @2026-09-21', ''].join('\n')]]);

        // 1 回目: 始めて、中断する。
        const first = vaultSession(contents);
        await first.scanAll();
        const w1 = widgetOver(first);
        const target = first.index.getTasks().find(t => t.content === '設計メモ')!;
        w1.widget.startTimer(target, 'child', { kind: 'countup' });
        const [timer] = w1.widget.board.values();
        await vi.waitFor(() => expect(timer.tail).not.toBeNull());
        await settleAll(first);
        vi.setSystemTime(at(9, 10));
        await w1.widget.lifecycle.stop(timer, 'suspend');
        await settleAll(first);
        expect(timer.session).toEqual({ kind: 'suspended' });
        w1.widget.board.flush();
        first.dispose();

        // 再読み込み: 復元は最初のスキャンの前に走る。
        const s = vaultSession(contents);
        const w2 = widgetOver(s);
        w2.widget.activate();
        const restored = w2.widget.board.get(timer.id)!;
        expect(restored.session).toEqual({ kind: 'suspended' });
        const name = w2.nameOf(restored.id);
        (w2.widget as unknown as { renderer: { refreshFromIndex(): void } }).renderer.refreshFromIndex();
        expect(isButton(name)).toBe(false);
        expect(name.textContent).toBe('設計メモ');

        await s.scanAll();
        await vi.waitFor(() => expect(isButton(name)).toBe(true));
        expect(name.textContent.trim()).toBe('設計メモ');
        name.dispatch('click');
        expect(w2.opened).toEqual([s.index.getTaskByAnchor(FILE, restored.tail!)!.id]);
        s.dispose();
    });
});

describe('a started widget has its name as a button once its first line is read, and loses it with the row', () => {
    afterEach(() => vi.useRealTimers());

    it('child: plain before the start write is back, the running line\'s name as a button after, plain again once the line is deleted', async () => {
        store.clear();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(at(9, 0));
        const contents = new Map([[FILE, ['- [ ] 設計メモ @2026-09-21', ''].join('\n')]]);
        const s = vaultSession(contents);
        await s.scanAll();
        const w = widgetOver(s);
        w.widget.activate();
        const target = s.index.getTasks().find(t => t.content === '設計メモ')!;

        w.widget.startTimer(target, 'child', { kind: 'countup' });
        const [timer] = w.widget.board.values();
        const name = w.nameOf(timer.id);
        (w.widget as unknown as { renderer: { refreshFromIndex(): void } }).renderer.refreshFromIndex();
        expect(timer.tail).toBeNull();
        expect(isButton(name)).toBe(false);
        expect(name.textContent).toBe('設計メモ');

        await vi.waitFor(() => expect(timer.tail).not.toBeNull());
        await settleAll(s);
        await vi.waitFor(() => expect(isButton(name)).toBe(true));
        const running = s.index.getTaskByAnchor(FILE, timer.tail!)!;
        expect(running.id).not.toBe(target.id);
        name.dispatch('keydown', { key: 'Enter' });
        expect(w.opened).toEqual([running.id]);

        expect(await s.ops.deleteTask(running.id)).toBe(true);
        await settleAll(s);
        await vi.waitFor(() => expect(isButton(name)).toBe(false));
        expect(name.textContent).toBe('設計メモ');
        s.dispose();
    });
});
