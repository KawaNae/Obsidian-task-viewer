import type { DragStrategy, DragContext } from '../DragStrategy';
import { DropReveal } from '../DropReveal';
import type { Task } from '../../../types';
import { materializeRawDates, NO_TASK_LOOKUP, toDisplayTask } from '../../../services/display/DisplayTaskConverter';
import { getTaskDateRange } from '../../../services/display/VisualDateRange';
import type { DragPlan } from '../DragPlan';

/**
 * ドラッグストラテジーの基底クラス。
 * 共通の lifecycle / commit / utility を提供する。Ghost 描画は各 Gesture が
 * 自前で {@link GhostRenderer} を保持して行う (旧 updateSplitPreview /
 * previewGhosts は廃止)。
 */
export abstract class BaseDragStrategy implements DragStrategy {
    abstract name: string;

    // 共通プロパティ
    protected dragTask: Task | null = null;
    protected dragEl: HTMLElement | null = null;
    /** ドロップ確定時の再可視化ゲート。1 drag = 1 Strategy インスタンス。 */
    protected readonly dropReveal = new DropReveal();
    protected lastHighlighted: HTMLElement | null = null;
    protected hasMoved: boolean = false;
    protected currentContext: DragContext | null = null;

    // ビュータイプ（Timeline or AllDay or Calendar）
    protected viewType: 'timeline' | 'allday' | 'calendar' = 'timeline';

    // Grid 系 Gesture (Move/Resize) のみ使用。
    /** Calendar / AllDay どちらの Surface か。due-arrow・cross-view drop など
     *  AllDay 限定の機能がこのフラグで分岐する。 */
    protected isAllDay: boolean = false;
    /** due-arrow 検索対象のコンテナ (AllDay: week-row 要素 / Calendar: drag container)。 */
    protected container: HTMLElement | null = null;

    // 初期位置
    protected initialX: number = 0;
    protected initialY: number = 0;

    // 抽象メソッド
    abstract onDown(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext): void;
    abstract onMove(e: PointerEvent, context: DragContext): void;
    abstract onUp(e: PointerEvent, context: DragContext): Promise<void>;

    /**
     * ハイライトをクリアする
     */
    protected clearHighlight(): void {
        if (this.lastHighlighted) {
            this.lastHighlighted.removeClass('drag-over');
            this.lastHighlighted = null;
        }
    }

    /**
     * 選択状態を復元する
     */
    protected restoreSelection(context: DragContext, taskId: string): void {
        context.onTaskClick(taskId);
    }

    /**
     * 1 回の drag 完了で生じる write-back を 1 経路に集約。
     *
     * - `plan === null` → 変更なし、early return
     * - そうでなければ visual edits を `materializeRawDates` で raw に変換し、
     *   baseTask との diff だけを `updateTask` に渡す
     * - 書き戻しの後に selection を復元する（segment id が drag で再生成
     *   されるため、再 render 後にも同じ task が selected であるよう保証）
     *
     * 各 finish は visual edits の組み立てに専念し、raw `Partial<Task>` を
     * 直接作らない。これにより endDate inclusive/exclusive の dual semantic を
     * 1 箇所（materializeRawDates）に閉じ込める。
     *
     * @returns 実際に書き戻したか。false は「掴んだが値は変わっていない」＝
     *          ソースカードの旧ジオメトリがそのまま正しい、を意味する
     *          （{@link commitAndReveal} の再可視化判断に使う）。
     */
    protected async commitPlan(context: DragContext, plan: DragPlan | null, taskId: string): Promise<boolean> {
        if (!plan) return false;
        const { edits, baseTask } = plan;
        const startHour = context.plugin.settings.startHour;
        const updates = this.diffUpdates(materializeRawDates(edits, baseTask, startHour), baseTask);
        if (Object.keys(updates).length === 0) return false;
        await context.writeService.updateTask(taskId, updates);
        this.restoreSelection(context, taskId);
        return true;
    }

    /**
     * ドロップ確定の唯一の入口。commit → 確定ジオメトリ反映 → 再可視化 →
     * ghost 撤去 の順序を **await を挟まない 1 ブロック** で固定する。
     *
     * この順序が {@link DropReveal} の不変条件（旧ジオメトリのソースカードが
     * 可視なフレームを作らない）の本体。ゲスチャ側の暗黙知にすると、過去
     * d97e38b のように別のリファクタで静かに壊れる — 壊れたときに落ちるのが
     * ここ 1 箇所になるよう API 境界に束ねている。
     *
     * `applyGeometry` は commit した値でソースカードを描き直し、描き直せた
     * 要素を {@link DropReveal.markApplied} する責務を持つ。反映できなかった
     * 要素は隠したまま次 render に委ねられる。
     *
     * 書き戻しが起きなかったとき（plan なし / 値が変わっていない）は旧ジオメトリ
     * がそのまま正しいので、ゲートを立てずに全要素を可視へ戻す。ここを取り違えると
     * 「render が来ないので永久に隠れたまま」の逆バグになる。
     */
    protected async commitAndReveal(params: {
        context: DragContext;
        plan: DragPlan | null;
        taskId: string;
        /** drag 中に隠した/淡くした全ソース要素。 */
        sourceElements: readonly HTMLElement[];
        applyGeometry: () => void;
        clearGhosts: () => void;
    }): Promise<void> {
        const { context, plan, taskId, sourceElements, applyGeometry, clearGhosts } = params;
        const wrote = await this.commitPlan(context, plan, taskId);

        // ---- ここから paint を挟まない。順序を入れ替えないこと ----
        if (wrote) {
            this.dropReveal.gate();
            applyGeometry();
        }
        this.dropReveal.finish(sourceElements);
        clearGhosts();
    }

    /**
     * baseTask と既に同じ値のキーを除外する。drag 完了時に「掴んだだけで
     * 値は変わっていない」フィールドを送らないための薄いヘルパー。
     */
    private diffUpdates(updates: Partial<Task>, baseTask: Task): Partial<Task> {
        const result: Partial<Task> = {};
        const u = updates as unknown as Record<string, unknown>;
        const b = baseTask as unknown as Record<string, unknown>;
        for (const key of Object.keys(u)) {
            if (u[key] !== b[key]) {
                (result as unknown as Record<string, unknown>)[key] = u[key];
            }
        }
        return result;
    }

    /**
     * ドラッグ状態をクリーンアップする
     */
    /** Abort the gesture without committing (pointercancel / lost capture). */
    onCancel(): void {
        this.cleanup();
    }

    protected cleanup(): void {
        this.clearHighlight();

        if (this.dragEl) {
            // 再可視化は DropReveal のゲート越し。commit したのに確定ジオメトリを
            // 反映できなかった要素はここでも隠したままにする。
            this.dropReveal.finish([this.dragEl]);
            this.dragEl.style.transform = '';
            // inline z は decorateLane が所有する lane z。可視に戻す要素では
            // 消さない（1 フレームだけ重なり順が崩れるのを避ける）。隠したまま
            // の要素は次 render で作り直されるのでどちらでもよい。
            if (!this.dropReveal.isRevealable(this.dragEl)) {
                this.dragEl.style.zIndex = '';
            }
        }

        this.dragTask = null;
        this.dragEl = null;
        this.currentContext = null;
        this.hasMoved = false;
    }

    /**
     * ビュータイプを判定する（要素の親コンテナから）
     */
    protected determineViewType(el: HTMLElement): 'timeline' | 'allday' | 'calendar' {
        if (el.closest('.cal-week-row')) {
            return 'calendar';
        }
        if (el.closest('.timeline-scroll-area__day-column')) {
            return 'timeline';
        }
        if (el.closest('.allday-section')) {
            return 'allday';
        }
        return 'timeline'; // デフォルト
    }

    /**
     * 移動閾値チェック
     */
    protected checkMoveThreshold(deltaX: number, deltaY: number, threshold: number = 5): boolean {
        if (this.hasMoved) return true;
        if (Math.abs(deltaX) >= threshold || Math.abs(deltaY) >= threshold) {
            this.hasMoved = true;
            return true;
        }
        return false;
    }

    /**
     * Compute inclusive visual date range for a task, matching the renderer's logic.
     */
    protected getVisualDateRange(task: Task, startHour: number): { start: string; end: string } {
        // Date range only depends on the task's own dates; childEntries are irrelevant.
        const dt = toDisplayTask(task, startHour, NO_TASK_LOOKUP);
        const range = getTaskDateRange(dt, startHour);
        const start = range.effectiveStart || task.startDate || '';
        const end = range.effectiveEnd || start;
        return { start, end };
    }

    /**
     * Split segments (siblings sharing `originalId`) currently rendered for
     * this task, outside the pinned-list sidebar. Collected on drag start so
     * they can be hidden together with the grabbed element.
     */
    protected collectSplitSiblings(context: DragContext, originalId: string): HTMLElement[] {
        const selector = `.task-card[data-id="${originalId}"], .task-card[data-split-original-id="${originalId}"]`;
        const siblings: HTMLElement[] = [];
        context.container.querySelectorAll(selector).forEach(segment => {
            if (segment instanceof HTMLElement && !segment.closest('.tv-sidebar__pinned-lists')) {
                siblings.push(segment);
            }
        });
        return siblings;
    }

    /** AllDay の due-arrow 位置更新 (Calendar では .due-arrow が無いので no-op)。Grid 系 Gesture 専用。 */
    protected updateArrowPosition(taskEndGridLine: number): void {
        if (!this.isAllDay) return;
        if (!this.dragEl?.dataset.id || !this.container) return;
        const taskId = this.dragEl.dataset.id;
        const arrow = this.container.querySelector(`.due-arrow[data-task-id="${taskId}"]`) as HTMLElement;
        if (arrow) {
            arrow.style.gridColumnStart = taskEndGridLine.toString();
            const arrowEnd = parseInt(arrow.style.gridColumnEnd) || 0;
            arrow.style.display = taskEndGridLine >= arrowEnd ? 'none' : '';
        }
    }
}
