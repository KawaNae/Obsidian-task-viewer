import { TFile } from 'obsidian';
import { TaskScanner } from '../../../src/services/core/TaskScanner';
import { TaskStore } from '../../../src/services/core/TaskStore';
import { TaskValidator } from '../../../src/services/core/TaskValidator';
import { InlineTaskWriter } from '../../../src/services/persistence/writers/InlineTaskWriter';
import { TaskCloner } from '../../../src/services/persistence/TaskCloner';
import { TaskRepository } from '../../../src/services/persistence/TaskRepository';
import { FileOperations } from '../../../src/services/persistence/utils/FileOperations';
import { DEFAULT_SETTINGS } from '../../../src/types';
import type { Task } from '../../../src/types';
import type { LineEdit, Refusal, WriteChannel } from '../../../src/services/persistence/FileLines';

/**
 * A vault in memory with a real `TaskScanner` over it, and the write layer
 * connected to that scanner the way `TaskIndex` connects it: a write files its
 * report with it (`writeSink`), hands what it left once it landed to it
 * (`landed`), and hands its refusals to {@link WriteBench.refused}.
 *
 * A write takes its target by the index's copy of it. So a test scans the
 * file first and hands the writer a task from the index
 * ({@link WriteBench.taskAt}), not one built by hand.
 *
 * `vault.process` rewrites the content and nothing else: no scan follows a
 * write unless the test asks for one ({@link WriteBench.scan}). What a write
 * left is in the index all the same, as it is in the plugin; a copy taken
 * before the write is still the copy it was.
 */

export const FILE = 'note.md';

export function makeFile(path: string): TFile {
    const file = new TFile();
    file.path = path;
    file.name = path.split('/').pop() ?? path;
    file.basename = file.name.replace(/\.[^.]+$/, '');
    file.extension = path.split('.').pop() ?? '';
    return file;
}

/** What one write that landed handed the channel. */
export interface Filed {
    file: string;
    before: string[];
    after: string[];
    /** Null for a write that could not say how it changed the lines (a mark). */
    edits: LineEdit[] | null;
}

export interface WriteBench {
    readonly app: any;
    readonly contents: Map<string, string>;
    readonly scanner: TaskScanner;
    readonly writer: InlineTaskWriter;
    readonly cloner: TaskCloner;
    readonly repo: TaskRepository;
    /** Every write given up, in order, as the channel was told it. */
    readonly refused: Refusal[];
    /** What every write that landed left, in order. */
    readonly filed: Filed[];
    /** The channel a write to `path` is handed. */
    channel(path?: string): WriteChannel;
    text(path?: string): string;
    lines(path?: string): string[];
    /** Something other than the plugin changed the file. No scan follows. */
    edit(text: string | string[], path?: string): void;
    scan(path?: string): Promise<void>;
    /** The index's tasks in `path`, in line order. */
    tasks(path?: string): Task[];
    /** The index's task on `line` of `path`. Throws when the scan read none there. */
    taskAt(line: number, path?: string): Task;
}

/**
 * Build the bench over `files` (one text is `note.md`) and scan every file once.
 */
export async function writeBench(files: string | string[] | Record<string, string>): Promise<WriteBench> {
    const contents = new Map<string, string>(
        typeof files === 'string' ? [[FILE, files]]
            : Array.isArray(files) ? [[FILE, files.join('\n')]]
            : Object.entries(files),
    );

    // Obsidian holds one TFile per note, and a write to it queues by that
    // object (`processOrFail`): the same path answers the same file.
    const held = new Map<string, TFile>();
    const fileAt = (path: string): TFile => held.get(path) ?? held.set(path, makeFile(path)).get(path)!;
    const app: any = {
        vault: {
            read: async (file: TFile) => contents.get(file.path) ?? '',
            cachedRead: async (file: TFile) => contents.get(file.path) ?? '',
            process: async (file: TFile, fn: (data: string) => string) => {
                const next = fn(contents.get(file.path) ?? '');
                contents.set(file.path, next);
                return next;
            },
            modify: async (file: TFile, data: string) => { contents.set(file.path, data); },
            create: async (path: string, data: string) => { contents.set(path, data); return fileAt(path); },
            getAbstractFileByPath: (path: string) => (contents.has(path) ? fileAt(path) : null),
            getMarkdownFiles: () => [...contents.keys()].map(fileAt),
        },
        metadataCache: { getCache: () => null },
    };

    const store = new TaskStore(DEFAULT_SETTINGS);
    const scanner = new TaskScanner(app as never, store, new TaskValidator(), DEFAULT_SETTINGS);

    const refused: Refusal[] = [];
    const filed: Filed[] = [];
    const channel = (path: string): WriteChannel => ({
        landed: landing => {
            filed.push({ file: path, before: [...landing.before], after: [...landing.lines], edits: landing.edits ? [...landing.edits] : null });
            scanner.landed(path, landing);
        },
        refused: refusal => { refused.push(refusal); },
        follow: (read, line, now) => scanner.followLine(path, read, line, now),
        reading: () => scanner.readingOf(path),
    });

    const repo = new TaskRepository(app);
    repo.connect(channel);
    const writes = (path: string) => repo.channelOf(path);
    const fileOps = new FileOperations(app);

    const bench: WriteBench = {
        app,
        contents,
        scanner,
        writer: new InlineTaskWriter(app, fileOps, writes),
        cloner: new TaskCloner(app, fileOps, writes),
        repo,
        refused,
        filed,
        channel: (path = FILE) => channel(path),
        text: (path = FILE) => contents.get(path) ?? '',
        lines: (path = FILE) => (contents.get(path) ?? '').split('\n'),
        edit: (text, path = FILE) => { contents.set(path, Array.isArray(text) ? text.join('\n') : text); },
        scan: async (path = FILE) => { await scanner.requestScan(makeFile(path)); },
        tasks: (path = FILE) => store.getTasks()
            .filter(task => task.file === path)
            .sort((a, b) => a.line - b.line),
        taskAt: (line, path = FILE) => {
            const task = store.getTasks().find(candidate => candidate.file === path && candidate.line === line);
            if (!task) throw new Error(`writeBench: the scan read no task on ${path}:${line}`);
            return task;
        },
    };

    for (const path of contents.keys()) await bench.scan(path);
    return bench;
}
