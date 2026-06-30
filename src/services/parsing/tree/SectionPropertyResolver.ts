import type { DocumentNode, SectionNode } from './DocumentTree';
import type { TvFileKeys, PropertyValue } from '../../../types';
import { BuiltinPropertyExtractor, type ExtractedProperties } from './BuiltinPropertyExtractor';
import { ChildLineClassifier } from '../utils/ChildLineClassifier';
import { TagExtractor } from '../utils/TagExtractor';
import { FilePropertyResolver } from '../FilePropertyResolver';

/**
 * Section-scope property resolver.
 *
 * Cascades properties along the section tree (frontmatter → parent section →
 * child section, child-wins). The frontmatter base is delegated to
 * FilePropertyResolver (the File layer in the File/Section/Task pipeline).
 */
export class SectionPropertyResolver {
    static resolve(
        doc: DocumentNode,
        frontmatter: Record<string, any> | undefined,
        keys: TvFileKeys,
        dailyNoteDate?: string
    ): void {
        const fmBase = FilePropertyResolver.extract(frontmatter, keys, dailyNoteDate);

        for (const section of doc.sections) {
            this.resolveSection(section, fmBase, keys);
        }
    }

    private static resolveSection(
        section: SectionNode,
        parentProps: ExtractedProperties,
        keys: TvFileKeys
    ): void {
        // セクション自身の PropertyBlock からプロパティ抽出
        const ownRaw = this.propertyBlockToRecord(section);
        const ownExtracted = BuiltinPropertyExtractor.extract(ownRaw, keys);

        // 親プロパティ + 自身のプロパティを child-wins マージ
        section.resolvedProperties = { ...parentProps.properties, ...ownExtracted.properties };
        section.resolvedColor = ownExtracted.color ?? parentProps.color;
        section.resolvedLinestyle = ownExtracted.linestyle ?? parentProps.linestyle;
        section.resolvedMask = ownExtracted.mask ?? parentProps.mask;
        section.resolvedTags = ownExtracted.tags
            ? TagExtractor.merge(parentProps.tags ?? [], ownExtracted.tags)
            : parentProps.tags;

        // Partial merge: date と time は独立に継承
        section.resolvedStartDate = ownExtracted.startDate ?? parentProps.startDate;
        section.resolvedStartTime = ownExtracted.startTime ?? parentProps.startTime;
        section.resolvedEndDate = ownExtracted.endDate ?? parentProps.endDate;
        section.resolvedEndTime = ownExtracted.endTime ?? parentProps.endTime;
        section.resolvedDue = ownExtracted.due ?? parentProps.due;

        // 子セクションへ再帰
        const resolved: ExtractedProperties = {
            color: section.resolvedColor,
            linestyle: section.resolvedLinestyle,
            mask: section.resolvedMask,
            tags: section.resolvedTags,
            startDate: section.resolvedStartDate,
            startTime: section.resolvedStartTime,
            endDate: section.resolvedEndDate,
            endTime: section.resolvedEndTime,
            due: section.resolvedDue,
            properties: section.resolvedProperties,
        };
        for (const child of section.children) {
            this.resolveSection(child, resolved, keys);
        }
    }

    /** PropertyBlock のエントリを Record<string, PropertyValue> に変換 */
    private static propertyBlockToRecord(
        section: SectionNode
    ): Record<string, PropertyValue> {
        const result: Record<string, PropertyValue> = {};
        if (!section.propertyBlock) return result;
        for (const entry of section.propertyBlock.entries) {
            result[entry.key] = {
                value: entry.value,
                type: ChildLineClassifier.inferType(entry.value),
            };
        }
        return result;
    }
}
