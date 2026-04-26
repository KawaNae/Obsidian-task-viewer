import type { FrontmatterTaskKeys } from '../../../types';

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
    fmKeys: FrontmatterTaskKeys
): boolean {
    if (!frontmatter) return false;

    const signalKeys: Array<keyof FrontmatterTaskKeys> = [
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
