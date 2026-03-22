/**
 * Shared utility for extracting tags from task content and frontmatter.
 */
export class TagExtractor {
    private static readonly TAG_REGEX = /\B#[^\s#]+/g;

    /**
     * Extract tags from inline content text.
     * Returns sorted, deduplicated tag names (without leading #).
     */
    static fromContent(content: string): string[] {
        const tags = new Set<string>();
        const matches = content.match(TagExtractor.TAG_REGEX) ?? [];
        for (const raw of matches) {
            const tag = raw.substring(1).trim();
            if (tag.length > 0) {
                tags.add(tag);
            }
        }
        return Array.from(tags).sort();
    }

    /**
     * Extract tags from frontmatter `tags` field.
     * Handles: string[], string (comma-separated), YAML lists.
     */
    static fromFrontmatter(value: unknown): string[] {
        if (!value) return [];
        if (Array.isArray(value)) {
            return value
                .filter(v => typeof v === 'string' && v.trim().length > 0)
                .map(v => (v as string).trim().replace(/^#/, ''))
                .filter(v => v.length > 0)
                .sort();
        }
        if (typeof value === 'string') {
            return value.split(',')
                .map(v => v.trim().replace(/^#/, ''))
                .filter(v => v.length > 0)
                .sort();
        }
        return [];
    }

    /**
     * Merge tags from multiple sources, deduplicate and sort.
     */
    static merge(...tagArrays: string[][]): string[] {
        const set = new Set<string>();
        for (const tags of tagArrays) {
            for (const tag of tags) {
                set.add(tag);
            }
        }
        return Array.from(set).sort();
    }
}
