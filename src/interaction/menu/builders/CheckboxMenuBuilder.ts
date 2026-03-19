import { App, Menu } from 'obsidian';
import type { TaskViewerSettings } from '../../../types';
import { buildStatusOptions, createStatusTitle } from '../../../constants/statusOptions';
import { CreateTaskModal, type CreateTaskResult, formatTaskLine } from '../../../modals/CreateTaskModal';
import { DateUtils } from '../../../utils/DateUtils';
import { DailyNoteUtils } from '../../../utils/DailyNoteUtils';
import { TaskLineClassifier } from '../../../utils/TaskLineClassifier';
import { t } from '../../../i18n';

export type CreateFrontmatterTaskCallback = (result: CreateTaskResult, statusChar: string) => Promise<string>;

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
        private onCreateFrontmatterTask?: CreateFrontmatterTaskCallback
    ) {}

    /**
     * Build the full menu for a plain checkbox line:
     * Status + Duplicate + Convert to Inline Task + Delete
     */
    addFullMenu(menu: Menu, lineText: string, settings: TaskViewerSettings, ops: CheckboxLineOps, filePath?: string): boolean {
        const classified = TaskLineClassifier.classify(lineText);
        if (!classified) return false;

        // Status submenu
        if (settings.enableStatusMenu) {
            this.addStatusSubmenu(menu, classified.prefix, classified.suffix, classified.statusChar, settings.statusMenuChars, ops);
            menu.addSeparator();
        }

        // Duplicate
        this.addDuplicateItem(menu, lineText, ops);

        // Convert to > Inline Task / Frontmatter Task
        this.addConvertSubmenu(menu, classified, lineText, ops, filePath);

        // Delete
        this.addDeleteItem(menu, ops);

        return true;
    }

    private addStatusSubmenu(
        menu: Menu,
        prefix: string,
        suffix: string,
        currentChar: string,
        statusMenuChars: string[],
        ops: CheckboxLineOps
    ): void {
        const options = buildStatusOptions(statusMenuChars);

        menu.addItem((item) => {
            const statusDisplay = `[${currentChar}]`;
            (item as any).setTitle(`Status: ${statusDisplay}`)
                .setIcon('check-square')
                .setSubmenu();

            const statusMenu = (item as any).submenu as Menu;

            options.forEach(s => {
                statusMenu.addItem(sub => {
                    sub.setTitle(createStatusTitle(s))
                        .setChecked(currentChar === s.char)
                        .onClick(async () => {
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
                    await ops.insertLineAfter(lineText);
                });
        });
    }

    private addConvertSubmenu(
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
            const subMenu = (item as any)
                .setTitle(t('menu.convertTo'))
                .setIcon('arrow-right-left')
                .setSubmenu() as Menu;

            // Inline Task
            subMenu.addItem((sub) => {
                sub.setTitle(t('menu.inlineTask'))
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
                            { title: t('menu.convertToInlineTask'), submitLabel: t('modal.convert'), focusField: 'start', startHour: this.getStartHour(), dailyNoteDate }
                        ).open();
                    });
            });

            // Frontmatter Task
            if (this.onCreateFrontmatterTask) {
                subMenu.addItem((sub) => {
                    sub.setTitle(t('menu.frontmatterTask'))
                        .setIcon('file-plus')
                        .onClick(() => {
                            menu.close();
                            const today = DateUtils.getVisualDateOfNow(this.getStartHour());
                            new CreateTaskModal(
                                this.app,
                                async (result) => {
                                    const newPath = await this.onCreateFrontmatterTask!(result, statusChar);
                                    const linkTarget = newPath.replace(/\.md$/, '');
                                    const fileName = linkTarget.split('/').pop() || 'task';
                                    await ops.updateLine(`${indent}${marker} [[${linkTarget}|${fileName}]]`);
                                },
                                { content, startDate: today },
                                { title: t('menu.convertToFrontmatterTaskTitle'), submitLabel: t('modal.convert'), focusField: 'start', startHour: this.getStartHour(), dailyNoteDate }
                            ).open();
                        });
                });
            }
        });
    }

    private addDeleteItem(menu: Menu, ops: CheckboxLineOps): void {
        menu.addItem((item) => {
            item.setTitle(t('menu.deleteTask'))
                .setIcon('trash')
                .setWarning(true)
                .onClick(async () => {
                    await ops.deleteLine();
                });
        });
    }
}
