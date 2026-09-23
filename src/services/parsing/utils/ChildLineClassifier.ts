import type { ChildLine, PropertyType, PropertyValue } from '../../../types';
import { IN_LINE } from '../../../utils/LineBreak';
import { LIST_BULLET_SOURCE } from './ListMarker';
import { INDENT_SOURCE, Outline } from './Outline';
import { extractWikilinkTarget } from '../../../utils/WikilinkUtils';

/**
 * 子行のパース・分類ユーティリティ。
 * パース層で ChildLine を生成し、下流での regex 再実行を不要にする。
 */
export class ChildLineClassifier {
    /** `- [[link]]` with any list bullet. */
    static readonly WIKILINK_CHILD = new RegExp(`^${INDENT_SOURCE}${LIST_BULLET_SOURCE}\\s+\\[\\[([^\\]]+)\\]\\]\\s*$`);
    /**
     * Matches `- key:: value` (Dataview-compatible). A key holds no `[` or `]`,
     * so a checkbox line and a wikilink line are never property lines.
     * 値部は空を許す（`- key ::` は空値プロパティ）。`(.+)` にすると末尾空白の
     * 有無で認識が反転する（`- key :: ` だけマッチ）ため `(.*)` が正しい。
     */
    static readonly PROPERTY_LINE = new RegExp(`^${INDENT_SOURCE}-\\s+([^:\\[\\]]+?)::\\s*(${IN_LINE}*)$`);

    /**
     * 生テキスト → ChildLine に変換。
     * @param bodyLine 絶対ファイル行（`Task.line` と同規約、-1 = body 行なし）
     */
    static classify(text: string, bodyLine: number): ChildLine {
        const indent = Outline.indentOf(text);
        const wikiMatch = text.match(this.WIKILINK_CHILD);

        const propMatch = text.match(this.PROPERTY_LINE);

        return {
            text,
            bodyLine,
            indent,
            wikilinkTarget: wikiMatch ? extractWikilinkTarget(wikiMatch[1]) : null,
            propertyKey: propMatch ? propMatch[1].trim() : null,
            propertyValue: propMatch ? propMatch[2].trim() : null,
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
     * write 層向け。分類本体と同じ `PROPERTY_LINE` を通す）。
     */
    static isPropertyLine(text: string): boolean {
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
        if (new RegExp(`^\\[${IN_LINE}*\\]$`).test(raw) || raw.includes(',')) return 'array';
        return 'string';
    }
}
