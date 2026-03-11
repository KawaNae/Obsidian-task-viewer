import type { ChildLine } from '../types';

/**
 * 子行のパース・分類ユーティリティ。
 * パース層で ChildLine を生成し、下流での regex 再実行を不要にする。
 */
export class ChildLineClassifier {
    static readonly WIKILINK_CHILD = /^\s*-\s+\[\[([^\]]+)\]\]\s*$/;
    static readonly CHECKBOX_CHAR = /^\s*(?:[-*+]|\d+[.)])\s*\[(.)\]/;

    /** 生テキスト → ChildLine に変換 */
    static classify(text: string): ChildLine {
        const indent = text.match(/^(\s*)/)?.[1] ?? '';
        const cbMatch = text.match(this.CHECKBOX_CHAR);
        const wikiMatch = text.match(this.WIKILINK_CHILD);
        return {
            text,
            indent,
            checkboxChar: cbMatch ? cbMatch[1] : null,
            wikilinkTarget: wikiMatch ? wikiMatch[1].split('|')[0].trim() : null,
        };
    }

    /** 生テキスト配列 → ChildLine[] に一括変換 */
    static classifyLines(lines: string[]): ChildLine[] {
        return lines.map(text => this.classify(text));
    }
}
