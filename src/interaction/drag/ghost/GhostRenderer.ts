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
     * sourceEl から ghost を派生。inline style は一切注入せず、source 由来の
     * transient state class のみ剥がす。視覚スタイル (opacity / shadow / handle
     * 抑止 / 選択枠 / split sawtooth padding / margin / display) はすべて
     * `task-card--ghost` 系クラス経由の CSS cascade に委ねる。
     *
     * `is-selected` は意図的に残す: clone が source の選択状態を継いで
     * `__shape::after` の選択枠を自動描画するため。`is-dragging` /
     * `is-drag-hidden` / `is-drag-source-*` は source 側の transient state
     * なので ghost には不要。
     */
    private createGhost(): HTMLElement {
        const ghost = this.sourceEl.cloneNode(true) as HTMLElement;
        ghost.classList.remove(
            'is-dragging',
            'is-drag-hidden',
            'is-drag-source-dimmed',
            'is-drag-source-faint',
        );
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

    /**
     * plan に従って position/size と layout 軸クラスを反映。視覚スタイルは
     * CSS の `.task-card--ghost` / `.task-card--ghost-grid` /
     * `.task-card--ghost-positioned` に委ねる。z-index も CSS 側に置くため
     * inline では設定しない。
     */
    private applyPlan(ghost: HTMLElement, plan: GhostPlan): void {
        ghost.classList.remove(
            'task-card--split-continues-before',
            'task-card--split-continues-after',
        );
        for (const cls of plan.splitClasses) ghost.classList.add(cls);

        ghost.classList.add('task-card--ghost');

        if (plan.layout === 'grid') {
            ghost.classList.add('task-card--ghost-grid');
            ghost.classList.remove('task-card--ghost-positioned');
            ghost.style.position = '';
            ghost.style.left = '';
            ghost.style.top = '';
            ghost.style.transform = '';
            ghost.style.width = '';
            ghost.style.height = '';
            ghost.style.gridColumn = plan.gridColumn;
            ghost.style.gridRow = plan.gridRow;
        } else {
            ghost.classList.add('task-card--ghost-positioned');
            ghost.classList.remove('task-card--ghost-grid');
            ghost.style.gridColumn = '';
            ghost.style.gridRow = '';
            ghost.style.position = plan.layout;
            // Position via transform: translate ではなく top/left を使うと、
            // top/left の更新は layout reflow を毎フレーム発生させ、will-change
            // hint と挙動も不整合になる（hint が transform でも実際は layout
            // animation）。anchor を 0,0 に固定し offset を transform で与える
            // ことで GPU compositor layer を維持し、iPad WebKit の handle trail
            // 現象を防ぐ。
            ghost.style.left = '0px';
            ghost.style.top = '0px';
            ghost.style.transform = `translate(${plan.left}px, ${plan.top}px)`;
            ghost.style.width = `${plan.width}px`;
            ghost.style.height = `${plan.height}px`;
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
