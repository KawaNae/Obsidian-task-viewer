import { normalizePath } from 'obsidian';

export const AI_INDEX_PLUGIN_FOLDER = '.obsidian/plugins/obsidian-task-viewer';

export interface AiIndexSettings {
    enabled: boolean;
    fileName: string;
    outputToPluginFolder: boolean;
    customOutputFolder: string;
    debounceMs: number;
    includeParsers: string[];
    includeDone: boolean;
    includeRaw: boolean;
    keepDoneDays: number;
    createBackup: boolean;
}

type LegacyAiIndexSettings = Partial<AiIndexSettings> & {
    outputPath?: unknown;
};

export const DEFAULT_AI_INDEX_SETTINGS: AiIndexSettings = {
    enabled: true,
    fileName: 'ai-task-index.ndjson',
    outputToPluginFolder: true,
    customOutputFolder: AI_INDEX_PLUGIN_FOLDER,
    debounceMs: 1000,
    includeParsers: ['inline', 'frontmatter'],
    includeDone: true,
    includeRaw: false,
    keepDoneDays: 0,
    createBackup: false,
};

export function normalizeAiIndexSettings(value: unknown): AiIndexSettings {
    const source = (value && typeof value === 'object')
        ? value as LegacyAiIndexSettings
        : {};

    const enabled = typeof source.enabled === 'boolean'
        ? source.enabled
        : DEFAULT_AI_INDEX_SETTINGS.enabled;

    const debounceMsRaw = typeof source.debounceMs === 'number'
        ? source.debounceMs
        : Number(source.debounceMs);
    const debounceMs = Number.isFinite(debounceMsRaw)
        ? Math.max(100, Math.min(5000, Math.round(debounceMsRaw)))
        : DEFAULT_AI_INDEX_SETTINGS.debounceMs;

    const includeParsers = normalizeIncludeParsers(source.includeParsers);

    const includeDone = typeof source.includeDone === 'boolean'
        ? source.includeDone
        : DEFAULT_AI_INDEX_SETTINGS.includeDone;

    const includeRaw = typeof source.includeRaw === 'boolean'
        ? source.includeRaw
        : DEFAULT_AI_INDEX_SETTINGS.includeRaw;

    const keepDoneDaysRaw = typeof source.keepDoneDays === 'number'
        ? source.keepDoneDays
        : Number(source.keepDoneDays);
    const keepDoneDays = Number.isFinite(keepDoneDaysRaw)
        ? Math.max(0, Math.min(3650, Math.round(keepDoneDaysRaw)))
        : DEFAULT_AI_INDEX_SETTINGS.keepDoneDays;

    const createBackup = typeof source.createBackup === 'boolean'
        ? source.createBackup
        : DEFAULT_AI_INDEX_SETTINGS.createBackup;

    const hasNewShape = hasOwn(source, 'fileName')
        || hasOwn(source, 'outputToPluginFolder')
        || hasOwn(source, 'customOutputFolder');

    let fileName = DEFAULT_AI_INDEX_SETTINGS.fileName;
    let outputToPluginFolder = DEFAULT_AI_INDEX_SETTINGS.outputToPluginFolder;
    let customOutputFolder = DEFAULT_AI_INDEX_SETTINGS.customOutputFolder;

    if (hasNewShape) {
        fileName = normalizeAiIndexFileName(source.fileName);
        outputToPluginFolder = typeof source.outputToPluginFolder === 'boolean'
            ? source.outputToPluginFolder
            : DEFAULT_AI_INDEX_SETTINGS.outputToPluginFolder;
        customOutputFolder = normalizeAiIndexFolderPath(source.customOutputFolder);
    } else if (typeof source.outputPath === 'string' && source.outputPath.trim().length > 0) {
        const migrated = migrateLegacyOutputPath(source.outputPath);
        fileName = migrated.fileName;
        outputToPluginFolder = migrated.outputToPluginFolder;
        customOutputFolder = migrated.customOutputFolder;
    }

    return {
        enabled,
        fileName,
        outputToPluginFolder,
        customOutputFolder,
        debounceMs,
        includeParsers,
        includeDone,
        includeRaw,
        keepDoneDays,
        createBackup,
    };
}

export function resolveAiIndexOutputPath(settings: AiIndexSettings): string {
    const fileName = normalizeAiIndexFileName(settings.fileName);
    const folder = settings.outputToPluginFolder
        ? AI_INDEX_PLUGIN_FOLDER
        : normalizeAiIndexFolderPath(settings.customOutputFolder);
    const joined = folder.length > 0 ? `${folder}/${fileName}` : fileName;
    const normalized = normalizePath(joined);
    if (!isValidVaultRelativeFilePath(normalized)) {
        return `${AI_INDEX_PLUGIN_FOLDER}/${DEFAULT_AI_INDEX_SETTINGS.fileName}`;
    }
    return normalized;
}

export function normalizeAiIndexFileName(value: unknown): string {
    if (typeof value !== 'string') {
        return DEFAULT_AI_INDEX_SETTINGS.fileName;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return DEFAULT_AI_INDEX_SETTINGS.fileName;
    }
    if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes(':')) {
        return DEFAULT_AI_INDEX_SETTINGS.fileName;
    }
    if (trimmed === '.' || trimmed === '..') {
        return DEFAULT_AI_INDEX_SETTINGS.fileName;
    }

    const normalized = trimmed.toLowerCase().endsWith('.ndjson')
        ? trimmed
        : `${trimmed}.ndjson`;

    return normalized;
}

export function normalizeAiIndexFolderPath(value: unknown): string {
    if (typeof value !== 'string') {
        return DEFAULT_AI_INDEX_SETTINGS.customOutputFolder;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return DEFAULT_AI_INDEX_SETTINGS.customOutputFolder;
    }

    const normalized = normalizePath(trimmed);
    if (!isValidVaultRelativeFolderPath(normalized)) {
        return DEFAULT_AI_INDEX_SETTINGS.customOutputFolder;
    }

    return normalized;
}

function normalizeIncludeParsers(value: unknown): string[] {
    const rawValues: string[] = [];

    if (typeof value === 'string') {
        rawValues.push(...value.split(','));
    } else if (Array.isArray(value)) {
        for (const item of value) {
            if (typeof item === 'string') {
                rawValues.push(item);
            }
        }
    }

    const normalized = rawValues
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item === 'inline' || item === 'frontmatter');

    const deduped = Array.from(new Set(normalized));
    return deduped.length > 0
        ? deduped
        : [...DEFAULT_AI_INDEX_SETTINGS.includeParsers];
}

function migrateLegacyOutputPath(rawPath: string): Pick<AiIndexSettings, 'fileName' | 'outputToPluginFolder' | 'customOutputFolder'> {
    const fallback = {
        fileName: DEFAULT_AI_INDEX_SETTINGS.fileName,
        outputToPluginFolder: DEFAULT_AI_INDEX_SETTINGS.outputToPluginFolder,
        customOutputFolder: DEFAULT_AI_INDEX_SETTINGS.customOutputFolder,
    };

    const normalizedLegacy = normalizePath(rawPath.trim());
    if (!isValidVaultRelativeFilePath(normalizedLegacy)) {
        return fallback;
    }

    const lastSlash = normalizedLegacy.lastIndexOf('/');
    const rawFileName = lastSlash >= 0
        ? normalizedLegacy.slice(lastSlash + 1)
        : normalizedLegacy;
    const rawFolder = lastSlash >= 0
        ? normalizedLegacy.slice(0, lastSlash)
        : '.';

    const fileName = normalizeAiIndexFileName(rawFileName);
    const customOutputFolder = normalizeAiIndexFolderPath(rawFolder);
    const outputToPluginFolder = customOutputFolder === AI_INDEX_PLUGIN_FOLDER;

    return {
        fileName,
        outputToPluginFolder,
        customOutputFolder,
    };
}

function hasOwn(source: LegacyAiIndexSettings, key: keyof LegacyAiIndexSettings): boolean {
    return Object.prototype.hasOwnProperty.call(source, key);
}

function isValidVaultRelativeFolderPath(path: string): boolean {
    return isValidVaultRelativePath(path) && !path.toLowerCase().endsWith('.ndjson');
}

function isValidVaultRelativeFilePath(path: string): boolean {
    return isValidVaultRelativePath(path);
}

function isValidVaultRelativePath(path: string): boolean {
    if (!path) {
        return false;
    }
    if (path.startsWith('/')) {
        return false;
    }
    if (path.startsWith('../')) {
        return false;
    }
    if (path.includes(':')) {
        return false;
    }

    const parts = path.split('/');
    for (const part of parts) {
        if (!part || part === '..') {
            return false;
        }
    }

    return true;
}
