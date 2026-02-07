import { FrontmatterKeyOrderer } from './FrontmatterKeyOrderer';

/**
 * Frontmatter の行レベル編集ユーティリティ。
 * vault.process() コールバック内で使用する静的メソッドを提供。
 *
 * 共通パターン（境界検出・キーパース・再構築）を集約し、
 * FrontmatterWriter / HabitTrackerRenderer / TaskCloner の重複を解消する。
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
     * frontmatter 内のキーと値を Map に収集する。
     * @returns allFields: キー → 値, originalIndices: キー → 元の順序, nextKeyIndex: 次の追加キー用インデックス
     */
    static parseFields(lines: string[], fmEnd: number): {
        allFields: Map<string, string>;
        originalIndices: Map<string, number>;
        nextKeyIndex: number;
    } {
        const allFields = new Map<string, string>();
        const originalIndices = new Map<string, number>();
        let keyIndex = 0;

        for (let i = 1; i < fmEnd; i++) {
            const keyMatch = lines[i].match(/^([^:\s]+)\s*:/);
            if (!keyMatch) continue;

            const key = keyMatch[1];
            const colonIndex = lines[i].indexOf(':');
            const value = lines[i].substring(colonIndex + 1).trim();
            allFields.set(key, value || '');
            originalIndices.set(key, keyIndex++);
        }

        return { allFields, originalIndices, nextKeyIndex: keyIndex };
    }

    /**
     * allFields と keyOrderer を使って frontmatter を再構築し、コンテンツ全体を返す。
     */
    static rebuild(
        lines: string[],
        fmEnd: number,
        allFields: Map<string, string>,
        originalIndices: Map<string, number>,
        keyOrderer: FrontmatterKeyOrderer
    ): string {
        const sortedKeys = keyOrderer.sortKeys(Array.from(allFields.keys()), originalIndices);

        const fmLines: string[] = [];
        for (const key of sortedKeys) {
            const value = allFields.get(key);
            fmLines.push(value === '' ? `${key}:` : `${key}: ${value}`);
        }

        return [
            lines[0],           // opening ---
            ...fmLines,
            lines[fmEnd],       // closing ---
            ...lines.slice(fmEnd + 1)
        ].join('\n');
    }
}
