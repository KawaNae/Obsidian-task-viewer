import { App, Notice } from 'obsidian';
import type { Task, TaskViewerSettings } from '../../types';
import { AiIndexOutputManager } from './AiIndexOutputManager';
import { AiIndexWriter } from './AiIndexWriter';
import { type AiIndexMeta, type NormalizedTask } from './NormalizedTask';
import { TaskNormalizer } from './TaskNormalizer';
import { VaultFileAdapter } from './VaultFileAdapter';

export class AiIndexService {
    private static readonly META_VERSION = 1;

    private fileAdapter: VaultFileAdapter;
    private outputManager: AiIndexOutputManager;
    private writer: AiIndexWriter;
    private normalizer: TaskNormalizer;
    private indexByPath: Map<string, NormalizedTask[]> = new Map();
    private pathHashes: Map<string, string> = new Map();
    private pendingPaths: Set<string> = new Set();
    private pendingDeletes: Set<string> = new Set();
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private lastError: string | null = null;
    private configSignature: string;
    private initialized = false;

    constructor(
        private app: App,
        private getTasks: () => Task[],
        private getSettings: () => TaskViewerSettings
    ) {
        this.fileAdapter = new VaultFileAdapter(app);
        this.outputManager = new AiIndexOutputManager(this.fileAdapter);
        this.writer = new AiIndexWriter(app, this.fileAdapter);
        this.normalizer = new TaskNormalizer();
        this.configSignature = this.buildConfigSignature(this.getSettings());
    }

    updateSettings(): void {
        const settings = this.getSettings();
        const nextSignature = this.buildConfigSignature(settings);
        if (nextSignature === this.configSignature) {
            return;
        }

        this.configSignature = nextSignature;
        this.clearPending();
        if (!settings.aiIndex.enabled) {
            void this.outputManager.dispose();
            return;
        }
        void this.syncOutputPath().catch((error) => {
            console.error('[AiIndexService] Failed to reinitialize AI index output path:', error);
        });
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

        const updatedAt = new Date().toISOString();
        const options = this.buildNormalizerOptions(updatedAt);
        const byPath = this.normalizer.normalizeTasks(this.getTasks(), options);

        this.indexByPath = byPath;
        this.pathHashes = new Map<string, string>();
        for (const [path, tasks] of byPath) {
            this.pathHashes.set(path, this.normalizer.hashTasksForPath(tasks));
        }

        this.initialized = true;
        await this.writeSnapshot(updatedAt);
    }

    async openIndexFile(): Promise<void> {
        const outputPath = await this.getOutputPath();
        const file = await this.writer.ensureIndexFile(outputPath);
        await this.app.workspace.getLeaf(true).openFile(file);
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
        const updatedAt = new Date().toISOString();
        const options = this.buildNormalizerOptions(updatedAt);

        for (const path of deletedPaths) {
            const removedIndex = this.indexByPath.delete(path);
            const removedHash = this.pathHashes.delete(path);
            if (removedIndex || removedHash) {
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
                if (removedIndex || removedHash) {
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
            hasAnyChange = true;
        }

        if (hasAnyChange) {
            await this.writeSnapshot(updatedAt);
        }
    }

    private async writeSnapshot(generatedAt: string): Promise<void> {
        const allTasks = this.collectAllTasks();
        const indexHash = this.buildIndexHash(allTasks);
        const pathHashesObject = this.toSortedPathHashObject(this.pathHashes);

        const baseMeta: AiIndexMeta = {
            version: AiIndexService.META_VERSION,
            generatedAt,
            taskCount: allTasks.length,
            fileCount: pathHashesObject ? Object.keys(pathHashesObject).length : 0,
            indexHash,
            pathHashes: pathHashesObject,
            lastError: null,
        };

        let outputPath: string | null = null;
        try {
            outputPath = await this.getOutputPath();
            const result = await this.writer.writeSnapshot(outputPath, allTasks, baseMeta);
            if (result.serializationError) {
                this.lastError = result.serializationError;
            } else {
                this.lastError = null;
            }
        } catch (error) {
            const message = (error as Error).message || String(error);
            this.lastError = `Failed to write AI index: ${message}`;
            console.error('[AiIndexService] Failed to write snapshot:', error);
            new Notice('Task Viewer: failed to write AI index.');

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

    private collectAllTasks(): NormalizedTask[] {
        const sortedPaths = Array.from(this.indexByPath.keys()).sort((a, b) => a.localeCompare(b));
        const tasks: NormalizedTask[] = [];
        for (const path of sortedPaths) {
            const pathTasks = this.indexByPath.get(path);
            if (!pathTasks || pathTasks.length === 0) {
                continue;
            }
            tasks.push(...pathTasks);
        }
        return tasks;
    }

    private buildNormalizerOptions(updatedAt: string) {
        const settings = this.getSettings();
        return {
            completeStatusChars: settings.completeStatusChars,
            includeParsers: new Set(settings.aiIndex.includeParsers.map((value) => value.toLowerCase())),
            includeDone: settings.aiIndex.includeDone,
            updatedAt,
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

    private buildIndexHash(tasks: NormalizedTask[]): string {
        const raw = tasks
            .map((task) => `${task.id}:${task.contentHash}`)
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

    private clearPending(): void {
        this.pendingPaths.clear();
        this.pendingDeletes.clear();
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }

    private buildConfigSignature(settings: TaskViewerSettings): string {
        const includeParsers = [...settings.aiIndex.includeParsers].sort();
        const completeChars = [...settings.completeStatusChars].sort();
        return JSON.stringify({
            enabled: settings.aiIndex.enabled,
            fileName: settings.aiIndex.fileName,
            outputToPluginFolder: settings.aiIndex.outputToPluginFolder,
            customOutputFolder: settings.aiIndex.customOutputFolder,
            debounceMs: settings.aiIndex.debounceMs,
            includeParsers,
            includeDone: settings.aiIndex.includeDone,
            completeChars,
        });
    }
}
