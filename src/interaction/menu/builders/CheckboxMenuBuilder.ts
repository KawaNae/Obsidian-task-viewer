import type { Menu } from 'obsidian';
import type { StatusDefinition, TaskViewerSettings } from '../../../types';
import { addStatusItems } from '../../../constants/statusOptions';
import { TaskLineClassifier } from '../../../services/parsing/utils/TaskLineClassifier';
import { t } from '../../../i18n';

/**
 * The editor's writes to one line. Each answers whether it was written; a
 * write that was not has told the user why (see `Operations.reportRefusal`).
 */
export interface CheckboxLineOps {
    updateLine(newContent: string): Promise<boolean>;
    insertLineAfter(content: string): Promise<boolean>;
    deleteLine(): Promise<boolean>;
}

/**
 * The editor's menu for a checkbox line the index does not read: one in a
 * note out of the read range, or one typed and not read yet (`lineMenuOf`
 * `'checkbox'`). Agnostic to the mutation backend — callers provide
 * CheckboxLineOps for the line's writes.
 */
export class CheckboxMenuBuilder {
    /**
     * Build the menu for a plain checkbox line: its status, a duplicate, and
     * a delete.
     */
    addFullMenu(menu: Menu, lineText: string, settings: TaskViewerSettings, ops: CheckboxLineOps): boolean {
        const classified = TaskLineClassifier.classify(lineText);
        if (!classified) return false;

        // Status submenu
        if (settings.enableStatusMenu) {
            this.addStatusSubmenu(menu, classified.prefix, classified.suffix, classified.statusChar, settings.statusDefinitions, ops);
            menu.addSeparator();
        }

        // Duplicate
        this.addDuplicateItem(menu, lineText, ops);

        // Delete
        this.addDeleteItem(menu, ops);

        return true;
    }

    private addStatusSubmenu(
        menu: Menu,
        prefix: string,
        suffix: string,
        currentChar: string,
        statusMenuChars: StatusDefinition[],
        ops: CheckboxLineOps
    ): void {
        menu.addItem((item) => {
            const statusDisplay = `[${currentChar}]`;
            item.setTitle(t('menu.status', { status: statusDisplay }))
                .setIcon('check-square')
                .setSubmenu();

            addStatusItems(item.submenu, statusMenuChars, currentChar, (char) => {
                menu.close();
                void ops.updateLine(prefix + char + suffix);
            });
        });
    }

    /**
     * The copy goes in without the line's `^id`, as every other duplicate
     * does (`DuplicateShift`): two lines with one `^id` would anchor neither
     * (`Task.anchor`), and the original would lose its lasting ID.
     */
    private addDuplicateItem(menu: Menu, lineText: string, ops: CheckboxLineOps): void {
        const copy = TaskLineClassifier.extractLineBlockId(lineText).text;
        menu.addItem((item) => {
            item.setTitle(t('menu.duplicate'))
                .setIcon('copy')
                .onClick(async () => {
                    menu.close();
                    await ops.insertLineAfter(copy);
                });
        });
    }

    private addDeleteItem(menu: Menu, ops: CheckboxLineOps): void {
        menu.addItem((item) => {
            item.setTitle(t('menu.deleteTask'))
                .setIcon('trash')
                .setWarning(true)
                .onClick(async () => {
                    menu.close();
                    await ops.deleteLine();
                });
        });
    }
}
