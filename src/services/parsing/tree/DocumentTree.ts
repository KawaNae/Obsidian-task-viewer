import type { PropertyValue } from '../../../types';

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
    blocks: BlockNode[];             // セクション内のブロック群（プロパティブロック除く）
    children: SectionNode[];         // ネストした子セクション
    /** セクションの行範囲 [startLine, endLine)（子セクション含む） */
    startLine: number;
    endLine: number;
}

export type BlockNode = PropertyBlock | TaskBlock | TextBlock;

/** 連続するプロパティ行群（セクション先頭のみ） */
export interface PropertyBlock {
    type: 'property-block';
    startLine: number;
    endLine: number;                 // exclusive
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

/** 非タスク・非プロパティのテキスト（無視対象） */
export interface TextBlock {
    type: 'text-block';
    startLine: number;
    endLine: number;                 // exclusive
}
