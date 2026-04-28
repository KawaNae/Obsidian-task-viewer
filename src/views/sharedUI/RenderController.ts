/**
 * View に注入される handler 群。
 * View 側の具体的な render 実装を controller から呼び出すため。
 */
export interface RenderControllerHandlers {
    /** 1 タスクの partial update を試みる。成功すれば true。失敗時は full render に降格 */
    tryPartial: (taskId: string, changes: string[]) => boolean;
    /** ビュー全体の full render */
    performFull: () => void;
    /** pinned list 部分のみリフレッシュ（partial 後に必要なら呼ぶ） */
    refreshPinned: () => void;
}

export type ChangeKeyClassification = 'no-render' | 'layout' | 'safe' | 'other';

/**
 * Keys that change task position on the grid → full render.
 * Source of truth — moved from TimelineView.ts.
 */
const LAYOUT_KEYS = new Set(['startDate', 'startTime', 'endDate', 'endTime', 'due']);
/** Keys safe for partial DOM update (no position change). */
const SAFE_KEYS = new Set(['status', 'statusChar', 'content', 'childLines']);
/** Keys with zero visual effect → skip render entirely. */
const NO_RENDER_KEYS = new Set(['blockId', 'timerTargetId']);

/**
 * View 横断の render ディスパッチコントローラー。
 * onChange イベント → 適切な render 戦略（partial / full / skip）を選択。
 * rAF で full render を coalesce。
 */
export class RenderController {
    private rafId: number | null = null;
    private dirty = false;

    constructor(private handlers: RenderControllerHandlers) {}

    /**
     * TaskIndex の onChange に対応するエントリポイント。
     * taskId / changes に応じて partial or full を判定。
     */
    handleChange(taskId: string | undefined, changes: string[] | undefined): void {
        if (taskId && changes) {
            const classification = this.classifyChanges(changes);

            if (classification === 'no-render') return;

            if (classification === 'safe') {
                const ok = this.handlers.tryPartial(taskId, changes);
                if (ok) {
                    this.handlers.refreshPinned();
                    return;
                }
            }
            // layout / other / partial 失敗 → full render（scheduleRender で coalesce）
        }

        this.scheduleRender();
    }

    /** 任意のタイミングで full render を要求（フィルタ変更など）。rAF で coalesce する。 */
    scheduleRender(): void {
        this.dirty = true;
        if (this.rafId !== null) return;
        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            if (!this.dirty) return;
            this.dirty = false;
            this.handlers.performFull();
        });
    }

    /** rAF をスキップして即座に full render（同 frame 内の二重描画を防ぐため保留中の rAF はキャンセル） */
    performImmediate(): void {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.dirty = false;
        this.handlers.performFull();
    }

    /**
     * 保留中の rAF をキャンセルするだけ（同期 render が呼ばれる直前の用途）。
     * full render 自体は呼び出さない。
     */
    cancelPending(): void {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
            this.dirty = false;
        }
    }

    /** unload 時に呼ぶ */
    dispose(): void {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.dirty = false;
    }

    private classifyChanges(changes: string[]): ChangeKeyClassification {
        if (changes.length === 0) return 'other';

        const allNoRender = changes.every(c => NO_RENDER_KEYS.has(c));
        if (allNoRender) return 'no-render';

        const anyLayout = changes.some(c => LAYOUT_KEYS.has(c));
        if (anyLayout) return 'layout';

        const allSafe = changes.every(c => SAFE_KEYS.has(c));
        if (allSafe) return 'safe';

        return 'other';
    }
}
