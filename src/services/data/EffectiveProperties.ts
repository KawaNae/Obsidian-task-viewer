import type { Properties, Task } from '../../types';
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
 * (same pattern as `getTaskNotation`).
 *
 * Consumers: display, filter, sort, API output. Writers and formatTaskLine must
 * keep reading raw fields only — inherited values are never serialized.
 */

/**
 * A style as the row shows it: its own, where it says one, else what its
 * section gives. A row's own no value (`- tv-color::`) is none, hiding the
 * section's.
 */
function ownOrInherited(own: string | null | undefined, inherited: string | undefined): string | undefined {
    return own !== undefined ? own ?? undefined : inherited;
}

/** Merged color: own child-line / own-FM declaration, else section cascade. */
export function getEffectiveColor(t: Task): string | undefined {
    return ownOrInherited(t.color, t.cascadeContext?.color);
}

/** Merged linestyle: own declaration, else section cascade. */
export function getEffectiveLinestyle(t: Task): string | undefined {
    return ownOrInherited(t.linestyle, t.cascadeContext?.linestyle);
}

/** Merged mask: own declaration, else section cascade. */
export function getEffectiveMask(t: Task): string | undefined {
    return ownOrInherited(t.mask, t.cascadeContext?.mask);
}

/** Merged tags: union of section cascade and own tags (sorted, deduped). */
export function getEffectiveTags(t: Task): string[] {
    const cascadeTags = t.cascadeContext?.tags;
    if (!cascadeTags || cascadeTags.length === 0) return t.tags;
    return TagExtractor.merge(cascadeTags, t.tags);
}

/**
 * Merged custom properties: section cascade overlaid by own (child-wins per
 * key, its case aside). Each keeps the key as the layer that won writes it.
 * A key with no value (null) wins as one with a value does, hiding the
 * value above it.
 */
export function getEffectiveProperties(t: Task): Properties {
    const cascadeProps = t.cascadeContext?.properties;
    if (!cascadeProps || Object.keys(cascadeProps).length === 0) return t.properties;
    return { ...cascadeProps, ...t.properties };
}
