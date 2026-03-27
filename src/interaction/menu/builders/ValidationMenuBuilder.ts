import { Menu } from 'obsidian';
import { Task } from '../../../types';

export class ValidationMenuBuilder {
    addValidationWarning(menu: Menu, task: Task): void {
        if (!task.validation) return;

        const icon = task.validation.severity === 'error'
            ? 'alert-circle'
            : 'alert-triangle';
        const cssClass = task.validation.severity === 'error'
            ? 'tv-menu-validation-error'
            : 'tv-menu-validation-warning';

        menu.addItem((item) => {
            item.setTitle(task.validation!.message)
                .setIcon(icon)
                .setDisabled(true);
            if (item.dom) {
                item.dom.addClass(cssClass);
            }
        });
        if (task.validation.hint) {
            menu.addItem((item) => {
                item.setTitle(task.validation!.hint)
                    .setIcon('lightbulb')
                    .setDisabled(true);
                if (item.dom) {
                    item.dom.addClass(cssClass);
                }
            });
        }
        menu.addSeparator();
    }
}
