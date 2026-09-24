import { ChildLineClassifier } from '../../parsing/utils/ChildLineClassifier';
import { TaskLineClassifier } from '../../parsing/utils/TaskLineClassifier';
import { Block, Placement } from './Placement';
import type { PropertyOp } from '../PropertyUpdatePlanner';
import type { LineDraft } from '../../../utils/FileLines';
import { INDENT_SOURCE, Outline } from '../../parsing/utils/Outline';
import { SPACE_OR_TAB_SOURCE } from '../../parsing/utils/ListMarker';

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
    private static readonly PROPERTY_PREFIX = new RegExp(`^(${INDENT_SOURCE}-${SPACE_OR_TAB_SOURCE}+[^:[\\]]+?::\\s*)`);

    /**
     * タスク直下の own プロパティ行を列挙する。どの行が own かはパーサと
     * 同じ1か所（`ChildLineClassifier.ownPropertyLines`）が決める: ノート
     * 全体の読み（`Outline.read`）でタスクの項目を親に持つ項目のうち、
     * コードでない `- key:: value` 行。子タスクやメモの下、コードブロック
     * の中の行は own でない。
     */
    static findOwnPropertyLines(lines: readonly string[], taskLineIdx: number): OwnPropertyLine[] {
        return ChildLineClassifier.ownPropertyLines(Outline.read(lines), taskLineIdx).map(lineIdx => {
            const m = lines[lineIdx].match(ChildLineClassifier.PROPERTY_LINE)!;
            return { lineIdx, key: m[1].trim(), value: m[2].trim() };
        });
    }

    /**
     * ops を draft に適用する。
     * 各 op の前に own プロパティ行を再走査するので、op 間の行シフトに
     * 対して常に正しい行を対象にする。
     *
     * ここが触る行はどれもタスク行より下なので、呼び口が先に書き換えた
     * タスク行の座標は動かない。変更はすべて draft を通るので、3経路とも
     * そのまま申告になる。行を足す位置は `Placement` が答え、足した行と
     * 消した行のあとで、ほかの行が変わらないかは書き込みの検査
     * （`checkWrite`）が答える。変わるなら書き込み全体が拒否される。
     */
    static applyOps(draft: LineDraft, taskLineIdx: number, ops: PropertyOp[]): void {
        const lines = draft.lines;
        for (const op of ops) {
            const ownLines = this.findOwnPropertyLines(lines, taskLineIdx);
            const matching = ownLines.filter(l => l.key === op.key);

            if (op.op === 'delete') {
                // 逆順に消すので、各 lineIdx はその行が立っていた座標のまま。
                for (let i = matching.length - 1; i >= 0; i--) {
                    draft.splice(matching[i].lineIdx, 1);
                }
                continue;
            }

            if (matching.length > 0) {
                // 更新: 最後の宣言行の値部分のみ置換（プレフィックス保存）
                const target = matching[matching.length - 1];
                const prefix = lines[target.lineIdx].match(this.PROPERTY_PREFIX)?.[1];
                if (prefix !== undefined) {
                    const value = this.formatValue(op.value, target.value);
                    // 空値行 (`- key ::`) はプレフィックスが `::` で終わるため、
                    // 値を書き込むときはセパレータの空白を補う
                    const sep = value !== '' && !/\s$/.test(prefix) ? ' ' : '';
                    // 値が変わっただけで、行の素性は変わらない。
                    draft.rewrite(target.lineIdx, prefix + sep + value);
                    continue;
                }
                // プレフィックスが取れない（理論上到達しない）場合は行ごと再構築
                const indent = Outline.indentOf(lines[target.lineIdx]);
                draft.rewrite(target.lineIdx, `${indent}- ${op.key}:: ${this.formatValue(op.value, target.value)}`);
                continue;
            }

            // 新規挿入（ルールA: 正準位置）: 既存の own プロパティ行があれば
            // その最後の兄弟として部分木の後ろ（宣言塊を保つ・インデント踏襲。
            // その行の下の行はその行のまま）、なければタスクの最初の子
            // （タスクの本文の続きの行の後ろ）。インデントは既存子行の表現を
            // 踏襲する（`FileOperations.resolveChildIndent`）。
            const line = `- ${op.key}:: ${this.formatValue(op.value, null)}`;
            const spot = ownLines.length > 0
                ? Placement.afterSubtree(lines, ownLines[ownLines.length - 1].lineIdx, line)
                : Placement.firstChild(lines, taskLineIdx, line);
            draft.put(spot, Block.line(line));
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
