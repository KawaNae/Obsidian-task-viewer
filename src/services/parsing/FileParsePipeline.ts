import { parseYaml } from 'obsidian';
import type { Task, TaskViewerSettings } from '../../types';
import { collectGenBlocks, type GenBlock } from './gen/GenBlockCollector';
import type { SectionNode } from './tree/Sections';
import { NoteSections } from './tree/NoteSections';
import { NoteTasks, type RowNamer } from './tree/NoteTasks';
import { Outline, type OutlineReading } from './utils/Outline';
import { SectionPropertyResolver } from './tree/SectionPropertyResolver';
import { lineParsers } from './TaskParser';

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
 *   the note's reading (`Outline.read`) → frontmatter → ignore check
 *   → NoteSections.read → SectionPropertyResolver.resolve → NoteTasks.extract
 *
 * Frontmatter makes no task: it is the root of the property cascade, which
 * hands its dates, style and tags down to every task in the note.
 *
 * The sections are read, then resolved in place, then read by the
 * extraction, in that exact order; wrapping them here means callers cannot
 * get it wrong. Pure with respect to the vault: no I/O, no store access —
 * TaskScanner owns the store commits.
 */
export class FileParsePipeline {
    /**
     * The frontmatter is read off `lines`, never out of metadataCache. The
     * cache describes the file at some other moment: inside a write's
     * `vault.process` it is the file before the write, and when the scan
     * a `modify` starts reads, Obsidian has not re-read it yet — while the
     * scan the `changed` that follows asks for does nothing when it reads what
     * the last scan read. A frontmatter key decides whether the note has
     * rows at all (`tv-ignore`) and what every row inherits (dates), so the
     * reading a write lands and the scan that follows have to read the same
     * lines the same way, which only the lines themselves allow.
     *
     * `name` gives each row its name (`RowNamer`): the index's scan names
     * the rows of one reading, and a reader outside the index gives its own.
     * Parsing spells no name.
     *
     * `reading` is a reading of these very lines someone already made (a
     * write's check, `processLines`), taken instead of reading them again.
     * One of other lines is not taken.
     */
    static parse(
        filePath: string,
        lines: string[],
        settings: TaskViewerSettings,
        name: RowNamer,
        reading?: OutlineReading,
    ): FileParseResult {
        const read = this.resolveSections(lines, settings, reading);
        if (!read) return { ignored: true, tasks: [], genBlocks: new Map() };
        const { outline, sections } = read;

        const tasks = NoteTasks.extract(outline, sections, {
            filePath,
            scopeKeys: settings.scopeKeys,
            parsers: lineParsers(settings),
            name,
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

    /**
     * The note's reading and its sections with every section's values
     * resolved, and where each came from (`SectionNode.resolvedSources`):
     * what `parse` extracts the rows from, for a reader who asks what a line
     * of the note inherits (`InheritedValues`). Null for a tv-ignore'd note,
     * which has no rows. `frontmatter` is the block as the YAML parser read
     * it.
     */
    static resolveSections(
        lines: readonly string[],
        settings: TaskViewerSettings,
        reading?: OutlineReading,
    ): { outline: OutlineReading; sections: SectionNode[]; frontmatter: Record<string, any> | undefined } | null {
        const outline = reading && sameLines(reading.lines, lines) ? reading : Outline.read(lines);

        // The same reading a write takes of where the body begins
        // (`Placement`): a line the parser reads as body is one a write may
        // place a line at.
        const { bodyStart } = outline;
        let frontmatterObj: Record<string, any> | undefined;
        if (bodyStart > 0) {
            try {
                const yamlContent = lines.slice(1, bodyStart - 1).join('\n');
                const parsed: unknown = parseYaml(yamlContent);
                if (parsed && typeof parsed === 'object') frontmatterObj = parsed as Record<string, any>;
            } catch {
                // A malformed block reads as no frontmatter, as metadataCache
                // reads it.
            }
        }

        if (this.isIgnoredByFrontmatter(frontmatterObj, lines, bodyStart, settings)) return null;

        const sections = NoteSections.read(outline);
        SectionPropertyResolver.resolve(sections, frontmatterObj, settings.scopeKeys);
        return { outline, sections, frontmatter: frontmatterObj };
    }

    private static isIgnoredByFrontmatter(
        frontmatterObj: Record<string, any> | undefined,
        lines: readonly string[],
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

/** Whether two arrays hold the same lines, one by one. */
function sameLines(a: readonly string[], b: readonly string[]): boolean {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}
