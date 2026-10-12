import type { Properties } from '../../../types';
import type { OutlineHeading } from '../utils/Outline';
import type { OwnPropertyLines } from '../utils/PropertyLines';

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
    /** Its own property lines (`PropertyLines.ofSection`), every one, those not read included. */
    properties: OwnPropertyLines;
    /**
     * Where a line put at its head goes (`Placement.into`): past the
     * property lines written at its top, above its first task, or just
     * below its heading when there are none.
     */
    head: number;
    /** カスケード解決済みプロパティ（SectionPropertyResolver が設定）。キーは折りたたんだ形、綴りは値を書いた層のもの */
    resolvedProperties: Properties;
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

/** A layer that adds tags to a section's union, and the tags it adds. */
export interface TagLayer {
    from: ValueSource;
    tags: readonly string[];
}

/**
 * Where a section's resolved values came from, value by value: which layer
 * won each (the resolution decides that, and only it), so that a reader
 * who has to say a value again elsewhere — the frontmatter of a note a row
 * is sent to — can go back to the line that says it, and one who shows a
 * row what it inherits (the hub) can say from where.
 */
export interface ResolvedSources {
    /** Per scalar value, the layer whose value won. None for a value no layer sets. */
    fields: Readonly<Partial<Record<ScalarField, ValueSource>>>;
    /** Every layer that adds tags to the union, from the top down, with the tags it adds. */
    tags: readonly TagLayer[];
    /** Per custom key, folded (`PropertyKey.fold`), the layer whose value won. */
    properties: Readonly<Record<string, ValueSource>>;
}

/** The sources of a section nothing resolved yet: no layer sets anything. */
export const NO_SOURCES: ResolvedSources = Object.freeze({
    fields: Object.freeze({}),
    tags: Object.freeze([]) as readonly TagLayer[],
    properties: Object.freeze({}),
});
