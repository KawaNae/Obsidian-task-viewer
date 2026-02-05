import { App, TFile, TFolder } from 'obsidian';
import { Task } from '../types';
import { TaskParser } from './TaskParser';
import { DateUtils } from '../utils/DateUtils';

export class TaskRepository {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * Helper: Collect children lines from file content starting at taskLine
     * Returns { childrenLines, taskIndent }
     * Note: Empty/blank lines are NOT included as children
     */
    private collectChildrenFromLines(lines: string[], taskLineIndex: number): {
        childrenLines: string[];
        taskIndent: number;
    } {
        const taskLine = lines[taskLineIndex];
        const taskIndent = taskLine.search(/\S|$/);
        const childrenLines: string[] = [];

        let j = taskLineIndex + 1;
        while (j < lines.length) {
            const nextLine = lines[j];

            // Skip blank lines - they are NOT children
            if (nextLine.trim() === '') {
                break;
            }

            const nextIndent = nextLine.search(/\S|$/);
            if (nextIndent > taskIndent) {
                childrenLines.push(nextLine);
                j++;
            } else {
                break;
            }
        }

        return { childrenLines, taskIndent };
    }

    /**
     * Helper: Strip block IDs from lines
     */
    private stripBlockIds(lines: string[]): string[] {
        const blockIdRegex = /\s\^[a-zA-Z0-9-]+$/;
        return lines.map(line => line.replace(blockIdRegex, ''));
    }

    async updateTaskInFile(task: Task, updatedTask: Task): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) {
            console.warn(`[TaskRepository] File not found: ${task.file}`);
            return;
        }

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');

            // Find current line number using originalText (handles line shifts)
            const currentLine = this.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) {
                console.warn(`[TaskRepository] Task not found in file`);
                return content;
            }

            // Re-format line
            const newLine = TaskParser.format(updatedTask);
            console.log(`[TaskRepository] Updating line ${currentLine}: "${lines[currentLine]}" -> "${newLine}"`);

            // Preserve indentation if possible
            const originalIndent = lines[currentLine].match(/^(\s*)/)?.[1] || '';
            lines[currentLine] = originalIndent + newLine.trim();

            return lines.join('\n');
        });
    }

    async insertLineAfterTask(task: Task, lineContent: string): Promise<number> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return -1;

        let insertedLineIndex = -1;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');

            // Find current line using originalText (handles line shifts)
            const currentLine = this.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) return content;

            // Use file-based calculation to get actual children count
            const { childrenLines } = this.collectChildrenFromLines(lines, currentLine);

            // Ignore trailing blank lines to avoid gaps
            let effectiveChildrenCount = childrenLines.length;
            for (let i = childrenLines.length - 1; i >= 0; i--) {
                if (childrenLines[i].trim() === '') {
                    effectiveChildrenCount--;
                } else {
                    break;
                }
            }

            const insertIndex = currentLine + 1 + effectiveChildrenCount;
            lines.splice(insertIndex, 0, lineContent);
            insertedLineIndex = insertIndex;

            return lines.join('\n');
        });

        return insertedLineIndex;
    }

    /**
     * Insert a line as the first child of a task (right after the task line).
     * Used for timer/pomodoro records that should appear at the top of children.
     */
    async insertLineAsFirstChild(task: Task, lineContent: string): Promise<number> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return -1;

        let insertedLineIndex = -1;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');

            // Find the current line number using multiple strategies
            let currentLine = this.findTaskLineNumber(lines, task);

            if (currentLine < 0 || currentLine >= lines.length) return content;

            // Insert directly after the task line (as first child)
            const insertIndex = currentLine + 1;
            lines.splice(insertIndex, 0, lineContent);
            insertedLineIndex = insertIndex;

            return lines.join('\n');
        });

        return insertedLineIndex;
    }

    /**
     * Find the current line number of a task in the file.
     * Uses multiple strategies: exact match, content + date match, fallback to stored line.
     */
    private findTaskLineNumber(lines: string[], task: Task): number {
        // Strategy 0: Stored line number (O(1), correct when no line shift has occurred)
        // Must run before Strategy 1 to avoid returning the first duplicate when
        // multiple lines share the same originalText (e.g. inherited-date child tasks).
        if (task.line >= 0 && task.line < lines.length && lines[task.line] === task.originalText) {
            return task.line;
        }

        // Strategy 1: Exact originalText match (fallback for shifted lines)
        for (let i = 0; i < lines.length; i++) {
            if (lines[i] === task.originalText) {
                return i;
            }
        }

        // Strategy 2: Match by content and date notation (more resilient)
        // Build a pattern: contains task content AND @ date notation
        const escapedContent = task.content.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const datePattern = task.startDate ? `@${task.startDate}` : (task.deadline ? `@` : null);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Must be a task line (checkbox), contain the content, and match approx indent
            if (line.includes(`] ${task.content}`) || line.match(new RegExp(`\\]\\s+${escapedContent}`))) {
                // Verify it has similar characteristics
                if (datePattern && line.includes(datePattern)) {
                    return i;
                } else if (!datePattern && line.includes(task.content)) {
                    return i;
                }
            }
        }

        // Strategy 3: Fallback to stored line number
        return task.line;
    }


    async updateLine(filePath: string, lineNumber: number, newContent: string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');
            if (lines.length <= lineNumber) return content;

            // Preserve original indentation
            const originalLine = lines[lineNumber];
            const originalIndent = originalLine.match(/^(\s*)/)?.[1] || '';
            const newContentTrimmed = newContent.trimStart();

            lines[lineNumber] = originalIndent + newContentTrimmed;

            return lines.join('\n');
        });
    }

    async deleteTaskFromFile(task: Task): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');

            // Find current line using originalText
            const currentLine = this.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) return content;

            const { childrenLines } = this.collectChildrenFromLines(lines, currentLine);

            // Delete task line + all children
            lines.splice(currentLine, 1 + childrenLines.length);

            return lines.join('\n');
        });
    }

    async duplicateTaskInFile(task: Task): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');

            // Find current line using originalText
            const currentLine = this.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) return content;

            // 1. Get original task line and collect children
            const taskLine = lines[currentLine];
            const { childrenLines } = this.collectChildrenFromLines(lines, currentLine);

            // 2. Strip block IDs from task line and children
            const newTaskLine = this.stripBlockIds([taskLine])[0];
            const newChildLines = this.stripBlockIds(childrenLines);

            const linesToInsert = [newTaskLine, ...newChildLines];

            // 3. Insert after the original block
            const insertIndex = currentLine + 1 + childrenLines.length;
            lines.splice(insertIndex, 0, ...linesToInsert);

            return lines.join('\n');
        });
    }

    /**
     * タスクを1週間分（7日間）複製。各タスクの日付を1日ずつシフト
     * @param task 複製元タスク
     */
    async duplicateTaskForWeek(task: Task): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return;

        // Import needed inside method to avoid circular dependencies
        const { DateUtils } = await import('../utils/DateUtils');

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');

            // Find current line using originalText
            const currentLine = this.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) return content;

            // Get original task line and its indentation
            const taskLine = lines[currentLine];
            const taskIndent = taskLine.search(/\S|$/);

            // Collect original children lines from file (with original indentation)
            const childrenLines: string[] = [];
            let j = currentLine + 1;
            while (j < lines.length) {
                const nextLine = lines[j];
                const nextIndent = nextLine.search(/\S|$/);

                if (nextLine.trim() === '') {
                    childrenLines.push(nextLine);
                    j++;
                    continue;
                }

                if (nextIndent > taskIndent) {
                    childrenLines.push(nextLine);
                    j++;
                } else {
                    break;
                }
            }

            const blockIdRegex = /\s\^[a-zA-Z0-9-]+$/;
            const allNewLines: string[] = [];

            // Generate 7 copies with shifted dates (1 day, 2 days, ..., 7 days)
            for (let dayOffset = 1; dayOffset <= 7; dayOffset++) {
                // Create shifted task
                const shiftedTask: Task = {
                    ...task,
                    startDate: task.startDate ? DateUtils.shiftDateString(task.startDate, dayOffset) : undefined,
                    endDate: task.endDate ? DateUtils.shiftDateString(task.endDate, dayOffset) : undefined,
                    deadline: task.deadline ? DateUtils.shiftDateString(task.deadline, dayOffset) : undefined,
                };

                // Format the shifted task
                const formattedLine = TaskParser.format(shiftedTask);

                // Preserve original indentation
                const originalIndent = taskLine.match(/^(\s*)/)?.[1] || '';

                // Strip block ID
                const cleanLine = (originalIndent + formattedLine.trim()).replace(blockIdRegex, '');
                allNewLines.push(cleanLine);

                // Add children without block IDs (from file, with original indentation)
                for (const child of childrenLines) {
                    allNewLines.push(child.replace(blockIdRegex, ''));
                }
            }

            // Insert after the original task block
            const insertIndex = currentLine + 1 + childrenLines.length;
            lines.splice(insertIndex, 0, ...allNewLines);

            return lines.join('\n');
        });
    }

    async insertRecurrenceForTask(task: Task, content: string, newTask?: Task): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (fileContent) => {
            const lines = fileContent.split('\n');

            // Find current line using originalText
            const currentLine = this.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) return fileContent;

            // 1. Get indent and collect children
            const originalIndent = lines[currentLine].match(/^(\s*)/)?.[1] || '';
            const { childrenLines } = this.collectChildrenFromLines(lines, currentLine);

            // 2. Strip block IDs from children
            const newChildLines = this.stripBlockIds(childrenLines);

            // 3. Build lines to insert: new task line + children
            const nextLine = originalIndent + content;
            const linesToInsert = [nextLine, ...newChildLines];

            // 4. Insert after the original block
            const insertIndex = currentLine + 1 + childrenLines.length;
            lines.splice(insertIndex, 0, ...linesToInsert);

            return lines.join('\n');
        });
    }

    async appendTaskToFile(filePath: string, content: string): Promise<void> {
        let file = this.app.vault.getAbstractFileByPath(filePath);

        if (!file) {
            // Ensure directory exists
            await this.ensureDirectoryExists(filePath);

            // Create file if it doesn't exist
            await this.app.vault.create(filePath, content);
            return;
        }

        if (file instanceof TFile) {
            await this.app.vault.process(file, (fileContent) => {
                // Ensure starts with newline if file not empty
                const prefix = fileContent.length > 0 && !fileContent.endsWith('\n') ? '\n' : '';
                return fileContent + prefix + content;
            });
        }
    }

    /**
     * Append task with children to file (for move command)
     * Reads children from the original file and appends them together
     * Adjusts children indentation relative to new parent position
     */
    async appendTaskWithChildren(destPath: string, content: string, task: Task): Promise<void> {
        // 1. Read children from original file
        const sourceFile = this.app.vault.getAbstractFileByPath(task.file);
        let childrenLines: string[] = [];
        let parentIndent = 0;

        if (sourceFile instanceof TFile) {
            const sourceContent = await this.app.vault.read(sourceFile);
            const lines = sourceContent.split('\n');

            // Find current line using originalText
            const currentLine = this.findTaskLineNumber(lines, task);

            if (currentLine >= 0 && currentLine < lines.length) {
                // Get parent's original indentation
                const parentLine = lines[currentLine];
                parentIndent = parentLine.search(/\S|$/);

                const result = this.collectChildrenFromLines(lines, currentLine);
                childrenLines = result.childrenLines;
            }
        }

        // 2. Strip block IDs from children
        const cleanedChildren = this.stripBlockIds(childrenLines);

        // 3. Adjust children indentation relative to parent
        // Remove parent's indentation amount, keep only relative indent
        const adjustedChildren = cleanedChildren.map(line => {
            if (line.trim() === '') return line; // Keep empty lines as-is
            const currentIndent = line.search(/\S|$/);
            const relativeIndent = Math.max(0, currentIndent - parentIndent);
            // Use tabs for the relative indentation
            return '\t'.repeat(relativeIndent / (line.includes('\t') ? 1 : 4)) + line.trimStart();
        });

        // 4. Build full content to append
        const fullContent = [content, ...adjustedChildren].join('\n');

        // 5. Append to destination file
        await this.appendTaskToFile(destPath, fullContent);
    }

    private async ensureDirectoryExists(filePath: string): Promise<void> {
        const lastSlashIndex = filePath.lastIndexOf('/');
        if (lastSlashIndex === -1) return; // Rooy directory

        const folderPath = filePath.substring(0, lastSlashIndex);
        if (this.app.vault.getAbstractFileByPath(folderPath) instanceof TFolder) {
            return;
        }

        // Recursive creation
        const folders = folderPath.split('/');
        let currentPath = '';
        for (const segment of folders) {
            currentPath = currentPath === '' ? segment : `${currentPath}/${segment}`;
            const existing = this.app.vault.getAbstractFileByPath(currentPath);
            if (!existing) {
                try {
                    await this.app.vault.createFolder(currentPath);
                } catch (error) {
                    // Ignore "Folder already exists" error
                    if (error.message && error.message.includes('Folder already exists')) {
                        continue;
                    }
                    throw error;
                }
            }
        }
    }

    // ========================================
    // Frontmatter タスク書き込み
    // ========================================

    /**
     * Frontmatter タスクの日付・ステータス等を更新する。
     * task オブジェクトは Object.assign で既に最新値に更新済み。
     * updates には変更されたフィールドのキーのみが含まれる。
     */
    async updateFrontmatterTask(task: Task, updates: Partial<Task>): Promise<void> {
        const fmUpdates: Record<string, string | null> = {};

        if ('statusChar' in updates) {
            // ' ' (todo) → キー削除; それ以外 → キー書き込み
            fmUpdates['status'] = task.statusChar === ' ' ? null : task.statusChar;
        }

        if ('startDate' in updates || 'startTime' in updates) {
            fmUpdates['start'] = this.formatFrontmatterDateTime(task.startDate, task.startTime);
        }

        if ('endDate' in updates || 'endTime' in updates) {
            fmUpdates['end'] = this.formatFrontmatterDateTime(task.endDate, task.endTime);
        }

        if ('deadline' in updates) {
            fmUpdates['deadline'] = task.deadline || null;
        }

        if ('content' in updates) {
            fmUpdates['content'] = task.content || null;
        }

        if (Object.keys(fmUpdates).length > 0) {
            await this.updateFrontmatterFields(task.file, fmUpdates);
        }
    }

    /**
     * Frontmatter タスクを削除する（タスク関連キーを除去のみ）。
     * ファイル自体は削除しない。
     */
    async deleteFrontmatterTask(task: Task): Promise<void> {
        await this.updateFrontmatterFields(task.file, {
            start: null, end: null, deadline: null, status: null, content: null,
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
        await this.ensureDirectoryExists(newPath);
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
                await this.ensureDirectoryExists(newPath);
                await this.app.vault.create(newPath, shiftedContent);
            }
        }
    }

    /**
     * Frontmatter タスクの直後（閉じる---の次行）に子タスク行を挿入する。
     */
    async insertLineAfterFrontmatter(filePath: string, lineContent: string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');

            if (lines[0]?.trim() !== '---') {
                // frontmatter なし → ファイル先頭に挿入
                lines.unshift(lineContent);
                return lines.join('\n');
            }

            let fmEnd = -1;
            for (let i = 1; i < lines.length; i++) {
                if (lines[i].trim() === '---') { fmEnd = i; break; }
            }
            if (fmEnd < 0) {
                lines.unshift(lineContent);
                return lines.join('\n');
            }

            // 閉じる --- の次行に挿入
            lines.splice(fmEnd + 1, 0, lineContent);
            return lines.join('\n');
        });
    }

    // --- Frontmatter helpers ---

    /**
     * frontmatter 内のキーを原子的に更新・追加・削除する。
     * value: null → キー削除, '' → `key:` (YAML null), その他 → `key: value`
     */
    private async updateFrontmatterFields(filePath: string, updates: Record<string, string | null>): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');

            if (lines[0]?.trim() !== '---') return content;

            let fmEnd = -1;
            for (let i = 1; i < lines.length; i++) {
                if (lines[i].trim() === '---') { fmEnd = i; break; }
            }
            if (fmEnd < 0) return content;

            const pending = new Map(Object.entries(updates));

            // 既存キーを走査して更新・削除
            for (let i = 1; i < fmEnd; i++) {
                const keyMatch = lines[i].match(/^(\w+)\s*:/);
                if (!keyMatch) continue;

                const key = keyMatch[1];
                if (!pending.has(key)) continue;

                const newValue = pending.get(key);
                pending.delete(key);

                if (newValue === null) {
                    // キーを削除
                    lines.splice(i, 1);
                    fmEnd--;
                    i--;
                } else {
                    lines[i] = newValue === '' ? `${key}:` : `${key}: ${newValue}`;
                }
            }

            // 新規キーを閉じる --- の直前に追加
            const newLines: string[] = [];
            for (const [key, value] of pending) {
                if (value !== null) {
                    newLines.push(value === '' ? `${key}:` : `${key}: ${value}`);
                }
            }
            if (newLines.length > 0) {
                lines.splice(fmEnd, 0, ...newLines);
            }

            return lines.join('\n');
        });
    }

    /** 日時 → frontmatter 値文字列。時刻オンリーは sexagesimal 回避のためquoted。 */
    private formatFrontmatterDateTime(date?: string, time?: string): string | null {
        if (date && time) return `${date}T${time}`;
        if (date) return date;
        if (time) return `"${time}"`;
        return null;
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
