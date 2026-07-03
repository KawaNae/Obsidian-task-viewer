import { parseYaml } from 'obsidian';
import type { Task, TaskViewerSettings, WikilinkRef } from '../../types';
import { isTvFileUnscheduled } from '../../types';
import { DocumentTreeBuilder } from './tree/DocumentTreeBuilder';
import { SectionPropertyResolver } from './tree/SectionPropertyResolver';
import { TreeTaskExtractor } from './tree/TreeTaskExtractor';
import { TVFileBuilder } from './tv-file/TVFileBuilder';

export interface FileParseResult {
    /** tv-ignore'd file: produce no tasks (caller clears existing state). */
    ignored: boolean;
    /** All tasks of the file (fm task first when present), fully resolved. */
    tasks: Task[];
    /** The tv-file (frontmatter) task, when the file is task-bearing. */
    fmTask: Task | null;
    /** Body wikilink refs of the fm task (parent-child wiring substrate). */
    wikilinkRefs: WikilinkRef[];
}

/**
 * File → Task[] parse pipeline — the single place that knows the parse
 * order contract:
 *
 *   frontmatter boundary → ignore check → TVFileBuilder (file-level task)
 *   → DocumentTreeBuilder → SectionPropertyResolver → TreeTaskExtractor
 *   → orphan re-parent
 *
 * build → resolve → extract mutate one shared DocumentNode in that exact
 * order; wrapping them here means callers cannot get it wrong. Pure with
 * respect to the vault: no I/O, no store access — TaskScanner owns
 * completion detection and store commits.
 */
export class FileParsePipeline {
    /**
     * @param cachedFrontmatter metadataCache frontmatter when available;
     *   the pipeline falls back to parsing the raw `---` block (covers the
     *   vault.modify → metadataCache.changed window).
     */
    static parse(
        filePath: string,
        lines: string[],
        cachedFrontmatter: Record<string, any> | undefined,
        settings: TaskViewerSettings
    ): FileParseResult {
        // --- Frontmatter境界検出 ---
        let bodyStartIndex = 0;
        let frontmatterObj = cachedFrontmatter;
        if (lines.length > 0 && lines[0].trim() === '---') {
            for (let i = 1; i < lines.length; i++) {
                if (lines[i].trim() === '---') { bodyStartIndex = i + 1; break; }
            }
            if (bodyStartIndex > 0 && !frontmatterObj) {
                try {
                    const yamlContent = lines.slice(1, bodyStartIndex - 1).join('\n');
                    frontmatterObj = parseYaml(yamlContent);
                } catch {
                    // YAML パースエラー時は無視（metadataCache.changed で再スキャンされる）
                }
            }
        }

        if (this.isIgnoredByFrontmatter(frontmatterObj, lines, bodyStartIndex, settings)) {
            return { ignored: true, tasks: [], fmTask: null, wikilinkRefs: [] };
        }

        const bodyLines = lines.slice(bodyStartIndex);
        const fmResult = TVFileBuilder.parse(
            filePath,
            frontmatterObj,
            bodyLines,
            bodyStartIndex,
            settings.tvFileKeys,
            settings.tvFileChildHeader,
            settings.tvFileChildHeaderLevel
        );

        // --- ツリーパイプライン（順序契約: build → resolve → extract）---
        const doc = DocumentTreeBuilder.build(filePath, lines, bodyStartIndex);
        SectionPropertyResolver.resolve(doc, frontmatterObj, settings.tvFileKeys);
        const inlineTasks = TreeTaskExtractor.extract(doc, {
            filePath,
            hasTvFileParent: fmResult !== null,
            tvFileKeys: settings.tvFileKeys,
        });

        const tasks: Task[] = [];
        let fmTask: Task | null = null;
        let wikilinkRefs: WikilinkRef[] = [];

        if (fmResult) {
            fmTask = fmResult.task;
            wikilinkRefs = fmResult.wikilinkRefs;

            // Container の content フォールバック: ファイル名の basename を使用
            if (isTvFileUnscheduled(fmTask) && !fmTask.content) {
                fmTask.content = this.basename(filePath);
            }

            // 全孤児インラインタスクを FM/Container の子にする
            for (const bt of inlineTasks) {
                if (!bt.parentId) {
                    bt.parentId = fmTask.id;
                    fmTask.childIds.push(bt.id);
                }
            }

            // Container は子がなければ作成しない
            const isEmptyContainer = isTvFileUnscheduled(fmTask)
                && fmTask.childIds.length === 0 && fmTask.childLines.length === 0;
            if (!isEmptyContainer) {
                tasks.push(fmTask);
            }
        }
        tasks.push(...inlineTasks);

        return { ignored: false, tasks, fmTask, wikilinkRefs };
    }

    private static basename(filePath: string): string {
        const base = filePath.split('/').pop() ?? filePath;
        return base.replace(/\.md$/i, '');
    }

    private static isIgnoredByFrontmatter(
        frontmatterObj: Record<string, any> | undefined,
        lines: string[],
        bodyStartIndex: number,
        settings: TaskViewerSettings
    ): boolean {
        const ignoreKey = settings.tvFileKeys.ignore;
        if (this.isTruthyIgnoreValue(frontmatterObj?.[ignoreKey])) {
            return true;
        }

        if (bodyStartIndex <= 0) {
            return false;
        }

        // metadataCache 未更新の窓に備え、raw frontmatter 行も直接照合する
        const escapedKey = ignoreKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const keyLineRegex = new RegExp(`^${escapedKey}\\s*:\\s*(.*)$`);

        for (let i = 1; i < bodyStartIndex - 1; i++) {
            const match = lines[i].match(keyLineRegex);
            if (!match) continue;
            return this.isTruthyIgnoreValue(match[1]);
        }

        return false;
    }

    private static isTruthyIgnoreValue(value: unknown): boolean {
        if (value === true || value === 1) {
            return true;
        }
        if (typeof value !== 'string') {
            return false;
        }

        const normalized = value
            .trim()
            .replace(/^['"]|['"]$/g, '')
            .replace(/\s+#.*$/, '')
            .toLowerCase();

        return normalized === 'true'
            || normalized === 'yes'
            || normalized === 'on'
            || normalized === '1';
    }
}
