export type ResizePosition = 'top' | 'bottom' | 'left' | 'right';
export type MovePosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

/**
 * Handle DOM 生成の共通ユーティリティ。Strategy 各実装はここを呼ぶだけで、
 * 「resize/move の生成方法」自体は 1 箇所に集約される。
 *
 * 生成された要素は `taskEl` に直接 append される。位置決めは CSS が
 * `position: absolute` + edge offset で行うため、生成順は表示順に影響しない。
 *
 * handle はタスクの名前を持たない。drag はつかんだ handle のカードから名前を
 * 読む（`DragRouter`）。カードは読み直しをまたいで残るので、handle に刻んだ
 * 名前は古くなりうる。
 */
export const HandleRenderer = {
    createResize(taskEl: HTMLElement, position: ResizePosition, icon: string): void {
        const container = taskEl.createDiv(`task-card__handle task-card__handle--resize-${position}`);
        const btn = container.createDiv('task-card__handle-btn');
        btn.setText(icon);
    },

    createMove(taskEl: HTMLElement, position: MovePosition): void {
        const container = taskEl.createDiv(`task-card__handle task-card__handle--move-${position}`);
        const btn = container.createDiv('task-card__handle-btn');
        btn.setText('::');
        btn.style.cursor = 'move';
    },
};
