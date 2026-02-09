import { Task } from '../../types';
import { TaskIndex } from '../../services/core/TaskIndex';
import { NotationUtils } from './NotationUtils';

/** 子タスク描画用の統一データ構造 */
export interface ChildRenderItem {
    markdown: string;
    notation: string | null;
    isCheckbox: boolean;
    handler: CheckboxHandler | null;
}

export type CheckboxHandler =
    | { type: 'task'; taskId: string }
    | { type: 'childLine'; parentTask: Task; childLineIndex: number };

/**
 * タスクデータ → ChildRenderItem[] 変換。
 * inline childLines / frontmatter childIds の両方に対応。
 * wikilink 解決・再帰展開を含む。
 */
export class ChildItemBuilder {
    private static readonly MAX_RENDER_DEPTH = 10;

    constructor(private taskIndex: TaskIndex) {}

    /**
     * Inline タスクの childLines → ChildRenderItem[]。
     * wikilink→checkbox 変換、@notation 抽出、再帰展開を実行。
     * @param indent 各行に付与するインデントプレフィックス（collapsed: '', non-collapsed: '    '）
     */
    buildInlineChildItems(task: Task, indent: string): ChildRenderItem[] {
        // childIdByLine: inline 子タスクの行番号 → Task
        const childIdByLine = new Map<number, Task>();
        for (const childId of task.childIds) {
            const child = this.taskIndex.getTask(childId);
            if (child && child.line >= 0) childIdByLine.set(child.line, child);
        }

        // wikilink 子タスク検出
        const wikiTaskByIdx = new Map<number, Task>();
        for (let i = 0; i < task.childLines.length; i++) {
            const wikiMatch = task.childLines[i].match(/^(\s*)-\s+\[\[([^\]]+)\]\]\s*$/);
            if (!wikiMatch) continue;
            const linkName = wikiMatch[2].trim();
            const wikiTask = this.findWikiLinkChild(task, childIdByLine, linkName);
            if (wikiTask) wikiTaskByIdx.set(i, wikiTask);
        }

        const items: ChildRenderItem[] = [];
        const visitedIds = new Set<string>();

        for (let idx = 0; idx < task.childLines.length; idx++) {
            const childLine = task.childLines[idx];
            const wikiTask = wikiTaskByIdx.get(idx);

            if (wikiTask) {
                // wikilink → checkbox 変換
                const lineIndent = (childLine.match(/^(\s*)/)?.[1]) ?? '';
                const linkName = childLine.match(/\[\[([^\]]+)\]\]/)?.[1] ?? '';
                items.push({
                    markdown: `${indent}${lineIndent}- [${wikiTask.statusChar || ' '}] [[${linkName}]]`,
                    notation: NotationUtils.buildNotationLabel(wikiTask),
                    isCheckbox: true,
                    handler: { type: 'task', taskId: wikiTask.id }
                });
                // wikilink 子の子孫を再帰展開（childLines + childIds）
                this.appendDescendants(
                    wikiTask, indent + lineIndent + '    ', task.id,
                    items, visitedIds, 0
                );
            } else {
                items.push(this.processChildLine(childLine, idx, task, indent));
            }
        }

        return items;
    }

    /**
     * Frontmatter タスクの子孫（childLines + childIds）を ChildRenderItem[] に変換。
     * appendDescendants を親タスク起点で実行し、ファイル内順序を維持する。
     */
    buildFrontmatterChildItems(parentTask: Task): ChildRenderItem[] {
        const items: ChildRenderItem[] = [];
        const visitedIds = new Set<string>();
        this.appendDescendants(parentTask, '', parentTask.id, items, visitedIds, 0);
        return items;
    }

    /**
     * タスクの childLines + childIds を再帰的に ChildRenderItem[] に追加。
     * Phase 1: childLines をファイル順に走査（childIdTask/orphan/wikilink/plain text）
     * Phase 2: childLines に出現しなかった残りの childIds を追加
     * visitedIds でサイクル防止、depth で深度制限。
     */
    private appendDescendants(
        task: Task,
        indent: string,
        rootId: string,
        items: ChildRenderItem[],
        visitedIds: Set<string>,
        depth: number = 0
    ): void {
        if (depth >= ChildItemBuilder.MAX_RENDER_DEPTH) return;

        // childIdByLine: この task の childIds を行番号でマップ
        const childIdByLine = new Map<number, Task>();
        for (const childId of task.childIds) {
            const child = this.taskIndex.getTask(childId);
            if (child && child.line >= 0) childIdByLine.set(child.line, child);
        }
        const renderedChildIds = new Set<string>();
        const consumedLineKeys = new Set<string>();

        // Phase 1: childLines をファイル順に走査
        for (let i = 0; i < task.childLines.length; i++) {
            const absLine = this.resolveChildAbsoluteLine(task, i);
            const lineKey = this.toLineKey(task.file, absLine);
            if (consumedLineKeys.has(lineKey)) continue;
            const childIdTask = childIdByLine.get(absLine);

            if (childIdTask) {
                if (visitedIds.has(childIdTask.id) || childIdTask.id === rootId) {
                    renderedChildIds.add(childIdTask.id);
                    continue;
                }
                visitedIds.add(childIdTask.id);
                renderedChildIds.add(childIdTask.id);
                items.push(this.createTaskItem(childIdTask, indent, task.file));
                this.appendDescendants(
                    childIdTask, indent + '    ', rootId,
                    items, visitedIds, depth + 1
                );
                this.markTaskSubtreeLines(childIdTask, consumedLineKeys);
            } else {
                // orphan チェック
                const orphanTask = this.taskIndex.getTask(`${task.file}:${absLine}`);
                if (orphanTask) {
                    if (orphanTask.parentId && orphanTask.parentId !== task.id) {
                        continue;
                    }
                    if (visitedIds.has(orphanTask.id) || orphanTask.id === rootId) {
                        continue;
                    }
                    items.push(this.createTaskItem(orphanTask, indent, task.file));
                    visitedIds.add(orphanTask.id);
                    renderedChildIds.add(orphanTask.id);
                    this.markTaskSubtreeLines(orphanTask, consumedLineKeys);
                } else {
                    // wikilink パターン検出
                    const wikiMatch = task.childLines[i].match(/^\s*-\s+\[\[([^\]]+)\]\]\s*$/);
                    const wikiChildTask = wikiMatch
                        ? this.findWikiLinkChild(task, childIdByLine, wikiMatch[1].trim())
                        : null;
                    if (wikiChildTask && !visitedIds.has(wikiChildTask.id) && wikiChildTask.id !== rootId) {
                        visitedIds.add(wikiChildTask.id);
                        renderedChildIds.add(wikiChildTask.id);
                        const lineIndent = task.childLines[i].match(/^(\s*)/)?.[1] ?? '';
                        const wikiLinkName = wikiChildTask.file.replace(/\.md$/, '');
                        items.push({
                            markdown: `${indent}${lineIndent}- [${wikiChildTask.statusChar || ' '}] [[${wikiLinkName}]]`,
                            notation: NotationUtils.buildNotationLabel(wikiChildTask),
                            isCheckbox: true,
                            handler: { type: 'task', taskId: wikiChildTask.id }
                        });
                        this.appendDescendants(
                            wikiChildTask, indent + lineIndent + '    ', rootId,
                            items, visitedIds, depth + 1
                        );
                        this.markTaskSubtreeLines(wikiChildTask, consumedLineKeys);
                    } else if (!wikiChildTask) {
                        // 通常の childLine テキスト
                        items.push(this.processChildLine(task.childLines[i], i, task, indent));
                    }
                }
            }
        }

        // Phase 2: childLines に出現しなかった残りの childIds
        for (const childId of task.childIds) {
            if (renderedChildIds.has(childId) || visitedIds.has(childId) || childId === rootId) continue;
            visitedIds.add(childId);
            const child = this.taskIndex.getTask(childId);
            if (!child) continue;

            items.push(this.createTaskItem(child, indent, task.file));
            this.appendDescendants(
                child, indent + '    ', rootId,
                items, visitedIds, depth + 1
            );
        }
    }

    /**
     * タスク → ChildRenderItem 変換。
     * frontmatter タスクが contextFile と異なるファイルの場合は wikilink 形式で描画。
     */
    private createTaskItem(task: Task, indent: string, contextFile: string): ChildRenderItem {
        const char = task.statusChar || ' ';
        if (task.parserId === 'frontmatter' && task.file !== contextFile) {
            const linkName = task.file.replace(/\.md$/, '');
            return {
                markdown: `${indent}- [${char}] [[${linkName}]]`,
                notation: NotationUtils.buildNotationLabel(task),
                isCheckbox: true,
                handler: { type: 'task', taskId: task.id }
            };
        }
        return {
            markdown: `${indent}- [${char}] ${task.content || '\u200B'}`,
            notation: NotationUtils.buildNotationLabel(task),
            isCheckbox: true,
            handler: { type: 'task', taskId: task.id }
        };
    }

    /**
     * 通常の childLine を ChildRenderItem に変換。
     * @notation 抽出・削除、bare checkbox ZWS パディング。
     */
    private processChildLine(line: string, idx: number, task: Task, indent: string): ChildRenderItem {
        const isCb = /^\s*-\s*\[.\]/.test(line);
        let notation: string | null = null;

        if (isCb) {
            const m = line.match(/@[\w\-:>T]+/);
            notation = m ? m[0] : null;
        }

        let cleaned = line
            .replace(/\s*@[\w\-:>T]+(?:\s*==>.*)?/g, '')
            .trimEnd();

        if (/^\s*-\s*\[.\]$/.test(cleaned)) {
            cleaned += ' \u200B';
        }

        return {
            markdown: indent + cleaned,
            notation,
            isCheckbox: isCb,
            handler: isCb
                ? { type: 'childLine', parentTask: task, childLineIndex: idx }
                : null
        };
    }

    /**
     * wikilink 子タスクを検索する。
     * 親タスクの childIds → childIdByLine タスクの childIds の順で検索。
     */
    private findWikiLinkChild(parentTask: Task, childIdByLine: Map<number, Task>, linkName: string): Task | null {
        const found = this.searchWikiChild(parentTask, linkName);
        if (found) return found;

        for (const task of childIdByLine.values()) {
            const found = this.searchWikiChild(task, linkName);
            if (found) return found;
        }
        return null;
    }

    private searchWikiChild(task: Task, linkName: string): Task | null {
        for (const childId of task.childIds) {
            const child = this.taskIndex.getTask(childId);
            if (!child || child.parserId !== 'frontmatter') continue;
            const baseName = child.file.replace(/\.md$/, '').split('/').pop() || '';
            const fullPath = child.file.replace(/\.md$/, '');
            if (linkName === baseName || linkName === fullPath || linkName === child.file) {
                return child;
            }
        }
        return null;
    }

    /**
     * childLines の絶対行番号を解決する。
     * - frontmatter: childLineBodyOffsets（絶対行）を優先
     * - inline: task.line + 1 + index
     */
    private resolveChildAbsoluteLine(task: Task, childLineIndex: number): number {
        const bodyOffset = task.childLineBodyOffsets?.[childLineIndex];
        if (typeof bodyOffset === 'number' && bodyOffset >= 0) {
            return bodyOffset;
        }
        return task.line + 1 + childLineIndex;
    }

    private toLineKey(file: string, line: number): string {
        return `${file}:${line}`;
    }

    private markTaskSubtreeLines(task: Task, consumedLineKeys: Set<string>, depth: number = 0): void {
        if (depth >= ChildItemBuilder.MAX_RENDER_DEPTH) return;
        if (task.line >= 0) {
            consumedLineKeys.add(this.toLineKey(task.file, task.line));
        }
        for (let i = 0; i < task.childLines.length; i++) {
            const absLine = this.resolveChildAbsoluteLine(task, i);
            consumedLineKeys.add(this.toLineKey(task.file, absLine));
        }
        for (const childId of task.childIds) {
            const child = this.taskIndex.getTask(childId);
            if (!child) continue;
            this.markTaskSubtreeLines(child, consumedLineKeys, depth + 1);
        }
    }
}
