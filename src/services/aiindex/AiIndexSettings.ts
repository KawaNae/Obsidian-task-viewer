export interface AiIndexSettings {
    enabled: boolean;
    outputPath: string;
    debounceMs: number;
    includeParsers: string[];
    includeDone: boolean;
}

export const DEFAULT_AI_INDEX_SETTINGS: AiIndexSettings = {
    enabled: true,
    outputPath: '.obsidian/plugins/obsidian-task-viewer/ai-task-index.ndjson',
    debounceMs: 1000,
    includeParsers: ['inline', 'frontmatter'],
    includeDone: true,
};

export function normalizeAiIndexSettings(value: unknown): AiIndexSettings {
    const source = (value && typeof value === 'object')
        ? value as Partial<Record<keyof AiIndexSettings, unknown>>
        : {};

    const enabled = typeof source.enabled === 'boolean'
        ? source.enabled
        : DEFAULT_AI_INDEX_SETTINGS.enabled;

    const outputPath = typeof source.outputPath === 'string' && source.outputPath.trim().length > 0
        ? source.outputPath.trim()
        : DEFAULT_AI_INDEX_SETTINGS.outputPath;

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

    return {
        enabled,
        outputPath,
        debounceMs,
        includeParsers,
        includeDone,
    };
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
