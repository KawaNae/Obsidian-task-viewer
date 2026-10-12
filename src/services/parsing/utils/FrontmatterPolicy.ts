import type { ScopeKeys } from '../../../types';
import { PropertyKey } from './PropertyKey';

/**
 * Keys the file task was written under before frontmatter stopped making
 * tasks. Notes still carry them; left unreserved, a leftover `tv-status` would
 * be inherited as a custom property and show up on every card in the note.
 */
const LEGACY_FILE_TASK_KEYS: ReadonlyArray<string> = ['tv-status', 'tv-content', 'tv-timer-target-id'];

/**
 * The reserved keys that are not scope keys: the file task's legacy keys,
 * `tags` and `position`, folded (`PropertyKey.fold`). A scope key cannot be
 * one of them either, whatever its case.
 */
export const KEYS_NOT_SCOPE: ReadonlySet<string> = new Set<string>([...LEGACY_FILE_TASK_KEYS, 'tags', 'position']);

/**
 * Keys that cannot be a custom property, whatever layer they arrive on,
 * folded (`PropertyKey.fold`): a key is asked folded, so `TV-COLOR` and
 * `Tags` are reserved as `tv-color` and `tags` are.
 *
 * Every configured scope key, the file task's legacy keys, `tags` (its own
 * field) and `position` (Obsidian writes it into the metadata cache). Said once
 * because it had been said three times with two different contents: the
 * frontmatter resolver and the update planner listed all of them, while the
 * child-line extractor listed only the keys it happened to handle.
 */
export function reservedPropertyKeys(fmKeys: ScopeKeys): ReadonlySet<string> {
    return new Set<string>([...Object.values(fmKeys).map(PropertyKey.fold), ...KEYS_NOT_SCOPE]);
}
