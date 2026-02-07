import { App, TFile } from 'obsidian';
import { Task } from '../../types';

/**
 * `- [[name]]` パターンのwikilink子タスクを解決し、親子関係をワイアーする。
 * 全ファイルスキャン後のポストパスとして実行される。
 * 新規タスクは作成しない — 既存のタスクMap上で関係だけを更新する。
 */
export class WikiLinkResolver {
    // `- [[name]]` を検出する正規表現（チェックボックス無し）
    private static readonly WIKI_LINK_CHILD_REGEX = /^\s*-\s+\[\[([^\]]+)\]\]\s*$/;

    /**
     * タスクMap全体をスキャンし、wikilink子タスクの親子関係を解決する。
     * @param tasks タスクインデックス (id → Task)
     * @param app Obsidian App インスタンス
     * @param excludedPaths 除外パスリスト
     */
    static resolve(tasks: Map<string, Task>, app: App, excludedPaths: string[]): void {
        for (const [parentId, parentTask] of tasks) {
            // frontmatter タスク: wikiLinkTargets を使用（childLines は空）
            if (parentTask.wikiLinkTargets && parentTask.wikiLinkTargets.length > 0) {
                for (const linkName of parentTask.wikiLinkTargets) {
                    const resolvedPath = this.resolveWikiLink(linkName, app, excludedPaths);
                    if (!resolvedPath) continue;
                    this.wireChild(parentTask, parentId, tasks, resolvedPath);
                }
                continue;
            }

            // inline タスク: childLines から wikilink パターンを検出
            if (!parentTask.childLines || parentTask.childLines.length === 0) continue;

            for (const line of parentTask.childLines) {
                const match = line.match(this.WIKI_LINK_CHILD_REGEX);
                if (!match) continue;

                const linkName = match[1].trim();
                const resolvedPath = this.resolveWikiLink(linkName, app, excludedPaths);
                if (!resolvedPath) continue;
                this.wireChild(parentTask, parentId, tasks, resolvedPath);
            }
        }
    }

    /**
     * 解決済みパスから子タスクを探し、親子関係をワイアする。
     */
    private static wireChild(
        parentTask: Task, parentId: string,
        tasks: Map<string, Task>, resolvedPath: string
    ): void {
        const childTaskId = `${resolvedPath}:-1`;
        const childTask = tasks.get(childTaskId);
        if (!childTask) return;

        childTask.parentId = parentId;
        if (!parentTask.childIds.includes(childTaskId)) {
            parentTask.childIds.push(childTaskId);
        }

        // 日付継承: 子が時刻のみ（日付なし）なら親の startDate を継承
        if (parentTask.startDate && !childTask.startDate && childTask.startTime) {
            childTask.startDate = parentTask.startDate;
            childTask.startDateInherited = true;
        }
        if (parentTask.startDate && !childTask.endDate && childTask.endTime) {
            childTask.endDate = parentTask.startDate;
        }
    }

    /**
     * wikilink名からvaultファイルのパスを解決する。
     * 解決順序:
     *   1. 完全パス一致 (linkName がすでに .md を含む場合)
     *   2. linkName + '.md'
     *   3. 全markdownファイルのbasenameで検索
     * 各候補は excludedPaths チェックを通る必要がある。
     */
    private static resolveWikiLink(linkName: string, app: App, excludedPaths: string[]): string | null {
        // 1. 完全パス一致
        const exact = app.vault.getAbstractFileByPath(linkName);
        if (exact instanceof TFile && !this.isExcluded(exact.path, excludedPaths)) {
            return exact.path;
        }

        // 2. .md 拡張子追加
        const withExt = app.vault.getAbstractFileByPath(`${linkName}.md`);
        if (withExt instanceof TFile && !this.isExcluded(withExt.path, excludedPaths)) {
            return withExt.path;
        }

        // 3. basename で検索
        const files = app.vault.getMarkdownFiles();
        const found = files.find(f => f.basename === linkName);
        if (found && !this.isExcluded(found.path, excludedPaths)) {
            return found.path;
        }

        return null;
    }

    private static isExcluded(filePath: string, excludedPaths: string[]): boolean {
        return excludedPaths.some(ep => filePath.startsWith(ep));
    }
}
