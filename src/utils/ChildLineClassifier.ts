import type { ChildLine, PropertyType, PropertyValue } from '../types';

/**
 * 子行のパース・分類ユーティリティ。
 * パース層で ChildLine を生成し、下流での regex 再実行を不要にする。
 */
export class ChildLineClassifier {
    static readonly WIKILINK_CHILD = /^\s*-\s+\[\[([^\]]+)\]\]\s*$/;
    static readonly CHECKBOX_CHAR = /^\s*(?:[-*+]|\d+[.)])\s*\[(.)\]/;
    /** Matches `- key:: value` (Dataview-compatible) but not checkbox or wikilink lines */
    static readonly PROPERTY_LINE = /^\s*-\s+([^:\[\]]+?)::\s*(.+)$/;

    /** 生テキスト → ChildLine に変換 */
    static classify(text: string): ChildLine {
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
            indent,
            checkboxChar: cbMatch ? cbMatch[1] : null,
            wikilinkTarget: wikiMatch ? wikiMatch[1].split('|')[0].trim() : null,
            propertyKey,
            propertyValue,
        };
    }

    /** 生テキスト配列 → ChildLine[] に一括変換 */
    static classifyLines(lines: string[]): ChildLine[] {
        return lines.map(text => this.classify(text));
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
        if (raw === 'true' || raw === 'false') return 'boolean';
        if (/^\[.*\]$/.test(raw)) return 'array';
        return 'string';
    }
}
