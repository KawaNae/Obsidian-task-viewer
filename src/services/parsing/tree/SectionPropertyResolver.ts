import { SCALAR_FIELDS, type ResolvedSources, type ScalarField, type SectionNode, type ValueSource } from './Sections';
import type { ScopeKeys } from '../../../types';
import { BuiltinPropertyExtractor, fieldKey, type ExtractedProperties } from './BuiltinPropertyExtractor';
import { TagExtractor } from '../utils/TagExtractor';
import { PropertyLines } from '../utils/PropertyLines';

/** What one layer hands the sections below it: its resolved values, and where each came from. */
interface Resolved {
    values: ExtractedProperties;
    sources: ResolvedSources;
}

const FRONTMATTER: ValueSource = Object.freeze({ kind: 'frontmatter' });

/**
 * Section-scope property resolver.
 *
 * Cascades properties along the section tree (frontmatter → parent section →
 * child section, child-wins). The frontmatter is the base: its values read
 * by the same extractor as a section's, its built-ins put apart from its
 * custom properties (`BuiltinPropertyExtractor.fromFrontmatter`).
 *
 * Beside each resolved value it records the layer that won it
 * (`SectionNode.resolvedSources`): the frontmatter, or the property line of a
 * section. Which layer wins is decided here and nowhere else; a reader that
 * has to write a value again goes back to that layer's line
 * (`InheritedValues`), and never walks the cascade itself.
 */
export class SectionPropertyResolver {
    static resolve(
        sections: readonly SectionNode[],
        frontmatter: Record<string, any> | undefined,
        keys: ScopeKeys
    ): void {
        const values = BuiltinPropertyExtractor.fromFrontmatter(frontmatter, keys);
        const root: Resolved = { values, sources: this.frontmatterSources(values) };

        for (const section of sections) {
            this.resolveSection(section, root, keys);
        }
    }

    /** Every value the frontmatter sets is the frontmatter's. */
    private static frontmatterSources(values: ExtractedProperties): ResolvedSources {
        const fields: Partial<Record<ScalarField, ValueSource>> = {};
        for (const field of SCALAR_FIELDS) if (values[field] !== undefined) fields[field] = FRONTMATTER;
        const properties: Record<string, ValueSource> = {};
        for (const key of Object.keys(values.properties)) properties[key] = FRONTMATTER;
        return { fields, tags: values.tags ? [{ from: FRONTMATTER, tags: values.tags }] : [], properties };
    }

    private static resolveSection(
        section: SectionNode,
        parent: Resolved,
        keys: ScopeKeys
    ): void {
        // What the section's own property lines say (a key written twice says nothing).
        const { values: raw, lineOf } = PropertyLines.read(section.properties, keys);
        const own = BuiltinPropertyExtractor.extract(raw, keys);
        const here = (key: string): ValueSource => ({ kind: 'section', line: lineOf.get(key)!, heading: section.heading });

        // 親プロパティ + 自身のプロパティを child-wins マージ。
        // Partial merge: date と time は独立に継承（別の field）。
        const values: ExtractedProperties = { properties: parent.values.properties };
        const fields: Partial<Record<ScalarField, ValueSource>> = {};
        for (const field of SCALAR_FIELDS) {
            const mine = own[field];
            values[field] = mine ?? parent.values[field];
            const from = mine !== undefined ? here(fieldKey(field, keys)) : parent.sources.fields[field];
            if (from) fields[field] = from;
        }

        // tags: 和集合。加えた層をすべて記録する
        values.tags = own.tags ? TagExtractor.merge(parent.values.tags ?? [], own.tags) : parent.values.tags;
        const tags = own.tags ? [...parent.sources.tags, { from: here('tags'), tags: own.tags }] : parent.sources.tags;

        // custom: キー単位の child-wins
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
