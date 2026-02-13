import { App, TFile } from 'obsidian';
import type { AiIndexMeta, NormalizedTask } from './NormalizedTask';

export interface AiIndexWriteResult {
    skippedRows: number;
    serializationError: string | null;
}

export class AiIndexWriter {
    constructor(private app: App) { }

    async writeSnapshot(outputPath: string, tasks: NormalizedTask[], meta: AiIndexMeta): Promise<AiIndexWriteResult> {
        const lines: string[] = [];
        let skippedRows = 0;
        let serializationError: string | null = null;

        for (const task of tasks) {
            try {
                lines.push(JSON.stringify(task));
            } catch (error) {
                skippedRows += 1;
                const message = (error as Error).message || String(error);
                serializationError = serializationError ?? `Failed to serialize task row: ${message}`;
                console.error('[AiIndexWriter] Skipping task serialization row:', message, task.id);
            }
        }

        const ndjson = lines.length > 0
            ? `${lines.join('\n')}\n`
            : '';

        await this.atomicWrite(outputPath, ndjson);

        const nextMeta: AiIndexMeta = {
            ...meta,
            lastError: serializationError ?? meta.lastError,
        };
        await this.writeMeta(outputPath, nextMeta);

        return {
            skippedRows,
            serializationError,
        };
    }

    async writeMeta(outputPath: string, meta: AiIndexMeta): Promise<void> {
        const metaPath = this.getMetaPath(outputPath);
        const text = `${JSON.stringify(meta, null, 2)}\n`;
        await this.atomicWrite(metaPath, text);
    }

    async ensureIndexFile(outputPath: string): Promise<TFile> {
        const existing = this.app.vault.getAbstractFileByPath(outputPath);
        if (existing instanceof TFile) {
            return existing;
        }

        await this.ensureDirectoryExists(outputPath);
        const alreadyExists = await this.app.vault.adapter.exists(outputPath);
        if (!alreadyExists) {
            return await this.app.vault.create(outputPath, '');
        }

        const file = this.app.vault.getAbstractFileByPath(outputPath);
        if (file instanceof TFile) {
            return file;
        }

        const content = await this.app.vault.adapter.read(outputPath);
        await this.app.vault.adapter.write(outputPath, content);
        const refreshed = this.app.vault.getAbstractFileByPath(outputPath);
        if (refreshed instanceof TFile) {
            return refreshed;
        }

        throw new Error(`AI index file exists but could not be resolved: ${outputPath}`);
    }

    getMetaPath(outputPath: string): string {
        return outputPath.endsWith('.ndjson')
            ? `${outputPath.slice(0, -'.ndjson'.length)}.meta.json`
            : `${outputPath}.meta.json`;
    }

    private async atomicWrite(path: string, content: string): Promise<void> {
        await this.ensureDirectoryExists(path);

        const tmpPath = `${path}.tmp`;
        const bakPath = `${path}.bak`;
        const adapter = this.app.vault.adapter;
        const hasExisting = await adapter.exists(path);

        await adapter.write(tmpPath, content);

        try {
            if (hasExisting) {
                if (await adapter.exists(bakPath)) {
                    await adapter.remove(bakPath);
                }
                await adapter.rename(path, bakPath);
            }
            await adapter.rename(tmpPath, path);
        } catch (error) {
            if (await adapter.exists(tmpPath)) {
                await adapter.remove(tmpPath);
            }
            const hasCurrent = await adapter.exists(path);
            if (hasExisting && !hasCurrent && await adapter.exists(bakPath)) {
                await adapter.rename(bakPath, path);
            }
            throw error;
        }

        if (hasExisting && await adapter.exists(bakPath)) {
            try {
                await adapter.remove(bakPath);
            } catch (error) {
                console.warn('[AiIndexWriter] Failed to cleanup AI index backup:', error);
            }
        }
    }

    private async ensureDirectoryExists(filePath: string): Promise<void> {
        const slashIndex = filePath.lastIndexOf('/');
        if (slashIndex < 0) {
            return;
        }

        const directory = filePath.substring(0, slashIndex);
        if (directory.length === 0) {
            return;
        }

        const adapter = this.app.vault.adapter;
        const parts = directory.split('/').filter((part) => part.length > 0);
        let current = '';

        for (const part of parts) {
            current = current.length > 0
                ? `${current}/${part}`
                : part;

            const exists = await adapter.exists(current);
            if (!exists) {
                await adapter.mkdir(current);
            }
        }
    }
}
