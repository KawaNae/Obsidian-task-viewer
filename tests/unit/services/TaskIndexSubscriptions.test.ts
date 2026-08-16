import { describe, it, expect } from 'vitest';
import { TaskIndex } from '../../../src/services/core/TaskIndex';
import { DEFAULT_SETTINGS } from '../../../src/types';

/**
 * 開いた購読は、閉じるときに全部閉じる。
 *
 * 本数ではなく対称性を固定する。件数を書くと、5 本目の購読が素の on(...) で
 * 足された日にテストを直して終わりになるが、対称性なら「閉じ忘れ」そのものが
 * 落ちる。閉じ忘れの実害は、旧インスタンスの検出器と実行器がイベントを受け
 * 続けること、つまり 1 回の完了が世代を 2 つ生むことである。
 */
class FakeEmitter {
    readonly opened: unknown[] = [];
    readonly closed: unknown[] = [];

    on(name: string, _fn: unknown): unknown {
        const ref = { name, id: this.opened.length };
        this.opened.push(ref);
        return ref;
    }

    offref(ref: unknown): void {
        this.closed.push(ref);
    }

    /** 開いたまま残っている購読。 */
    leaked(): unknown[] {
        return this.opened.filter(ref => !this.closed.includes(ref));
    }
}

function makeApp() {
    const vault = new FakeEmitter();
    const metadataCache = new FakeEmitter();
    const workspace = new FakeEmitter();
    const app = {
        vault: Object.assign(vault, {
            getAbstractFileByPath: () => null,
            getMarkdownFiles: () => [],
        }),
        metadataCache: Object.assign(metadataCache, {
            getCache: () => null,
        }),
        workspace: Object.assign(workspace, {
            // レイアウト準備のコールバックは呼ばない。初回スキャンはこのテストの
            // 対象ではなく、呼ぶと vault 全体を読みに行く。
            onLayoutReady: () => { },
            activeLeaf: null,
        }),
    };
    return { app, vault, metadataCache, workspace };
}

describe('what the index subscribes to, and what it lets go of', () => {
    it('closes every subscription it opened', async () => {
        const { app, vault, metadataCache, workspace } = makeApp();
        const index = new TaskIndex(app as never, { ...DEFAULT_SETTINGS });

        await index.initialize();
        expect(vault.opened.length + metadataCache.opened.length + workspace.opened.length)
            .toBeGreaterThan(0);

        index.dispose();

        expect({
            vault: vault.leaked(),
            metadataCache: metadataCache.leaked(),
            workspace: workspace.leaked(),
        }).toEqual({ vault: [], metadataCache: [], workspace: [] });
    });

    it('can be disposed twice without closing anything twice', () => {
        // アンロードの経路は 1 本とは限らない。二度目が例外を投げたり、他人の
        // 購読を閉じたりしないことまでが「閉じ方」の仕様になる。
        const { app, vault } = makeApp();
        const index = new TaskIndex(app as never, { ...DEFAULT_SETTINGS });

        index.dispose();
        index.dispose();

        expect(vault.closed).toEqual([]);
    });
});
