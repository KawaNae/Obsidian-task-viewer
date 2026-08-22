/**
 * The frontmatter key names a tv-file task is written under, and the
 * normalisation and validation the settings apply to them.
 */
export interface TvFileKeys {
    start: string;
    end: string;
    due: string;
    status: string;
    content: string;
    timerTargetId: string;
    color: string;
    linestyle: string;
    mask: string;
    ignore: string;
}

export const DEFAULT_TV_FILE_KEYS: TvFileKeys = {
    start: 'tv-start',
    end: 'tv-end',
    due: 'tv-due',
    status: 'tv-status',
    content: 'tv-content',
    timerTargetId: 'tv-timer-target-id',
    color: 'tv-color',
    linestyle: 'tv-linestyle',
    mask: 'tv-mask',
    ignore: 'tv-ignore',
};

export function normalizeTvFileKeys(value: unknown): TvFileKeys {
    const source = (value && typeof value === 'object')
        ? value as Partial<Record<keyof TvFileKeys, unknown>>
        : {};

    const normalize = (key: keyof TvFileKeys): string => {
        const raw = source[key];
        if (typeof raw !== 'string') {
            return DEFAULT_TV_FILE_KEYS[key];
        }

        const trimmed = raw.trim();
        return trimmed.length > 0 ? trimmed : DEFAULT_TV_FILE_KEYS[key];
    };

    return {
        start: normalize('start'),
        end: normalize('end'),
        due: normalize('due'),
        status: normalize('status'),
        content: normalize('content'),
        timerTargetId: normalize('timerTargetId'),
        color: normalize('color'),
        linestyle: normalize('linestyle'),
        mask: normalize('mask'),
        ignore: normalize('ignore'),
    };
}

export function validateTvFileKeys(keys: TvFileKeys): string | null {
    const names: Array<keyof TvFileKeys> = [
        'start',
        'end',
        'due',
        'status',
        'content',
        'timerTargetId',
        'color',
        'linestyle',
        'mask',
        'ignore',
    ];

    const normalizedValues = new Map<keyof TvFileKeys, string>();
    for (const name of names) {
        const value = keys[name].trim();
        if (!value) {
            return 'tv-file keys cannot be empty.';
        }
        normalizedValues.set(name, value);
    }

    const seen = new Set<string>();
    for (const name of names) {
        const value = normalizedValues.get(name)!;
        if (seen.has(value)) {
            return `tv-file keys must be unique. Duplicate: "${value}".`;
        }
        seen.add(value);
    }

    return null;
}
