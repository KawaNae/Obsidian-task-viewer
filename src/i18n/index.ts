import en from './locales/en.json';
import ja from './locales/ja.json';
import { moment } from 'obsidian';

type LocaleData = typeof en;

const locales: Record<string, LocaleData> = { en, ja };

let current: LocaleData = en;

/**
 * Initialize i18n. Call once at plugin load.
 * Detects locale from Obsidian's moment.locale().
 */
export function initI18n(): void {
    const lang = moment.locale();
    // moment locale can be 'ja', 'en', 'en-gb', etc. Match prefix.
    const key = lang.split('-')[0];
    current = locales[key] ?? en;
}

/**
 * Translate a dot-path key, with optional {{param}} interpolation.
 * Falls back to English, then to the key itself.
 */
export function t(key: string, params?: Record<string, string | number>): string {
    let value = resolve(current, key) ?? resolve(en, key) ?? key;
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            value = value.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
        }
    }
    return value;
}

function resolve(data: LocaleData, key: string): string | undefined {
    const parts = key.split('.');
    let obj: any = data;
    for (const part of parts) {
        if (obj == null || typeof obj !== 'object') return undefined;
        obj = obj[part];
    }
    return typeof obj === 'string' ? obj : undefined;
}
