import { type App, normalizePath } from 'obsidian';
import { DEFAULT_TV_FILE_KEYS, type TvFileKeys, type Task, type PropertyValue } from '../../types';
import type { FileOperations } from './utils/FileOperations';
import { FrontmatterLineEditor } from './utils/FrontmatterLineEditor';
import { DateUtils } from '../../utils/DateUtils';
import { TagExtractor } from '../parsing/utils/TagExtractor';
import {
    getEffectiveColor, getEffectiveLinestyle, getEffectiveMask,
    getEffectiveTags, getEffectiveProperties,
} from '../data/EffectiveProperties';

/**
 * tv-inline タスクを tv-file タスク（frontmatter ベース）に変換する。
 */
export class TaskConverter {
    constructor(
        private app: App,
        private fileOps: FileOperations
    ) {}

    /**
     * tv-inline タスクを tv-file タスクへ変換。
     * 新ファイルパスを返す。
     */
    async convertToTvFile(
        task: Task,
        headerName: string,
        headerLevel: number,
        sourceFileColor?: string,
        sourceSharedTags?: string[],
        frontmatterKeys: TvFileKeys = DEFAULT_TV_FILE_KEYS,
        bodyChildLines: string[] = []
    ): Promise<string> {
        const filePath = this.generateFilePath(task);
        const frontmatter = this.buildFrontmatterContent(task, sourceFileColor, sourceSharedTags, frontmatterKeys);
        const body = this.buildBodyContent(bodyChildLines, headerName, headerLevel);
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

        // 変換元ファイル基準の保存先フォルダ。パスは normalizePath で正準化
        // (root の '/' 起因の '//' 二重スラッシュ → wikilink リンク切れを防ぐ)。
        const folder = this.app.fileManager.getNewFileParent(task.file);
        const prefix = folder.path ? `${folder.path}/` : '';

        // 衝突チェック + 自動採番
        let candidate = normalizePath(`${prefix}${baseName}.md`);
        if (!this.app.vault.getAbstractFileByPath(candidate)) {
            return candidate;
        }

        for (let i = 2; i < 100; i++) {
            candidate = normalizePath(`${prefix}${baseName} ${i}.md`);
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
        frontmatterKeys: TvFileKeys = DEFAULT_TV_FILE_KEYS
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

        // due (日付フィールドは plain 出力 — start/end と対称。escapeYamlScalar は
        // ユーザー任意文字列 content/status 専用)
        if (task.due) {
            lines.push(`${frontmatterKeys.due}: ${task.due}`);
        }

        // content (#tag を除去して tv-content に書く)
        // 空なら省略 — update パス (FrontmatterWriter) が空 content でキーを削除するのと対称。
        const cleanContent = task.content.replace(/\B#[^\s#]+/g, '').trim();
        if (cleanContent) {
            lines.push(`${frontmatterKeys.content}: ${FrontmatterLineEditor.escapeYamlScalar(cleanContent)}`);
        }

        // status (デフォルトの ' ' は省略)
        if (task.statusChar && task.statusChar !== ' ') {
            lines.push(`${frontmatterKeys.status}: ${FrontmatterLineEditor.escapeYamlScalar(task.statusChar)}`);
        }

        // 変換で新ファイルはセクション文脈を離れるため、継承込みの effective
        // 値を焼き込んで見た目を保存する（従来挙動の維持）。

        // color (タスクの effective 値を優先、ソースファイルをフォールバック)
        const taskColor = getEffectiveColor(task) || color;
        if (taskColor) {
            lines.push(`${frontmatterKeys.color}: ${FrontmatterLineEditor.escapeYamlScalar(taskColor)}`);
        }

        // linestyle
        const taskLinestyle = getEffectiveLinestyle(task);
        if (taskLinestyle) {
            lines.push(`${frontmatterKeys.linestyle}: ${FrontmatterLineEditor.escapeYamlScalar(taskLinestyle)}`);
        }

        // mask
        const taskMask = getEffectiveMask(task);
        if (taskMask) {
            lines.push(`${frontmatterKeys.mask}: ${FrontmatterLineEditor.escapeYamlScalar(taskMask)}`);
        }

        // tags
        const taskTags = getEffectiveTags(task);
        const allTags = sharedTags && sharedTags.length > 0
            ? TagExtractor.merge(taskTags, sharedTags)
            : taskTags;
        if (allTags.length > 0) {
            const tagItems = allTags.map(t => FrontmatterLineEditor.escapeYamlScalar(t)).join(', ');
            lines.push(`tags: [${tagItems}]`);
        }

        // custom properties
        for (const [key, prop] of Object.entries(getEffectiveProperties(task))) {
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
                return `[${items.map(s => FrontmatterLineEditor.escapeYamlScalar(s)).join(', ')}]`;
            }
            default:
                // Delegate to the single canonical scalar authority.
                return FrontmatterLineEditor.escapeYamlScalar(prop.value);
        }
    }

    /**
     * Body コンテンツを構築。
     * childLines がある場合は指定された見出し下に配置。
     */
    /**
     * 子行を見出し下に配置する body を構築。childLineTexts は変換元から取得した
     * 生の子行(property 行除外・インデント正規化済み)。@notation 子・孫・説明文・
     * 通常チェックボックスを区別せず全て含み、tv-file 再スキャンで childLines /
     * childIds に再分類させる(削除範囲と対称 = データ消失しない)。
     */
    private buildBodyContent(childLineTexts: string[], header: string, headerLevel: number): string {
        if (childLineTexts.length === 0) {
            return '';
        }
        const headerPrefix = '#'.repeat(headerLevel) + ' '; // 空行 + 見出し + 子行
        return ['', headerPrefix + header, ...childLineTexts].join('\n');
    }
}
