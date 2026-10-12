import type { ChildLine } from '../../../types';
import { LIST_BULLET_SOURCE, SPACE_OR_TAB_SOURCE } from './ListMarker';
import { INDENT_SOURCE, Outline, type OutlineReading } from './Outline';
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
     * Whether the plugin reads a meaning from the item on `line` of
     * `reading`: a task, a `==>` line, a property, a wikilink child, or an
     * item of a property's list (an item directly under a property line
     * with no value, `PropertyLines`). Such an item means what it does by
     * where it stands (the task it belongs to, the property it is an item
     * of), so a write that takes lines out must leave it standing where it
     * was (`checkWrite`): a list's line taken out from above its items
     * would leave them notes of another item. Any other item is a note.
     */
    static carriesMeaning(reading: OutlineReading, line: number): boolean {
        const text = reading.lines[line];
        if (TaskLineClassifier.isTaskLine(text)
            || FLOW_LINE_RE.test(text)
            || PROPERTY_LINE.test(text)
            || this.WIKILINK_CHILD.test(text)) return true;
        const parent = reading.item(line)?.parent ?? null;
        if (parent === null || reading.inCode(parent)) return false;
        return reading.lines[parent].match(PROPERTY_LINE)?.[2].trim() === '';
    }
}
