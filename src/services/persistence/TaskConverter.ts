import { App, TFile } from 'obsidian';
import { DEFAULT_FRONTMATTER_TASK_KEYS, FrontmatterTaskKeys, Task } from '../../types';
import { FileOperations } from './utils/FileOperations';

/**
 * Inline タスクを Frontmatter タスクファイルに変換する。
 */
export class TaskConverter {
    constructor(
        private app: App,
        private fileOps: FileOperations
    ) {}

    /**
     * inline タスクを frontmatter タスクファイルに変換。
     * 新ファイルパスを返す。
     */
    async convertToFrontmatterTask(
        task: Task,
        headerName: string,
        headerLevel: number,
        sourceFileColor?: string,
        frontmatterKeys: FrontmatterTaskKeys = DEFAULT_FRONTMATTER_TASK_KEYS
    ): Promise<string> {
        const filePath = this.generateFilePath(task);
        const frontmatter = this.buildFrontmatterContent(task, sourceFileColor, frontmatterKeys);
        const body = this.buildBodyContent(task, headerName, headerLevel);
        const content = frontmatter + body;

        await this.app.vault.create(filePath, content);
        return filePath;
    }

    // --- Private helpers ---

    /**
     * タスクの content からファイルパスを生成。
     * 衝突時は " 2", " 3" と自動採番。
     */
    private generateFilePath(task: Task): string {
        let baseName = task.content.trim() || 'Untitled Task';
        baseName = this.sanitizeFilename(baseName);

        // 100文字で切り詰め
        if (baseName.length > 100) {
            baseName = baseName.substring(0, 100);
        }

        // Obsidian のデフォルト保存先フォルダ
        const folder = this.app.fileManager.getNewFileParent('');
        const prefix = folder.path ? `${folder.path}/` : '';

        // 衝突チェック + 自動採番
        let candidate = `${prefix}${baseName}.md`;
        if (!this.app.vault.getAbstractFileByPath(candidate)) {
            return candidate;
        }

        for (let i = 2; i < 100; i++) {
            candidate = `${prefix}${baseName} ${i}.md`;
            if (!this.app.vault.getAbstractFileByPath(candidate)) {
                return candidate;
            }
        }

        return candidate;
    }

    /**
     * ファイル名に使用できない文字を _ に置換。
     */
    private sanitizeFilename(name: string): string {
        return name.replace(/[<>:"|?*]/g, '_');
    }

    /**
     * Frontmatter YAML を構築。
     */
    private buildFrontmatterContent(task: Task, color?: string, frontmatterKeys: FrontmatterTaskKeys = DEFAULT_FRONTMATTER_TASK_KEYS): string {
        const lines = ['---'];

        // start
        const startValue = this.formatDateTime(task.startDate, task.startTime);
        if (startValue) {
            lines.push(`${frontmatterKeys.start}: ${startValue}`);
        }

        // end
        const endValue = this.formatDateTime(task.endDate, task.endTime);
        if (endValue) {
            lines.push(`${frontmatterKeys.end}: ${endValue}`);
        }

        // deadline
        if (task.deadline) {
            lines.push(`${frontmatterKeys.deadline}: ${task.deadline}`);
        }

        // content
        lines.push(`${frontmatterKeys.content}: ${task.content}`);

        // status (デフォルトの ' ' は省略)
        if (task.statusChar && task.statusChar !== ' ') {
            lines.push(`${frontmatterKeys.status}: ${task.statusChar}`);
        }

        // color (ソースファイルから継承、存在する場合のみ)
        if (color) {
            lines.push(`${frontmatterKeys.color}: "${this.escapeForDoubleQuotedYaml(color)}"`);
        }

        lines.push('---');
        return lines.join('\n');
    }

    /**
     * Body コンテンツを構築。
     * childLines がある場合は指定された見出し下に配置。
     */
    private buildBodyContent(task: Task, header: string, headerLevel: number): string {
        if (task.childLines.length === 0) {
            return '';
        }

        const headerPrefix = '#'.repeat(headerLevel) + ' ';
        const lines = ['', headerPrefix + header]; // 空行 + 見出し
        lines.push(...task.childLines);

        return lines.join('\n');
    }

    /**
     * 日付 + 時刻を結合してフォーマット。
     */
    private formatDateTime(date?: string, time?: string): string | null {
        if (!date && !time) return null;
        if (date && time) return `${date}T${time}`;
        if (date) return date;
        return time || null;
    }

    /**
     * Double-quoted YAML scalar 向けに \ と " をエスケープ。
     */
    private escapeForDoubleQuotedYaml(value: string): string {
        return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }
}
