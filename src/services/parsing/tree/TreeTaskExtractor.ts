import type { Task, TvFileKeys, PropertyValue } from '../../../types';
import { isTvInline } from '../../../types';
import type { DocumentNode, SectionNode, TaskBlock } from './DocumentTree';
import { BuiltinPropertyExtractor } from './BuiltinPropertyExtractor';
import { ChildLineClassifier } from '../utils/ChildLineClassifier';
import { TagExtractor } from '../utils/TagExtractor';
import { TaskParser } from '../TaskParser';
import { collectFlowLineIndices, flowLineTail } from '../../flow/FlowLineScanner';
import { flowValidation, parseFlowSegments } from '../../flow/FlowSegments';

export interface TaskExtractionContext {
    filePath: string;
    hasTvFileParent: boolean;
    tvFileKeys: TvFileKeys;
}

/**
 * classifyBlock の結果: この block は Task になるか、それとも行群として
 * 親の childLines に残るか。`task` は Task 化した場合の（style 未適用の）
 * インスタンス、`flowLineIndices` はその block の childRawLines 相対の
 * `- ==>` フロー行 index。
 */
type BlockOutcome =
    | { kind: 'task'; task: Task; flowLineIndices: Set<number> }
    | { kind: 'lines' };

/**
 * ドキュメントツリーから Task[] を抽出する。
 * SectionPropertyResolver.resolve() が呼ばれた後のツリーを受け取る。
 */
export class TreeTaskExtractor {
    static extract(doc: DocumentNode, ctx: TaskExtractionContext): Task[] {
        const allTasks: Task[] = [];
        for (const section of this.allSections(doc.sections)) {
            for (const block of section.blocks) {
                if (block.type === 'task-block') {
                    const outcome = this.classifyBlock(block, section, ctx, /*hasAncestorTask=*/false);
                    this.processTaskBlock(block, outcome, section, ctx, allTasks, false);
                }
            }
        }
        return allTasks;
    }

    /**
     * 「この block は Task になるか」の唯一の実装（判定は block あたり 1 回、
     * 結果は BlockOutcome として伝搬する — 親の childLines 除外と子の再帰が
     * 同じ結果オブジェクトを共有するので、判定の非対称バグは構造的に起きない）。
     *
     * 順序契約（この順でなければ壊れる）:
     * 1. mergeChildFlow — bare 判定より前。子行だけに flow を書いた
     *    チェックボックスはここで program を得てタスクに昇格する
     * 2. cascade 日時継承（cascadeContext に格納、raw fields は触れない）
     * 3. 抑制判定 — 非 task-bearing ファイルの日付/コマンドなし checkbox、
     *    および祖先 Task ありの bare checkbox は行群として親に残す
     */
    private static classifyBlock(
        block: TaskBlock,
        section: SectionNode,
        ctx: TaskExtractionContext,
        hasAncestorTask: boolean
    ): BlockOutcome {
        const task = TaskParser.parse(block.rawLine, ctx.filePath, block.line);
        if (!task) return { kind: 'lines' };

        const flowLineIndices = this.mergeChildFlow(task, block);

        const cc: NonNullable<Task['cascadeContext']> = {};
        if (!task.startDate && section.resolvedStartDate) cc.startDate = section.resolvedStartDate;
        if (!task.startTime && section.resolvedStartTime) cc.startTime = section.resolvedStartTime;
        if (!task.endDate && section.resolvedEndDate) cc.endDate = section.resolvedEndDate;
        if (!task.endTime && section.resolvedEndTime) cc.endTime = section.resolvedEndTime;
        if (!task.due && section.resolvedDue) cc.due = section.resolvedDue;
        if (Object.keys(cc).length > 0) task.cascadeContext = cc;

        const hasCascadeDates = !!(task.cascadeContext?.startDate || task.cascadeContext?.endDate || task.cascadeContext?.due);
        if (!ctx.hasTvFileParent && !hasCascadeDates
            && !task.startDate && !task.endDate && !task.due
            && !task.flow?.program) {
            return { kind: 'lines' };
        }

        if (hasAncestorTask && this.isBareCheckbox(task)) {
            return { kind: 'lines' };
        }

        return { kind: 'task', task, flowLineIndices };
    }

    /**
     * TaskBlock を再帰的に処理してタスクを抽出する。自分の判定結果
     * （outcome）は呼び出し元が classifyBlock 済み。子 block の判定は
     * ここで 1 回だけ行い、childLines 除外と再帰の両方が同じ結果を使う。
     */
    private static processTaskBlock(
        block: TaskBlock,
        outcome: BlockOutcome,
        section: SectionNode,
        ctx: TaskExtractionContext,
        output: Task[],
        hasAncestorTask: boolean = false
    ): void {
        if (outcome.kind === 'lines') {
            // 親はプレーンチェックボックスだが、子タスクブロックは再帰処理する
            for (const childBlock of block.childTaskBlocks) {
                const childOutcome = this.classifyBlock(childBlock, section, ctx, hasAncestorTask);
                this.processTaskBlock(childBlock, childOutcome, section, ctx, output, hasAncestorTask);
            }
            return;
        }

        const task = outcome.task;

        // インデントを設定
        task.indent = block.indent;
        task.childIds = [];

        // 子 block の判定を一括で 1 回だけ（除外と再帰の共有ソース）。
        // 自分が Task 化したので、子から見ると祖先 Task が存在する。
        const childOutcomes = block.childTaskBlocks.map(cb => ({
            block: cb,
            outcome: this.classifyBlock(cb, section, ctx, /*hasAncestorTask=*/true),
        }));

        // childLines 設定: まず子タスク行を特定するため childRawLines を処理
        const children = block.childRawLines;

        // 実際にタスクを生成する childTaskBlocks のみ childLines から除外する
        // （plain `- [ ]` は祖先に Task（＝自分）がいるため Task 化されず childLines に残す）
        const taskProducingLines = new Set<number>();
        for (const co of childOutcomes) {
            if (co.outcome.kind === 'task') {
                taskProducingLines.add(co.block.line);
            }
        }

        // フロー子行はコンテンツではなくコマンドの物理表現なので
        // childLines（描画・コピー・プロパティ収集の substrate）から除外する
        const excludeIndices = new Set<number>(outcome.flowLineIndices);
        for (let k = 0; k < children.length; k++) {
            const absLine = block.childLineNumbers[k];
            if (!taskProducingLines.has(absLine)) continue;
            excludeIndices.add(k);
            // この子タスクより深いインデントの後続行も除外
            const ctIndent = children[k].search(/\S|$/);
            for (let m = k + 1; m < children.length; m++) {
                const nextLine = children[m];
                if (nextLine.trim() === '') { excludeIndices.add(m); continue; }
                if (nextLine.search(/\S|$/) > ctIndent) {
                    excludeIndices.add(m);
                } else {
                    break;
                }
            }
        }

        // インデント正規化 + タスク生成行除外 + 絶対行番号の付与
        const nonEmptyChildren = children.filter(c => c.trim() !== '');
        if (nonEmptyChildren.length > 0) {
            const minIndent = Math.min(...nonEmptyChildren.map(c => c.search(/\S|$/)));
            const normalized = children.map(c => {
                if (c.trim() === '') return c;
                return c.substring(minIndent);
            });

            const ownLines: string[] = [];
            const ownLineNumbers: number[] = [];
            for (let k = 0; k < normalized.length; k++) {
                if (excludeIndices.has(k)) continue;
                ownLines.push(normalized[k]);
                ownLineNumbers.push(block.childLineNumbers[k]);
            }

            task.childLines = ChildLineClassifier.classifyLines(ownLines, ownLineNumbers);
        } else {
            task.childLines = ChildLineClassifier.classifyLines(children, block.childLineNumbers);
        }

        // 子行プロパティを収集
        const rawProps = ChildLineClassifier.collectProperties(task.childLines);

        // 組み込みプロパティを専用フィールドに分離
        const extracted = BuiltinPropertyExtractor.extract(rawProps, ctx.tvFileKeys);

        // セクションプロパティ → 子行プロパティの順でマージ（child-wins）
        task.properties = { ...section.resolvedProperties, ...extracted.properties };

        // カスケード: 子行 > セクション（FM含む）。タスク親子間は継承しない（日付と同一原則）
        task.color = extracted.color ?? section.resolvedColor;
        task.linestyle = extracted.linestyle ?? section.resolvedLinestyle;
        task.mask = extracted.mask ?? section.resolvedMask;

        // タグのマージ: section resolved + childLine property + content tags（union）
        const sectionTags = section.resolvedTags ?? [];
        const propertyTags = extracted.tags ?? [];
        if (sectionTags.length > 0 || propertyTags.length > 0) {
            task.tags = TagExtractor.merge(sectionTags, propertyTags, task.tags);
        }

        // 子タスクブロックを再帰的に処理（判定は上で計算済みの outcome を
        // 再利用 — 再パースしない）
        const childTasks: Task[] = [];
        for (const co of childOutcomes) {
            this.processTaskBlock(co.block, co.outcome, section, ctx, childTasks, /*hasAncestorTask=*/true);
        }

        // 親子関係を設定（直接の子のみ: インデント差 +1/+2/+4）
        const taskIndent = block.indent;
        for (const childTask of childTasks) {
            if (childTask.indent === taskIndent + 1
                || childTask.indent === taskIndent + 2
                || childTask.indent === taskIndent + 4) {
                childTask.parentId = task.id;
                task.childIds.push(childTask.id);
            }
        }

        output.push(task);
        output.push(...childTasks);
    }

    /**
     * 直下の `- ==>` フロー子行を task.flow に merge し、joined ソースで
     * プログラムを再パースする。戻り値は childRawLines 相対の flow 行 index
     * （childLines からの除外用）。
     *
     * flow 行の所有判定は FlowLineScanner に一元化されている（構造上の親が
     * タスク行である行のみ）。ネストした checkbox 配下の flow 行はその
     * checkbox 自身の merge が拾う。
     */
    private static mergeChildFlow(task: Task, block: TaskBlock): Set<number> {
        if (!isTvInline(task)) return new Set();

        const indices = collectFlowLineIndices([block.rawLine, ...block.childRawLines], 0)
            .map(i => i - 1);
        if (indices.length === 0) return new Set();

        const oldFlow = task.flow;
        const childSegments = indices.map(k => ({
            raw: flowLineTail(block.childRawLines[k]) ?? '',
            bodyLine: block.childLineNumbers[k],
        }));
        const { program, diagnostics } = parseFlowSegments([
            oldFlow?.raw ?? '',
            ...childSegments.map(s => s.raw),
        ]);
        task.flow = { raw: oldFlow?.raw ?? '', childSegments, program, diagnostics };

        // validation の鮮度: line-level パースが載せた flow 診断は joined で
        // 解消され得る（例: タスク行単体では orphan-modifier）。旧 flow 診断
        // 由来の validation はクリアし、joined の結果から再導出する。
        // 日付ルール等 flow 以外の validation は温存。
        const oldFlowCodes = new Set((oldFlow?.diagnostics ?? []).map(d => d.code));
        if (task.validation && oldFlowCodes.has(task.validation.rule)) {
            task.validation = undefined;
        }
        if (!task.validation) {
            task.validation = flowValidation(task.flow);
        }
        return new Set(indices);
    }

    /**
     * `- [ ]` のみで日付・時刻・コマンドを一切持たないチェックボックスか。
     * Task Viewer の inline parser 統一後、parserId は不変なため
     * フィールド有無で「bare」を判定する。
     */
    private static isBareCheckbox(task: Task): boolean {
        return !task.startDate && !task.startTime
            && !task.endDate && !task.endTime
            && !task.due
            && !task.flow?.program;
    }

    /** セクションツリーを深さ優先でフラットに展開 */
    private static allSections(sections: SectionNode[]): SectionNode[] {
        const result: SectionNode[] = [];
        const stack = [...sections];
        while (stack.length > 0) {
            const s = stack.shift()!;
            result.push(s);
            stack.unshift(...s.children);
        }
        return result;
    }
}
