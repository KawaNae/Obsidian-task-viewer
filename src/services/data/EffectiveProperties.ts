import type { Task, PropertyValue } from '../../types';
import { TagExtractor } from '../parsing/utils/TagExtractor';

/**
 * Effective (inheritance-merged) views of a task's properties / tags / style.
 *
 * Raw fields (`task.color`, `task.tags`, `task.properties`, …) hold only the
 * task's own declaration; section-inherited values live in
 * `task.cascadeContext`. These helpers derive the merged view — the property
 * counterpart of `DisplayTask.effective*` for dates. Dates materialize on
 * DisplayTask because their merge needs display context (startHour); the
 * property merge closes over the Task alone, so it stays a derived helper
 * (same pattern as `getTaskKind` / `isFrontmatterContainer`).
 *
 * Consumers: display, filter, sort, API output. Writers and format() must
 * keep reading raw fields only — inherited values are never serialized.
 */

/** Merged color: own child-line / own-FM declaration, else section cascade. */
export function getEffectiveColor(t: Task): string | undefined {
    return t.color ?? t.cascadeContext?.color;
}

/** Merged linestyle: own declaration, else section cascade. */
export function getEffectiveLinestyle(t: Task): string | undefined {
    return t.linestyle ?? t.cascadeContext?.linestyle;
}

/** Merged mask: own declaration, else section cascade. */
export function getEffectiveMask(t: Task): string | undefined {
    return t.mask ?? t.cascadeContext?.mask;
}

/** Merged tags: union of section cascade and own tags (sorted, deduped). */
export function getEffectiveTags(t: Task): string[] {
    const cascadeTags = t.cascadeContext?.tags;
    if (!cascadeTags || cascadeTags.length === 0) return t.tags;
    return TagExtractor.merge(cascadeTags, t.tags);
}

/** Merged custom properties: section cascade overlaid by own (child-wins per key). */
export function getEffectiveProperties(t: Task): Record<string, PropertyValue> {
    const cascadeProps = t.cascadeContext?.properties;
    if (!cascadeProps || Object.keys(cascadeProps).length === 0) return t.properties;
    return { ...cascadeProps, ...t.properties };
}
