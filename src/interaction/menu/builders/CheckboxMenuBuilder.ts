import type { App, Menu } from 'obsidian';
import type { StatusDefinition, TaskViewerSettings } from '../../../types';
import { buildStatusOptions, createStatusTitle } from '../../../constants/statusOptions';
import { CreateTaskModal, formatTaskLine } from '../../../modals/CreateTaskModal';
import { DateUtils } from '../../../utils/DateUtils';
import { DailyNoteUtils } from '../../../utils/DailyNoteUtils';
import { TaskLineClassifier } from '../../../services/parsing/utils/TaskLineClassifier';
import { t } from '../../../i18n';

/**
 * The editor's writes to one line. Each answers whether it was written; a
 * write that was not has told the user why (see `TaskIndex.reportRefusal`).
 */
export interface CheckboxLineOps {
    updateLine(newContent: string): Promise<boolean>;
    insertLineAfter(content: string): Promise<boolean>;
    deleteLine(): Promise<boolean>;
}

/**
 * Menu builder for plain checkbox lines (not recognized as @notation tasks).
 * Agnostic to the mutation backend — callers provide CheckboxLineOps
 * for Editor-based or TaskIndex-based line operations.
 */
export class CheckboxMenuBuilder {
    constructor(
        private app: App,
        private getStartHour: () => number,
    ) {}

    /**
     * Build the full menu for a plain checkbox line:
     * Status + Duplicate + Convert to Inline + Delete
     */
    addFullMenu(menu: Menu, lineText: string, settings: TaskViewerSettings, ops: CheckboxLineOps, filePath?: string): boolean {
        const classified = TaskLineClassifier.classify(lineText);
        if (!classified) return false;

        // Status submenu
        if (settings.enableStatusMenu) {
            this.addStatusSubmenu(menu, classified.prefix, classified.suffix, classified.statusChar, settings.statusDefinitions, ops);
            menu.addSeparator();
        }

        // Duplicate
        this.addDuplicateItem(menu, lineText, ops);

        this.addConvertToInlineItem(menu, classified, lineText, ops, filePath);

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
        const options = buildStatusOptions(statusMenuChars);

        menu.addItem((item) => {
            const statusDisplay = `[${currentChar}]`;
            item.setTitle(t('menu.status', { status: statusDisplay }))
                .setIcon('check-square')
                .setSubmenu();

            const statusMenu = item.submenu;

            options.forEach(s => {
                statusMenu.addItem(sub => {
                    sub.setTitle(createStatusTitle(s))
                        .setChecked(currentChar === s.char)
                        .onClick(async () => {
                            menu.close();
                            const newLine = prefix + s.char + suffix;
                            await ops.updateLine(newLine);
                        });
                });
            });
        });
    }

    private addDuplicateItem(menu: Menu, lineText: string, ops: CheckboxLineOps): void {
        menu.addItem((item) => {
            item.setTitle(t('menu.duplicate'))
                .setIcon('copy')
                .onClick(async () => {
                    menu.close();
                    await ops.insertLineAfter(lineText);
                });
        });
    }

    private addConvertToInlineItem(
        menu: Menu,
        classified: NonNullable<ReturnType<typeof TaskLineClassifier.classify>>,
        lineText: string,
        ops: CheckboxLineOps,
        filePath?: string
    ): void {
        const { rawContent, statusChar, indent } = classified;
        const marker = TaskLineClassifier.extractMarker(lineText);
        const content = rawContent.trim();
        const dailyNoteDate = filePath ? DailyNoteUtils.parseDateFromFilePath(this.app, filePath) ?? undefined : undefined;

        menu.addItem((item) => {
            item.setTitle(t('menu.convertToInline'))
                .setIcon('at-sign')
                .onClick(() => {
                    menu.close();
                    const today = DateUtils.getVisualDateOfNow(this.getStartHour());
                    new CreateTaskModal(
                        this.app,
                        async (result) => {
                            const formatted = formatTaskLine(result);
                            const newLine = indent + TaskLineClassifier.formatPrefix(statusChar, '', marker)
                                + TaskLineClassifier.splitContent(formatted).content;
                            await ops.updateLine(newLine);
                        },
                        { content, startDate: today },
                        { title: t('menu.convertToInline'), submitLabel: t('modal.convert'), startHour: this.getStartHour(), dailyNoteDate }
                    ).open();
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
