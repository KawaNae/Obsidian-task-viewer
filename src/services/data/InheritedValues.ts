import { stringifyYaml } from 'obsidian';
import type { PropertyValue, TaskViewerSettings } from '../../types';
import { FileParsePipeline } from '../parsing/FileParsePipeline';
import type { SectionNode, ValueSource } from '../parsing/tree/DocumentTree';
import { ChildLineClassifier } from '../parsing/utils/ChildLineClassifier';
import { FrontmatterLineEditor } from '../persistence/utils/FrontmatterLineEditor';

/**
 * A value a line of a note inherits, said as a key of a note's frontmatter.
 */
export interface InheritedValue {
    key: string;
    /** The lines to write into a frontmatter block: the key's line and what continues it. */
    yaml: readonly string[];
    /** The layers the value came from, from the top down: more than one for tags, or a date and time from two. */
    from: readonly ValueSource[];
    /** A key of Obsidian's own (`aliases`, `cssclasses`, ...), which a row does not inherit so much as the note has. */
    obsidian: boolean;
}

/** Obsidian's own keys: a note's names, look and publishing, not anything a task inherits. */
const OBSIDIAN_KEYS: ReadonlySet<string> = new Set(['aliases', 'alias', 'cssclasses', 'cssclass', 'publish', 'permalink']);

/**
 * The values the line `row` of `lines` inherits, each said as a frontmatter
 * key that gives it back: written into the frontmatter of a note the row is
 * sent to, the row inherits there what it inherited here.
 *
 * What the row inherits is the resolution's answer for the section the row
 * stands in (`FileParsePipeline.resolveTree`, the same reading the index
 * makes), whatever the row holds itself: a child row inherits its section's
 * values as its parent does, and a row with a date of its own still has its
 * section's to hand on. Which layer won each value is the resolution's
 * record (`SectionNode.resolvedSources`); this only says it again:
 *
 * - A key one layer sets is said as that layer said it. The frontmatter's
 *   lines go as they are: the resolved value is normalized (a list
 *   joined), and the lines keep what it lost. A property line's value is
 *   said in the YAML of the type the line gave it
 *   (`ChildLineClassifier.inferType`), so the frontmatter reads back the
 *   same type (`propertyYaml`); the plugin's own keys (color, line style,
 *   mask) are read as text either way, and go as a string.
 * - A date and its time may come from two layers, so the key is put
 *   together from the resolved date and time.
 * - Tags are a union of layers, said as the resolved list.
 *
 * Keys that are no one's to inherit (`tv-ignore`, `position`, the file
 * task's old keys) never come: the resolution holds none of them. A note
 * the index does not read (`tv-ignore`) has no rows, and answers none.
 */
export function inheritedAt(lines: readonly string[], row: number, settings: TaskViewerSettings): InheritedValue[] {
    const tree = FileParsePipeline.resolveTree('', lines, settings);
    if (!tree) return [];
    const section = sectionAt(tree.doc.sections, row);
    if (!section) return [];

    const keys = settings.scopeKeys;
    const { fields, tags, properties } = section.resolvedSources;
    const fmEnd = FrontmatterLineEditor.findEnd(lines);
    const out: InheritedValue[] = [];
    const push = (key: string, yaml: readonly string[], from: readonly ValueSource[]) => {
        out.push({ key, yaml, from, obsidian: OBSIDIAN_KEYS.has(key) });
    };
    /**
     * A key one layer set, said as that layer said it: a property line's
     * value as `typed` says it, or else as a string.
     */
    const asWritten = (key: string, from: ValueSource, typed?: PropertyValue) => {
        if (from.kind === 'section') {
            push(key, typed
                ? propertyYaml(key, typed)
                : [`${yamlKey(key)}: ${FrontmatterLineEditor.escapeYamlScalar(propertyValueAt(lines, from.line))}`], [from]);
            return;
        }
        const range = FrontmatterLineEditor.findKeyRange(lines, fmEnd, key);
        const written = range ? trimBlank(lines.slice(range[0], range[1])) : null;
        push(key, written ?? stringifyYaml({ [key]: tree.frontmatter?.[key] }).trimEnd().split('\n'), [from]);
    };

    const when = (key: string, date: string | undefined, time: string | undefined, sources: readonly (ValueSource | undefined)[]) => {
        const value = date && time ? `${date}T${time}` : date ?? time;
        if (value === undefined) return;
        push(key, [`${yamlKey(key)}: ${FrontmatterLineEditor.escapeYamlScalar(value)}`], distinct(sources));
    };
    when(keys.start, section.resolvedStartDate, section.resolvedStartTime, [fields.startDate, fields.startTime]);
    when(keys.end, section.resolvedEndDate, section.resolvedEndTime, [fields.endDate, fields.endTime]);
    when(keys.due, section.resolvedDue, undefined, [fields.due]);

    if (fields.color) asWritten(keys.color, fields.color);
    if (fields.linestyle) asWritten(keys.linestyle, fields.linestyle);
    if (fields.mask) asWritten(keys.mask, fields.mask);

    if (section.resolvedTags && section.resolvedTags.length > 0) {
        push('tags', ['tags:', ...section.resolvedTags.map(tag => `  - ${FrontmatterLineEditor.escapeYamlScalar(tag)}`)], tags);
    }

    for (const [key, value] of Object.entries(section.resolvedProperties)) {
        const from = properties[key];
        if (from) asWritten(key, from, value);
    }
    return out;
}

/** The innermost section whose lines hold `row`. */
function sectionAt(sections: readonly SectionNode[], row: number): SectionNode | undefined {
    for (const section of sections) {
        if (row < section.startLine || row >= section.endLine) continue;
        return sectionAt(section.children, row) ?? section;
    }
    return undefined;
}

/** The value a section's property line says, as the tree read it (`DocumentTreeBuilder`). */
function propertyValueAt(lines: readonly string[], line: number): string {
    return lines[line].match(ChildLineClassifier.PROPERTY_LINE)?.[2].trim() ?? '';
}

/**
 * A property line's value as frontmatter lines the frontmatter reads back
 * as the same type (`FilePropertyResolver`): a number bare, a boolean as
 * YAML's, an array as a list of its items (`ChildLineClassifier.arrayItems`,
 * which the frontmatter joins back with `, `), a string quoted when it has
 * to be. The text comes back as written but where the YAML type has its
 * own spelling: `True` as `true`, `007` as `7`, `[a,b]` as `a, b`.
 */
function propertyYaml(key: string, property: PropertyValue): string[] {
    const head = `${yamlKey(key)}:`;
    switch (property.type) {
        case 'number': return [`${head} ${property.value}`];
        case 'boolean': return [`${head} ${property.value === 'True'}`];
        case 'array': {
            const items = ChildLineClassifier.arrayItems(property.value);
            if (items.length === 0) return [`${head} []`];
            return [head, ...items.map(item => `  - ${FrontmatterLineEditor.escapeYamlScalar(item)}`)];
        }
        case 'string': return [`${head} ${FrontmatterLineEditor.escapeYamlScalar(property.value)}`];
    }
}

/** A key as a YAML mapping key: plain when YAML reads it plain, else quoted. */
function yamlKey(key: string): string {
    return /^[^\s\-?:,[\]{}#&*!|>'"%@`][^:#]*$/.test(key) && key === key.trim()
        ? key
        : FrontmatterLineEditor.escapeYamlScalar(key);
}

/** The lines of a key's range, without the blank lines that end it; null for none. */
function trimBlank(range: readonly string[]): readonly string[] | null {
    let end = range.length;
    while (end > 0 && range[end - 1].trim() === '') end--;
    return end > 0 ? range.slice(0, end) : null;
}

/** The sources given, each once, in order. */
function distinct(sources: readonly (ValueSource | undefined)[]): ValueSource[] {
    const out: ValueSource[] = [];
    for (const source of sources) {
        if (source && !out.some(seen => sameSource(seen, source))) out.push(source);
    }
    return out;
}

function sameSource(a: ValueSource, b: ValueSource): boolean {
    if (a.kind === 'frontmatter' || b.kind === 'frontmatter') return a.kind === b.kind;
    return a.line === b.line;
}
