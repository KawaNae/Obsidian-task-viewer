import { Outline } from '../../parsing/utils/Outline';
import type { LineDraft } from '../../../utils/FileLines';

/**
 * Frontmatter の行レベル編集ユーティリティ。
 * `processLines` のコールバック内で、その draft を編集する静的メソッドを提供。
 *
 * 書き込みは surgical edit（外科的編集）方式:
 * 対象キーの行のみを更新・削除・挿入し、他の行は一切触らない。
 * これにより YAML 配列・ブロックスカラー等のマルチライン値や
 * キー順序が意図せず破壊されるリスクを排除する。
 */
export class FrontmatterLineEditor {

    /**
     * frontmatter の閉じタグ `---` の行インデックスを返す。
     * frontmatter がない場合は -1 を返す。
     */
    static findEnd(lines: readonly string[]): number {
        // The parser's reading of where the body begins, so the block edited
        // here is the one the index reads as frontmatter.
        return Outline.bodyStart(lines) - 1;
    }

    /**
     * frontmatter を持たないファイルのために空の block を先頭へ挿し、
     * fmEnd を返す。既にある場合は何も足さない。
     *
     * `processFrontMatter` はキーを書くときに block を作るので、surgical edit
     * へ寄せる経路（{@link FrontmatterWriter.setKeys}）が block 無しのファイルで
     * 黙って何もしないと機能が落ちる。本文は後ろにそのまま残す。
     */
    static ensureBlock(draft: LineDraft): number {
        const existing = this.findEnd(draft.lines);
        if (existing >= 0) return existing;
        draft.splice(0, 0, '---', '---');
        return 1;
    }

    /**
     * キーの値を**書かれたまま**（引用符を外さず）返す。キーが無ければ null。
     *
     * 条件付き削除のための読み取りなので、値の解釈はしない。比較側は
     * {@link escapeYamlScalar} を通した形と生の形の双方を許す。マルチライン値は
     * 対象外で、キー行の右側だけを見る。
     */
    static readRawScalar(lines: readonly string[], fmEnd: number, key: string): string | null {
        const range = this.findKeyRange(lines, fmEnd, key);
        if (!range) return null;
        const m = lines[range[0]].match(/^[^:\s]+\s*:\s*(.*)$/);
        return m ? m[1].trim() : null;
    }

    /**
     * frontmatter 内でトップレベルキーの行範囲 [start, end) を返す。
     * 継続行（配列項目・ブロックスカラー等）も含む。
     * キーが存在しない場合は null。
     */
    static findKeyRange(lines: readonly string[], fmEnd: number, key: string): [number, number] | null {
        for (let i = 1; i < fmEnd; i++) {
            const keyMatch = lines[i].match(/^([^:\s]+)\s*:/);
            if (keyMatch && keyMatch[1] === key) {
                // キー行を発見。継続行の終端を探す
                let end = i + 1;
                while (end < fmEnd) {
                    if (lines[end].match(/^([^:\s]+)\s*:/)) break; // 次のキー
                    end++;
                }
                return [i, end];
            }
        }
        return null;
    }

    /**
     * Surgical frontmatter edit:
     * 指定キーのみを更新・削除・挿入する。他の行は一切変更しない。
     *
     * - value: null → キー削除（継続行含む）
     * - value: string → キー更新（既存なら置換、なければ閉じ --- の直前に挿入）
     * - value: string[] → キー行 + 継続行の完全な生行列（マルチライン値。
     *   先頭要素が `key:` 行であること）。既存範囲を丸ごと差し替え / 挿入
     *
     * 行の差し替えは draft の splice で行う。frontmatter の行はタスクではない
     * ので、消して足した行として報告してよい。
     */
    static applyUpdates(draft: LineDraft, fmEnd: number, updates: Record<string, string | string[] | null>): void {
        const result = draft.lines;
        let currentFmEnd = fmEnd;

        for (const [key, value] of Object.entries(updates)) {
            const range = this.findKeyRange(result, currentFmEnd, key);

            if (value === null) {
                // 削除: キー行 + 継続行を除去
                if (range) {
                    const count = range[1] - range[0];
                    draft.splice(range[0], count);
                    currentFmEnd -= count;
                }
            } else {
                const newLines = Array.isArray(value)
                    ? value
                    : [value === '' ? `${key}:` : `${key}: ${value}`];
                if (range) {
                    // 更新: キー行 + 継続行を新しい行列に置換
                    const count = range[1] - range[0];
                    draft.splice(range[0], count, ...newLines);
                    currentFmEnd += newLines.length - count;
                } else {
                    // 挿入: 閉じ --- の直前に追加
                    draft.splice(currentFmEnd, 0, ...newLines);
                    currentFmEnd += newLines.length;
                }
            }
        }
    }

    /**
     * Converts an arbitrary string into a safe single-line YAML scalar.
     * The single canonical authority shared by every frontmatter write surface
     * (FrontmatterWriter.setKeys + applyUpdates)
     * so no value silently corrupts the block on write.
     *
     * Allowlist policy: emit a plain (unquoted) scalar ONLY for values that are
     * provably safe and would round-trip as the same string. Everything else is
     * double-quoted with full escaping. A misjudgement therefore degrades to a
     * harmless extra pair of quotes rather than YAML corruption / data loss.
     */
    static escapeYamlScalar(value: string): string {
        if (value === '') return '""';
        return this.isSafePlainScalar(value) ? value : this.toDoubleQuotedYaml(value);
    }

    /**
     * True only when `value` can be emitted unquoted and re-parses verbatim as
     * the identical string. Conservative on purpose — anything uncertain returns
     * false so the caller quotes it.
     */
    private static isSafePlainScalar(value: string): boolean {
        // Surrounding whitespace would be trimmed away by the YAML parser.
        if (value !== value.trim()) return false;
        // Alphanumerics / spaces / underscore only, and must not lead with a
        // space-class char. This rejects every YAML indicator and leading sigil
        // (`-`, `~`, `` ` ``, `:`, `#`, `[`, `{`, `@`, `*`, `&`, `!`, `|`, `>`, …),
        // colons, and control chars (newline/CR/tab) outright.
        if (!/^[A-Za-z0-9_][A-Za-z0-9 _]*$/.test(value)) return false;
        // Pure numbers would be re-typed as a number on read.
        if (/^[0-9]+(?:\.[0-9]+)?$/.test(value)) return false;
        // YAML 1.1 keywords would be re-typed as boolean/null on read.
        if (/^(?:true|false|null|yes|no|on|off|~)$/i.test(value)) return false;
        return true;
    }

    /**
     * Wraps `value` in a double-quoted YAML scalar with full escaping. A
     * double-quoted scalar can represent any string, so this never fails.
     */
    private static toDoubleQuotedYaml(value: string): string {
        const escaped = value
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
        return `"${escaped}"`;
    }
}
