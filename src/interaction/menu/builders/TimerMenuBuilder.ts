import { Menu } from 'obsidian';
import { Task } from '../../../types';
import TaskViewerPlugin from '../../../main';

/**
 * Timerメニューの構築
 */
export class TimerMenuBuilder {
    constructor(private plugin: TaskViewerPlugin) { }

    /**
     * Timerメニュー項目を追加
     */
    addTimerItem(menu: Menu, task: Task): void {
        menu.addItem((item) => {
            const displayName = task.content.trim()
                || task.file.replace(/\.md$/, '').split('/').pop()
                || 'Untitled';

            item.setTitle('⏱️ Start Timer')
                .setIcon('play')
                .onClick(() => {
                    const widget = this.plugin.getTimerWidget();
                    // recordMode: 'self' = update this task directly, autoStart: true
                    widget.showCountup(task.id, displayName, task.originalText, task.file, 'self', true, task.parserId);
                });
        });
    }
}
