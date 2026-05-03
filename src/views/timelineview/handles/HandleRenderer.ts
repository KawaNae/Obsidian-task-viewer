import { setIcon } from 'obsidian';

export type ResizePosition = 'top' | 'bottom' | 'left' | 'right';
export type MovePosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

/**
 * Handle DOM 生成の共通ユーティリティ。Strategy 各実装はここを呼ぶだけで、
 * 「resize/move/detail の生成方法」自体は 1 箇所に集約される。
 *
 * 生成された要素は `taskEl` に直接 append される。位置決めは CSS が
 * `position: absolute` + edge offset で行うため、生成順は表示順に影響しない。
 */
export const HandleRenderer = {
    createResize(taskEl: HTMLElement, taskId: string, position: ResizePosition, icon: string): void {
        const container = taskEl.createDiv(`task-card__handle task-card__handle--resize-${position}`);
        const btn = container.createDiv('task-card__handle-btn');
        btn.setText(icon);
        btn.dataset.taskId = taskId;
    },

    createMove(taskEl: HTMLElement, taskId: string, position: MovePosition): void {
        const container = taskEl.createDiv(`task-card__handle task-card__handle--move-${position}`);
        const btn = container.createDiv('task-card__handle-btn');
        btn.setText('::');
        btn.dataset.taskId = taskId;
        btn.style.cursor = 'move';
    },

    createDetail(taskEl: HTMLElement, taskId: string): void {
        const container = taskEl.createDiv('task-card__handle task-card__handle--detail');
        const btn = container.createDiv('task-card__handle-btn');
        // setIcon needs a span wrapper for WebKit to render reliably inside
        // an inline-flex button. 'info' (i in a circle) over 'expand' which
        // visually bleeds into the card's top-left corner due to -12px outset.
        setIcon(btn.createSpan(), 'info');
        btn.dataset.taskId = taskId;
        btn.dataset.handleType = 'detail';
        btn.style.cursor = 'pointer';
    },
};
