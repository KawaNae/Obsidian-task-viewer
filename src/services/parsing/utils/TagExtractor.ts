import { scanNotation } from './InlineNotation';

/**
 * Shared utility for extracting tags from task content and frontmatter.
 */
export class TagExtractor {
    /**
     * The tags of inline content text: its `#tag` notation outside code and
     * links (`scanNotation`), so `[[報告書#見出し]]` holds none.
     * Returns sorted, deduplicated tag names (without leading #).
     */
    static fromContent(content: string): string[] {
        const tags = new Set<string>();
        for (const notation of scanNotation(content)) {
            if (notation.kind === 'tag') tags.add(notation.tag);
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
     * Extract tags from a property line value (e.g. "- tags:: #tag1 #tag2" or "- tags:: tag1, tag2").
     * Supports both #hashtag format and comma-separated format (frontmatter-compatible).
     */
    static fromPropertyValue(value: string): string[] {
        const hashTags = TagExtractor.fromContent(value);
        if (hashTags.length > 0) return hashTags;
        return TagExtractor.fromFrontmatter(value);
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
