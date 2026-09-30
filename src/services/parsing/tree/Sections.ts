import type { PropertyValue } from '../../../types';
import type { OutlineHeading } from '../utils/Outline';

/**
 * A section of a note: the lines a heading the note reads opens, up to the
 * next heading of its level or above (`NoteSections.read`). Holds what the
 * section gives the rows in it — its own property lines, and the values
 * resolved down the cascade (`SectionPropertyResolver`) — and nothing of
 * the rows themselves, which the extraction reads off the note's reading
 * (`NoteTasks`).
 */
export interface SectionNode {
    /** The heading that opens it; null for the lines above the note's first heading. */
    heading: OutlineHeading | null;
    propertyBlock: PropertyBlock | null;
    /** カスケード解決済みプロパティ（SectionPropertyResolver が設定） */
    resolvedProperties: Record<string, PropertyValue>;
    resolvedColor?: string;
    resolvedLinestyle?: string;
    resolvedMask?: string;
    resolvedTags?: string[];
    resolvedStartDate?: string;
    resolvedStartTime?: string;
    resolvedEndDate?: string;
    resolvedEndTime?: string;
    resolvedDue?: string;
    /** Which layer each resolved value above came from (SectionPropertyResolver が設定) */
    resolvedSources: ResolvedSources;
    children: SectionNode[];         // ネストした子セクション
    /** セクションの行範囲 [startLine, endLine)（子セクション含む） */
    startLine: number;
    endLine: number;
}

/**
 * The layer a resolved value came from: the note's frontmatter, or the
 * property line `line` of a section — `heading` null for the section above
 * the note's first heading.
 */
export type ValueSource =
    | { kind: 'frontmatter' }
    | { kind: 'section'; line: number; heading: OutlineHeading | null };

/** A resolved value one layer sets for good: the nearest layer that has one wins. */
export type ScalarField = 'color' | 'linestyle' | 'mask' | 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'due';

export const SCALAR_FIELDS: readonly ScalarField[] = ['color', 'linestyle', 'mask', 'startDate', 'startTime', 'endDate', 'endTime', 'due'];

/**
 * Where a section's resolved values came from, value by value: which layer
 * won each (the resolution decides that, and only it), so that a reader
 * who has to say a value again elsewhere — the frontmatter of a note a row
 * is sent to — can go back to the line that says it.
 */
export interface ResolvedSources {
    /** Per scalar value, the layer whose value won. None for a value no layer sets. */
    fields: Readonly<Partial<Record<ScalarField, ValueSource>>>;
    /** Every layer that adds tags to the union, from the top down. */
    tags: readonly ValueSource[];
    /** Per custom key, the layer whose value won. */
    properties: Readonly<Record<string, ValueSource>>;
}

/** The sources of a section nothing resolved yet: no layer sets anything. */
export const NO_SOURCES: ResolvedSources = Object.freeze({
    fields: Object.freeze({}),
    tags: Object.freeze([]) as readonly ValueSource[],
    properties: Object.freeze({}),
});

/**
 * セクションスコープのプロパティ集合。
 * lead area (heading 直後 〜 最初のタスク行直前) 内の同レベル
 * `- key:: value` 行をすべて集約する。物理的に連続している必要はない。
 */
export interface PropertyBlock {
    entries: PropertyBlockEntry[];
}

export interface PropertyBlockEntry {
    key: string;
    value: string;
    line: number;
}
