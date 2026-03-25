import type { DocumentNode, SectionNode } from './DocumentTree';
import type { FrontmatterTaskKeys, PropertyValue } from '../../../types';
import { BuiltinPropertyExtractor, type ExtractedProperties } from './BuiltinPropertyExtractor';
import { ChildLineClassifier } from '../utils/ChildLineClassifier';
import { normalizeColor } from '../../../utils/ColorUtils';

/**
 * ドキュメントツリーのセクションプロパティをカスケード解決する。
 *
 * 継承順序: frontmatter → 親セクション → 子セクション（child-wins）
 */
export class SectionPropertyResolver {
    static resolve(
        doc: DocumentNode,
        frontmatter: Record<string, any> | undefined,
        keys: FrontmatterTaskKeys
    ): void {
        // frontmatter からベースプロパティを抽出
        const fmBase = this.extractFrontmatterBase(frontmatter, keys);

        for (const section of doc.sections) {
            this.resolveSection(section, fmBase, keys);
        }
    }

    private static resolveSection(
        section: SectionNode,
        parentProps: ExtractedProperties,
        keys: FrontmatterTaskKeys
    ): void {
        // セクション自身の PropertyBlock からプロパティ抽出
        const ownRaw = this.propertyBlockToRecord(section);
        const ownExtracted = BuiltinPropertyExtractor.extract(ownRaw, keys);

        // 親プロパティ + 自身のプロパティを child-wins マージ
        section.resolvedProperties = { ...parentProps.properties, ...ownExtracted.properties };
        section.resolvedColor = ownExtracted.color ?? parentProps.color;
        section.resolvedLinestyle = ownExtracted.linestyle ?? parentProps.linestyle;
        section.resolvedMask = ownExtracted.mask ?? parentProps.mask;

        // 子セクションへ再帰
        const resolved: ExtractedProperties = {
            color: section.resolvedColor,
            linestyle: section.resolvedLinestyle,
            mask: section.resolvedMask,
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

    /** frontmatter オブジェクトからプロパティベースを抽出 */
    private static extractFrontmatterBase(
        frontmatter: Record<string, any> | undefined,
        keys: FrontmatterTaskKeys
    ): ExtractedProperties {
        if (!frontmatter) return { properties: {} };

        // frontmatter の組み込みキーを直接抽出
        const rawColor = this.extractStringValue(frontmatter, keys.color);
        const color = rawColor ? normalizeColor(rawColor) : undefined;
        const linestyle = this.extractStringValue(frontmatter, keys.linestyle);
        const mask = this.extractStringValue(frontmatter, keys.mask);

        // 残りのカスタムプロパティ
        const excludedKeys = new Set<string>(Object.values(keys));
        excludedKeys.add('tags');

        const properties: Record<string, PropertyValue> = {};
        for (const [key, value] of Object.entries(frontmatter)) {
            if (excludedKeys.has(key)) continue;
            if (value === null || value === undefined) continue;
            if (key === 'position') continue; // Obsidian internal
            const type = typeof value === 'number' ? 'number' as const
                : typeof value === 'boolean' ? 'boolean' as const
                : Array.isArray(value) ? 'array' as const
                : 'string' as const;
            properties[key] = {
                value: Array.isArray(value) ? value.join(', ') : String(value),
                type,
            };
        }

        return { color: color ?? undefined, linestyle: linestyle ?? undefined, mask: mask ?? undefined, properties };
    }

    private static extractStringValue(
        obj: Record<string, any>,
        key: string
    ): string | undefined {
        const raw = obj[key];
        if (typeof raw === 'string' && raw.trim()) return raw.trim();
        return undefined;
    }
}
