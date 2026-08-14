import { type App, TFile } from 'obsidian';
import type { TvFileKeys, Task } from '../../../types';
import type { FileOperations } from '../utils/FileOperations';
import { FrontmatterLineEditor } from '../utils/FrontmatterLineEditor';
import { HeadingInserter } from '../../../utils/HeadingInserter';
import { DateUtils } from '../../../utils/DateUtils';
import type { PropertyOp } from '../PropertyUpdatePlanner';


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
        frontmatterKeys: TvFileKeys,
        propertyOps: PropertyOp[] = []
    ): Promise<boolean> {
        const fmUpdates: Record<string, string | null> = {};

        if ('statusChar' in updates) {
            // ' ' (todo) → キー削除; それ以外 → エスケープしてキー書き込み
            fmUpdates[frontmatterKeys.status] = task.statusChar === ' ' ? null : FrontmatterLineEditor.escapeYamlScalar(task.statusChar);
        }

        if ('startDate' in updates || 'startTime' in updates) {
            fmUpdates[frontmatterKeys.start] = DateUtils.formatDateTimeForStorage(task.startDate, task.startTime);
        }

        if ('endDate' in updates || 'endTime' in updates) {
            fmUpdates[frontmatterKeys.end] = DateUtils.formatDateTimeForStorage(task.endDate, task.endTime, task.endTime ? task.startDate : undefined);
        }

        if ('due' in updates) {
            // 日付フィールドは plain 出力(start/end と対称)
            fmUpdates[frontmatterKeys.due] = task.due || null;
        }

        if ('content' in updates) {
            fmUpdates[frontmatterKeys.content] = task.content ? FrontmatterLineEditor.escapeYamlScalar(task.content) : null;
        }

        if (Object.keys(fmUpdates).length > 0 || propertyOps.length > 0) {
            // tags（配列値）の表現決定は既存キーの形（ブロックリスト / 単一行）
            // に依存するため、ファイル行を見られる builder 内で解決する。
            return this.updateFrontmatterFields(task.file, (lines, fmEnd) => {
                const merged: Record<string, string | string[] | null> = { ...fmUpdates };
                for (const op of propertyOps) {
                    if (op.op === 'delete') {
                        merged[op.key] = null;
                    } else if (Array.isArray(op.value)) {
                        merged[op.key] = this.buildListUpdate(lines, fmEnd, op.key, op.value);
                    } else {
                        merged[op.key] = FrontmatterLineEditor.escapeYamlScalar(op.value ?? '');
                    }
                }
                return merged;
            });
        }

        // 書くものが無い更新（時刻も非時刻プロパティも変わっていない）は
        // 書き込みが起きなくても失敗ではない。
        return true;
    }

    /**
     * 配列値（tags）の frontmatter 表現を決定する（ルールB: 表現保持）。
     * 既存キーがブロックリスト（複数行）ならブロックリストで書き戻し、
     * 単一行 or 新規ならフロー形式 `[a, b]` の単一行にする。
     */
    private buildListUpdate(lines: string[], fmEnd: number, key: string, values: string[]): string | string[] {
        const escaped = values.map(v => FrontmatterLineEditor.escapeYamlScalar(v));
        const range = FrontmatterLineEditor.findKeyRange(lines, fmEnd, key);
        if (range && range[1] - range[0] > 1) {
            const itemIndent = lines[range[0] + 1].match(/^(\s*)-/)?.[1] ?? '  ';
            return [`${key}:`, ...escaped.map(v => `${itemIndent}- ${v}`)];
        }
        return `[${escaped.join(', ')}]`;
    }

    /**
     * tv-file タスクを削除する（タスク関連キーを除去のみ）。
     * ファイル自体は削除しない。
     */
    async deleteTvFile(task: Task, frontmatterKeys: TvFileKeys): Promise<void> {
        await this.updateFrontmatterFields(task.file, () => ({
            [frontmatterKeys.start]: null,
            [frontmatterKeys.end]: null,
            [frontmatterKeys.due]: null,
            [frontmatterKeys.status]: null,
            [frontmatterKeys.content]: null,
        }));
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
            return HeadingInserter.insertUnderHeading(content, lineContent, header, headerLevel).content;
        });
    }

    /**
     * Task を介さずに frontmatter のキーを設定・削除する汎用経路。
     * `null` は削除、それ以外は {@link FrontmatterLineEditor.escapeYamlScalar}
     * を通して書く。
     *
     * `processFrontMatter` を使う経路（タイマーの対象 ID、色・線種のサジェスト）
     * をここへ寄せるために公開している。あちらは frontmatter 全体を YAML として
     * 読み直して書き戻すので、コメント行が消え、引用符が外れ、フロー形式の配列が
     * ブロックリストへ変わる。surgical edit は対象キーの行しか触らないため、
     * 表現を保ったまま書ける。
     *
     * 設定するキーが1つでもあれば block の無いファイルには block を作る。
     * 削除だけの場合は作らない（消す相手が無いので書く必要がない）。
     */
    async setKeys(filePath: string, updates: Record<string, string | null>): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;

        const hasSet = Object.values(updates).some(v => v !== null);

        await this.app.vault.process(file, (content) => {
            const raw = content.split('\n');
            if (FrontmatterLineEditor.findEnd(raw) < 0 && !hasSet) return content;

            const { lines, fmEnd } = FrontmatterLineEditor.ensureBlock(raw);
            const escaped: Record<string, string | null> = {};
            for (const [key, value] of Object.entries(updates)) {
                escaped[key] = value === null ? null : FrontmatterLineEditor.escapeYamlScalar(value);
            }
            return FrontmatterLineEditor.applyUpdates(lines, fmEnd, escaped);
        });
    }

    /**
     * 値が `expected` と一致するときに限りキーを削除する。
     *
     * 読み取りと削除を同じ `vault.process` に収めるのが要点で、外で値を確かめて
     * から消しに行くと、その隙間で誰かが書き換えた値を消しうる。書かれた形と
     * エスケープ後の形の双方を一致とみなすのは、書いた側がどちらの経路でも
     * 同じ値を指しているためである。
     */
    async deleteKeyIfValue(filePath: string, key: string, expected: string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');
            const fmEnd = FrontmatterLineEditor.findEnd(lines);
            if (fmEnd < 0) return content;

            const current = FrontmatterLineEditor.readRawScalar(lines, fmEnd, key);
            if (current === null) return content;
            if (current !== expected && current !== FrontmatterLineEditor.escapeYamlScalar(expected)) {
                return content;
            }

            return FrontmatterLineEditor.applyUpdates(lines, fmEnd, { [key]: null });
        });
    }

    // --- Frontmatter helpers ---

    /**
     * frontmatter 内のキーを surgical edit で更新・追加・削除する。
     * 対象キーの行のみを操作し、他の行は一切触らない。
     * updates は builder 関数で受ける — マルチライン値（tags 配列等）の
     * 表現決定が既存ファイル行に依存するため。
     */
    private async updateFrontmatterFields(
        filePath: string,
        build: (lines: string[], fmEnd: number) => Record<string, string | string[] | null>
    ): Promise<boolean> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return false;

        let written = false;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');
            const fmEnd = FrontmatterLineEditor.findEnd(lines);
            if (fmEnd < 0) return content;

            written = true;
            return FrontmatterLineEditor.applyUpdates(lines, fmEnd, build(lines, fmEnd));
        });

        return written;
    }

}
