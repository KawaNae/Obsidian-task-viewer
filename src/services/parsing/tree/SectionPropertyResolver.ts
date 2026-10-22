import { SCALAR_FIELDS, type ResolvedSources, type ScalarField, type SectionNode, type ValueSource } from './Sections';
import type { ScopeKeys } from '../../../types';
import { BuiltinPropertyExtractor, fieldKey, type ExtractedBuiltins, type ExtractedProperties } from './BuiltinPropertyExtractor';
import { TagExtractor } from '../utils/TagExtractor';
import { PropertyKey } from '../utils/PropertyKey';
import { PropertyLines } from '../utils/PropertyLines';
import { frontmatterKeyRange } from '../utils/FrontmatterKeyLines';
import type { OutlineReading } from '../utils/Outline';

/** What one layer hands the sections below it: its resolved values, and where each came from. */
interface Resolved {
    values: ExtractedProperties;
    sources: ResolvedSources;
}

/**
 * Section-scope property resolver.
 *
 * Cascades properties along the section tree (frontmatter → root → parent
 * section → child section, child-wins): the root is the section of the
 * whole note, so a property line above the first heading reaches every
 * row, and wins over the frontmatter as any section does. The frontmatter
 * is the base, its built-ins alone, read by the same extractor as a
 * section's (`BuiltinPropertyExtractor.fromFrontmatter`): its other keys
 * are the note's own, and no row inherits them.
 *
 * The nearest layer that says a value wins, and a layer that says it has
 * none (`- area::`, `tv-color:`) wins as one with a value does: it hides
 * the value above it, a built-in's as a custom property's. A key a layer
 * does not read (one written twice, a built-in's value it cannot read)
 * says nothing, and the value above comes through. Tags are a union, which
 * nothing hides.
 *
 * Beside each resolved value it records the layer that won it
 * (`SectionNode.resolvedSources`): the frontmatter's key line, or the
 * property line of a section. Which layer wins is decided here and nowhere
 * else; a reader that has to write a value again goes back to that layer's
 * line (`InheritedValues`), and never walks the cascade itself.
 */
export class SectionPropertyResolver {
    static resolve(
        outline: OutlineReading,
        root: SectionNode,
        frontmatter: Record<string, any> | undefined,
        keys: ScopeKeys
    ): void {
        const builtins = BuiltinPropertyExtractor.fromFrontmatter(frontmatter, keys);
        const base: Resolved = { values: { ...builtins, properties: {} }, sources: this.frontmatterSources(outline, builtins, keys) };
        this.resolveSection(root, base, keys);
    }

    /** Every value the frontmatter says is the frontmatter's, by the line of its key. */
    private static frontmatterSources(outline: OutlineReading, values: ExtractedBuiltins, keys: ScopeKeys): ResolvedSources {
        const fmEnd = outline.bodyStart - 1;
        const at = (key: string): ValueSource => ({ kind: 'frontmatter', line: frontmatterKeyRange(outline.lines, fmEnd, key)?.[0] ?? null });
        const fields: Partial<Record<ScalarField, ValueSource>> = {};
        for (const field of SCALAR_FIELDS) if (values[field] !== undefined) fields[field] = at(fieldKey(field, keys));
        return { fields, tags: values.tags ? [{ from: at(fieldKey('tags', keys)), tags: values.tags }] : [], properties: {} };
    }

    private static resolveSection(
        section: SectionNode,
        parent: Resolved,
        keys: ScopeKeys
    ): void {
        // What the section's own property lines say (a key written twice says nothing).
        const { values: raw, lineOf } = PropertyLines.read(section.properties, keys);
        const own = BuiltinPropertyExtractor.extract(raw, keys);
        const here = (key: string): ValueSource => ({ kind: 'section', line: lineOf.get(PropertyKey.fold(key))!, heading: section.heading });

        // 親プロパティ + 自身のプロパティを child-wins マージ。値なし (null) も
        // 自身の値として勝ち、上の層の値を隠す。
        // Partial merge: date と time は独立に継承（別の field）。
        const values: ExtractedProperties = { properties: parent.values.properties };
        const fields: Partial<Record<ScalarField, ValueSource>> = {};
        for (const field of SCALAR_FIELDS) {
            const mine = own[field];
            values[field] = mine !== undefined ? mine : parent.values[field];
            const from = mine !== undefined ? here(fieldKey(field, keys)) : parent.sources.fields[field];
            if (from) fields[field] = from;
        }

        // tags: 和集合。加えた層をすべて記録する
        values.tags = own.tags ? TagExtractor.merge(parent.values.tags ?? [], own.tags) : parent.values.tags;
        const tags = own.tags ? [...parent.sources.tags, { from: here('tags'), tags: own.tags }] : parent.sources.tags;

        // custom: キー単位の child-wins。キーは大文字と小文字を区別しない
        // (`PropertyKey`)。近い層の値が、その層の綴りのキーとともに勝つ
        let properties = parent.sources.properties;
        const ownKeys = Object.keys(own.properties);
        if (ownKeys.length > 0) {
            values.properties = { ...parent.values.properties, ...own.properties };
            const merged: Record<string, ValueSource> = { ...parent.sources.properties };
            for (const key of ownKeys) merged[key] = here(key);
            properties = merged;
        }

        section.resolvedProperties = values.properties;
        section.resolvedColor = values.color;
        section.resolvedLinestyle = values.linestyle;
        section.resolvedMask = values.mask;
        section.resolvedTags = values.tags;
        section.resolvedStartDate = values.startDate;
        section.resolvedStartTime = values.startTime;
        section.resolvedEndDate = values.endDate;
        section.resolvedEndTime = values.endTime;
        section.resolvedDue = values.due;
        section.resolvedSources = { fields, tags, properties };

        // 子セクションへ再帰
        const resolved: Resolved = { values, sources: section.resolvedSources };
        for (const child of section.children) {
            this.resolveSection(child, resolved, keys);
        }
    }
}
