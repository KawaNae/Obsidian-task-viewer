import { Task } from '../../types';

/**
 * タッチとマウスイベントの統合処理
 */
export class TouchEventHandler {
    private longPressTimer: NodeJS.Timeout | null = null;
    private longPressThreshold = 500; // ms

    /**
     * タスク要素にコンテキストメニューを追加
     * タッチとマウスイベントを統合処理
     */
    addTaskContextMenu(
        el: HTMLElement,
        task: Task,
        onContextMenu: (x: number, y: number, task: Task) => void
    ): void {
        // Touch events
        el.addEventListener('touchstart', (e) => {
            this.longPressTimer = setTimeout(() => {
                const touch = e.touches[0];
                if (touch) {
                    e.preventDefault();
                    onContextMenu(touch.clientX, touch.clientY, task);
                }
            }, this.longPressThreshold);
        });

        el.addEventListener('touchend', (e) => {
            this.cancelLongPress();
        });

        el.addEventListener('touchmove', (e) => {
            this.cancelLongPress();
        });

        // Mouse context menu
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            onContextMenu(e.clientX, e.clientY, task);
        });
    }

    private cancelLongPress(): void {
        if (this.longPressTimer) {
            clearTimeout(this.longPressTimer);
            this.longPressTimer = null;
        }
    }
}
