import { ChildLineClassifier } from '../../parsing/utils/ChildLineClassifier';
import type { PropertyOp } from '../PropertyUpdatePlanner';

interface OwnPropertyLine {
    lineIdx: number;
    key: string;
    value: string;
}

/**
 * インラインタスクの子プロパティ行（`- key:: value`）の外科的編集。
 * FrontmatterLineEditor と対を成す純関数・静的クラスで、vault.process()
 * コールバック内の lines[] を直接操作する。
 *
 * ルールB（表現保持）の実装点:
 * - 更新は既存行の `- key:: ` プレフィックス（インデント・bullet・キー表記）
 *   を保存して値部分のみ置換
 * - tags は既存値が #hashtag 形式ならその形式、カンマ区切りならその形式で
 *   書き戻す（新規は #hashtag が正準）
 * - set は「最後の own 宣言行」を対象（パースが後勝ちのため）、delete は
 *   全 own 宣言行を除去（先行の重複が透け戻るのを防ぐ）
 */
export class ChildPropertyLineEditor {
    /** `- key:: ` プレフィックス捕捉用（PROPERTY_LINE と同じ形状制約） */
    private static readonly PROPERTY_PREFIX = /^(\s*-\s+[^:[\]]+?::\s*)/;

    /**
     * タスク直下の own プロパティ行を列挙する。
     * 子範囲の規則は FileOperations.collectChildrenFromLines と同一
     * （空行で終端、インデントがタスク行より深い連続行）。範囲内の
     * ネスト子タスク（checkbox 行）のブロックは own でないためスキップ
     * （TreeTaskExtractor の除外規則の write 層版）。
     */
    static findOwnPropertyLines(lines: string[], taskLineIdx: number): OwnPropertyLine[] {
        const taskIndent = lines[taskLineIdx].search(/\S|$/);
        const result: OwnPropertyLine[] = [];
        let skipDeeperThan: number | null = null;

        for (let j = taskLineIdx + 1; j < lines.length; j++) {
            const line = lines[j];
            if (line.trim() === '') break;
            const indent = line.search(/\S|$/);
            if (indent <= taskIndent) break;

            if (skipDeeperThan !== null) {
                if (indent > skipDeeperThan) continue;
                skipDeeperThan = null;
            }
            if (ChildLineClassifier.CHECKBOX_CHAR.test(line)) {
                skipDeeperThan = indent;
                continue;
            }
            if (ChildLineClassifier.isPropertyLine(line)) {
                const m = line.match(ChildLineClassifier.PROPERTY_LINE);
                if (m) {
                    result.push({ lineIdx: j, key: m[1].trim(), value: m[2].trim() });
                }
            }
        }
        return result;
    }

    /**
     * ops を lines に適用する（in-place mutate）。
     * 各 op の前に own プロパティ行を再走査するので、op 間の行シフトに
     * 対して常に正しい行を対象にする。
     */
    static applyOps(lines: string[], taskLineIdx: number, ops: PropertyOp[]): void {
        for (const op of ops) {
            const ownLines = this.findOwnPropertyLines(lines, taskLineIdx);
            const matching = ownLines.filter(l => l.key === op.key);

            if (op.op === 'delete') {
                for (let i = matching.length - 1; i >= 0; i--) {
                    lines.splice(matching[i].lineIdx, 1);
                }
                continue;
            }

            if (matching.length > 0) {
                // 更新: 最後の宣言行の値部分のみ置換（プレフィックス保存）
                const target = matching[matching.length - 1];
                const prefix = lines[target.lineIdx].match(this.PROPERTY_PREFIX)?.[1];
                if (prefix !== undefined) {
                    lines[target.lineIdx] = prefix + this.formatValue(op.value, target.value);
                    continue;
                }
                // プレフィックスが取れない（理論上到達しない）場合は行ごと再構築
                const indent = lines[target.lineIdx].match(/^(\s*)/)?.[1] ?? '';
                lines[target.lineIdx] = `${indent}- ${op.key}:: ${this.formatValue(op.value, target.value)}`;
                continue;
            }

            // 新規挿入（ルールA: 正準位置）: 既存の own プロパティ行があれば
            // その最後の直後（宣言塊を保つ・インデント踏襲）、なければ
            // タスク行直下 first child（タスク行インデント + タブ1）
            let insertIdx: number;
            let indent: string;
            if (ownLines.length > 0) {
                const last = ownLines[ownLines.length - 1];
                insertIdx = last.lineIdx + 1;
                indent = lines[last.lineIdx].match(/^(\s*)/)?.[1] ?? '';
            } else {
                insertIdx = taskLineIdx + 1;
                indent = (lines[taskLineIdx].match(/^(\s*)/)?.[1] ?? '') + '\t';
            }
            lines.splice(insertIdx, 0, `${indent}- ${op.key}:: ${this.formatValue(op.value, null)}`);
        }
    }

    /**
     * op.value を子行の値表現にフォーマットする。
     * tags（string[]）は既存値の表現（#hashtag / カンマ区切り）を踏襲、
     * 新規は #hashtag を正準とする。
     */
    private static formatValue(value: string | string[] | undefined, existingValue: string | null): string {
        if (value === undefined) return '';
        if (!Array.isArray(value)) return value;
        const useComma = existingValue !== null && !existingValue.includes('#');
        return useComma
            ? value.join(', ')
            : value.map(t => `#${t}`).join(' ');
    }
}
