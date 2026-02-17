import { App, Notice } from 'obsidian';
import type { Task, TaskViewerSettings } from '../../types';
import { AiIndexOutputManager } from './AiIndexOutputManager';
import { AiIndexWriter } from './AiIndexWriter';
import { type AiIndexMeta, type NormalizedTask } from './NormalizedTask';
import { TaskNormalizer } from './TaskNormalizer';
import { VaultFileAdapter } from './VaultFileAdapter';

export class AiIndexService {
    private static readonly META_VERSION = 6;
    private static readonly WRITE_RETRY_BASE_MS = 1000;
    private static readonly WRITE_RETRY_MAX_MS = 30000;
    private static readonly NOTICE_COOLDOWN_MS = 15000;

    private fileAdapter: VaultFileAdapter;
    private outputManager: AiIndexOutputManager;
    private writer: AiIndexWriter;
    private normalizer: TaskNormalizer;
    private indexByPath: Map<string, NormalizedTask[]> = new Map();
    private pathHashes: Map<string, string> = new Map();
    private serializedByPath: Map<string, string[]> = new Map();
    private pendingPaths: Set<string> = new Set();
    private pendingDeletes: Set<string> = new Set();
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private retryWriteTimer: ReturnType<typeof setTimeout> | null = null;
    private lastError: string | null = null;
    private configSignature: string;
    private initialized = false;
    private consecutiveWriteFailures = 0;
    private lastWriteNoticeAt = 0;
    private nextWriteEarliestAt = 0;

    constructor(
        private app: App,
        private getTasks: () => Task[],
        private getSettings: () => TaskViewerSettings,
        private pluginVersion: string
    ) {
        this.fileAdapter = new VaultFileAdapter(app);
        this.outputManager = new AiIndexOutputManager(this.fileAdapter);
        this.writer = new AiIndexWriter(app, this.fileAdapter);
        this.normalizer = new TaskNormalizer();
        this.configSignature = this.buildConfigSignature(this.getSettings());
    }

    async updateSettings(): Promise<void> {
        const settings = this.getSettings();
        const nextSignature = this.buildConfigSignature(settings);
        if (nextSignature === this.configSignature) {
            return;
        }

        this.configSignature = nextSignature;
        this.clearPending();
        if (!settings.aiIndex.enabled) {
            this.resetWriteFailureState();
            await this.outputManager.dispose();
            return;
        }
        try {
            await this.syncOutputPath();
        } catch (error) {
            console.error('[AiIndexService] Failed to reinitialize AI index output path:', error);
        }
    }

    schedulePath(path: string): void {
        if (!this.getSettings().aiIndex.enabled) {
            return;
        }
        this.pendingDeletes.delete(path);
        this.pendingPaths.add(path);
        this.scheduleFlush();
    }

    scheduleDeletePath(path: string): void {
        if (!this.getSettings().aiIndex.enabled) {
            return;
        }
        this.pendingPaths.delete(path);
        this.pendingDeletes.add(path);
        this.scheduleFlush();
    }

    async rebuildAll(): Promise<void> {
        if (!this.getSettings().aiIndex.enabled) {
            return;
        }

        this.clearPending();

        const snapshotAt = new Date().toISOString();
        const options = this.buildNormalizerOptions(snapshotAt);
        const byPath = this.normalizer.normalizeTasks(this.getTasks(), options);

        this.indexByPath = byPath;
        this.pathHashes = new Map<string, string>();
        this.serializedByPath = new Map<string, string[]>();
        for (const [path, tasks] of byPath) {
            this.pathHashes.set(path, this.normalizer.hashTasksForPath(tasks));
            this.serializedByPath.set(path, this.serializeTasks(tasks));
        }

        this.initialized = true;
        await this.writeSnapshot(snapshotAt);
    }

    async openIndexFile(): Promise<void> {
        const outputPath = await this.getOutputPath();
        const file = await this.writer.ensureIndexFile(outputPath);
        await this.app.workspace.getLeaf(true).openFile(file);
    }

    dispose(): void {
        this.clearPending();
        this.serializedByPath.clear();
        this.initialized = false;
        this.resetWriteFailureState();
        void this.outputManager.dispose();
    }

    private scheduleFlush(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        const debounceMs = this.getSettings().aiIndex.debounceMs;
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            void this.flushPending();
        }, debounceMs);
    }

    private async flushPending(): Promise<void> {
        if (!this.getSettings().aiIndex.enabled) {
            this.clearPending();
            return;
        }

        // 初回ロード前に来たイベントは全再構築に集約する。
        if (!this.initialized) {
            await this.rebuildAll();
            return;
        }

        const deletedPaths = Array.from(this.pendingDeletes);
        const changedPaths = Array.from(this.pendingPaths);
        const deletedPathSet = new Set(deletedPaths);
        this.pendingDeletes.clear();
        this.pendingPaths.clear();

        let hasAnyChange = false;
        const snapshotAt = new Date().toISOString();
        const options = this.buildNormalizerOptions(snapshotAt);

        for (const path of deletedPaths) {
            const removedIndex = this.indexByPath.delete(path);
            const removedHash = this.pathHashes.delete(path);
            const removedSerialized = this.serializedByPath.delete(path);
            if (removedIndex || removedHash || removedSerialized) {
                hasAnyChange = true;
            }
        }

        for (const path of changedPaths) {
            if (deletedPathSet.has(path)) {
                continue;
            }

            const sourceTasks = this.getTasks().filter((task) => task.file === path);
            const normalizedMap = this.normalizer.normalizeTasks(sourceTasks, options);
            const nextTasks = normalizedMap.get(path) ?? [];

            if (nextTasks.length === 0) {
                const removedIndex = this.indexByPath.delete(path);
                const removedHash = this.pathHashes.delete(path);
                const removedSerialized = this.serializedByPath.delete(path);
                if (removedIndex || removedHash || removedSerialized) {
                    hasAnyChange = true;
                }
                continue;
            }

            const nextPathHash = this.normalizer.hashTasksForPath(nextTasks);
            const previousPathHash = this.pathHashes.get(path);
            if (previousPathHash === nextPathHash) {
                continue;
            }

            this.indexByPath.set(path, nextTasks);
            this.pathHashes.set(path, nextPathHash);
            this.serializedByPath.set(path, this.serializeTasks(nextTasks));
            hasAnyChange = true;
        }

        if (hasAnyChange) {
            await this.writeSnapshot(snapshotAt);
        }
    }

    private async writeSnapshot(generatedAt: string): Promise<void> {
        const now = Date.now();
        if (now < this.nextWriteEarliestAt) {
            const waitMs = this.nextWriteEarliestAt - now;
            console.warn(`[AiIndexService] Skipping AI index write during backoff window (${waitMs}ms remaining).`);
            this.scheduleRetryWrite();
            return;
        }

        const allLines = this.collectAllSerializedLines();
        const taskCount = this.countAllTasks();
        const pathHashesObject = this.toSortedPathHashObject(this.pathHashes);
        const indexHash = this.buildIndexHashFromPathHashes(pathHashesObject);
        const settings = this.getSettings();

        const baseMeta: AiIndexMeta = {
            version: AiIndexService.META_VERSION,
            pluginVersion: this.pluginVersion,
            generatedAt,
            taskCount,
            fileCount: Object.keys(pathHashesObject).length,
            indexHash,
            pathHashes: pathHashesObject,
            lastError: null,
        };

        let outputPath: string | null = null;
        try {
            outputPath = await this.getOutputPath();
            await this.writer.writeSnapshotFromLines(outputPath, allLines, baseMeta, settings.aiIndex.createBackup);
            this.resetWriteFailureState();
            this.lastError = null;
        } catch (error) {
            const failedAt = Date.now();
            const message = (error as Error).message || String(error);
            this.lastError = `Failed to write AI index: ${message}`;
            this.consecutiveWriteFailures += 1;
            const backoffMs = Math.min(
                AiIndexService.WRITE_RETRY_BASE_MS * (2 ** (this.consecutiveWriteFailures - 1)),
                AiIndexService.WRITE_RETRY_MAX_MS
            );
            this.nextWriteEarliestAt = failedAt + backoffMs;
            console.error('[AiIndexService] Failed to write snapshot:', error);
            if (failedAt - this.lastWriteNoticeAt >= AiIndexService.NOTICE_COOLDOWN_MS) {
                new Notice('Task Viewer: failed to write AI index.');
                this.lastWriteNoticeAt = failedAt;
            }
            this.scheduleRetryWrite();

            const errorMeta: AiIndexMeta = {
                ...baseMeta,
                lastError: this.lastError,
            };
            if (!outputPath) {
                return;
            }
            try {
                await this.writer.writeMeta(outputPath, errorMeta);
            } catch (metaError) {
                console.error('[AiIndexService] Failed to write AI index meta:', metaError);
            }
        }
    }

    private collectAllSerializedLines(): string[] {
        const sortedPaths = Array.from(this.serializedByPath.keys()).sort((a, b) => a.localeCompare(b));
        const allLines: string[] = [];
        for (const path of sortedPaths) {
            const pathLines = this.serializedByPath.get(path);
            if (pathLines && pathLines.length > 0) {
                allLines.push(...pathLines);
            }
        }
        return allLines;
    }

    private countAllTasks(): number {
        let count = 0;
        for (const lines of this.serializedByPath.values()) {
            count += lines.length;
        }
        return count;
    }

    private buildNormalizerOptions(snapshotAt: string) {
        const settings = this.getSettings();
        return {
            completeStatusChars: settings.completeStatusChars,
            includeParsers: new Set(settings.aiIndex.includeParsers.map((value) => value.toLowerCase())),
            includeDone: settings.aiIndex.includeDone,
            includeRaw: settings.aiIndex.includeRaw,
            keepDoneDays: settings.aiIndex.keepDoneDays,
            snapshotAt,
        };
    }

    private async getOutputPath(): Promise<string> {
        await this.syncOutputPath();
        return this.outputManager.getCurrentPath();
    }

    private async syncOutputPath(): Promise<void> {
        const transition = await this.outputManager.reinitialize(this.getSettings().aiIndex);
        if (transition.pathChanged) {
            console.info(`[AiIndexService] AI index output path changed: ${transition.oldPath} -> ${transition.newPath}`);
        }
    }

    private buildIndexHashFromPathHashes(pathHashesObject: Record<string, string>): string {
        const raw = Object.entries(pathHashesObject)
            .map(([path, hash]) => `${path}:${hash}`)
            .join('|');
        return this.normalizer.hashText(raw);
    }

    private toSortedPathHashObject(pathHashes: Map<string, string>): Record<string, string> {
        const record: Record<string, string> = {};
        const entries = Array.from(pathHashes.entries()).sort((a, b) => a[0].localeCompare(b[0]));
        for (const [path, hash] of entries) {
            record[path] = hash;
        }
        return record;
    }

    private serializeTasks(tasks: NormalizedTask[]): string[] {
        const lines: string[] = [];
        for (const task of tasks) {
            try {
                lines.push(JSON.stringify(task));
            } catch (error) {
                console.error('[AiIndexService] Serialization error:', (error as Error).message, task.id);
            }
        }
        return lines;
    }

    private clearPending(): void {
        this.pendingPaths.clear();
        this.pendingDeletes.clear();
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }

    private scheduleRetryWrite(): void {
        if (this.retryWriteTimer || !this.getSettings().aiIndex.enabled) {
            return;
        }
        const delayMs = Math.max(0, this.nextWriteEarliestAt - Date.now());
        this.retryWriteTimer = setTimeout(() => {
            this.retryWriteTimer = null;
            if (!this.getSettings().aiIndex.enabled) {
                return;
            }
            void this.writeSnapshot(new Date().toISOString());
        }, delayMs);
    }

    private resetWriteFailureState(): void {
        this.consecutiveWriteFailures = 0;
        this.nextWriteEarliestAt = 0;
        if (this.retryWriteTimer) {
            clearTimeout(this.retryWriteTimer);
            this.retryWriteTimer = null;
        }
    }

    private buildConfigSignature(settings: TaskViewerSettings): string {
        const includeParsers = [...settings.aiIndex.includeParsers].sort();
        const completeChars = [...settings.completeStatusChars].sort();
        return JSON.stringify({
            pluginVersion: this.pluginVersion,
            enabled: settings.aiIndex.enabled,
            fileName: settings.aiIndex.fileName,
            outputToPluginFolder: settings.aiIndex.outputToPluginFolder,
            customOutputFolder: settings.aiIndex.customOutputFolder,
            debounceMs: settings.aiIndex.debounceMs,
            includeParsers,
            includeDone: settings.aiIndex.includeDone,
            includeRaw: settings.aiIndex.includeRaw,
            keepDoneDays: settings.aiIndex.keepDoneDays,
            createBackup: settings.aiIndex.createBackup,
            completeChars,
        });
    }
}
