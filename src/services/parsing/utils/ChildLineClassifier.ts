import type { ChildLine } from '../../../types';
import { LIST_BULLET_SOURCE, SPACE_OR_TAB_SOURCE } from './ListMarker';
import { INDENT_SOURCE, Outline } from './Outline';
import { extractWikilinkTarget } from '../../../utils/WikilinkUtils';
import { FLOW_LINE_RE } from './FlowLineScanner';
import { TaskLineClassifier } from './TaskLineClassifier';
import { WIKILINK_TEXT_SOURCE } from './InlineNotation';
import { PROPERTY_LINE } from './PropertyLines';

/**
 * 子行のパース・分類ユーティリティ。
 * パース層で ChildLine を生成し、下流での regex 再実行を不要にする。
 */
export class ChildLineClassifier {
    /**
     * `- [[link]]` with any list bullet. The marker is followed by spaces
     * and tabs as a list item's is (`Outline.read`); a no-break space there
     * opens no item.
     */
    static readonly WIKILINK_CHILD = new RegExp(`^${INDENT_SOURCE}${LIST_BULLET_SOURCE}${SPACE_OR_TAB_SOURCE}+\\[\\[(${WIKILINK_TEXT_SOURCE}+)\\]\\]\\s*$`);
    /**
     * 生テキスト → ChildLine に変換。
     * @param bodyLine 絶対ファイル行（`Task.line` と同規約）
     */
    static classify(text: string, bodyLine: number): ChildLine {
        const indent = Outline.indentOf(text);
        const wikiMatch = text.match(this.WIKILINK_CHILD);

        const propMatch = text.match(PROPERTY_LINE);

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
     * Whether the plugin reads a meaning from `text` when it opens a list
     * item: a task, a `==>` line, a property or a wikilink child. Such an
     * item means what it does by where it stands (the task it belongs to),
     * so a write that takes lines out must leave it standing where it was
     * (`checkWrite`). Any other item is a note.
     */
    static carriesMeaning(text: string): boolean {
        return TaskLineClassifier.isTaskLine(text)
            || FLOW_LINE_RE.test(text)
            || PROPERTY_LINE.test(text)
            || this.WIKILINK_CHILD.test(text);
    }
}
