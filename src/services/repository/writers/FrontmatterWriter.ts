import { App, TFile } from 'obsidian';
import type { Task } from '../../../types';
import { FileOperations } from '../utils/FileOperations';


/**
 * Frontmatterタスクの書き込み操作を担当するクラス
 * Frontmatterフィールドの更新、削除、挿入などの操作を提供
 */
export class FrontmatterWriter {
    constructor(
        private app: App,
        private fileOps: FileOperations
    ) { }

    /**
     * Frontmatter タスクの日付・ステータス等を更新する。
     * task オブジェクトは Object.assign で既に最新値に更新済み。
     * updates には変更されたフィールドのキーのみが含まれる。
     */
    async updateFrontmatterTask(task: Task, updates: Partial<Task>): Promise<void> {
        const fmUpdates: Record<string, string | null> = {};

        if ('statusChar' in updates) {
            // ' ' (todo) → キー削除; それ以外 → エスケープしてキー書き込み
            fmUpdates['status'] = task.statusChar === ' ' ? null : this.escapeStatusChar(task.statusChar);
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

    /**
     * 必要に応じてステータス文字をYAML用にエスケープする。
     * YAML特殊文字: ? ! > - : などは引用符で囲む必要がある。
     */
    private escapeStatusChar(statusChar: string): string {
        const needsQuoting = /[?!>:\-\[\]{}|&*#,]/.test(statusChar);
        return needsQuoting ? `"${statusChar}"` : statusChar;
    }

    /** 日時 → frontmatter 値文字列。時刻オンリーは sexagesimal 回避のためquoted。 */
    private formatFrontmatterDateTime(date?: string, time?: string): string | null {
        if (date && time) return `${date}T${time}`;
        if (date) return date;
        if (time) return `"${time}"`;
        return null;
    }
}
