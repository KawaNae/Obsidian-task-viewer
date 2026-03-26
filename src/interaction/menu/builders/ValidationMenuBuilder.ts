import { Menu } from 'obsidian';
import { Task } from '../../../types';

export class ValidationMenuBuilder {
    addValidationWarning(menu: Menu, task: Task): void {
        if (!task.validationWarning) return;
        menu.addItem((item) => {
            item.setTitle(task.validationWarning!)
                .setIcon('alert-triangle')
                .setDisabled(true);
            if (item.dom) {
                item.dom.addClass('tv-menu-validation-warning');
            }
        });
        if (task.validationHint) {
            menu.addItem((item) => {
                item.setTitle(task.validationHint!)
                    .setIcon('lightbulb')
                    .setDisabled(true);
                if (item.dom) {
                    item.dom.addClass('tv-menu-validation-warning');
                }
            });
        }
        menu.addSeparator();
    }
}
