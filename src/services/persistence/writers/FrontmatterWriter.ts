import { App, TFile } from 'obsidian';
import type { FrontmatterTaskKeys, Task } from '../../../types';
import { FileOperations } from '../utils/FileOperations';
import { FrontmatterLineEditor } from '../utils/FrontmatterLineEditor';
import { HeadingInserter } from '../../../utils/HeadingInserter';
import { DateUtils } from '../../../utils/DateUtils';


/**
 * tv-file (frontmatter-form) タスクの書き込み操作を担当するクラス。
 * 下請けの YAML 操作には FrontmatterLineEditor を使用。
 */
export class FrontmatterWriter {
    constructor(
        private app: App,
        private fileOps: FileOperations,
    ) {}

    /**
     * tv-file タスクの日付・ステータス等を更新する。
     * task オブジェクトは Object.assign で既に最新値に更新済み。
     * updates には変更されたフィールドのキーのみが含まれる。
     */
    async updateTvFile(
        task: Task,
        updates: Partial<Task>,
        frontmatterKeys: FrontmatterTaskKeys
    ): Promise<void> {
        const fmUpdates: Record<string, string | null> = {};

        if ('statusChar' in updates) {
            // ' ' (todo) → キー削除; それ以外 → エスケープしてキー書き込み
            fmUpdates[frontmatterKeys.status] = task.statusChar === ' ' ? null : this.escapeStatusChar(task.statusChar);
        }

        if ('startDate' in updates || 'startTime' in updates) {
            fmUpdates[frontmatterKeys.start] = DateUtils.formatDateTimeForStorage(task.startDate, task.startTime);
        }

        if ('endDate' in updates || 'endTime' in updates) {
            fmUpdates[frontmatterKeys.end] = DateUtils.formatDateTimeForStorage(task.endDate, task.endTime, task.endTime ? task.startDate : undefined);
        }

        if ('due' in updates) {
            fmUpdates[frontmatterKeys.due] = task.due || null;
        }

        if ('content' in updates) {
            fmUpdates[frontmatterKeys.content] = task.content || null;
        }

        if (Object.keys(fmUpdates).length > 0) {
            await this.updateFrontmatterFields(task.file, fmUpdates);
        }
    }

    /**
     * tv-file タスクを削除する（タスク関連キーを除去のみ）。
     * ファイル自体は削除しない。
     */
    async deleteTvFile(task: Task, frontmatterKeys: FrontmatterTaskKeys): Promise<void> {
        await this.updateFrontmatterFields(task.file, {
            [frontmatterKeys.start]: null,
            [frontmatterKeys.end]: null,
            [frontmatterKeys.due]: null,
            [frontmatterKeys.status]: null,
            [frontmatterKeys.content]: null,
        });
    }

    /**
     * tv-file タスクファイルの指定見出し下に子タスク行を挿入する。
     * 見出しが存在しない場合はファイル末尾に作成する。
     */
    async insertLineAfterTvFile(
        filePath: string,
        lineContent: string,
        header: string,
        headerLevel: number
    ): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (content) => {
            return HeadingInserter.insertUnderHeading(content, lineContent, header, headerLevel);
        });
    }

    // --- Frontmatter helpers ---

    /**
     * frontmatter 内のキーを surgical edit で更新・追加・削除する。
     * 対象キーの行のみを操作し、他の行は一切触らない。
     */
    private async updateFrontmatterFields(filePath: string, updates: Record<string, string | null>): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');
            const fmEnd = FrontmatterLineEditor.findEnd(lines);
            if (fmEnd < 0) return content;

            return FrontmatterLineEditor.applyUpdates(lines, fmEnd, updates);
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

}
