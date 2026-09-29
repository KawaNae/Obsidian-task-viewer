import type { PropertyValue } from '../../../types';
import type { OutlineReading } from '../utils/Outline';

/** 見出し情報 */
export interface HeadingInfo {
    level: number;    // 1-6
    text: string;     // # を除いた見出しテキスト
    line: number;     // absolute line number (0-based)
}

/** ドキュメントルートノード */
export interface DocumentNode {
    filePath: string;
    bodyStartLine: number;          // frontmatter 終了後の行番号
    sections: SectionNode[];        // トップレベルセクション
    /** The note's one reading of items and code blocks (`Outline.read`), by absolute line. */
    outline: OutlineReading;
}

/** 見出しで区切られたセクション */
export interface SectionNode {
    heading: HeadingInfo | null;     // null = 見出し前の暗黙ルートセクション
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
    blocks: BlockNode[];             // セクション内のブロック群（プロパティブロック除く）
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
    | { kind: 'section'; line: number; heading: HeadingInfo | null };

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

export type BlockNode = TaskBlock;

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

/** タスク行 + その子行群 */
export interface TaskBlock {
    type: 'task-block';
    line: number;                    // absolute line number
    rawLine: string;
    indent: number;
    childRawLines: string[];         // インデントされた子行（正規化前）
    childLineNumbers: number[];      // childRawLines の absolute line numbers
    childTaskBlocks: TaskBlock[];    // 再帰的な子タスクブロック
}
