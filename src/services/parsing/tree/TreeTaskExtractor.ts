import type { Task, FrontmatterTaskKeys, PropertyValue } from '../../../types';
import type { DocumentNode, SectionNode, TaskBlock } from './DocumentTree';
import { BuiltinPropertyExtractor } from './BuiltinPropertyExtractor';
import { ChildLineClassifier } from '../utils/ChildLineClassifier';
import { TagExtractor } from '../utils/TagExtractor';
import { TaskParser } from '../TaskParser';
import { ImplicitCalendarDateResolver } from '../../display/ImplicitCalendarDateResolver';

export interface TaskExtractionContext {
    filePath: string;
    dailyNoteDate?: string;
    hasFrontmatterParent: boolean;
    frontmatterTaskKeys: FrontmatterTaskKeys;
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
     * 現 extractTasksFromLines のロジックを忠実に移植。
     */
    private static processTaskBlock(
        block: TaskBlock,
        section: SectionNode,
        ctx: TaskExtractionContext,
        output: Task[],
        parentStyle?: { color?: string; linestyle?: string; mask?: string }
    ): void {
        let task = TaskParser.parse(block.rawLine, ctx.filePath, block.line);

        // 非デイリーノートかつFM/Container親がないファイルで、
        // 時刻のみ（日付なし）のタスクはプレーンチェックボックスとして扱う
        if (task && !ctx.dailyNoteDate && !ctx.hasFrontmatterParent
            && !task.startDate && !task.endDate && !task.due
            && (!task.commands || task.commands.length === 0)) {
            task = null;
        }

        if (!task) {
            // 親はプレーンチェックボックスだが、子タスクブロックは再帰処理する
            for (const childBlock of block.childTaskBlocks) {
                this.processTaskBlock(childBlock, section, ctx, output, parentStyle);
            }
            return;
        }

        // デイリーノートの日付を継承
        if (ctx.dailyNoteDate) {
            Object.assign(task, ImplicitCalendarDateResolver.resolveDailyNoteDates(task, ctx.dailyNoteDate));
        }

        // インデントを設定
        task.indent = block.indent;
        task.childIds = [];

        // childLines 設定: まず子タスク行を特定するため childRawLines を処理
        const children = block.childRawLines;

        // 実際にタスクを生成する childTaskBlocks のみ childLines から除外する
        // （@notation なしの - [x] 行はタスクにならないため childLines に残す）
        const taskProducingLines = new Set<number>();
        for (const cb of block.childTaskBlocks) {
            if (this.isTaskProducing(cb.rawLine, ctx.filePath, cb.line, ctx)) {
                taskProducingLines.add(cb.line);
            }
        }

        const excludeIndices = new Set<number>();
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

        // インデント正規化 + タスク生成行除外 + childLineBodyOffsets 構築
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

            task.childLines = ChildLineClassifier.classifyLines(ownLines);
            task.childLineBodyOffsets = ownLineNumbers;
        } else {
            task.childLines = ChildLineClassifier.classifyLines(children);
            task.childLineBodyOffsets = [...block.childLineNumbers];
        }

        // 子行プロパティを収集
        const rawProps = ChildLineClassifier.collectProperties(task.childLines);

        // 組み込みプロパティを専用フィールドに分離
        const extracted = BuiltinPropertyExtractor.extract(rawProps, ctx.frontmatterTaskKeys);

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
        const style = { color: task.color, linestyle: task.linestyle, mask: task.mask };
        const childTasks: Task[] = [];
        for (const childBlock of block.childTaskBlocks) {
            this.processTaskBlock(childBlock, section, ctx, childTasks, style);
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

    /** childTaskBlock がタスクを生成するかを判定する */
    private static isTaskProducing(
        rawLine: string, filePath: string, lineNumber: number, ctx: TaskExtractionContext
    ): boolean {
        let task = TaskParser.parse(rawLine, filePath, lineNumber);
        if (task && !ctx.dailyNoteDate && !ctx.hasFrontmatterParent
            && !task.startDate && !task.endDate && !task.due
            && (!task.commands || task.commands.length === 0)) {
            task = null;
        }
        return task !== null;
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
