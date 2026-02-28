import { App } from 'obsidian';

const VALID_LINE_STYLES = new Set(['solid', 'dashed', 'dotted', 'double', 'dashdotted']);

/**
 * Resolves task accent color and line style from file frontmatter.
 * Pure data-retrieval logic — no DOM manipulation.
 */
export class TaskStyleResolver {
    /**
     * Gets the custom color for a file from its frontmatter.
     */
    static getFileColor(app: App, filePath: string, frontmatterKey: string | null): string | null {
        if (!frontmatterKey) return null;

        const cache = app.metadataCache.getCache(filePath);
        return cache?.frontmatter?.[frontmatterKey] || null;
    }

    /**
     * Gets the custom line style for a file from its frontmatter.
     * Returns null when the key is missing or the value is invalid.
     */
    static getFileLinestyle(app: App, filePath: string, frontmatterKey: string | null): string | null {
        if (!frontmatterKey) return null;

        const cache = app.metadataCache.getCache(filePath);
        const value = cache?.frontmatter?.[frontmatterKey];
        if (typeof value !== 'string') return null;

        const normalized = value.trim().toLowerCase();
        if (!normalized) return null;

        return VALID_LINE_STYLES.has(normalized) ? normalized : null;
    }
}
