import { parseYaml } from 'obsidian';
import type { Task, TaskViewerSettings } from '../../types';
import { collectGenBlocks, type GenBlock } from './gen/GenBlockCollector';
import { DocumentTreeBuilder } from './tree/DocumentTreeBuilder';
import { Outline } from './utils/Outline';
import { SectionPropertyResolver } from './tree/SectionPropertyResolver';
import { TreeTaskExtractor } from './tree/TreeTaskExtractor';

export interface FileParseResult {
    /** tv-ignore'd file: produce no tasks (caller clears existing state). */
    ignored: boolean;
    /** All tasks of the file, fully resolved. */
    tasks: Task[];
    /** `tv-gen` blocks of the file, by name. Referenced by `use("name")`. */
    genBlocks: Map<string, GenBlock>;
}

/**
 * File → Task[] parse pipeline — the single place that knows the parse
 * order contract:
 *
 *   frontmatter boundary → ignore check
 *   → DocumentTreeBuilder → SectionPropertyResolver → TreeTaskExtractor
 *
 * Frontmatter makes no task: it is the root of the property cascade, which
 * hands its dates, style and tags down to every task in the note.
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
        // The same reading a write takes of where the body begins
        // (`Placement`): a line the parser reads as body is one a write may
        // place a line at.
        const bodyStartIndex = Outline.bodyStart(lines);
        let frontmatterObj = cachedFrontmatter;
        if (bodyStartIndex > 0 && !frontmatterObj) {
            try {
                const yamlContent = lines.slice(1, bodyStartIndex - 1).join('\n');
                frontmatterObj = parseYaml(yamlContent);
            } catch {
                // YAML パースエラー時は無視（metadataCache.changed で再スキャンされる）
            }
        }

        if (this.isIgnoredByFrontmatter(frontmatterObj, lines, bodyStartIndex, settings)) {
            return { ignored: true, tasks: [], genBlocks: new Map() };
        }

        // --- ツリーパイプライン（順序契約: build → resolve → extract）---
        const doc = DocumentTreeBuilder.build(filePath, lines, bodyStartIndex);
        SectionPropertyResolver.resolve(doc, frontmatterObj, settings.scopeKeys);
        const tasks = TreeTaskExtractor.extract(doc, {
            filePath,
            scopeKeys: settings.scopeKeys,
        });

        // Blocks are collected from the whole file (frontmatter cannot hold a
        // fence, and a block is not a task, so the body offset is irrelevant).
        const { blocks: genBlocks } = collectGenBlocks(lines);

        return { ignored: false, tasks, genBlocks };
    }

    private static isIgnoredByFrontmatter(
        frontmatterObj: Record<string, any> | undefined,
        lines: string[],
        bodyStartIndex: number,
        settings: TaskViewerSettings
    ): boolean {
        const ignoreKey = settings.scopeKeys.ignore;
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
