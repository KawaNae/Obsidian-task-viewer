export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
    timestamp: number;
    level: LogLevel;
    message: string;
}

const MAX_LOG_ENTRIES = 500;
const buffer: LogEntry[] = [];
let listeners: ((entry: LogEntry) => void)[] = [];

function pushEntry(level: LogLevel, message: string): void {
    const entry: LogEntry = { timestamp: Date.now(), level, message };
    buffer.push(entry);
    if (buffer.length > MAX_LOG_ENTRIES) buffer.shift();
    for (const fn of listeners) {
        try { fn(entry); } catch { /* listener errors don't propagate */ }
    }
}

export function getLogEntries(): LogEntry[] {
    return [...buffer];
}

export function clearLog(): void {
    buffer.length = 0;
}

export function onLogEntry(fn: (entry: LogEntry) => void): () => void {
    listeners.push(fn);
    return () => { listeners = listeners.filter((l) => l !== fn); };
}

type SettingsGetter = () => { verboseNotice: boolean };
type NoticeFunc = (message: string, durationMs: number) => void;

let _getSettings: SettingsGetter | null = null;
let _showNotice: NoticeFunc | null = null;

export function initLog(
    getSettings: SettingsGetter,
    showNotice: NoticeFunc,
): void {
    _getSettings = getSettings;
    _showNotice = showNotice;
}

function isVerbose(): boolean {
    return _getSettings?.().verboseNotice ?? false;
}

export function logDebug(message: string): void {
    pushEntry("debug", message);
    if (isVerbose()) console.log(message);
}

export function logInfo(message: string, durationMs = 4000): void {
    pushEntry("info", message);
    if (!isVerbose()) return;
    console.log(message);
    _showNotice?.(message, durationMs);
}

export function logWarn(message: string): void {
    pushEntry("warn", message);
    console.warn(message);
}

export function logError(message: string): void {
    pushEntry("error", message);
    console.error(message);
    _showNotice?.(message, 8000);
}

export function notify(message: string, durationMs = 5000): void {
    pushEntry("info", message);
    _showNotice?.(message, durationMs);
}
