import { App, TFile } from 'obsidian';
import { Task, WikilinkRef, isFrontmatterTask, hasBodyLine } from '../../types';
import { TaskIdGenerator } from '../display/TaskIdGenerator';

/**
 * `- [[name]]` パターンのwikilink子タスクを解決し、親子関係をワイアーする。
 * 全ファイルスキャン後のポストパスとして実行される。
 * 新規タスクは作成しない — 既存のタスクMap上で関係だけを更新する。
 */
export class WikiLinkResolver {
    /**
     * タスクMap全体をスキャンし、wikilink子タスクの親子関係を解決する。
     * @param tasks タスクインデックス (id → Task)
     * @param wikilinkRefsMap タスクIDごとの WikilinkRef 配列
     * @param app Obsidian App インスタンス
     */
    static resolve(tasks: Map<string, Task>, wikilinkRefsMap: Map<string, WikilinkRef[]>, app: App): void {
        // wikilink 子の body 行位置を追跡（ソート用）
        const wikiChildLineMap = new Map<string, Map<string, number>>();

        for (const [parentId, parentTask] of tasks) {
            // frontmatter タスク: wikilinkRefs を使用（childLines は空）
            const refs = wikilinkRefsMap.get(parentId);
            if (refs && refs.length > 0) {
                const childLineMap = new Map<string, number>();
                for (const ref of refs) {
                    const resolvedPath = this.resolveWikiLink(ref.target, app);
                    if (!resolvedPath) continue;
                    const childTaskId = this.wireChild(parentTask, parentId, tasks, resolvedPath);
                    if (childTaskId) {
                        childLineMap.set(childTaskId, ref.bodyLine);
                    }
                }
                if (childLineMap.size > 0) {
                    wikiChildLineMap.set(parentId, childLineMap);
                }
                continue;
            }

            // inline タスク: childLines から直接子の wikilink パターンのみ検出
            if (!parentTask.childLines || parentTask.childLines.length === 0) continue;

            // childLines の最小リストインデントを求める（直接子のレベル）
            let minChildIndent = Infinity;
            for (const cl of parentTask.childLines) {
                minChildIndent = Math.min(minChildIndent, cl.indent.length);
            }

            for (const cl of parentTask.childLines) {
                if (cl.wikilinkTarget === null) continue;

                // 直接子のインデントレベルのみ処理（孫以降はスキップ）
                if (cl.indent.length !== minChildIndent) continue;

                const resolvedPath = this.resolveWikiLink(cl.wikilinkTarget, app);
                if (!resolvedPath) continue;
                this.wireChild(parentTask, parentId, tasks, resolvedPath);
            }
        }

        // frontmatter タスクの childIds をファイル内の出現順にソート
        for (const [parentId, parentTask] of tasks) {
            if (!isFrontmatterTask(parentTask) || parentTask.childIds.length <= 1) continue;
            const childLineMap = wikiChildLineMap.get(parentId);
            parentTask.childIds.sort((a, b) => {
                const lineA = this.getChildBodyLine(a, childLineMap, tasks);
                const lineB = this.getChildBodyLine(b, childLineMap, tasks);
                return lineA - lineB;
            });
        }
    }

    /**
     * childId からファイル内の出現行を取得（ソート用）
     */
    private static getChildBodyLine(
        childId: string,
        wikiLineMap: Map<string, number> | undefined,
        tasks: Map<string, Task>
    ): number {
        const wikiLine = wikiLineMap?.get(childId);
        if (wikiLine !== undefined) return wikiLine;
        const child = tasks.get(childId);
        if (child && hasBodyLine(child)) return child.line;
        return Infinity;
    }

    /**
     * 解決済みパスから子タスクを探し、親子関係をワイアする。
     * DAG制約: 自己参照・循環を禁止し、合流時は最初の親を優先する。
     */
    private static wireChild(
        parentTask: Task, parentId: string,
        tasks: Map<string, Task>, resolvedPath: string
    ): string | null {
        const childTaskId = TaskIdGenerator.generate('tv-file', resolvedPath, 'fm-root');
        const childTask = tasks.get(childTaskId);
        if (!childTask) return null;

        // 自己参照禁止
        if (childTaskId === parentId) return null;

        // 循環禁止: childTask のサブツリーに parentId が存在しないか確認
        if (this.wouldCreateCycle(childTaskId, parentId, tasks)) return null;

        // DAG: parentId は最初の親のみ設定（合流時は上書きしない）
        if (!childTask.parentId) {
            childTask.parentId = parentId;
        }
        if (!parentTask.childIds.includes(childTaskId)) {
            parentTask.childIds.push(childTaskId);
        }

        // 日付継承はデイリーノートベースに移行（TaskScanner側で処理済み）

        return childTaskId;
    }

    /**
     * childTaskId の childIds サブツリーをたどり、
     * targetId に到達可能なら true（リンク追加でサイクルが形成される）。
     */
    private static wouldCreateCycle(
        childTaskId: string, targetId: string,
        tasks: Map<string, Task>, maxDepth: number = 50
    ): boolean {
        const visited = new Set<string>();
        const stack = [childTaskId];
        while (stack.length > 0 && visited.size < maxDepth) {
            const current = stack.pop()!;
            if (current === targetId) return true;
            if (visited.has(current)) continue;
            visited.add(current);
            const task = tasks.get(current);
            if (task) {
                for (const cid of task.childIds) {
                    stack.push(cid);
                }
            }
        }
        return false;
    }

    /**
     * wikilink名からvaultファイルのパスを解決する。
     * 解決順序:
     *   1. 完全パス一致 (linkName がすでに .md を含む場合)
     *   2. linkName + '.md'
     *   3. 全markdownファイルのbasenameで検索
     * 各候補を順番に試して最初に解決できたパスを返す。
     */
    private static resolveWikiLink(linkName: string, app: App): string | null {
        const target = this.extractWikiLinkTarget(linkName);
        if (!target) {
            return null;
        }

        // 1. 完全パス一致
        const exact = app.vault.getAbstractFileByPath(target);
        if (exact instanceof TFile) {
            return exact.path;
        }

        // 2. .md 拡張子追加
        const withExt = app.vault.getAbstractFileByPath(`${target}.md`);
        if (withExt instanceof TFile) {
            return withExt.path;
        }

        // 3. basename で検索
        const files = app.vault.getMarkdownFiles();
        const found = files.find(f => f.basename === target);
        if (found) {
            return found.path;
        }

        return null;
    }

    private static extractWikiLinkTarget(linkName: string): string {
        return linkName.split('|')[0].trim();
    }
}
