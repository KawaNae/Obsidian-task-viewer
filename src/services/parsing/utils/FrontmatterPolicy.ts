import type { TvFileKeys } from '../../../types';

/**
 * True when the frontmatter declares the file as task-bearing.
 *
 * A file is task-bearing when its frontmatter includes `tags` or any
 * configured fm-key (except `ignore`, which is the opt-out signal).
 * The presence of the key is what matters — values are not inspected.
 *
 * Used both to gate container creation in TVFileBuilder and, via
 * the fmResult-presence proxy, to gate plain-checkbox task extraction in
 * TreeTaskExtractor.
 */
export function isTaskBearingFile(
    frontmatter: Record<string, unknown> | undefined,
    fmKeys: TvFileKeys
): boolean {
    if (!frontmatter) return false;

    const signalKeys: Array<keyof TvFileKeys> = [
        'start',
        'end',
        'due',
        'status',
        'content',
        'timerTargetId',
        'color',
        'linestyle',
        'mask',
    ];

    if ('tags' in frontmatter) return true;
    for (const k of signalKeys) {
        if (fmKeys[k] in frontmatter) return true;
    }
    return false;
}

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
