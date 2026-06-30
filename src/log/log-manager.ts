import {
    onLogEntry,
    type LogEntry,
} from "./log";
import type { LogStorage, PersistedLogEntry } from "./log-storage";
import {
    formatLogExport,
    buildExportFileName,
    type ExportMeta,
    type DeviceInfo,
} from "./markdown-formatter";

const FLUSH_INTERVAL_MS = 50;
const FLUSH_MAX_BATCH = 100;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
export const AVG_ENTRY_BYTES = 200;

export interface TaskDiagnostics {
    taskCount: number;
    activeViewCount: number;
    enabledParsers: string[];
    startHour: number;
}

interface LogSettings {
    logRetentionDays: number;
    logMaxStorageMB: number;
}

export interface LogManagerDeps {
    storage: LogStorage;
    getSettings: () => LogSettings;
    getPluginVersion: () => string;
    getObsidianVersion: () => string;
    getPlatform: () => { os: string; isMobile: boolean };
    getTaskDiagnostics: () => TaskDiagnostics;
    getDeviceInfo?: () => DeviceInfo;
    vault: {
        exists: (path: string) => Promise<boolean>;
        createBinary: (path: string, data: ArrayBuffer) => Promise<void>;
    };
    now?: () => number;
    timer?: {
        setTimeout: (cb: () => void, ms: number) => any;
        clearTimeout: (id: any) => void;
        setInterval: (cb: () => void, ms: number) => any;
        clearInterval: (id: any) => void;
    };
    doc?: {
        addEventListener: (type: string, listener: () => void) => void;
        removeEventListener: (type: string, listener: () => void) => void;
        visibilityState?: string;
    };
    win?: {
        addEventListener: (type: string, listener: () => void) => void;
        removeEventListener: (type: string, listener: () => void) => void;
    };
}

export class LogManager {
    private queue: PersistedLogEntry[] = [];
    private flushTimer: any = null;
    private cleanupTimer: any = null;
    private unsubscribe: (() => void) | null = null;
    private running = false;
    private flushInFlight: Promise<void> | null = null;

    private readonly storage: LogStorage;
    private readonly getSettings: () => LogSettings;
    private readonly getPluginVersion: () => string;
    private readonly getObsidianVersion: () => string;
    private readonly getPlatform: () => { os: string; isMobile: boolean };
    private readonly getTaskDiagnostics: () => TaskDiagnostics;
    private readonly getDeviceInfo?: () => DeviceInfo;
    private readonly vault: LogManagerDeps["vault"];
    private readonly now: () => number;
    private readonly timer: NonNullable<LogManagerDeps["timer"]>;
    private readonly doc: LogManagerDeps["doc"];
    private readonly win: LogManagerDeps["win"];

    private readonly boundOnVisibility = () => {
        if (this.doc?.visibilityState === "hidden") this.fireAndForgetFlush();
    };
    private readonly boundOnPageHide = () => this.fireAndForgetFlush();

    constructor(deps: LogManagerDeps) {
        this.storage = deps.storage;
        this.getSettings = deps.getSettings;
        this.getPluginVersion = deps.getPluginVersion;
        this.getObsidianVersion = deps.getObsidianVersion;
        this.getPlatform = deps.getPlatform;
        this.getTaskDiagnostics = deps.getTaskDiagnostics;
        this.getDeviceInfo = deps.getDeviceInfo;
        this.vault = deps.vault;
        this.now = deps.now ?? (() => Date.now());
        this.timer = deps.timer ?? {
            setTimeout: (cb, ms) => setTimeout(cb, ms),
            clearTimeout: (id) => clearTimeout(id),
            setInterval: (cb, ms) => setInterval(cb, ms),
            clearInterval: (id) => clearInterval(id),
        };
        this.doc = deps.doc;
        this.win = deps.win;
    }

    start(): void {
        if (this.running) return;
        this.running = true;
        this.unsubscribe = onLogEntry((e) => this.enqueue(e));
        void this.cleanup();
        this.cleanupTimer = this.timer.setInterval(
            () => { void this.cleanup(); },
            CLEANUP_INTERVAL_MS,
        );
        this.doc?.addEventListener("visibilitychange", this.boundOnVisibility);
        this.win?.addEventListener("pagehide", this.boundOnPageHide);
    }

    stop(): void {
        if (!this.running) return;
        this.running = false;
        this.unsubscribe?.();
        this.unsubscribe = null;
        if (this.cleanupTimer !== null) {
            this.timer.clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        if (this.flushTimer !== null) {
            this.timer.clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        this.doc?.removeEventListener("visibilitychange", this.boundOnVisibility);
        this.win?.removeEventListener("pagehide", this.boundOnPageHide);
        this.fireAndForgetFlush();
    }

    async flush(): Promise<void> {
        if (this.flushInFlight) {
            await this.flushInFlight;
        }
        if (this.queue.length === 0) return;
        await this.doFlush();
    }

    async getStats() {
        return this.storage.getStats();
    }

    async clearStoredLogs(): Promise<void> {
        await this.storage.clearAll();
    }

    async deleteLogDatabase(): Promise<void> {
        await this.storage.deleteDatabase();
    }

    async exportToVault(): Promise<{ path: string; count: number }> {
        await this.flush();

        const exportedAt = this.now();
        const entries = await this.storage.getAll();
        const meta: ExportMeta = {
            pluginVersion: this.getPluginVersion(),
            obsidianVersion: this.getObsidianVersion(),
            platform: this.getPlatform(),
            exportedAt,
            taskState: this.getTaskDiagnostics(),
            device: this.getDeviceInfo?.(),
        };
        const content = formatLogExport(entries, meta);

        const baseName = buildExportFileName(exportedAt);
        let path = baseName;
        let suffix = 1;
        while (await this.vault.exists(path)) {
            path = baseName.replace(/\.md$/, `_${suffix}.md`);
            suffix++;
        }

        const bytes = new TextEncoder().encode(content);
        await this.vault.createBinary(path, bytes.buffer as ArrayBuffer);
        return { path, count: entries.length };
    }

    private enqueue(entry: LogEntry): void {
        if (!this.running) return;
        this.queue.push({
            timestamp: entry.timestamp,
            level: entry.level,
            message: entry.message,
        });
        if (this.queue.length >= FLUSH_MAX_BATCH) {
            this.scheduleFlush(true);
        } else {
            this.scheduleFlush(false);
        }
    }

    private scheduleFlush(immediate: boolean): void {
        if (immediate) {
            if (this.flushTimer !== null) {
                this.timer.clearTimeout(this.flushTimer);
                this.flushTimer = null;
            }
            queueMicrotask(() => { void this.doFlush(); });
            return;
        }
        if (this.flushTimer !== null) return;
        this.flushTimer = this.timer.setTimeout(() => {
            this.flushTimer = null;
            void this.doFlush();
        }, FLUSH_INTERVAL_MS);
    }

    private async doFlush(): Promise<void> {
        if (this.queue.length === 0) return;
        const batch = this.queue;
        this.queue = [];
        const work = this.storage.bulkAppend(batch);
        this.flushInFlight = work.finally(() => {
            if (this.flushInFlight === work) this.flushInFlight = null;
        });
        await this.flushInFlight;
    }

    private fireAndForgetFlush(): void {
        if (this.queue.length === 0) return;
        void this.doFlush();
    }

    private async cleanup(): Promise<{ removedByAge: number; removedBySize: number }> {
        const settings = this.getSettings();
        const retentionDays = Math.max(1, settings.logRetentionDays | 0);
        const cutoff = this.now() - retentionDays * 24 * 60 * 60 * 1000;
        const removedByAge = await this.storage.deleteBefore(cutoff);

        let removedBySize = 0;
        const maxMB = settings.logMaxStorageMB;
        if (maxMB > 0) {
            const maxEntries = Math.max(1, Math.floor((maxMB * 1024 * 1024) / AVG_ENTRY_BYTES));
            removedBySize = await this.storage.trimToCount(maxEntries);
        }
        return { removedByAge, removedBySize };
    }
}
