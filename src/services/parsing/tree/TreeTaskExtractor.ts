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
 * ドキュメントツリーから Task[] を抽出する。
 * SectionPropertyResolver.resolve() が呼ばれた後のツリーを受け取る。
 */
export class TreeTaskExtractor {
    static extract(doc: DocumentNode, ctx: TaskExtractionContext): Task[] {
        const allTasks: Task[] = [];
        for (const section of this.allSections(doc.sections)) {
            for (const block of section.blocks) {
                if (block.type === 'task-block') {
                    const tasks = this.extractFromTaskBlock(block, section, ctx);
                    allTasks.push(...tasks);
                }
            }
        }
        return allTasks;
    }

    private static extractFromTaskBlock(
        block: TaskBlock,
        section: SectionNode,
        ctx: TaskExtractionContext
    ): Task[] {
        const extracted: Task[] = [];
        this.processTaskBlock(block, section, ctx, extracted);
        return extracted;
    }

    /**
     * TaskBlock を再帰的に処理してタスクを抽出する。
     * hasAncestorTask: 祖先のどこかに既に Task 化したブロックがあるか。
     *   - true のとき、このブロックが日付・コマンド共に持たない bare checkbox なら
     *     カードの ChildLine として親に残すため Task 化せず null にする。
     */
    private static processTaskBlock(
        block: TaskBlock,
        section: SectionNode,
        ctx: TaskExtractionContext,
        output: Task[],
        parentStyle?: { color?: string; linestyle?: string; mask?: string },
        hasAncestorTask: boolean = false
    ): void {
        let task = TaskParser.parse(block.rawLine, ctx.filePath, block.line);

        // `- ==>` フロー子行を merge して joined プログラムを再パース。
        // bare checkbox 判定より前が必須: 子行だけに flow を書いたチェック
        // ボックスはここで program を得てタスクに昇格する。
        let flowLineIndices = new Set<number>();
        if (task) {
            flowLineIndices = this.mergeChildFlow(task, block);
        }

        // Section/File カスケードから日時を継承（cascadeContext に格納、raw fields は触れない）
        if (task) {
            const cc: NonNullable<Task['cascadeContext']> = {};
            if (!task.startDate && section.resolvedStartDate) cc.startDate = section.resolvedStartDate;
            if (!task.startTime && section.resolvedStartTime) cc.startTime = section.resolvedStartTime;
            if (!task.endDate && section.resolvedEndDate) cc.endDate = section.resolvedEndDate;
            if (!task.endTime && section.resolvedEndTime) cc.endTime = section.resolvedEndTime;
            if (!task.due && section.resolvedDue) cc.due = section.resolvedDue;
            if (Object.keys(cc).length > 0) task.cascadeContext = cc;
        }

        // 非デイリーノートかつ task-bearing でないファイルで、
        // 日付・コマンドを持たない bare checkbox は表出させない。
        if (task) {
            const hasCascadeDates = !!(task.cascadeContext?.startDate || task.cascadeContext?.endDate || task.cascadeContext?.due);
            if (!ctx.hasTvFileParent && !hasCascadeDates
                && !task.startDate && !task.endDate && !task.due
                && !task.flow?.program) {
                task = null;
            }
        }

        // 祖先に Task がある bare checkbox（日付・コマンドなし）は
        // ChildLine として親カードに残すため Task 化しない。
        if (task && hasAncestorTask && this.isBareCheckbox(task)) {
            task = null;
        }

        if (!task) {
            // 親はプレーンチェックボックスだが、子タスクブロックは再帰処理する
            for (const childBlock of block.childTaskBlocks) {
                this.processTaskBlock(childBlock, section, ctx, output, parentStyle, hasAncestorTask);
            }
            return;
        }

        // インデントを設定
        task.indent = block.indent;
        task.childIds = [];

        // childLines 設定: まず子タスク行を特定するため childRawLines を処理
        const children = block.childRawLines;

        // 実際にタスクを生成する childTaskBlocks のみ childLines から除外する
        // （plain `- [ ]` は祖先に Task（＝自分）がいるため Task 化されず childLines に残す）
        const taskProducingLines = new Set<number>();
        for (const cb of block.childTaskBlocks) {
            if (this.isTaskProducing(cb, ctx, section, /*hasAncestorTask=*/true)) {
                taskProducingLines.add(cb.line);
            }
        }

        // フロー子行はコンテンツではなくコマンドの物理表現なので
        // childLines（描画・コピー・プロパティ収集の substrate）から除外する
        const excludeIndices = new Set<number>(flowLineIndices);
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

        // カスケード: 子行 > 親タスクブロック > セクション（FM含む）
        task.color = extracted.color ?? parentStyle?.color ?? section.resolvedColor;
        task.linestyle = extracted.linestyle ?? parentStyle?.linestyle ?? section.resolvedLinestyle;
        task.mask = extracted.mask ?? parentStyle?.mask ?? section.resolvedMask;

        // タグのマージ: section resolved + childLine property + content tags（union）
        const sectionTags = section.resolvedTags ?? [];
        const propertyTags = extracted.tags ?? [];
        if (sectionTags.length > 0 || propertyTags.length > 0) {
            task.tags = TagExtractor.merge(sectionTags, propertyTags, task.tags);
        }

        // 子タスクブロックを再帰的に処理（effective style を伝播）
        // 自分が Task 化したので、子から見ると祖先 Task が存在する。
        const style = { color: task.color, linestyle: task.linestyle, mask: task.mask };
        const childTasks: Task[] = [];
        for (const childBlock of block.childTaskBlocks) {
            this.processTaskBlock(childBlock, section, ctx, childTasks, style, /*hasAncestorTask=*/true);
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
     * childTaskBlock がタスクを生成するかを判定する。
     * processTaskBlock と同じ mergeChildFlow を通すこと（非対称だと
     * 子行 flow で昇格したタスクが親の childLines にも残り二重表出する）。
     */
    private static isTaskProducing(
        block: TaskBlock,
        ctx: TaskExtractionContext,
        section: SectionNode,
        hasAncestorTask: boolean = false
    ): boolean {
        let task = TaskParser.parse(block.rawLine, ctx.filePath, block.line);
        if (task) {
            this.mergeChildFlow(task, block);
        }
        if (task) {
            const hasCascadeDates = !!(
                (!task.startDate && section.resolvedStartDate)
                || (!task.endDate && section.resolvedEndDate)
                || (!task.due && section.resolvedDue)
            );
            if (!ctx.hasTvFileParent && !hasCascadeDates
                && !task.startDate && !task.endDate && !task.due
                && !task.flow?.program) {
                task = null;
            }
        }
        if (task && hasAncestorTask && this.isBareCheckbox(task)) {
            task = null;
        }
        return task !== null;
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
