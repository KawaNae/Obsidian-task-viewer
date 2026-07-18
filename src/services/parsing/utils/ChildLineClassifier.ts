import type { ChildLine, PropertyType, PropertyValue } from '../../../types';

/**
 * 子行のパース・分類ユーティリティ。
 * パース層で ChildLine を生成し、下流での regex 再実行を不要にする。
 */
export class ChildLineClassifier {
    /** `- [[link]]` with any list bullet (kept in sync with CHECKBOX_CHAR's bullet set). */
    static readonly WIKILINK_CHILD = /^\s*(?:[-*+]|\d+[.)])\s+\[\[([^\]]+)\]\]\s*$/;
    static readonly CHECKBOX_CHAR = /^\s*(?:[-*+]|\d+[.)])\s*\[(.)\]/;
    /**
     * Matches `- key:: value` (Dataview-compatible) but not checkbox or wikilink lines.
     * 値部は空を許す（`- key ::` は空値プロパティ）。`(.+)` にすると末尾空白の
     * 有無で認識が反転する（`- key :: ` だけマッチ）ため `(.*)` が正しい。
     */
    static readonly PROPERTY_LINE = /^\s*-\s+([^:\[\]]+?)::\s*(.*)$/;

    /**
     * 生テキスト → ChildLine に変換。
     * @param bodyLine 絶対ファイル行（`Task.line` と同規約、-1 = body 行なし）
     */
    static classify(text: string, bodyLine: number): ChildLine {
        const indent = text.match(/^(\s*)/)?.[1] ?? '';
        const cbMatch = text.match(this.CHECKBOX_CHAR);
        const wikiMatch = text.match(this.WIKILINK_CHILD);

        // Property extraction: only for non-checkbox, non-wikilink lines
        let propertyKey: string | null = null;
        let propertyValue: string | null = null;
        if (!cbMatch && !wikiMatch) {
            const propMatch = text.match(this.PROPERTY_LINE);
            if (propMatch) {
                propertyKey = propMatch[1].trim();
                propertyValue = propMatch[2].trim();
            }
        }

        return {
            text,
            bodyLine,
            indent,
            checkboxChar: cbMatch ? cbMatch[1] : null,
            wikilinkTarget: wikiMatch ? wikiMatch[1].split('|')[0].trim() : null,
            propertyKey,
            propertyValue,
        };
    }

    /** 生テキスト配列 → ChildLine[] に一括変換（bodyLines は行番号の並行入力） */
    static classifyLines(lines: string[], bodyLines: number[]): ChildLine[] {
        if (lines.length !== bodyLines.length) {
            throw new Error(`classifyLines: lines(${lines.length}) and bodyLines(${bodyLines.length}) must be parallel`);
        }
        return lines.map((text, i) => this.classify(text, bodyLines[i]));
    }

    /**
     * `- key:: value` プロパティ行かの純粋述語（bodyLine 概念を持たない
     * write 層向け。分類本体と同じ checkbox/wikilink 除外規則を通す）。
     */
    static isPropertyLine(text: string): boolean {
        if (this.CHECKBOX_CHAR.test(text) || this.WIKILINK_CHILD.test(text)) return false;
        return this.PROPERTY_LINE.test(text);
    }

    /** childLines から properties を集約 */
    static collectProperties(childLines: ChildLine[]): Record<string, PropertyValue> {
        const properties: Record<string, PropertyValue> = {};
        for (const cl of childLines) {
            if (cl.propertyKey) {
                const raw = cl.propertyValue!;
                properties[cl.propertyKey] = { value: raw, type: this.inferType(raw) };
            }
        }
        return properties;
    }

    /** 文字列から型を推定 */
    static inferType(raw: string): PropertyType {
        if (/^\d+(\.\d+)?$/.test(raw)) return 'number';
        if (raw === 'True' || raw === 'False') return 'boolean';
        if (/^\[.*\]$/.test(raw) || raw.includes(',')) return 'array';
        return 'string';
    }
}
