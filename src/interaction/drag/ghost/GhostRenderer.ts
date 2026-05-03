import type { GhostPlan } from './GhostPlan';

/**
 * Drag 中の ghost / preview 描画を 1 本化したレンダラ。
 *
 * 旧構成では 3 系統に分かれていた:
 *   - createGhostElement (GhostFactory)  : floating ghost 1 個
 *   - GhostManager                       : Timeline cascade の絶対配置 ghost N 個
 *   - previewGhosts (BaseDragStrategy)   : Calendar/AllDay の grid 内 split preview N 個
 *
 * これらは全て「source card を clone → handle を除去 → layout に合わせて配置 →
 * split-continues 系の class を applied → diff-update で reuse」という同じ
 * フォーマットだった。{@link GhostPlan} を grid/absolute/fixed の union 型として
 * 受け取り、render(plans) 1 本で全ケースを処理する。
 *
 * sourceEl は 1 つの drag セッション中に固定 (drag 開始時の card)。clone の元として
 * 再利用される。
 */
export class GhostRenderer {
    private ghosts: HTMLElement[] = [];

    constructor(
        private readonly sourceEl: HTMLElement,
        /** fixed layout の ghost を append する Document (popout window 対応)。 */
        private readonly doc: Document = document,
    ) {}

    /**
     * plans に従って ghost を再構成。既存 ghost を index 単位で diff-update し、
     * 不足分を新規生成、余剰分は削除する。append/remove を最小化することで
     * drag 中の reflow を抑える。
     */
    render(plans: readonly GhostPlan[]): void {
        const oldCount = this.ghosts.length;
        const newCount = plans.length;

        for (let i = 0; i < Math.min(oldCount, newCount); i++) {
            const ghost = this.ghosts[i];
            const plan = plans[i];
            this.relocate(ghost, plan);
            this.applyPlan(ghost, plan);
        }

        // surplus を削除
        for (let i = newCount; i < oldCount; i++) {
            this.ghosts[i].remove();
        }

        // 不足分を新規生成
        for (let i = oldCount; i < newCount; i++) {
            const plan = plans[i];
            const ghost = this.createGhost();
            this.applyPlan(ghost, plan);
            this.attach(ghost, plan);
            this.ghosts.push(ghost);
        }

        this.ghosts.length = newCount;
    }

    /** 全 ghost を DOM から除去。drag 終了時の cleanup で呼ぶ。 */
    clear(): void {
        for (const g of this.ghosts) g.remove();
        this.ghosts = [];
    }

    /**
     * sourceEl から ghost を派生。handle / selection state は除去し、size/font の
     * inline copy のみ保持。layout 固有の class や positioning は applyPlan で。
     */
    private createGhost(): HTMLElement {
        const ghost = this.sourceEl.cloneNode(true) as HTMLElement;
        ghost.querySelectorAll('.task-card__handle').forEach(h => h.remove());
        ghost.classList.remove('is-selected', 'is-dragging');
        ghost.classList.remove('is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint');
        ghost.style.boxSizing = 'border-box';
        ghost.style.margin = '0';
        ghost.style.overflow = 'hidden';
        ghost.style.display = 'block';
        ghost.style.pointerEvents = 'none';

        // layout 用の padding/font だけ source から継承する
        const computedStyle = this.sourceEl.ownerDocument.defaultView?.getComputedStyle(this.sourceEl);
        ghost.style.padding = computedStyle?.padding || '';
        ghost.style.fontSize = computedStyle?.fontSize || '';
        ghost.style.fontFamily = computedStyle?.fontFamily || '';
        ghost.style.color = computedStyle?.color || '';

        return ghost;
    }

    /**
     * 既存 ghost の親が plan.parent と異なる場合に reparent する (grid/absolute のみ)。
     * fixed は body 直下なので reparent 不要。
     */
    private relocate(ghost: HTMLElement, plan: GhostPlan): void {
        if (plan.layout === 'fixed') return;
        if (ghost.parentElement !== plan.parent) {
            plan.parent.appendChild(ghost);
        }
    }

    /** plan に従って position/size class を反映。 */
    private applyPlan(ghost: HTMLElement, plan: GhostPlan): void {
        // split-continues class を一旦剥がしてから plan の指定を適用
        ghost.classList.remove('task-card--split-continues-before', 'task-card--split-continues-after');
        for (const cls of plan.splitClasses) ghost.classList.add(cls);

        switch (plan.layout) {
            case 'grid':
                ghost.classList.add('task-card--drag-preview');
                ghost.classList.remove('task-card--drag-ghost');
                ghost.style.position = '';
                ghost.style.gridColumn = plan.gridColumn;
                ghost.style.gridRow = plan.gridRow;
                ghost.style.left = '';
                ghost.style.top = '';
                ghost.style.width = '';
                ghost.style.height = '';
                ghost.style.zIndex = '1001';
                ghost.style.transform = '';
                break;
            case 'absolute':
                ghost.classList.add('task-card--drag-ghost');
                ghost.classList.remove('task-card--drag-preview');
                ghost.style.position = 'absolute';
                ghost.style.gridColumn = '';
                ghost.style.gridRow = '';
                ghost.style.left = `${plan.left}px`;
                ghost.style.top = `${plan.top}px`;
                ghost.style.width = `${plan.width}px`;
                ghost.style.height = `${plan.height}px`;
                ghost.style.zIndex = 'var(--z-task-card-drag-ghost, 9999)';
                break;
            case 'fixed':
                ghost.classList.add('task-card--drag-ghost');
                ghost.classList.remove('task-card--drag-preview');
                ghost.style.position = 'fixed';
                ghost.style.gridColumn = '';
                ghost.style.gridRow = '';
                ghost.style.left = `${plan.left}px`;
                ghost.style.top = `${plan.top}px`;
                ghost.style.width = `${plan.width}px`;
                ghost.style.height = `${plan.height}px`;
                ghost.style.zIndex = 'var(--z-task-card-drag-ghost, 9999)';
                break;
        }
    }

    /** 新規 ghost を初期挿入する。 */
    private attach(ghost: HTMLElement, plan: GhostPlan): void {
        if (plan.layout === 'fixed') {
            this.doc.body.appendChild(ghost);
        } else {
            plan.parent.appendChild(ghost);
        }
    }
}
