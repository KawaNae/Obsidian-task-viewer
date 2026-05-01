import { App, Menu } from 'obsidian';
import type { StatusDefinition, TaskViewerSettings } from '../../../types';
import { buildStatusOptions, createStatusTitle } from '../../../constants/statusOptions';
import { CreateTaskModal, type CreateTaskResult, formatTaskLine } from '../../../modals/CreateTaskModal';
import { DateUtils } from '../../../utils/DateUtils';
import { DailyNoteUtils } from '../../../utils/DailyNoteUtils';
import { TaskLineClassifier } from '../../../services/parsing/utils/TaskLineClassifier';
import { t } from '../../../i18n';

export type CreateTvFileCallback = (result: CreateTaskResult, statusChar: string) => Promise<string>;

export interface CheckboxLineOps {
    updateLine(newContent: string): void | Promise<void>;
    insertLineAfter(content: string): void | Promise<void>;
    deleteLine(): void | Promise<void>;
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
        private onCreateTvFile?: CreateTvFileCallback
    ) {}

    /**
     * Build the full menu for a plain checkbox line:
     * Status + Duplicate + Convert to Inline + Convert to File + Delete
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

        // Convert to Inline / Convert to File (independent items)
        this.addConvertToInlineItem(menu, classified, lineText, ops, filePath);
        this.addConvertToFileItem(menu, classified, lineText, ops, filePath);

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
            item.setTitle(`Status: ${statusDisplay}`)
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
                            const newLine = indent + formatted.replace(/^- \[ \]/, `${marker} [${statusChar}]`);
                            await ops.updateLine(newLine);
                        },
                        { content, startDate: today },
                        { title: t('menu.convertToInline'), submitLabel: t('modal.convert'), focusField: 'start', startHour: this.getStartHour(), dailyNoteDate }
                    ).open();
                });
        });
    }

    private addConvertToFileItem(
        menu: Menu,
        classified: NonNullable<ReturnType<typeof TaskLineClassifier.classify>>,
        lineText: string,
        ops: CheckboxLineOps,
        filePath?: string
    ): void {
        if (!this.onCreateTvFile) return;
        const { rawContent, statusChar, indent } = classified;
        const marker = TaskLineClassifier.extractMarker(lineText);
        const content = rawContent.trim();
        const dailyNoteDate = filePath ? DailyNoteUtils.parseDateFromFilePath(this.app, filePath) ?? undefined : undefined;

        menu.addItem((item) => {
            item.setTitle(t('menu.convertToFile'))
                .setIcon('file-plus')
                .onClick(() => {
                    menu.close();
                    const today = DateUtils.getVisualDateOfNow(this.getStartHour());
                    new CreateTaskModal(
                        this.app,
                        async (result) => {
                            const newPath = await this.onCreateTvFile!(result, statusChar);
                            const linkTarget = newPath.replace(/\.md$/, '');
                            const fileName = linkTarget.split('/').pop() || 'task';
                            await ops.updateLine(`${indent}${marker} [[${linkTarget}|${fileName}]]`);
                        },
                        { content, startDate: today },
                        { title: t('menu.convertToFile'), submitLabel: t('modal.convert'), focusField: 'start', startHour: this.getStartHour(), dailyNoteDate }
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
