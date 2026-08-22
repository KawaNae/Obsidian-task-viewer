import { describe, it, expect } from 'vitest';
import { buildExportFileName, formatLogExport, type ExportMeta, type DeviceInfo } from '../../../src/log/markdown-formatter';
import type { PersistedLogEntry } from '../../../src/log/log-storage';

function meta(overrides: Partial<ExportMeta> = {}): ExportMeta {
    return {
        pluginVersion: '0.53.0',
        obsidianVersion: '1.12.0',
        platform: { os: 'windows', isMobile: false },
        exportedAt: Date.UTC(2026, 7, 22, 12, 0, 0),
        taskState: { taskCount: 3, activeViewCount: 2, enabledParsers: ['tv-inline', 'tv-file'], startHour: 4 },
        ...overrides,
    };
}

function entry(overrides: Partial<PersistedLogEntry> = {}): PersistedLogEntry {
    return { timestamp: Date.UTC(2026, 7, 22, 12, 0, 0), level: 'info', message: 'hello', ...overrides };
}

describe('buildExportFileName', () => {
    it('formats in UTC and replaces colons with hyphens', () => {
        // 2026-08-22T12:34:56.789Z
        const ms = Date.UTC(2026, 7, 22, 12, 34, 56, 789);
        expect(buildExportFileName(ms)).toBe('task_viewer_log_2026-08-22T12-34-56.md');
    });

    it('is UTC regardless of what local calendar day it would be', () => {
        // 23:30 UTC — a local-time formatter in a negative-offset zone would show a different date.
        const ms = Date.UTC(2026, 7, 22, 23, 30, 0);
        expect(buildExportFileName(ms)).toBe('task_viewer_log_2026-08-22T23-30-00.md');
    });
});

describe('formatLogExport frontmatter', () => {
    it('includes plugin/obsidian version, platform, and exportedAt', () => {
        // version strings start with a digit, so yamlScalar quotes them (see next test) — pin that here too.
        const out = formatLogExport([], meta());
        expect(out).toContain("plugin_version: '0.53.0'");
        expect(out).toContain("obsidian_version: '1.12.0'");
        expect(out).toContain('  os: windows');
        expect(out).toContain('  mobile: false');
        expect(out).toContain("exported_at: '2026-08-22T12:00:00.000Z'");
    });

    it('quotes YAML scalars that need it (special chars or leading digit), leaves plain ones bare', () => {
        const out = formatLogExport([], meta({ pluginVersion: 'plain', obsidianVersion: '1: with colon' }));
        expect(out).toContain('plugin_version: plain');
        expect(out).toContain("obsidian_version: '1: with colon'");
    });

    it('quotes a value starting with a digit even without special characters', () => {
        const out = formatLogExport([], meta({ pluginVersion: '2v' }));
        expect(out).toContain("plugin_version: '2v'");
    });

    it('quotes an empty string scalar as two single quotes', () => {
        const out = formatLogExport([], meta({ pluginVersion: '' }));
        expect(out).toContain("plugin_version: ''");
    });

    it('counts entries per level, zero-filling levels with no entries', () => {
        const entries = [entry({ level: 'error' }), entry({ level: 'error' }), entry({ level: 'warn' })];
        const out = formatLogExport(entries, meta());
        expect(out).toContain('  debug: 0');
        expect(out).toContain('  info: 0');
        expect(out).toContain('  warn: 1');
        expect(out).toContain('  error: 2');
    });

    it('uses exportedAt for buffer_range when there are no entries', () => {
        const out = formatLogExport([], meta({ exportedAt: Date.UTC(2026, 7, 22, 9, 0, 0) }));
        expect(out).toContain("  from: '2026-08-22T09:00:00.000Z'");
        expect(out).toContain("  to: '2026-08-22T09:00:00.000Z'");
    });

    it('uses the first and last entry timestamps for buffer_range when entries exist (assumes caller sorted them)', () => {
        const entries = [
            entry({ timestamp: Date.UTC(2026, 7, 22, 8, 0, 0) }),
            entry({ timestamp: Date.UTC(2026, 7, 22, 8, 5, 0) }),
            entry({ timestamp: Date.UTC(2026, 7, 22, 8, 10, 0) }),
        ];
        const out = formatLogExport(entries, meta());
        expect(out).toContain("  from: '2026-08-22T08:00:00.000Z'");
        expect(out).toContain("  to: '2026-08-22T08:10:00.000Z'");
    });

    it('includes task_state fields verbatim', () => {
        const out = formatLogExport([], meta());
        expect(out).toContain('  task_count: 3');
        expect(out).toContain('  active_view_count: 2');
        expect(out).toContain('  enabled_parsers: [tv-inline, tv-file]');
        expect(out).toContain('  start_hour: 4');
    });

    it('omits the device block entirely when meta.device is undefined', () => {
        const out = formatLogExport([], meta());
        expect(out).not.toContain('device:');
    });

    it('includes only the device fields that are defined and non-empty', () => {
        const device: DeviceInfo = { cpuCores: 8, userAgent: '', cpuModel: 'Test CPU' };
        const out = formatLogExport([], meta({ device }));
        expect(out).toContain('device:');
        expect(out).toContain('  cpu_cores: 8');
        expect(out).toContain("  cpu_model: 'Test CPU'");
        expect(out).not.toContain('user_agent'); // empty string skipped
        expect(out).not.toContain('js_heap_used_mb'); // undefined skipped
    });

    it('omits the device block when device is present but every field is empty/undefined', () => {
        const out = formatLogExport([], meta({ device: {} }));
        expect(out).not.toContain('device:');
    });
});

describe('formatLogExport body', () => {
    it('produces frontmatter only (no trailing body) when there are no entries', () => {
        const out = formatLogExport([], meta());
        expect(out.endsWith('---\n')).toBe(true);
        expect(out).not.toMatch(/\[INFO\]/);
    });

    it('renders each entry as an ISO-timestamped, level-tagged line', () => {
        const entries = [
            entry({ timestamp: Date.UTC(2026, 7, 22, 8, 0, 0), level: 'warn', message: 'careful' }),
            entry({ timestamp: Date.UTC(2026, 7, 22, 8, 1, 0), level: 'error', message: 'boom' }),
        ];
        const out = formatLogExport(entries, meta());
        expect(out).toContain('2026-08-22T08:00:00.000Z [WARN] careful');
        expect(out).toContain('2026-08-22T08:01:00.000Z [ERROR] boom');
    });
});
