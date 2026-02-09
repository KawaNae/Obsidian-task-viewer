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
                // wikilink 子の子孫を再帰展開
                if (wikiTask.childIds.length > 0) {
                    this.appendDescendants(
                        wikiTask, indent + lineIndent + '    ', task.id,
                        items, visitedIds, 0
                    );
                }
            } else {
                items.push(this.processChildLine(childLine, idx, task, indent));
            }
        }

        return items;
    }

    /**
     * Frontmatter タスクの childIds → ChildRenderItem[]。
     * single-pass でファイル順に走査し、childId/orphan/wikilink を検出。
     */
    buildFrontmatterChildItems(parentTask: Task, childTasks: Task[]): ChildRenderItem[] {
        const items: ChildRenderItem[] = [];

        for (const ct of childTasks) {
            const char = ct.statusChar || ' ';

            if (ct.parserId === 'frontmatter' && ct.file !== parentTask.file) {
                const linkName = ct.file.replace(/\.md$/, '');
                items.push({
                    markdown: `- [${char}] [[${linkName}]]`,
                    notation: NotationUtils.buildNotationLabel(ct),
                    isCheckbox: true,
                    handler: { type: 'task', taskId: ct.id }
                });
            } else {
                items.push({
                    markdown: `- [${char}] ${ct.content || '\u200B'}`,
                    notation: NotationUtils.buildNotationLabel(ct),
                    isCheckbox: true,
                    handler: { type: 'task', taskId: ct.id }
                });
            }

            // single-pass: ct の childLines をファイル順に走査
            const childIdByLine = new Map<number, Task>();
            for (const childId of ct.childIds) {
                const child = this.taskIndex.getTask(childId);
                if (child && child.line >= 0) childIdByLine.set(child.line, child);
            }
            const renderedChildIds = new Set<string>();

            for (let cli = 0; cli < ct.childLines.length; cli++) {
                const absLine = ct.line + 1 + cli;
                const childIdTask = childIdByLine.get(absLine);

                if (childIdTask) {
                    const lineIndent = ct.childLines[cli].match(/^(\s*)/)?.[1] ?? '';
                    const prefix = '    ' + lineIndent;
                    items.push({
                        markdown: `${prefix}- [${childIdTask.statusChar || ' '}] ${childIdTask.content || '\u200B'}`,
                        notation: NotationUtils.buildNotationLabel(childIdTask),
                        isCheckbox: true,
                        handler: { type: 'task', taskId: childIdTask.id }
                    });
                    renderedChildIds.add(childIdTask.id);
                } else {
                    const orphanTask = this.taskIndex.getTask(`${ct.file}:${absLine}`);
                    if (orphanTask) {
                        const lineIndent = ct.childLines[cli].match(/^(\s*)/)?.[1] ?? '';
                        const prefix = '    ' + lineIndent;
                        items.push({
                            markdown: `${prefix}- [${orphanTask.statusChar || ' '}] ${orphanTask.content || '\u200B'}`,
                            notation: NotationUtils.buildNotationLabel(orphanTask),
                            isCheckbox: true,
                            handler: { type: 'task', taskId: orphanTask.id }
                        });
                    } else {
                        // wikilink パターン検出
                        const wikiMatch = ct.childLines[cli].match(/^\s*-\s+\[\[([^\]]+)\]\]\s*$/);
                        const wikiChildTask = wikiMatch
                            ? this.findWikiLinkChild(ct, childIdByLine, wikiMatch[1].trim())
                            : null;
                        if (wikiChildTask) {
                            const lineIndent = ct.childLines[cli].match(/^(\s*)/)?.[1] ?? '';
                            const prefix = '    ' + lineIndent;
                            const wikiLinkName = wikiChildTask.file.replace(/\.md$/, '');
                            items.push({
                                markdown: `${prefix}- [${wikiChildTask.statusChar || ' '}] [[${wikiLinkName}]]`,
                                notation: NotationUtils.buildNotationLabel(wikiChildTask),
                                isCheckbox: true,
                                handler: { type: 'task', taskId: wikiChildTask.id }
                            });
                            renderedChildIds.add(wikiChildTask.id);
                            if (wikiChildTask.childIds.length > 0) {
                                this.appendDescendants(
                                    wikiChildTask, prefix + '    ', parentTask.id,
                                    items, renderedChildIds
                                );
                            }
                        } else {
                            // 通常の childLine テキスト
                            const isCb = /^\s*-\s+\[.\]/.test(ct.childLines[cli]);
                            items.push({
                                markdown: '    ' + ct.childLines[cli],
                                notation: null,
                                isCheckbox: isCb,
                                handler: isCb
                                    ? { type: 'childLine', parentTask: ct, childLineIndex: cli }
                                    : null
                            });
                        }
                    }
                }
            }

            // 残りの childIds を再帰展開
            this.appendDescendants(
                ct, '    ', parentTask.id,
                items, renderedChildIds
            );
        }

        return items;
    }

    /**
     * タスクの childIds を再帰的に ChildRenderItem[] に追加。
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

        for (const childId of task.childIds) {
            if (visitedIds.has(childId) || childId === rootId) continue;
            visitedIds.add(childId);
            const child = this.taskIndex.getTask(childId);
            if (!child) continue;

            const char = child.statusChar || ' ';
            if (child.parserId === 'frontmatter' && child.file !== task.file) {
                const linkName = child.file.replace(/\.md$/, '');
                items.push({
                    markdown: `${indent}- [${char}] [[${linkName}]]`,
                    notation: NotationUtils.buildNotationLabel(child),
                    isCheckbox: true,
                    handler: { type: 'task', taskId: child.id }
                });
            } else {
                items.push({
                    markdown: `${indent}- [${char}] ${child.content || '\u200B'}`,
                    notation: NotationUtils.buildNotationLabel(child),
                    isCheckbox: true,
                    handler: { type: 'task', taskId: child.id }
                });
            }

            if (child.childIds.length > 0) {
                this.appendDescendants(
                    child, indent + '    ', rootId,
                    items, visitedIds, depth + 1
                );
            }
        }
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
}
