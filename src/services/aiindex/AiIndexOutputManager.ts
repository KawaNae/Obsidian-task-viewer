import type { AiIndexSettings } from './AiIndexSettings';
import { resolveAiIndexOutputPath } from './AiIndexSettings';
import { VaultFileAdapter } from './VaultFileAdapter';

export interface PathTransition {
    pathChanged: boolean;
    oldPath: string | null;
    newPath: string;
    requiresRebuild: boolean;
}

export class AiIndexOutputManager {
    private currentPath: string | null = null;
    private initialized = false;

    constructor(private fileAdapter: VaultFileAdapter) { }

    async initialize(settings: AiIndexSettings): Promise<void> {
        const path = resolveAiIndexOutputPath(settings);
        await this.fileAdapter.ensureDirectory(path);
        const probe = await this.fileAdapter.testWritability(path);
        if (!probe.ok) {
            console.warn(
                `[AiIndexOutputManager] AI index probe write failed for "${path}" (retryable=${probe.retryable}): ${probe.message}`
            );
        }
        this.currentPath = path;
        this.initialized = true;
    }

    async reinitialize(settings: AiIndexSettings): Promise<PathTransition> {
        const nextPath = resolveAiIndexOutputPath(settings);
        const oldPath = this.currentPath;
        const pathChanged = oldPath !== null && oldPath !== nextPath;

        if (!this.initialized || oldPath !== nextPath) {
            await this.initialize(settings);
        }

        return {
            pathChanged,
            oldPath,
            newPath: this.getCurrentPath(),
            requiresRebuild: pathChanged,
        };
    }

    async dispose(): Promise<void> {
        this.currentPath = null;
        this.initialized = false;
    }

    getCurrentPath(): string {
        if (!this.currentPath) {
            throw new Error('AI index output path is not initialized.');
        }
        return this.currentPath;
    }

    isInitialized(): boolean {
        return this.initialized;
    }
}
