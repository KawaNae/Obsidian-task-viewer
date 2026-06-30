import Dexie, { type Table } from "dexie";
import type { LogLevel } from "./log";

export interface PersistedLogEntry {
    id?: number;
    timestamp: number;
    level: LogLevel;
    message: string;
}

export interface LogStorageStats {
    count: number;
    oldestTs: number | null;
    newestTs: number | null;
    approxBytes: number;
    levels?: Record<LogLevel, number>;
}

const LOG_SCHEMA_VERSION = 1 as const;

interface MetaRow { key: string; value: number }

class LogDB extends Dexie {
    entries!: Table<PersistedLogEntry, number>;
    _meta!: Table<MetaRow, string>;

    constructor(vaultName: string) {
        super(`task-viewer-logs-${vaultName}`);
        this.version(1).stores({
            entries: "++id, timestamp",
        });
        this.version(2).stores({
            entries: "++id, timestamp",
            _meta: "&key",
        });
    }
}

export function approxEntryBytes(entry: PersistedLogEntry): number {
    return 48 + entry.message.length * 2;
}

export class LogStorage {
    private db: LogDB;
    private readonly dbName: string;

    constructor(vaultName: string) {
        this.dbName = `task-viewer-logs-${vaultName}`;
        this.db = new LogDB(vaultName);
    }

    async ensureSchemaVersion(): Promise<void> {
        try {
            const existing = await this.db._meta.get("schemaVersion");
            if (existing === undefined) {
                await this.db._meta.put({ key: "schemaVersion", value: LOG_SCHEMA_VERSION });
                return;
            }
            if (existing.value !== LOG_SCHEMA_VERSION) {
                console.warn(
                    `[log-storage] schema version mismatch (stored=${existing.value}, expected=${LOG_SCHEMA_VERSION})`,
                );
            }
        } catch (e: any) {
            console.warn(`[log-storage] ensureSchemaVersion failed: ${e?.message ?? e}`);
        }
    }

    async bulkAppend(entries: PersistedLogEntry[]): Promise<void> {
        if (entries.length === 0) return;
        try {
            await this.db.entries.bulkAdd(entries);
        } catch (e: any) {
            console.warn(`[log-storage] bulkAppend failed: ${e?.message ?? e}`);
        }
    }

    async getAll(sinceTs?: number): Promise<PersistedLogEntry[]> {
        try {
            const coll = sinceTs !== undefined
                ? this.db.entries.where("timestamp").aboveOrEqual(sinceTs)
                : this.db.entries.toCollection();
            return await coll.sortBy("timestamp");
        } catch (e: any) {
            console.warn(`[log-storage] getAll failed: ${e?.message ?? e}`);
            return [];
        }
    }

    async deleteBefore(cutoffTs: number): Promise<number> {
        try {
            return await this.db.entries.where("timestamp").below(cutoffTs).delete();
        } catch (e: any) {
            console.warn(`[log-storage] deleteBefore failed: ${e?.message ?? e}`);
            return 0;
        }
    }

    async trimToCount(maxEntries: number): Promise<number> {
        if (maxEntries < 0) return 0;
        try {
            const count = await this.db.entries.count();
            if (count <= maxEntries) return 0;
            const overflow = count - maxEntries;
            const oldestIds = await this.db.entries
                .orderBy("timestamp")
                .limit(overflow)
                .primaryKeys();
            await this.db.entries.bulkDelete(oldestIds);
            return oldestIds.length;
        } catch (e: any) {
            console.warn(`[log-storage] trimToCount failed: ${e?.message ?? e}`);
            return 0;
        }
    }

    async getStats(): Promise<LogStorageStats> {
        try {
            const count = await this.db.entries.count();
            if (count === 0) {
                return { count: 0, oldestTs: null, newestTs: null, approxBytes: 0 };
            }
            const oldest = await this.db.entries.orderBy("timestamp").first();
            const newest = await this.db.entries.orderBy("timestamp").last();
            let approxBytes = 0;
            const levels: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };
            await this.db.entries.each((e) => {
                approxBytes += approxEntryBytes(e);
                levels[e.level] = (levels[e.level] ?? 0) + 1;
            });
            return {
                count,
                oldestTs: oldest?.timestamp ?? null,
                newestTs: newest?.timestamp ?? null,
                approxBytes,
                levels,
            };
        } catch (e: any) {
            console.warn(`[log-storage] getStats failed: ${e?.message ?? e}`);
            return { count: 0, oldestTs: null, newestTs: null, approxBytes: 0 };
        }
    }

    async clearAll(): Promise<void> {
        try {
            await this.db.entries.clear();
        } catch (e: any) {
            console.warn(`[log-storage] clearAll failed: ${e?.message ?? e}`);
        }
    }

    close(): void {
        try {
            this.db.close();
        } catch { /* idempotent */ }
    }

    async deleteDatabase(): Promise<void> {
        try {
            this.db.close();
            await Dexie.delete(this.dbName);
        } catch (e: any) {
            console.warn(`[log-storage] deleteDatabase failed: ${e?.message ?? e}`);
        }
        this.db = new LogDB(this.dbName.replace(/^task-viewer-logs-/, ""));
    }
}
