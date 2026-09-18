import type { TvFileKeys } from '../../../types';

/**
 * Keys that cannot be a custom property, whatever layer they arrive on.
 *
 * Every configured declaration key, plus `tags` (its own field) and
 * `position` (Obsidian writes it into the metadata cache). Said once because
 * it had been said three times with two different contents: the frontmatter
 * resolver and the update planner listed all of them, while the child-line
 * extractor listed only the keys it happened to handle. `tv-ignore` written
 * as a child property line therefore survived into `Task.properties` and was
 * printed into the frontmatter of a converted file, which made that file
 * invisible to the plugin.
 */
export function reservedPropertyKeys(fmKeys: TvFileKeys): ReadonlySet<string> {
    return new Set<string>([...Object.values(fmKeys), 'tags', 'position']);
}
