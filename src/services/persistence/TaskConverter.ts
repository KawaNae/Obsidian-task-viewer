import { App, TFile } from 'obsidian';
import { DEFAULT_FRONTMATTER_TASK_KEYS, FrontmatterTaskKeys, Task, PropertyValue } from '../../types';
import { FileOperations } from './utils/FileOperations';
import { DateUtils } from '../../utils/DateUtils';
import { TagExtractor } from '../parsing/utils/TagExtractor';

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
        sourceSharedTags?: string[],
        frontmatterKeys: FrontmatterTaskKeys = DEFAULT_FRONTMATTER_TASK_KEYS
    ): Promise<string> {
        const filePath = this.generateFilePath(task);
        const frontmatter = this.buildFrontmatterContent(task, sourceFileColor, sourceSharedTags, frontmatterKeys);
        const body = this.buildBodyContent(task, headerName, headerLevel);
        const content = frontmatter + body;

        await this.app.vault.create(filePath, content);
        return filePath;
    }

    // --- Private helpers ---

    /**
     * タスクの content からファイルパスを生成。
     * #tag を除去してからサニタイズ。衝突時は " 2", " 3" と自動採番。
     */
    private generateFilePath(task: Task): string {
        let baseName = task.content.replace(/\B#[^\s#]+/g, '').trim() || 'Untitled Task';
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
        return name.replace(/[<>:"/\\|?*#]/g, '_');
    }

    /**
     * Frontmatter YAML を構築。
     */
    private buildFrontmatterContent(
        task: Task,
        color?: string,
        sharedTags?: string[],
        frontmatterKeys: FrontmatterTaskKeys = DEFAULT_FRONTMATTER_TASK_KEYS
    ): string {
        const lines = ['---'];

        // start
        const startValue = DateUtils.formatDateTimeForStorage(task.startDate, task.startTime);
        if (startValue) {
            lines.push(`${frontmatterKeys.start}: ${startValue}`);
        }

        // end (endTime があるが endDate がない場合のみ startDate をフォールバック — same-day 推論)
        const endValue = DateUtils.formatDateTimeForStorage(task.endDate, task.endTime, task.endTime ? task.startDate : undefined);
        if (endValue) {
            lines.push(`${frontmatterKeys.end}: ${endValue}`);
        }

        // due
        if (task.due) {
            lines.push(`${frontmatterKeys.due}: ${task.due}`);
        }

        // content (#tag を除去して tv-content に書く)
        const cleanContent = task.content.replace(/\B#[^\s#]+/g, '').trim();
        lines.push(`${frontmatterKeys.content}: ${cleanContent}`);

        // status (デフォルトの ' ' は省略)
        if (task.statusChar && task.statusChar !== ' ') {
            lines.push(`${frontmatterKeys.status}: ${task.statusChar}`);
        }

        // color (タスクの解決済み値を優先、ソースファイルをフォールバック)
        const effectiveColor = task.color || color;
        if (effectiveColor) {
            lines.push(`${frontmatterKeys.color}: "${this.escapeForDoubleQuotedYaml(effectiveColor)}"`);
        }

        // linestyle
        if (task.linestyle) {
            lines.push(`${frontmatterKeys.linestyle}: "${this.escapeForDoubleQuotedYaml(task.linestyle)}"`);
        }

        // mask
        if (task.mask) {
            lines.push(`${frontmatterKeys.mask}: "${this.escapeForDoubleQuotedYaml(task.mask)}"`);
        }

        // tags
        const allTags = sharedTags && sharedTags.length > 0
            ? TagExtractor.merge(task.tags, sharedTags)
            : task.tags;
        if (allTags.length > 0) {
            lines.push(`tags: [${allTags.join(', ')}]`);
        }

        // custom properties
        for (const [key, prop] of Object.entries(task.properties)) {
            lines.push(`${key}: ${this.formatPropertyValueForYaml(prop)}`);
        }

        lines.push('---');
        return lines.join('\n');
    }

    /**
     * PropertyValue を YAML スカラーにフォーマット。
     */
    private formatPropertyValueForYaml(prop: PropertyValue): string {
        switch (prop.type) {
            case 'number':
            case 'boolean':
                return prop.value;
            case 'array': {
                const inner = prop.value.startsWith('[') ? prop.value.slice(1, -1) : prop.value;
                const items = inner.split(',').map(s => s.trim()).filter(s => s !== '');
                return `[${items.join(', ')}]`;
            }
            default: {
                // Quote strings that contain YAML-sensitive characters
                if (/[:#{}[\],&*?|<>=!%@'"]/.test(prop.value) || prop.value !== prop.value.trim()) {
                    return `"${this.escapeForDoubleQuotedYaml(prop.value)}"`;
                }
                return prop.value;
            }
        }
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
        // プロパティ行は frontmatter に昇格済みなので body から除外
        lines.push(...task.childLines.filter(cl => cl.propertyKey === null).map(cl => cl.text));

        return lines.join('\n');
    }

    /**
     * Double-quoted YAML scalar 向けに \ と " をエスケープ。
     */
    private escapeForDoubleQuotedYaml(value: string): string {
        return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }
}
