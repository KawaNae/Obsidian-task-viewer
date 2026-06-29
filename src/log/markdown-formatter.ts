import type { LogLevel } from "./log";
import type { PersistedLogEntry } from "./log-storage";

export interface ExportMeta {
    pluginVersion: string;
    obsidianVersion: string;
    platform: {
        os: string;
        isMobile: boolean;
    };
    exportedAt: number;
    taskState: {
        taskCount: number;
        activeViewCount: number;
        enabledParsers: string[];
        startHour: number;
    };
    device?: DeviceInfo;
}

export interface DeviceInfo {
    cpuCores?: number;
    userAgent?: string;
    jsHeapUsedMb?: number;
    jsHeapLimitMb?: number;
    deviceMemoryGb?: number;
    cpuModel?: string;
    totalRamGb?: number;
    freeRamGb?: number;
    arch?: string;
    osRelease?: string;
}

const LEVEL_KEYS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

export function buildExportFileName(exportedAtMs: number): string {
    const ts = new Date(exportedAtMs).toISOString().slice(0, 19).replace(/:/g, "-");
    return `task_viewer_log_${ts}.md`;
}

function yamlScalar(value: string): string {
    if (value === "") return "''";
    const needsQuote = /[:#&*!|>'"%@`{}\[\],?\-\s]|^[\d]/.test(value);
    if (!needsQuote) return value;
    return `'${value.replace(/'/g, "''")}'`;
}

function formatFrontmatter(entries: PersistedLogEntry[], meta: ExportMeta): string {
    const levels: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };
    for (const e of entries) levels[e.level] = (levels[e.level] ?? 0) + 1;

    const oldest = entries.length > 0 ? entries[0].timestamp : meta.exportedAt;
    const newest = entries.length > 0 ? entries[entries.length - 1].timestamp : meta.exportedAt;

    const lines: string[] = ["---"];
    lines.push(`plugin_version: ${yamlScalar(meta.pluginVersion)}`);
    lines.push(`obsidian_version: ${yamlScalar(meta.obsidianVersion)}`);
    lines.push(`platform:`);
    lines.push(`  os: ${yamlScalar(meta.platform.os)}`);
    lines.push(`  mobile: ${meta.platform.isMobile}`);
    lines.push(`exported_at: ${yamlScalar(new Date(meta.exportedAt).toISOString())}`);
    lines.push(`log_count: ${entries.length}`);
    lines.push(`buffer_range:`);
    lines.push(`  from: ${yamlScalar(new Date(oldest).toISOString())}`);
    lines.push(`  to: ${yamlScalar(new Date(newest).toISOString())}`);
    lines.push(`levels:`);
    for (const k of LEVEL_KEYS) lines.push(`  ${k}: ${levels[k]}`);
    lines.push(`task_state:`);
    lines.push(`  task_count: ${meta.taskState.taskCount}`);
    lines.push(`  active_view_count: ${meta.taskState.activeViewCount}`);
    lines.push(`  enabled_parsers: [${meta.taskState.enabledParsers.join(", ")}]`);
    lines.push(`  start_hour: ${meta.taskState.startHour}`);
    appendDeviceBlock(lines, meta.device);
    lines.push("---");
    return lines.join("\n");
}

function appendDeviceBlock(lines: string[], device: DeviceInfo | undefined): void {
    if (!device) return;
    const num: Array<[string, number | undefined]> = [
        ["cpu_cores", device.cpuCores],
        ["js_heap_used_mb", device.jsHeapUsedMb],
        ["js_heap_limit_mb", device.jsHeapLimitMb],
        ["device_memory_gb", device.deviceMemoryGb],
        ["total_ram_gb", device.totalRamGb],
        ["free_ram_gb", device.freeRamGb],
    ];
    const str: Array<[string, string | undefined]> = [
        ["user_agent", device.userAgent],
        ["cpu_model", device.cpuModel],
        ["arch", device.arch],
        ["os_release", device.osRelease],
    ];
    const body: string[] = [];
    for (const [k, v] of num) if (v !== undefined && Number.isFinite(v)) body.push(`  ${k}: ${v}`);
    for (const [k, v] of str) if (v !== undefined && v !== "") body.push(`  ${k}: ${yamlScalar(v)}`);
    if (body.length === 0) return;
    lines.push("device:");
    lines.push(...body);
}

function formatBody(entries: PersistedLogEntry[]): string {
    const lines: string[] = [];
    for (const e of entries) {
        const ts = new Date(e.timestamp).toISOString();
        lines.push(`${ts} [${e.level.toUpperCase()}] ${e.message}`);
    }
    return lines.join("\n");
}

export function formatLogExport(
    entries: PersistedLogEntry[],
    meta: ExportMeta,
): string {
    const fm = formatFrontmatter(entries, meta);
    const body = formatBody(entries);
    return body.length > 0 ? `${fm}\n\n${body}\n` : `${fm}\n`;
}
