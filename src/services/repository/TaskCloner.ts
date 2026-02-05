import { App, TFile } from 'obsidian';
import type { Task } from '../../types';
import { TaskParser } from '../TaskParser';
import { DateUtils } from '../../utils/DateUtils';
import { FileOperations } from './utils/FileOperations';


/**
 * タスク複製ロジックを担当するクラス
 * インラインタスクとFrontmatterタスクの複製、週次複製、再発処理を提供
 */
export class TaskCloner {
    constructor(
        private app: App,
        private fileOps: FileOperations
    ) { }

    /**
     * インラインタスクを同一ファイル内に複製する。
     * 元タスクの直後（子要素を含む全範囲の次行）に挿入される。
     * Block ID は除去される。
     */
    async duplicateTaskInFile(task: Task): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');

            // Find current line using originalText
            const currentLine = this.fileOps.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) return content;

            // Collect task line + children
            const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, currentLine);
            const taskLineToCopy = lines[currentLine];
            const allLines = [taskLineToCopy, ...childrenLines];

            // Strip block IDs
            const cleaned = this.fileOps.stripBlockIds(allLines);

            // Insert after task + children
            const insertIndex = currentLine + 1 + childrenLines.length;
            lines.splice(insertIndex, 0, ...cleaned);

            return lines.join('\n');
        });
    }

    /**
     * インラインタスクを1週間分（7日間）複製する。
     * 各コピーの @start 日付を1日ずつシフトする。
     */
    async duplicateTaskForWeek(task: Task): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return;

        const baseDate = task.startDate || DateUtils.getToday();

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');

            // Find current line using originalText
            const currentLine = this.fileOps.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) return content;

            // Collect task line + children
            const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, currentLine);
            const taskLineToCopy = lines[currentLine];
            const allLines = [taskLineToCopy, ...childrenLines];

            // Strip block IDs
            const cleaned = this.fileOps.stripBlockIds(allLines);

            // Insert after task + children
            const insertIndex = currentLine + 1 + childrenLines.length;
            const newLines: string[] = [];

            for (let dayOffset = 1; dayOffset <= 7; dayOffset++) {
                const newDate = DateUtils.addDays(baseDate, dayOffset);

                // Shift dates for each line
                const shiftedLines = cleaned.map((line) => {
                    // Replace @YYYY-MM-DD notation
                    return line.replace(/@\d{4}-\d{2}-\d{2}/, `@${newDate}`);
                });

                newLines.push(...shiftedLines);
            }

            lines.splice(insertIndex, 0, ...newLines);

            return lines.join('\n');
        });
    }

    /**
     * Frontmatter タスクを複製する（新規ファイル作成）。
     * ファイル名: `Name.md` → `Name copy.md` → `Name copy 2.md` → ...
     */
    async duplicateFrontmatterTask(task: Task): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return;

        const content = await this.app.vault.read(file);
        const newPath = this.generateCopyPath(file);
        await this.fileOps.ensureDirectoryExists(newPath);
        await this.app.vault.create(newPath, content);
    }

    /**
     * Frontmatter タスクを1週間分（7日間）複製。各コピーの日付を1日ずつシフト。
     * ファイル名: 既存日付あり → 置換、なし → 末尾に追加
     */
    async duplicateFrontmatterTaskForWeek(task: Task): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return;

        const content = await this.app.vault.read(file);

        for (let dayOffset = 1; dayOffset <= 7; dayOffset++) {
            const shiftedContent = this.shiftFrontmatterDates(content, dayOffset);
            const newPath = this.generateDatedPath(file, task, dayOffset);

            if (!this.app.vault.getAbstractFileByPath(newPath)) {
                await this.fileOps.ensureDirectoryExists(newPath);
                await this.app.vault.create(newPath, shiftedContent);
            }
        }
    }

    /**
     * タスクの再発処理：元タスクの直後に新しいタスクを挿入する。
     * 既存タスクがある場合はその直後に、なければ新しいタスクとして追加する。
     */
    async insertRecurrenceForTask(task: Task, content: string, newTask?: Task): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (fileContent) => {
            const lines = fileContent.split('\n');

            // Find current line using originalText
            const currentLine = this.fileOps.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) {
                // If task not found, append to end
                const prefix = fileContent.length > 0 && !fileContent.endsWith('\n') ? '\n' : '';
                return fileContent + prefix + content;
            }

            // Collect task line + children to skip them
            const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, currentLine);

            // Determine new task indentation
            const originalLine = lines[currentLine];
            const originalIndent = originalLine.match(/^(\s*)/)?.[1] || '';

            // Prepare new task content with proper indentation
            const newContent = TaskParser.format(newTask || task);
            const indentedContent = originalIndent + newContent.trim();

            // Insert after task + children
            const insertIndex = currentLine + 1 + childrenLines.length;
            lines.splice(insertIndex, 0, indentedContent);

            return lines.join('\n');
        });
    }

    // --- Private helpers ---

    /** `Name.md` → `Name copy.md` → `Name copy 2.md` → ... */
    private generateCopyPath(file: TFile): string {
        const dir = file.parent?.path || '';
        const name = file.basename.replace(/\.md$/, '');
        const prefix = dir ? `${dir}/` : '';

        let candidate = `${prefix}${name} copy.md`;
        if (!this.app.vault.getAbstractFileByPath(candidate)) return candidate;

        for (let i = 2; i < 100; i++) {
            candidate = `${prefix}${name} copy ${i}.md`;
            if (!this.app.vault.getAbstractFileByPath(candidate)) return candidate;
        }
        return candidate;
    }

    /**
     * 日付付きコピー先パスを生成する。
     * ファイル名に既存の日付がある場合は置換、なければ末尾に追加。
     */
    private generateDatedPath(file: TFile, task: Task, dayOffset: number): string {
        const dir = file.parent?.path || '';
        const name = file.basename.replace(/\.md$/, '');
        const baseDate = task.startDate || DateUtils.getToday();
        const newDate = DateUtils.addDays(baseDate, dayOffset);
        const prefix = dir ? `${dir}/` : '';

        // ファイル名に既存の日付があれば置換
        const dateRegex = /\d{4}-\d{2}-\d{2}/;
        if (dateRegex.test(name)) {
            return `${prefix}${name.replace(dateRegex, newDate)}.md`;
        }
        return `${prefix}${name} ${newDate}.md`;
    }

    /** frontmatter の日付キー (start/end/deadline) の日付部分を N日シフトする。 */
    private shiftFrontmatterDates(content: string, dayOffset: number): string {
        const lines = content.split('\n');
        if (lines[0]?.trim() !== '---') return content;

        let fmEnd = -1;
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '---') { fmEnd = i; break; }
        }
        if (fmEnd < 0) return content;

        const dateKeys = new Set(['start', 'end', 'deadline']);
        const dateRegex = /(\d{4}-\d{2}-\d{2})/;

        for (let i = 1; i < fmEnd; i++) {
            const keyMatch = lines[i].match(/^(\w+)\s*:/);
            if (!keyMatch || !dateKeys.has(keyMatch[1])) continue;

            lines[i] = lines[i].replace(dateRegex, (match) => {
                return DateUtils.shiftDateString(match, dayOffset);
            });
        }

        return lines.join('\n');
    }
}
