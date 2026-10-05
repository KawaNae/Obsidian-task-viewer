import { describe, it, expect, afterEach, vi } from 'vitest';
import { TimerWidget } from '../../../src/timer/TimerWidget';
import { DEFAULT_SETTINGS } from '../../../src/types';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';

/**
 * widget の表示は索引の読みから作り、索引が変わるたびに描き直す。tick は時間の
 * 表示だけを進める。
 *
 * 再読み込みのあと、走っていない widget（中断中と記録待ち）の名前欄も、最初の
 * スキャンが済めば尻尾の行の名前になる。復元の描画は最初のスキャンの前に走り、
 * 止まっている widget には時間の表示を進める tick しか来ないので、名前欄を合わせ
 * 直すのは索引の変化（`refreshFromIndex`）である。
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

/** 名前欄だけを持つ widget の DOM の代わり。 */
function fakeContainer() {
    const inputs = new Map<string, { value: string; scrollHeight: number; style: Record<string, string>; ownerDocument: { activeElement: null } }>();
    const inputOf = (timerId: string) => inputs.get(timerId)
        ?? inputs.set(timerId, { value: '', scrollHeight: 0, style: {}, ownerDocument: { activeElement: null } }).get(timerId)!;
    const container = {
        querySelector: (selector: string) => {
            const id = /data-timer-id="([^"]+)"/.exec(selector)?.[1];
            if (!id) return null;
            return {
                querySelector: (inner: string) => (inner === '.timer-widget__title-input' ? inputOf(id) : null),
            };
        },
    };
    return { container: container as unknown as HTMLElement, inputOf };
}

/** vaultSession の上の、実物の TimerWidget。描画の器だけは置き換える。 */
function widgetOver(s: VaultSession) {
    Object.assign(s.app.vault, { getName: () => 'test-vault' });
    const plugin = {
        settings: { ...DEFAULT_SETTINGS },
        getIndex: () => s.index,
        getOperations: () => s.ops,
        registerEvent: () => { },
    };
    const widget = new TimerWidget(s.app, plugin as never);
    const dom = fakeContainer();
    widget.render = () => { };
    widget.ensureContainer = () => dom.container;
    return { widget, inputOf: dom.inputOf };
}

async function settleAll(s: VaultSession) {
    for (let i = 0; i < 3; i++) {
        await new Promise(r => setTimeout(r, 0));
        await s.settle(FILE);
    }
}

describe('a restored widget that is not running takes its name from the index once it is read', () => {
    afterEach(() => vi.useRealTimers());

    it('suspended, then a reload: the name field is empty before the first scan and the tail\'s name after it', async () => {
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
        expect(w2.inputOf(restored.id).value).toBe('');

        await s.scanAll();
        await vi.waitFor(() => expect(w2.inputOf(restored.id).value).toBe('設計メモ'));
        s.dispose();
    });
});
