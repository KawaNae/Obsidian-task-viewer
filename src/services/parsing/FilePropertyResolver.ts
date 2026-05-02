import type { TvFileKeys, PropertyValue } from '../../types';
import type { ExtractedProperties } from './tree/BuiltinPropertyExtractor';
import { VALID_LINE_STYLES } from '../../constants/style';
import { normalizeColor } from '../../utils/ColorUtils';
import { TagExtractor } from './utils/TagExtractor';

/**
 * File-scope (frontmatter) property resolver.
 *
 * Pure transformation: frontmatter object → ExtractedProperties.
 * Builtin keys (color/linestyle/mask) are normalized and validated; other
 * keys become custom properties. Used by both TVFileBuilder (for the
 * tv-file Task itself) and SectionPropertyResolver (as the cascade root).
 *
 * Symmetry: this is the File layer in the File/Section/Task inheritance
 * pipeline (see DEVELOPER.md).
 */
export class FilePropertyResolver {
    /** Obsidian metadataCache internal keys to exclude from custom properties */
    private static readonly INTERNAL_KEYS = new Set<string>(['position']);

    static extract(
        frontmatter: Record<string, any> | undefined,
        keys: TvFileKeys
    ): ExtractedProperties {
        if (!frontmatter) return { properties: {} };

        const color = this.resolveColor(frontmatter[keys.color]);
        const linestyle = this.resolveLinestyle(frontmatter[keys.linestyle]);
        const mask = this.resolveMask(frontmatter[keys.mask]);

        const excluded = new Set<string>(Object.values(keys));
        excluded.add('tags');
        for (const k of this.INTERNAL_KEYS) excluded.add(k);

        const properties: Record<string, PropertyValue> = {};
        for (const [key, value] of Object.entries(frontmatter)) {
            if (excluded.has(key)) continue;
            if (value === null || value === undefined) continue;
            const type = typeof value === 'number' ? 'number' as const
                : typeof value === 'boolean' ? 'boolean' as const
                : Array.isArray(value) ? 'array' as const
                : 'string' as const;
            properties[key] = {
                value: Array.isArray(value) ? value.join(', ') : String(value),
                type,
            };
        }

        const tags = TagExtractor.fromFrontmatter(frontmatter['tags']);

        return {
            color,
            linestyle,
            mask,
            tags: tags.length > 0 ? tags : undefined,
            properties,
        };
    }

    private static resolveColor(value: unknown): string | undefined {
        if (typeof value !== 'string') return undefined;
        return value.trim() ? normalizeColor(value) : undefined;
    }

    private static resolveLinestyle(value: unknown): string | undefined {
        if (typeof value !== 'string') return undefined;
        const normalized = value.trim().toLowerCase();
        return VALID_LINE_STYLES.has(normalized) ? normalized : undefined;
    }

    private static resolveMask(value: unknown): string | undefined {
        if (typeof value !== 'string') return undefined;
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
}
