import { App, TFolder } from 'obsidian';

export interface WriteOptions {
    retries?: number;
    retryDelayMs?: number;
    createBackup?: boolean;
}

export interface ExistsOptions {
    bypassCache?: boolean;
}

export type ProbeResult =
    | { ok: true }
    | { ok: false; retryable: boolean; message: string };

export class VaultFileAdapter {
    constructor(private app: App) { }

    async ensureDirectory(filePath: string): Promise<void> {
        const directory = this.getDirectoryPath(filePath);
        if (!directory) {
            return;
        }

        const segments = directory.split('/').filter((segment) => segment.length > 0);
        let currentPath = '';
        for (const segment of segments) {
            currentPath = currentPath.length > 0
                ? `${currentPath}/${segment}`
                : segment;

            const cached = this.app.vault.getAbstractFileByPath(currentPath);
            if (cached instanceof TFolder) {
                continue;
            }

            try {
                await this.app.vault.createFolder(currentPath);
            } catch (error) {
                const existsNow = await this.exists(currentPath, { bypassCache: true });
                if (existsNow || this.isFolderAlreadyExistsError(error)) {
                    continue;
                }
                throw error;
            }
        }
    }

    async testWritability(filePath: string): Promise<ProbeResult> {
        await this.ensureDirectory(filePath);

        const directory = this.getDirectoryPath(filePath);
        const maxRetries = 3;
        let lastError: unknown = null;
        let lastRetryable = false;

        const adapter = this.app.vault.adapter;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${attempt}`;
            const probePath = directory
                ? `${directory}/.ai-index-write-test-${stamp}.tmp`
                : `.ai-index-write-test-${stamp}.tmp`;
            try {
                await adapter.write(probePath, '');
                return { ok: true };
            } catch (error) {
                lastError = error;
                lastRetryable = this.isRetryableError(error);
                const isLastAttempt = attempt >= maxRetries;
                if (!lastRetryable || isLastAttempt) {
                    return {
                        ok: false,
                        retryable: lastRetryable,
                        message: this.toErrorMessage(error),
                    };
                }
                const delayMs = 100 * (2 ** attempt);
                await this.sleep(delayMs);
            } finally {
                if (await this.exists(probePath, { bypassCache: true })) {
                    await adapter.remove(probePath).catch(() => undefined);
                }
            }
        }

        return {
            ok: false,
            retryable: lastRetryable,
            message: this.toErrorMessage(lastError),
        };
    }

    async writeAtomic(path: string, content: string, options: WriteOptions = {}): Promise<void> {
        const maxRetries = options.retries ?? 3;
        const baseDelay = options.retryDelayMs ?? 100;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                await this.performAtomicWrite(path, content, options);
                return;
            } catch (error) {
                const isLastAttempt = attempt >= maxRetries;
                if (isLastAttempt || !this.isRetryableError(error)) {
                    throw error;
                }
                const delayMs = baseDelay * (2 ** attempt);
                await this.sleep(delayMs);
            }
        }
    }

    async read(path: string): Promise<string> {
        return this.app.vault.adapter.read(path);
    }

    async exists(path: string, options: ExistsOptions = {}): Promise<boolean> {
        if (!options.bypassCache) {
            const cached = this.app.vault.getAbstractFileByPath(path);
            if (cached) {
                return true;
            }
        }
        return this.app.vault.adapter.exists(path);
    }

    private async performAtomicWrite(path: string, content: string, options: WriteOptions): Promise<void> {
        await this.ensureDirectory(path);

        const adapter = this.app.vault.adapter;
        const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const tmpPath = `${path}.tmp.${stamp}`;
        const bakPath = `${path}.bak`;
        const useBackup = options.createBackup !== false;
        const hasExisting = await this.exists(path, { bypassCache: true });
        let hasBackup = false;

        await adapter.write(tmpPath, content);
        const tmpExists = await this.exists(tmpPath, { bypassCache: true });
        if (!tmpExists) {
            throw new Error(`Temporary AI index file was not created: ${tmpPath}`);
        }

        try {
            if (hasExisting) {
                if (useBackup) {
                    if (await this.exists(bakPath, { bypassCache: true })) {
                        await adapter.remove(bakPath);
                    }
                    await adapter.rename(path, bakPath);
                    hasBackup = true;
                } else {
                    await adapter.remove(path);
                }
            }
            await adapter.rename(tmpPath, path);
        } catch (error) {
            await this.cleanupIfExists(tmpPath);
            const hasCurrent = await this.exists(path, { bypassCache: true });
            if (hasBackup && !hasCurrent && await this.exists(bakPath, { bypassCache: true })) {
                try {
                    await adapter.rename(bakPath, path);
                } catch (rollbackError) {
                    console.error(
                        '[VaultFileAdapter] Rollback failed after write error. Original error:',
                        error,
                        'Rollback error:',
                        rollbackError
                    );
                }
            }
            throw error;
        }

        if (hasBackup && await this.exists(bakPath, { bypassCache: true })) {
            await adapter.remove(bakPath).catch((cleanupError) => {
                console.warn('[VaultFileAdapter] Failed to cleanup AI index backup:', cleanupError);
            });
        }
    }

    private async cleanupIfExists(path: string): Promise<void> {
        if (await this.exists(path, { bypassCache: true })) {
            await this.app.vault.adapter.remove(path).catch(() => undefined);
        }
    }

    private getDirectoryPath(filePath: string): string | null {
        const lastSlash = filePath.lastIndexOf('/');
        if (lastSlash < 0) {
            return null;
        }
        const directory = filePath.slice(0, lastSlash);
        return directory.length > 0 ? directory : null;
    }

    private isRetryableError(error: unknown): boolean {
        const message = this.toErrorMessage(error).toLowerCase();
        return message.includes('ebusy')
            || message.includes('eperm')
            || message.includes('locked')
            || message.includes('in use')
            || message.includes('resource busy');
    }

    private isFolderAlreadyExistsError(error: unknown): boolean {
        const message = this.toErrorMessage(error).toLowerCase();
        return message.includes('already exists')
            || message.includes('eexist');
    }

    private toErrorMessage(error: unknown): string {
        if (error instanceof Error) {
            return error.message ?? '';
        }
        return String(error ?? '');
    }

    private async sleep(ms: number): Promise<void> {
        await new Promise<void>((resolve) => {
            setTimeout(resolve, ms);
        });
    }
}
