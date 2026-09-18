/**
 * The frontmatter (and section property) key names that set a note's scope:
 * default dates, style and the ignore switch that every task in the note
 * inherits. Frontmatter makes no task of its own — these keys only hand values
 * down. Also the normalisation and validation the settings apply to them.
 */
export interface ScopeKeys {
    start: string;
    end: string;
    due: string;
    color: string;
    linestyle: string;
    mask: string;
    ignore: string;
}

export const DEFAULT_SCOPE_KEYS: ScopeKeys = {
    start: 'tv-start',
    end: 'tv-end',
    due: 'tv-due',
    color: 'tv-color',
    linestyle: 'tv-linestyle',
    mask: 'tv-mask',
    ignore: 'tv-ignore',
};

const SCOPE_KEY_NAMES: ReadonlyArray<keyof ScopeKeys> = [
    'start',
    'end',
    'due',
    'color',
    'linestyle',
    'mask',
    'ignore',
];

/**
 * Rebuilt from the fixed list, so a key this version no longer knows (the
 * file-task era's status / content / timerTargetId) is dropped on the next save.
 */
export function normalizeScopeKeys(value: unknown): ScopeKeys {
    const source = (value && typeof value === 'object')
        ? value as Partial<Record<keyof ScopeKeys, unknown>>
        : {};

    const normalized = {} as ScopeKeys;
    for (const key of SCOPE_KEY_NAMES) {
        const raw = source[key];
        const trimmed = typeof raw === 'string' ? raw.trim() : '';
        normalized[key] = trimmed.length > 0 ? trimmed : DEFAULT_SCOPE_KEYS[key];
    }
    return normalized;
}

export function validateScopeKeys(keys: ScopeKeys): string | null {
    const normalizedValues = new Map<keyof ScopeKeys, string>();
    for (const name of SCOPE_KEY_NAMES) {
        const value = keys[name].trim();
        if (!value) {
            return 'Scope keys cannot be empty.';
        }
        normalizedValues.set(name, value);
    }

    const seen = new Set<string>();
    for (const name of SCOPE_KEY_NAMES) {
        const value = normalizedValues.get(name)!;
        if (seen.has(value)) {
            return `Scope keys must be unique. Duplicate: "${value}".`;
        }
        seen.add(value);
    }

    return null;
}
