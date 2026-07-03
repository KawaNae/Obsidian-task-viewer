/**
 * Frontmatter の行レベル編集ユーティリティ。
 * vault.process() コールバック内で使用する静的メソッドを提供。
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
    static findEnd(lines: string[]): number {
        if (!lines.length || lines[0]?.trim() !== '---') return -1;
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '---') return i;
        }
        return -1;
    }

    /**
     * frontmatter 内でトップレベルキーの行範囲 [start, end) を返す。
     * 継続行（配列項目・ブロックスカラー等）も含む。
     * キーが存在しない場合は null。
     */
    static findKeyRange(lines: string[], fmEnd: number, key: string): [number, number] | null {
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
     *
     * @returns 編集後のコンテンツ文字列
     */
    static applyUpdates(lines: string[], fmEnd: number, updates: Record<string, string | null>): string {
        const result = [...lines];
        let currentFmEnd = fmEnd;

        for (const [key, value] of Object.entries(updates)) {
            const range = this.findKeyRange(result, currentFmEnd, key);

            if (value === null) {
                // 削除: キー行 + 継続行を除去
                if (range) {
                    const count = range[1] - range[0];
                    result.splice(range[0], count);
                    currentFmEnd -= count;
                }
            } else if (range) {
                // 更新: キー行 + 継続行を単一行に置換
                const newLine = value === '' ? `${key}:` : `${key}: ${value}`;
                const count = range[1] - range[0];
                result.splice(range[0], count, newLine);
                currentFmEnd -= (count - 1);
            } else {
                // 挿入: 閉じ --- の直前に追加
                const newLine = value === '' ? `${key}:` : `${key}: ${value}`;
                result.splice(currentFmEnd, 0, newLine);
                currentFmEnd++;
            }
        }

        return result.join('\n');
    }

    /**
     * Converts an arbitrary string into a safe single-line YAML scalar.
     * The single canonical authority shared by every frontmatter write surface
     * (create: TaskConverter, update: FrontmatterWriter + applyUpdates)
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
