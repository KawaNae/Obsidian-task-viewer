import { App, TFile } from 'obsidian';
import type { DuplicateOptions, FrontmatterTaskKeys, Task } from '../../types';
import { TaskParser } from '../parsing/TaskParser';
import { DateUtils } from '../../utils/DateUtils';
import { FileOperations } from './utils/FileOperations';
import { FrontmatterLineEditor } from './utils/FrontmatterLineEditor';


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
     * インラインタスクを複製する。
     * - dayOffset=0, count=1: 同一ファイル内に複製（Block ID除去、元タスクの前に挿入）
     * - dayOffset>0, count=1: 指定日数シフトして1件複製（元タスクの前に挿入）
     * - count>1: dayOffset..dayOffset+count-1 の各日付で複製（future-first 挿入）
     */
    async duplicateInlineTask(task: Task, options?: DuplicateOptions): Promise<void> {
        const { dayOffset = 0, count = 1 } = options ?? {};

        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');

            if (count > 1) {
                // Multi-copy: future-first insertion (highest offset first)
                const currentLine = this.fileOps.findTaskLineNumber(lines, task);
                if (currentLine < 0 || currentLine >= lines.length) return content;

                const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, currentLine);
                const cleanParent = this.fileOps.stripBlockIds([lines[currentLine]])[0];
                const cleanedChildren = this.fileOps.stripBlockIds(childrenLines);

                const newLines: string[] = [];
                // Future-first order: highest offset first so newer dates appear above older ones.
                for (let offset = dayOffset + count - 1; offset >= dayOffset; offset--) {
                    newLines.push(this.shiftInlineDates(cleanParent, offset));
                    newLines.push(...cleanedChildren);
                }

                lines.splice(currentLine, 0, ...newLines);
                return lines.join('\n');
            } else if (dayOffset === 0) {
                // In-place copy: clean parent, insert before
                const idx = this.fileOps.findTaskLineNumber(lines, task);
                if (idx < 0 || idx >= lines.length) return content;

                const cleanParent = this.fileOps.stripBlockIds([lines[idx]])[0];
                const result = this.duplicateInlineTaskLines(lines, task, cleanParent, 'before');
                return result ? result.join('\n') : content;
            } else {
                // Single copy with date shift
                const idx = this.fileOps.findTaskLineNumber(lines, task);
                if (idx < 0 || idx >= lines.length) return content;

                const shiftedParent = this.shiftInlineDates(
                    this.fileOps.stripBlockIds([lines[idx]])[0], dayOffset
                );
                const result = this.duplicateInlineTaskLines(lines, task, shiftedParent, 'before');
                return result ? result.join('\n') : content;
            }
        });
    }

    /**
     * Frontmatter タスクを複製する（新規ファイル作成）。
     * - dayOffset=0: `Name.md` → `Name copy.md` → `Name copy 2.md` → ...
     * - dayOffset>0: dayOffset..dayOffset+count-1 の各日付でシフトしたファイルを作成
     */
    async duplicateFrontmatterTask(task: Task, frontmatterKeys: FrontmatterTaskKeys, options?: DuplicateOptions): Promise<void> {
        const { dayOffset = 0, count = 1 } = options ?? {};

        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return;

        if (dayOffset === 0) {
            const content = await this.app.vault.read(file);
            const newPath = this.generateCopyPath(file);
            await this.fileOps.ensureDirectoryExists(newPath);
            await this.app.vault.create(newPath, content);
        } else {
            const content = await this.app.vault.read(file);
            for (let offset = dayOffset; offset < dayOffset + count; offset++) {
                const shiftedContent = this.shiftFrontmatterDates(content, offset, frontmatterKeys);
                const newPath = this.generateDatedPath(file, task, offset);

                if (!this.app.vault.getAbstractFileByPath(newPath)) {
                    await this.fileOps.ensureDirectoryExists(newPath);
                    await this.app.vault.create(newPath, shiftedContent);
                }
            }
        }
    }

    /**
     * タスクの再発処理：元タスク+子行の直後に新しいタスク（+子行コピー）を挿入する。
     * 既存タスクがある場合はその直後に、なければ新しいタスクとして追加する。
     */
    async insertRecurrenceForTask(task: Task, content: string, newTask?: Task, copyChildren = true): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (fileContent) => {
            const lines = fileContent.split('\n');

            const currentLine = this.fileOps.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) {
                // Task not found: append to end
                const prefix = fileContent.length > 0 && !fileContent.endsWith('\n') ? '\n' : '';
                return fileContent + prefix + content;
            }

            // Format new parent line with original indentation
            const originalLine = lines[currentLine];
            const originalIndent = originalLine.match(/^(\s*)/)?.[1] || '';
            const newContent = TaskParser.format(newTask || task);
            const newParentLine = originalIndent + newContent.trim();

            const insertAt = this.fileOps.findSiblingGroupStart(lines, currentLine);
            if (copyChildren) {
                // Collect children, strip block IDs, and reset checkboxes
                const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, currentLine);
                const cleaned = this.fileOps.stripBlockIds(childrenLines);
                const reset = this.resetChildCheckboxes(cleaned);
                lines.splice(insertAt, 0, newParentLine, ...reset);
            } else {
                lines.splice(insertAt, 0, newParentLine);
            }

            return lines.join('\n');
        });
    }

    // --- Private helpers ---

    private resetChildCheckboxes(lines: string[]): string[] {
        return lines.map(line => line.replace(/^(\s*(?:[-*+]|\d+[.)]) *\[)[^\]]/, '$1 '));
    }

    /**
     * Inline task duplication core: collect parent+children, replace parent line,
     * strip block IDs from children, insert at specified position.
     * Children are copied as-is (no date shifting).
     * @returns Modified lines array, or null if task not found.
     */
    private duplicateInlineTaskLines(
        lines: string[],
        task: Task,
        newParentLine: string,
        position: 'before' | 'after'
    ): string[] | null {
        const currentLine = this.fileOps.findTaskLineNumber(lines, task);
        if (currentLine < 0 || currentLine >= lines.length) return null;

        const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, currentLine);
        const cleanedChildren = this.fileOps.stripBlockIds(childrenLines);

        const linesToInsert = [newParentLine, ...cleanedChildren];

        if (position === 'before') {
            lines.splice(currentLine, 0, ...linesToInsert);
        } else {
            const insertIndex = currentLine + 1 + childrenLines.length;
            lines.splice(insertIndex, 0, ...linesToInsert);
        }

        return lines;
    }

    /**
     * @notation ブロック内の start/end 日付を dayOffset 日シフトする。
     * due（3番目のセグメント）はシフトしない。
     */
    private shiftInlineDates(line: string, dayOffset: number): string {
        return line.replace(
            /(@(?=[\d>T])(?:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?|T?\d{2}:\d{2})?(?:>(?:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?|\d{2}:\d{2})?)*)/,
            (block) => {
                const inner = block.slice(1); // remove '@'
                const segments = inner.split('>');
                const shifted = segments.map((seg, i) =>
                    i < 2 ? seg.replace(/\d{4}-\d{2}-\d{2}/g, (d) => DateUtils.addDays(d, dayOffset)) : seg,
                );
                return '@' + shifted.join('>');
            },
        );
    }

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

    /** frontmatter の日付キー (start/end/due) の日付部分を N日シフトする。 */
    private shiftFrontmatterDates(content: string, dayOffset: number, frontmatterKeys: FrontmatterTaskKeys): string {
        const lines = content.split('\n');
        const fmEnd = FrontmatterLineEditor.findEnd(lines);
        if (fmEnd < 0) return content;

        const dateKeys = new Set([
            frontmatterKeys.start,
            frontmatterKeys.end,
            frontmatterKeys.due,
        ]);
        const dateRegex = /(\d{4}-\d{2}-\d{2})/;

        for (let i = 1; i < fmEnd; i++) {
            const keyMatch = lines[i].match(/^([^:\s]+)\s*:/);
            if (!keyMatch || !dateKeys.has(keyMatch[1])) continue;

            lines[i] = lines[i].replace(dateRegex, (match) => {
                return DateUtils.shiftDateString(match, dayOffset);
            });
        }

        return lines.join('\n');
    }
}
