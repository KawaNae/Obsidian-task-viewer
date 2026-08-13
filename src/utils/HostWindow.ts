/**
 * View の DOM を駆動するフレームクロックを **その DOM が属する window** に束ねる
 * ためのプリミティブ。
 *
 * 素の `requestAnimationFrame` はプラグインコードが評価された realm ＝ main
 * window のクロックを指す。popout window の view がこれを使うと:
 *   - popout は自分の compositor で独立に paint するため、DOM 更新と paint の
 *     順序保証が失われる（ドロップ時の旧位置フラッシュの直接原因）
 *   - main window が最小化されると main の rAF が停止し、popout の render が
 *     一切走らなくなる
 *
 * 正しい host は `node.ownerDocument.defaultView`。既に PopoverShell /
 * OverlayShell / FloatingOverlayHost / ExportService はこの解決を行っており、
 * ここはその作法を view 寿命のスケジューラに一般化したもの。
 */

/** `Node.DOCUMENT_NODE`。`Node` グローバルの無い環境 (unit test) でも参照できるよう即値で持つ。 */
const DOCUMENT_NODE = 9;

/**
 * `node` が属する window を返す。Document を渡してもよい。解決できない
 * (未接続ノード等) 場合は現在の realm の window にフォールバックする。
 */
export function hostWindow(node: Node | null | undefined): Window {
    const doc = !node
        ? null
        : node.nodeType === DOCUMENT_NODE
            ? (node as Document)
            : node.ownerDocument;
    // プラグイン実行時は realm の window が必ず存在する。DOM 非依存の unit test
    // では host 側が defaultView を提供するため、この分岐には到達しない。
    return (doc?.defaultView as Window | null) ?? (globalThis.window as Window);
}

/** 内部で保持する 1 件のスケジュール。cancel は必ず発行元 window に対して行う。 */
interface PendingFrame {
    win: Window;
    rafId: number;
}

/**
 * host 要素の window に束ねた rAF スケジューラ。
 *
 * 設計上の要点:
 *  - **host は毎回解決する**。Obsidian の leaf は main ↔ popout 間を移動できる
 *    ため、コンストラクト時に window を固定すると移動後に古い window の
 *    クロックを掴んだままになる。
 *  - **cancel は発行元 window に対して行う**。rAF の id は window ごとの連番で
 *    衝突しうるので、外部には自前のトークンを返し、内部で (window, rafId) を
 *    保持する。
 *  - **dispose() で未発火をすべて取り消す**。view の unload 後にコールバックが
 *    走って detached な DOM を触る事故を防ぐ。
 */
export class HostFrameScheduler {
    private readonly pending = new Map<number, PendingFrame>();
    private seq = 0;

    constructor(private readonly getHost: () => Node | null) {}

    /** 次フレームで `cb` を実行する。戻り値は {@link cancel} に渡すトークン。 */
    request(cb: () => void): number {
        return this.schedule(1, cb);
    }

    /**
     * `frames` フレーム後に `cb` を 1 回実行する。多段 rAF (レイアウト沈静化を
     * 待つ「last write wins」パターン) を 1 トークンで扱うための入口。
     */
    after(frames: number, cb: () => void): number {
        return this.schedule(Math.max(1, Math.floor(frames)), cb);
    }

    /** 未発火のスケジュールを取り消す。発火済み / 未知のトークンは no-op。 */
    cancel(token: number): void {
        const entry = this.pending.get(token);
        if (!entry) return;
        this.pending.delete(token);
        entry.win.cancelAnimationFrame(entry.rafId);
    }

    /** 未発火のスケジュールが 1 件でもあるか。 */
    hasPending(): boolean {
        return this.pending.size > 0;
    }

    /** 未発火のスケジュールをすべて取り消す。view の unload / detach で呼ぶ。 */
    dispose(): void {
        for (const token of [...this.pending.keys()]) {
            this.cancel(token);
        }
    }

    private schedule(frames: number, cb: () => void): number {
        const token = ++this.seq;
        const step = (remaining: number): void => {
            // 毎ホップで host を解決し直す。チェーンの途中で leaf が別 window へ
            // 移っても、以後のフレームは移動先のクロックに乗る。
            const win = hostWindow(this.getHost());
            const rafId = win.requestAnimationFrame(() => {
                if (!this.pending.has(token)) return; // 発火直前に cancel された
                if (remaining <= 1) {
                    this.pending.delete(token);
                    cb();
                    return;
                }
                step(remaining - 1);
            });
            this.pending.set(token, { win, rafId });
        };
        step(frames);
        return token;
    }
}
