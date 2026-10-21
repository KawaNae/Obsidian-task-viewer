import { stringifyYaml } from 'obsidian';
import type { TaskViewerSettings } from '../../types';
import { FileParsePipeline } from '../parsing/FileParsePipeline';
import type { ValueSource } from '../parsing/tree/Sections';
import { NoteSections } from '../parsing/tree/NoteSections';
import { Outline } from '../parsing/utils/Outline';
import { PropertyValues } from '../parsing/utils/PropertyValues';
import type { PropertyLine } from '../parsing/utils/PropertyLines';
import { FrontmatterLineEditor } from '../persistence/utils/FrontmatterLineEditor';
import type { NoteValue } from '../persistence/writers/SendWriter';

/**
 * A value a line of a note inherits, said as a note says it to every row
 * of its own (`NoteValue`): a built-in as a key of the frontmatter, a
 * custom property as a property line of the root, above the first heading.
 */
export interface InheritedValue extends NoteValue {
    /** The layers the value came from, from the top down: more than one for tags, or a date and time from two. */
    from: readonly ValueSource[];
}

/**
 * The values the line `row` of `lines` inherits, each said as a note says
 * it to every row it holds: written into a note the row is sent to, the
 * row inherits there what it inherited here.
 *
 * What the row inherits is the resolution's answer for the section the row
 * stands in (`FileParsePipeline.resolveSections`, the same reading the index
 * makes), whatever the row holds itself: a child row inherits its section's
 * values as its parent does, and a row with a date of its own still has its
 * section's to hand on. Which layer won each value is the resolution's
 * record (`SectionNode.resolvedSources`); this only says it again.
 *
 * A built-in (the dates, color, line style, mask, tags) goes into the
 * frontmatter, whichever layer said it:
 *
 * - A key the frontmatter sets goes as its lines are: the resolved value is
 *   normalized (a number's spelling, a comment), and the lines keep what it
 *   lost. One a property line sets goes as a string, the way the plugin's
 *   own keys read either way; no value as the key with none (`tv-color:`),
 *   which hides the value above it there as the line does here.
 * - A date and its time may come from two layers, so the key is put
 *   together from the resolved date and time.
 * - Tags are a union of layers, said as the resolved list.
 *
 * A custom property comes from a property line, a heading's section's or
 * the root's: the frontmatter's custom keys are no row's to inherit. It
 * goes as a property line of the root, the line written again as
 * `- key:: value` (the list marker made `-`, the value as spelt), and the
 * items its list reads under it, each as far under it as it stands here
 * (`Outline.shiftIndent`): the line reads back there as the same value of
 * the same type, no value as no value (`- key::`). What else stands under
 * the line is no part of the value, and stays.
 *
 * Keys that are no one's to inherit (`tv-ignore`, `position`, the file
 * task's old keys) never come: the resolution holds none of them. A note
 * the index does not read (`tv-ignore`) has no rows, and answers none.
 */
export function inheritedAt(lines: readonly string[], row: number, settings: TaskViewerSettings): InheritedValue[] {
    const read = FileParsePipeline.resolveSections(lines, settings);
    if (!read) return [];
    const section = NoteSections.at(read.root, row);
    if (!section) return [];

    const keys = settings.scopeKeys;
    const { fields, tags, properties } = section.resolvedSources;
    const fmEnd = FrontmatterLineEditor.findEnd(lines);
    const propertyLines = new Map<number, PropertyLine>();
    for (const node of NoteSections.all(read.root)) for (const line of node.properties.lines) propertyLines.set(line.line, line);
    const out: InheritedValue[] = [];

    /** A built-in one layer set, said as that layer said it: a property line's value as a string, no value as no value. */
    const builtin = (key: string, from: ValueSource) => {
        if (from.kind === 'section') {
            const written = propertyLines.get(from.line)!.value;
            const yaml = written.type === 'null'
                ? noValue(key)
                : [`${yamlKey(key)}: ${FrontmatterLineEditor.escapeYamlScalar(PropertyValues.display(written))}`];
            out.push({ key, to: 'frontmatter', lines: yaml, from: [from] });
            return;
        }
        const range = FrontmatterLineEditor.findKeyRange(lines, fmEnd, key);
        const written = range ? trimBlank(lines.slice(range[0], range[1])) : null;
        out.push({ key, to: 'frontmatter', lines: written ?? stringifyYaml({ [key]: read.frontmatter?.[key] }).trimEnd().split('\n'), from: [from] });
    };

    /**
     * A date key put together from its date and time. A key whose date and
     * time a layer hides with no value goes as the key with none.
     */
    const when = (key: string, date: string | null | undefined, time: string | null | undefined, sources: readonly (ValueSource | undefined)[]) => {
        const value = date && time ? `${date}T${time}` : date || time;
        if (value) {
            out.push({ key, to: 'frontmatter', lines: [`${yamlKey(key)}: ${FrontmatterLineEditor.escapeYamlScalar(value)}`], from: distinct(sources) });
        } else if (date === null) {
            out.push({ key, to: 'frontmatter', lines: noValue(key), from: distinct(sources) });
        }
    };
    when(keys.start, section.resolvedStartDate, section.resolvedStartTime, [fields.startDate, fields.startTime]);
    when(keys.end, section.resolvedEndDate, section.resolvedEndTime, [fields.endDate, fields.endTime]);
    when(keys.due, section.resolvedDue, undefined, [fields.due]);

    if (fields.color) builtin(keys.color, fields.color);
    if (fields.linestyle) builtin(keys.linestyle, fields.linestyle);
    if (fields.mask) builtin(keys.mask, fields.mask);

    if (section.resolvedTags && section.resolvedTags.length > 0) {
        out.push({
            key: 'tags',
            to: 'frontmatter',
            lines: ['tags:', ...section.resolvedTags.map(tag => `  - ${FrontmatterLineEditor.escapeYamlScalar(tag)}`)],
            from: tags.map(layer => layer.from),
        });
    }

    // Each key as the line that won it writes it.
    for (const [folded, { key }] of Object.entries(section.resolvedProperties)) {
        const from = properties[folded];
        if (from?.kind !== 'section') continue;
        out.push({ key, to: 'root', lines: rootLines(lines, propertyLines.get(from.line)!), from: [from] });
    }
    return out;
}

/** A frontmatter key with no value (`key:`). */
function noValue(key: string): string[] {
    return [`${yamlKey(key)}:`];
}

/**
 * The property line `line` of `lines` as a line of the root writes it: at
 * the top, marked `-`, its key and value as spelt, and the items its list
 * reads, each as far under it as it stands here.
 */
function rootLines(lines: readonly string[], line: PropertyLine): string[] {
    const indent = Outline.indentOf(lines[line.line]);
    const head = line.written === '' ? `- ${line.key}::` : `- ${line.key}:: ${line.written}`;
    return [head, ...line.items.map(item => Outline.shiftIndent(lines[item], indent, ''))];
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
