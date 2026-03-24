import type { Task, FrontmatterTaskKeys, PropertyValue } from '../../../types';
import type { DocumentNode, SectionNode, TaskBlock } from './DocumentTree';
import { BuiltinPropertyExtractor } from './BuiltinPropertyExtractor';
import { ChildLineClassifier } from '../utils/ChildLineClassifier';
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
        output: Task[]
    ): void {
        let task = TaskParser.parse(block.rawLine, ctx.filePath, block.line);

        // 非デイリーノートかつFM/Container親がないファイルで、
        // 時刻のみ（日付なし）のタスクはプレーンチェックボックスとして扱う
        if (task && !ctx.dailyNoteDate && !ctx.hasFrontmatterParent
            && !task.startDate && !task.endDate && !task.due
            && (!task.commands || task.commands.length === 0)) {
            task = null;
        }

        if (!task) return;

        // デイリーノートの日付を継承
        if (ctx.dailyNoteDate) {
            Object.assign(task, ImplicitCalendarDateResolver.resolveDailyNoteDates(task, ctx.dailyNoteDate));
        }

        // インデントを設定
        task.indent = block.indent;
        task.childIds = [];

        // 子タスクブロックを再帰的に処理
        const childTasks: Task[] = [];
        for (const childBlock of block.childTaskBlocks) {
            this.processTaskBlock(childBlock, section, ctx, childTasks);
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

        // childLines 設定: 子タスクとその配下行を除外
        const children = block.childRawLines;
        const childTaskLineSet = new Set<number>();
        for (const ct of childTasks) {
            childTaskLineSet.add(ct.line);
        }

        const excludeIndices = new Set<number>();
        for (let k = 0; k < children.length; k++) {
            const absLine = block.childLineNumbers[k];
            if (!childTaskLineSet.has(absLine)) continue;
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

        // インデント正規化 + 子タスク行除外
        const nonEmptyChildren = children.filter(c => c.trim() !== '');
        if (nonEmptyChildren.length > 0) {
            const minIndent = Math.min(...nonEmptyChildren.map(c => c.search(/\S|$/)));
            const normalized = children.map(c => {
                if (c.trim() === '') return c;
                return c.substring(minIndent);
            });

            const ownLines: string[] = [];
            for (let k = 0; k < normalized.length; k++) {
                if (excludeIndices.has(k)) continue;
                ownLines.push(normalized[k]);
            }

            task.childLines = ChildLineClassifier.classifyLines(ownLines);
        } else {
            task.childLines = ChildLineClassifier.classifyLines(children);
        }

        // 子行プロパティを収集
        const rawProps = ChildLineClassifier.collectProperties(task.childLines);

        // 組み込みプロパティを専用フィールドに分離
        const extracted = BuiltinPropertyExtractor.extract(rawProps, ctx.frontmatterTaskKeys);

        // セクションプロパティ → 子行プロパティの順でマージ（child-wins）
        task.properties = { ...section.resolvedProperties, ...extracted.properties };

        // 組み込みプロパティ: 子行のみ直接セット、セクション由来は退避（親タスク継承より弱い）
        task.color = extracted.color;
        task.linestyle = extracted.linestyle;
        task.mask = extracted.mask;
        task.sectionColor = section.resolvedColor;
        task.sectionLinestyle = section.resolvedLinestyle;
        task.sectionMask = section.resolvedMask;

        output.push(task);
        output.push(...childTasks);
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
