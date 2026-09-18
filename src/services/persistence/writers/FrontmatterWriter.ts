import { type App, TFile } from 'obsidian';
import type { FileOperations } from '../utils/FileOperations';
import { FrontmatterLineEditor } from '../utils/FrontmatterLineEditor';
import { HeadingInserter } from '../../../utils/HeadingInserter';

/**
 * frontmatter と見出しへの書き込みを担当するクラス。frontmatter はノートの
 * スコープ属性（中のタスクに継承される既定値）で、タスクは作らない。
 * 下請けの YAML 操作には FrontmatterLineEditor を使用。
 */
export class FrontmatterWriter {
    constructor(
        private app: App,
        private fileOps: FileOperations,
    ) {}

    /**
     * 指定ファイルの見出し下に行を挿入する（見出し付きのタスク作成に使う
     * 汎用操作）。見出しが存在しない場合はファイル末尾に作成する。
     * @returns 挿入した行の 0-based 行番号。ファイルが無ければ -1。
     */
    async insertLineUnderHeading(
        filePath: string,
        lineContent: string,
        header: string,
        headerLevel: number
    ): Promise<number> {
        return HeadingInserter.writeUnderHeading(this.app, filePath, lineContent, header, headerLevel);
    }

    /**
     * Task を介さずに frontmatter のキーを設定・削除する汎用経路。
     * `null` は削除、それ以外は {@link FrontmatterLineEditor.escapeYamlScalar}
     * を通して書く。
     *
     * `processFrontMatter` を使う経路（色・線種のサジェスト）
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
}
