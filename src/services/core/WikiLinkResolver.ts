import { App, TFile } from 'obsidian';
import { Task, WikilinkRef, isTvFile, hasBodyLine } from '../../types';
import { TaskIdGenerator } from '../display/TaskIdGenerator';
import { logWarn, logDebug } from '../../log/log';

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
        let parentCount = 0;
        let linkCount = 0;
        let unresolvedCount = 0;

        // === clear フェーズ: wikilink 由来エッジと dangling を剥がす（冪等化の要） ===
        // パーサー（TaskScanner / TreeTaskExtractor）は 1 ファイル内で完結するため、
        // ファイルをまたぐ親子エッジは必ずこの resolver が張った wikilink 由来。
        // 毎 resolve でこれを一旦剥がし、下の rebuild で現状から張り直すことで、
        // resolve を「導出状態の冪等な再構築」にする。ファイル削除/改名でも
        // 親の childIds・子の parentId が自然に正しい状態へ収束する（dangling 解消）。
        // 同一ファイル内エッジ（@notation 子・frontmatter 孤児吸収）は親ファイルの
        // 再スキャンが面倒を見るので、ここでは一切触らない。
        this.clearCrossFileEdges(tasks);

        // wikilink 子の body 行位置を追跡（ソート用）
        const wikiChildLineMap = new Map<string, Map<string, number>>();

        for (const [parentId, parentTask] of tasks) {
            // frontmatter タスク: wikilinkRefs を使用（childLines は空）
            const refs = wikilinkRefsMap.get(parentId);
            if (refs && refs.length > 0) {
                parentCount++;
                const childLineMap = new Map<string, number>();
                for (const ref of refs) {
                    linkCount++;
                    const resolvedPath = this.resolveWikiLink(ref.target, app);
                    if (!resolvedPath) { unresolvedCount++; continue; }
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

            let hasWikilink = false;
            for (const cl of parentTask.childLines) {
                if (cl.wikilinkTarget === null) continue;

                // 直接子のインデントレベルのみ処理（孫以降はスキップ）
                if (cl.indent.length !== minChildIndent) continue;

                if (!hasWikilink) { parentCount++; hasWikilink = true; }
                linkCount++;
                const resolvedPath = this.resolveWikiLink(cl.wikilinkTarget, app);
                if (!resolvedPath) { unresolvedCount++; continue; }
                this.wireChild(parentTask, parentId, tasks, resolvedPath);
            }
        }

        // frontmatter タスクの childIds をファイル内の出現順にソート
        for (const [parentId, parentTask] of tasks) {
            if (!isTvFile(parentTask) || parentTask.childIds.length <= 1) continue;
            const childLineMap = wikiChildLineMap.get(parentId);
            parentTask.childIds.sort((a, b) => {
                const lineA = this.getChildBodyLine(a, childLineMap, tasks);
                const lineB = this.getChildBodyLine(b, childLineMap, tasks);
                return lineA - lineB;
            });
        }

        logDebug(`[WikiLink:resolved] parents=${parentCount} links=${linkCount} unresolved=${unresolvedCount}`);
    }

    /**
     * 全タスクから「ファイルをまたぐ親子エッジ（= wikilink 由来）」と
     * 「相手が消えた dangling エッジ」を除去する。同一ファイル内エッジは保持。
     * rebuild の前段として呼ばれ、resolve を冪等にする。
     */
    private static clearCrossFileEdges(tasks: Map<string, Task>): void {
        for (const [, parentTask] of tasks) {
            if (parentTask.childIds.length === 0) continue;
            parentTask.childIds = parentTask.childIds.filter(cid => {
                const child = tasks.get(cid);
                if (!child) return false;                  // dangling: 子が消えた
                return child.file === parentTask.file;       // 別ファイル(=wikilink)は除去、同一ファイルは保持
            });
        }
        for (const [, childTask] of tasks) {
            if (!childTask.parentId) continue;
            const parent = tasks.get(childTask.parentId);
            if (!parent || parent.file !== childTask.file) {
                childTask.parentId = undefined;             // dangling 親 or 別ファイル親(=wikilink)を clear
            }
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

        return childTaskId;
    }

    /**
     * childTaskId の childIds サブツリーをたどり、
     * targetId に到達可能なら true（リンク追加でサイクルが形成される）。
     */
    private static wouldCreateCycle(
        childTaskId: string, targetId: string,
        tasks: Map<string, Task>
    ): boolean {
        // visited Set が終端を保証するので深さ上限は不要。
        // 以前の maxDepth=50 cap は大きなサブツリーで本物の循環を見逃す
        // false-negative しか生まなかったため撤廃。
        const visited = new Set<string>();
        const stack = [childTaskId];
        while (stack.length > 0) {
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

        // 3. basename で検索（同名複数時は path 辞書順で決定的に1件を選ぶ）
        const files = app.vault.getMarkdownFiles();
        const matches = files.filter(f => f.basename === target);
        if (matches.length > 0) {
            if (matches.length > 1) {
                matches.sort((a, b) => a.path.localeCompare(b.path));
                logWarn(
                    `[WikiLinkResolver] Ambiguous wikilink "${target}" matches ${matches.length} files; ` +
                    `resolving to "${matches[0].path}"`
                );
            }
            return matches[0].path;
        }

        return null;
    }

    private static extractWikiLinkTarget(linkName: string): string {
        return linkName.split('|')[0].trim();
    }
}
