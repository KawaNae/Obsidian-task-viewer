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
     * The frontmatter is read off `lines`, never out of metadataCache. The
     * cache describes the file at some other moment: inside a write's
     * `vault.process` it is the file before the write, and when the scan
     * a `modify` starts reads, Obsidian has not re-read it yet — while the
     * scan the `changed` that follows asks for does nothing when it reads what
     * the last scan read (`TaskScanner.rescanUnlessRead`). A frontmatter key
     * decides whether the note
     * has rows at all (`tv-ignore`) and what every row inherits (dates,
     * which the ladder compares), so a write's record, a write's `locate` and
     * the scan that follows have to read the same lines the same way, which
     * only the lines themselves allow.
     */
    static parse(
        filePath: string,
        lines: string[],
        settings: TaskViewerSettings
    ): FileParseResult {
        // --- Frontmatter境界検出 ---
        // The same reading a write takes of where the body begins
        // (`Placement`): a line the parser reads as body is one a write may
        // place a line at.
        const bodyStartIndex = Outline.bodyStart(lines);
        let frontmatterObj: Record<string, any> | undefined;
        if (bodyStartIndex > 0) {
            try {
                const yamlContent = lines.slice(1, bodyStartIndex - 1).join('\n');
                const parsed: unknown = parseYaml(yamlContent);
                if (parsed && typeof parsed === 'object') frontmatterObj = parsed as Record<string, any>;
            } catch {
                // A malformed block reads as no frontmatter, as metadataCache
                // reads it.
            }
        }

        if (this.isIgnoredByFrontmatter(frontmatterObj, lines, bodyStartIndex, settings)) {
            return { ignored: true, tasks: [], genBlocks: new Map() };
        }

        // --- ツリーパイプライン（順序契約: build → resolve → extract）---
        const outline = Outline.read(lines);
        const doc = DocumentTreeBuilder.build(filePath, lines, bodyStartIndex, outline);
        SectionPropertyResolver.resolve(doc, frontmatterObj, settings.scopeKeys);
        const tasks = TreeTaskExtractor.extract(doc, {
            filePath,
            scopeKeys: settings.scopeKeys,
        });
        // What an operation that takes a row away plans from (`RowBasis`).
        // Slices of one array share its strings, so a deep tree costs one
        // reference per line and level, not a copy of the text.
        for (const task of tasks) {
            if (task.line >= 0 && task.line < lines.length) {
                task.subtreeLines = lines.slice(task.line, outline.subtreeEnd(task.line));
            }
        }

        // Blocks are collected from the whole file (frontmatter cannot hold a
        // fence, and a block is not a task, so the body offset is irrelevant).
        const { blocks: genBlocks } = collectGenBlocks(lines, outline);

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

        // A block YAML refuses still says tv-ignore line by line.
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
