import { vi } from 'vitest';
import { TFile } from 'obsidian';
import { TaskScanner } from '../../../src/services/core/TaskScanner';
import { TaskStore } from '../../../src/services/core/TaskStore';
import { TaskValidator } from '../../../src/services/core/TaskValidator';
import { InlineTaskWriter } from '../../../src/services/persistence/writers/InlineTaskWriter';
import { TaskCloner } from '../../../src/services/persistence/TaskCloner';
import { TaskRepository } from '../../../src/services/persistence/TaskRepository';
import { WriteObserver } from '../../../src/services/persistence/WriteObserver';
import { FileOperations } from '../../../src/services/persistence/utils/FileOperations';
import { DEFAULT_SETTINGS } from '../../../src/types';
import type { Task } from '../../../src/types';
import type { LineEdit, Refusal, WriteChannel } from '../../../src/utils/FileLines';

/**
 * A vault in memory with a real `TaskScanner` over it, and the write layer
 * connected to that scanner the way `TaskIndex` connects it: a write asks the
 * scanner where its target stands (`locate`), files its report with it
 * (`writeSink`), and hands its refusals to {@link WriteBench.refused}.
 *
 * A write names its target, and only a row the scanner has read can be named.
 * So a test scans the file first and hands the writer a task from the index
 * ({@link WriteBench.taskAt}), not one built by hand.
 *
 * `vault.process` rewrites the content and nothing else: no scan follows a
 * write unless the test asks for one ({@link WriteBench.scan}).
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

/** One report a write handed the sink, as it was handed. */
export interface Filed {
    file: string;
    before: string[];
    after: string[];
    edits: LineEdit[];
}

export interface WriteBench {
    readonly app: any;
    readonly contents: Map<string, string>;
    readonly store: TaskStore;
    readonly scanner: TaskScanner;
    readonly writes: WriteObserver;
    readonly fileOps: FileOperations;
    readonly writer: InlineTaskWriter;
    readonly cloner: TaskCloner;
    readonly repo: TaskRepository;
    /** Every write given up, in order, as the channel was told it. */
    readonly refused: Refusal[];
    /** The reports the sink holds now: a withdrawn one is taken off again. */
    readonly filed: Filed[];
    /** How many times `vault.process` ran for each path. */
    readonly processed: Map<string, number>;
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
    const processed = new Map<string, number>();

    const app: any = {
        vault: {
            read: async (file: TFile) => contents.get(file.path) ?? '',
            cachedRead: async (file: TFile) => contents.get(file.path) ?? '',
            process: async (file: TFile, fn: (data: string) => string) => {
                processed.set(file.path, (processed.get(file.path) ?? 0) + 1);
                const next = fn(contents.get(file.path) ?? '');
                contents.set(file.path, next);
                return next;
            },
            modify: async (file: TFile, data: string) => { contents.set(file.path, data); },
            create: async (path: string, data: string) => { contents.set(path, data); return makeFile(path); },
            getAbstractFileByPath: (path: string) => (contents.has(path) ? makeFile(path) : null),
            getMarkdownFiles: () => [...contents.keys()].map(makeFile),
        },
        metadataCache: { getCache: () => null },
    };

    const store = new TaskStore(DEFAULT_SETTINGS);
    const flow = { handleTaskCompletion: vi.fn(async () => { }) };
    const scanner = new TaskScanner(
        app as never, store, new TaskValidator(), {} as never, flow as never, DEFAULT_SETTINGS,
    );
    scanner.setInitializing(false);

    const refused: Refusal[] = [];
    const filed: Filed[] = [];
    const channel = (path: string): WriteChannel => {
        const sink = scanner.writeSink(path);
        return {
            sink: (before, after, edits) => {
                const entry: Filed = { file: path, before: [...before], after: [...after], edits: [...edits] };
                filed.push(entry);
                const withdraw = sink(before, after, edits);
                return () => {
                    const at = filed.indexOf(entry);
                    if (at >= 0) filed.splice(at, 1);
                    withdraw();
                };
            },
            locate: (lines, ref) => scanner.locate(path, lines, ref),
            refused: refusal => { refused.push(refusal); },
        };
    };

    const writes = new WriteObserver();
    writes.connect(channel);
    const fileOps = new FileOperations(app);
    const repo = new TaskRepository(app);
    repo.getWriteObserver().connect(channel);

    const bench: WriteBench = {
        app,
        contents,
        store,
        scanner,
        writes,
        fileOps,
        writer: new InlineTaskWriter(app, fileOps, writes),
        cloner: new TaskCloner(app, fileOps, writes),
        repo,
        refused,
        filed,
        processed,
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
