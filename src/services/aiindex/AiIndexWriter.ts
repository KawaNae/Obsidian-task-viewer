import { App, TFile } from 'obsidian';
import type { AiIndexMeta, NormalizedTask } from './NormalizedTask';
import { VaultFileAdapter } from './VaultFileAdapter';

export interface AiIndexWriteResult {
    skippedRows: number;
    serializationError: string | null;
}

export class AiIndexWriter {
    constructor(
        private app: App,
        private fileAdapter: VaultFileAdapter
    ) { }

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

        await this.fileAdapter.ensureDirectory(outputPath);
        const alreadyExists = await this.fileAdapter.exists(outputPath, { bypassCache: true });
        if (!alreadyExists) {
            return await this.app.vault.create(outputPath, '');
        }

        const file = this.app.vault.getAbstractFileByPath(outputPath);
        if (file instanceof TFile) {
            return file;
        }

        const content = await this.fileAdapter.read(outputPath);
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
        await this.fileAdapter.writeAtomic(path, content, {
            retries: 3,
            retryDelayMs: 100,
            createBackup: true,
        });
    }
}
