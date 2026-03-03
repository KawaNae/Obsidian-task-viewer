import { App, Editor, Menu } from 'obsidian';
import type { TaskViewerSettings } from '../../../types';
import { buildStatusOptions, createStatusTitle } from '../../../constants/statusOptions';
import { CreateTaskModal, CreateTaskResult, formatTaskLine } from '../../../modals/CreateTaskModal';
import { DateUtils } from '../../../utils/DateUtils';

export type CreateFrontmatterTaskCallback = (result: CreateTaskResult, statusChar: string) => Promise<string>;

/** Regex to detect checkbox lines: `- [ ]`, `- [x]`, `- [!]`, etc. */
const CHECKBOX_LINE_REGEX = /^(\s*-\s*\[)(.)(\].*)$/;

/** Regex to extract content text after checkbox marker: `- [x] content here` */
const CHECKBOX_CONTENT_REGEX = /^\s*-\s*\[.\]\s*(.*?)\s*$/;

/**
 * Menu builder for plain checkbox lines (not recognized as @notation tasks).
 */
export class EditorCheckboxMenuBuilder {
    constructor(
        private app: App,
        private getStartHour: () => number,
        private onCreateFrontmatterTask?: CreateFrontmatterTaskCallback
    ) {}
    /**
     * Build the full menu for a plain checkbox line:
     * Status + Duplicate + Convert to Inline Task + Delete
     */
    addFullMenu(menu: Menu, editor: Editor, line: number, settings: TaskViewerSettings): boolean {
        const lineText = editor.getLine(line);
        const match = lineText.match(CHECKBOX_LINE_REGEX);
        if (!match) return false;

        // Status submenu
        if (settings.enableStatusMenu) {
            this.addStatusSubmenu(menu, editor, line, match, settings.statusMenuChars);
            menu.addSeparator();
        }

        // Duplicate
        this.addDuplicateItem(menu, editor, line);

        // Convert to > Inline Task / Frontmatter Task
        this.addConvertSubmenu(menu, editor, line, lineText);

        // Delete
        this.addDeleteItem(menu, editor, line);

        return true;
    }

    private addStatusSubmenu(menu: Menu, editor: Editor, line: number, match: RegExpMatchArray, statusMenuChars: string[]): void {
        const currentChar = match[2];
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
                        .onClick(() => {
                            const newLine = match[1] + s.char + match[3];
                            editor.setLine(line, newLine);
                        });
                });
            });
        });
    }

    private addDuplicateItem(menu: Menu, editor: Editor, line: number): void {
        menu.addItem((item) => {
            item.setTitle('Duplicate')
                .setIcon('copy')
                .onClick(() => {
                    const lineText = editor.getLine(line);
                    const lineCount = editor.lineCount();
                    const isLastLine = line === lineCount - 1;
                    const insertText = isLastLine ? '\n' + lineText : lineText + '\n';
                    const insertPos = isLastLine
                        ? { line, ch: editor.getLine(line).length }
                        : { line: line + 1, ch: 0 };
                    editor.replaceRange(insertText, insertPos);
                });
        });
    }

    private addConvertSubmenu(menu: Menu, editor: Editor, line: number, lineText: string): void {
        const contentMatch = lineText.match(CHECKBOX_CONTENT_REGEX);
        const content = contentMatch ? contentMatch[1] : '';
        const match = lineText.match(CHECKBOX_LINE_REGEX);
        const statusChar = match ? match[2] : ' ';

        menu.addItem((item) => {
            const subMenu = (item as any)
                .setTitle('Convert to')
                .setIcon('arrow-right-left')
                .setSubmenu() as Menu;

            // Inline Task
            subMenu.addItem((sub) => {
                sub.setTitle('Inline Task')
                    .setIcon('at-sign')
                    .onClick(() => {
                        menu.close();
                        const today = DateUtils.getVisualDateOfNow(this.getStartHour());
                        new CreateTaskModal(
                            this.app,
                            (result) => {
                                const indent = match ? match[1].match(/^(\s*)/)?.[1] ?? '' : '';
                                const formatted = formatTaskLine(result);
                                const newLine = indent + formatted.replace(/^- \[ \]/, `- [${statusChar}]`);
                                editor.setLine(line, newLine);
                            },
                            { content, startDate: today },
                            { title: 'Convert to Inline Task', submitLabel: 'Convert', focusField: 'start' }
                        ).open();
                    });
            });

            // Frontmatter Task
            if (this.onCreateFrontmatterTask) {
                subMenu.addItem((sub) => {
                    sub.setTitle('Frontmatter Task')
                        .setIcon('file-plus')
                        .onClick(() => {
                            menu.close();
                            const today = DateUtils.getVisualDateOfNow(this.getStartHour());
                            new CreateTaskModal(
                                this.app,
                                async (result) => {
                                    const newPath = await this.onCreateFrontmatterTask!(result, statusChar);
                                    const indent = match ? match[1].match(/^(\s*)/)?.[1] ?? '' : '';
                                    const linkTarget = newPath.replace(/\.md$/, '');
                                    const fileName = linkTarget.split('/').pop() || 'task';
                                    editor.setLine(line, `${indent}- [[${linkTarget}|${fileName}]]`);
                                },
                                { content, startDate: today },
                                { title: 'Convert to Frontmatter Task', submitLabel: 'Convert', focusField: 'start' }
                            ).open();
                        });
                });
            }
        });
    }

    private addDeleteItem(menu: Menu, editor: Editor, line: number): void {
        menu.addItem((item) => {
            item.setTitle('Delete')
                .setIcon('trash')
                .setWarning(true)
                .onClick(() => {
                    this.deleteLine(editor, line);
                });
        });
    }

    private deleteLine(editor: Editor, line: number): void {
        const lineCount = editor.lineCount();
        if (lineCount === 1) {
            editor.setLine(line, '');
        } else if (line === lineCount - 1) {
            const prevLineEnd = editor.getLine(line - 1).length;
            editor.replaceRange('', { line: line - 1, ch: prevLineEnd }, { line, ch: editor.getLine(line).length });
        } else {
            editor.replaceRange('', { line, ch: 0 }, { line: line + 1, ch: 0 });
        }
    }
}
