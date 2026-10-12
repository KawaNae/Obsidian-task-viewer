import { scanNotation } from './InlineNotation';
import { TagRule } from './TagRule';

/**
 * Shared utility for extracting tags from task content and frontmatter.
 */
export class TagExtractor {
    /**
     * The tags of inline text, a task's content or a `tags::` line's value:
     * its `#tag` notation outside code and links (`scanNotation`), so
     * `[[報告書#見出し]]` holds none. A `tags::` value is read as any text
     * is, as Obsidian reads that line: `tags:: a, b` holds no tag.
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
     * The tags of a frontmatter as YAML gave it, the ones Obsidian lists
     * (`TagRule.ofFrontmatter`): `tags: [a.b, ok, true]` holds `ok`, and so
     * does `Tags: ok`. Sorted, deduplicated, without `#`.
     */
    static fromFrontmatter(frontmatter: Readonly<Record<string, unknown>> | undefined): string[] {
        return Array.from(new Set(TagRule.ofFrontmatter(frontmatter))).sort();
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
