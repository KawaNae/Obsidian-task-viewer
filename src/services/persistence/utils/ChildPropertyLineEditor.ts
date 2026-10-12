import { PropertyKey } from '../../parsing/utils/PropertyKey';
import { PROPERTY_LINE, PropertyLines } from '../../parsing/utils/PropertyLines';
import { Block, Placement } from './Placement';
import type { PropertyOp } from '../PropertyUpdatePlanner';
import type { LineDraft } from '../FileLines';
import type { OutlineReading } from '../../parsing/utils/Outline';

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
 * - op のキーに当たる行は、大文字と小文字を区別せずに探す（`PropertyKey`）。
 *   更新はその行のキーの綴りを保ち、op のキーの綴りは新しく足す行にだけ使う
 * - set は「最後の own 宣言行」を書き換え、delete は全 own 宣言行を除去
 *   する。同じキーが2行以上あれば読みはそのキーを読まない
 *   （`PropertyLines.read`）ので、set では重複が残り、値は読まれないまま
 *   である
 */
export class ChildPropertyLineEditor {
    /**
     * タスク直下の own プロパティ行を列挙する。どの行が own かはパーサと
     * 同じ1か所（`PropertyLines.ofTask`）が決める: ノート全体の読み
     * （`Outline.read`）でタスクの項目を親に持つ項目のうち、コードでない
     * `- key:: value` 行。子タスクやメモの下、コードブロックの中の行は
     * own でない。読まれない行（同じキーの2行目、日付のキー）も含む。
     */
    static findOwnPropertyLines(outline: OutlineReading, taskLineIdx: number): OwnPropertyLine[] {
        return PropertyLines.ofTask(outline, taskLineIdx).lines
            .map(line => ({ lineIdx: line.line, key: line.key, value: line.written }));
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
     *
     * `unit` は Obsidian の設定が言う一段の字下げ（`ObsidianConfig.indentUnit`）
     * で、子の無いタスクに最初のプロパティ行を足すときの字下げになる。
     */
    static applyOps(draft: LineDraft, taskLineIdx: number, ops: PropertyOp[], unit: string): void {
        for (const op of ops) {
            const ownLines = this.findOwnPropertyLines(draft.reading(), taskLineIdx);
            const matching = ownLines.filter(l => PropertyKey.same(l.key, op.key));

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
                // 値の前まで（字下げ、記号、キー、`::` とその後の空白）。own の行は
                // PROPERTY_LINE に合うので、値の捕捉を除いた残りがそれである。
                const line = draft.lines[target.lineIdx];
                const prefix = line.slice(0, line.length - line.match(PROPERTY_LINE)![2].length);
                const value = this.formatValue(op.value);
                // 空値行 (`- key ::`) はプレフィックスが `::` で終わるため、
                // 値を書き込むときはセパレータの空白を補う
                const sep = value !== '' && !/\s$/.test(prefix) ? ' ' : '';
                // 値が変わっただけで、行の素性は変わらない。
                draft.rewrite(target.lineIdx, prefix + sep + value);
                continue;
            }

            // 新規挿入（ルールA: 正準位置）: 既存の own プロパティ行があれば
            // その最後の兄弟として部分木の後ろ（宣言塊を保つ。その行の下の
            // 行はその行のまま）、なければタスクの最初の子（タスクの本文の
            // 続きの行の後ろ）。新しい行なので、字下げは隣の項目の綴りで、
            // 隣に兄弟が無ければ子の字下げ（`Placement.resolveChildIndent`。
            // 子が1つも無ければ Obsidian の設定の一段）。
            const line = `- ${op.key}:: ${this.formatValue(op.value)}`;
            const spot = ownLines.length > 0
                ? Placement.afterSubtree(draft.reading(), ownLines[ownLines.length - 1].lineIdx, line, unit)
                : Placement.firstChild(draft.reading(), taskLineIdx, line, unit);
            draft.put(spot, Block.line(line));
        }
    }

    /**
     * op.value を子行の値表現にフォーマットする。tags（string[]）は常に
     * `#a #b` で書く。Obsidian が `tags::` の行から読むのは `#tag` だけなので
     * （`TagExtractor.fromContent`）、既存の行がカンマ区切りでもこの形に書き換える。
     */
    private static formatValue(value: string | string[] | undefined): string {
        if (value === undefined) return '';
        if (!Array.isArray(value)) return value;
        return value.map(t => `#${t}`).join(' ');
    }
}
