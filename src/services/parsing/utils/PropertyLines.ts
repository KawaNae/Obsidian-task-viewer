import type { Properties, PropertyScalar, PropertyValue, ScopeKeys } from '../../../types';
import { IN_LINE } from '../../../utils/LineBreak';
import { LIST_BULLET_SOURCE, SPACE_OR_TAB_SOURCE } from './ListMarker';
import { INDENT_SOURCE, Outline, type OutlineReading } from './Outline';
import { PropertyKey } from './PropertyKey';
import { PropertyValues } from './PropertyValues';
import { TaskLineClassifier } from './TaskLineClassifier';

/**
 * `- key:: value`, with any list bullet as a `==>` line takes one (`*`,
 * `+`, `1.`), the marker followed by spaces and tabs as a list item's is
 * (`Outline.read`). A key holds no `:`, `[` or `]`, so a checkbox line and a
 * wikilink line are never property lines. The value may be empty
 * (`- key::`): `(.*)`, not `(.+)`, so that a space after `::` does not
 * decide whether the line is one.
 */
export const PROPERTY_LINE = new RegExp(`^${INDENT_SOURCE}${LIST_BULLET_SOURCE}${SPACE_OR_TAB_SOURCE}+([^:\\[\\]]+?)::\\s*(${IN_LINE}*)$`);

/** A list item's text: what follows its marker and the gap after it. */
export const ITEM_TEXT = new RegExp(`^${INDENT_SOURCE}${LIST_BULLET_SOURCE}(?:${SPACE_OR_TAB_SOURCE}+(${IN_LINE}*))?$`);

/**
 * Who a property line is written for: a task, by the line of its item, or a
 * section, by the line of its heading (null for the lines above the note's
 * first heading).
 */
export type PropertyOwner =
    | { kind: 'task'; line: number }
    | { kind: 'section'; heading: number | null };

/**
 * What is wrong with a property line, or with a line under one, as the
 * reading found it. An error leaves the key unread; a warning says how a
 * line was read, or that it was not.
 *
 * - `duplicate-key` (error): the owner writes the key on two lines or more,
 *   its case aside (`Area::` and `area::`); the key is read on none of
 *   them, and the value above comes through
 * - `date-key-under-task` (warning): a date key (`tv-start` and the others
 *   the settings name) under a task, which takes its dates from its own
 *   line's `@` only; not read
 * - `lines-under-value` (warning): a line under a property line that has a
 *   value; the value is the line's, and the lines under it are notes, no
 *   list
 * - `property-shaped-item` (warning): an item of a list written as a
 *   property line (`- name:: Kawa`); read as the text `name:: Kawa`, as no
 *   property nests in another
 * - `not-a-list-item` (warning): a line under a property line with no value
 *   that is no item of its list: a task, an item nested in an item, a line
 *   that is no item (a paragraph going on, a quote, code), an item that is
 *   empty or no value
 */
export type PropertyFindingKind =
    | 'duplicate-key'
    | 'date-key-under-task'
    | 'lines-under-value'
    | 'property-shaped-item'
    | 'not-a-list-item';

export interface PropertyFinding {
    kind: PropertyFindingKind;
    severity: 'error' | 'warning';
    /** The line it is on: for a line under a property line, that line, not the property line. */
    line: number;
    /** Just past the lines it is about: an item's whole subtree, a run of lines that are no item. */
    end: number;
    /** The key of the property line it is about, as written there. */
    key: string;
    /** The property line it is about. */
    propertyLine: number;
    owner: PropertyOwner;
}

/** One property line of an owner, and how its own lines read. */
export interface PropertyLine {
    /** The line of its item. */
    line: number;
    /** The key as written, trimmed. */
    key: string;
    /** What follows `::`, trimmed: the value's spelling, empty for a line that writes none. */
    written: string;
    /**
     * The value the line says: its text read as a value is
     * (`PropertyValues.fromText`); for a line that writes none, the list of
     * the items under it, or no value when none of them is one.
     */
    value: PropertyValue;
    /** The lines read as the items of its list, top to bottom. */
    items: readonly number[];
    /** Just past its subtree: the lines its item holds. */
    end: number;
    /** What its own lines hold that is wrong (`lines-under-value`, `property-shaped-item`, `not-a-list-item`). */
    findings: readonly PropertyFinding[];
}

/** An owner's property lines, every one of them, top to bottom: those not read included. */
export interface OwnPropertyLines {
    owner: PropertyOwner;
    lines: readonly PropertyLine[];
}

/** What an owner's property lines say. */
export interface PropertyReading {
    /** The value of each key read, in the order the lines write them, by key folded (`PropertyKey`). */
    values: Properties;
    /** The line each key read is written on, by key folded. */
    lineOf: ReadonlyMap<string, number>;
    /** Every finding, in the order of the lines they are on. */
    findings: readonly PropertyFinding[];
}

/**
 * The one reading of property lines: which lines are an owner's, and what
 * they say. The parser reads a task's and a section's properties here, and
 * the writer (`ChildPropertyLineEditor`) edits the lines this says are the
 * task's, so the two are one set.
 *
 * A property line is a `- key:: value` item standing directly in its
 * owner: for a task, an item the outline reads directly under the task's
 * item; for a section, an item at the top of the section's own lines (its
 * nested sections' left out), wherever it stands in them, below a task too.
 * A `- key:: value` deeper than that is no one's property. Code is never
 * one.
 *
 * A property line with a value has that value, and nothing under it is
 * read. One with none (`- key::`) reads the items directly under it as a
 * list, each item's text read as a line's value is: a task stays a task, and
 * an item nested in one, and what is no item, are not read. Every line
 * under a property line is read as part of it, or found (`PropertyFinding`).
 */
export const PropertyLines = {
    /** The property lines of the task whose item is on `taskLine`. */
    ofTask(outline: OutlineReading, taskLine: number): OwnPropertyLines {
        const owner: PropertyOwner = { kind: 'task', line: taskLine };
        const lines = outline.directItems(taskLine)
            .filter(line => PROPERTY_LINE.test(outline.lines[line]))
            .map(line => readLine(outline, line, outline.subtreeEnd(line), owner));
        return { owner, lines };
    },

    /**
     * The property lines of the section opened by the heading on `heading`
     * (null for the lines above the first heading), whose own lines are
     * `from` up to `to`: the items at the top of them.
     */
    ofSection(outline: OutlineReading, heading: number | null, from: number, to: number): OwnPropertyLines {
        const owner: PropertyOwner = { kind: 'section', heading };
        const lines: PropertyLine[] = [];
        for (let line = from; line < to; line++) {
            const item = outline.item(line);
            if (item === null || item.parent !== null || outline.inCode(line)) continue;
            if (PROPERTY_LINE.test(outline.lines[line])) lines.push(readLine(outline, line, Math.min(item.end, to), owner));
        }
        return { owner, lines };
    },

    /**
     * What `own` says, key by key, a key's case aside (`PropertyKey`). A
     * key the owner writes twice is read on neither line (`duplicate-key`): the owner says nothing of it, and the
     * value above comes through. A task's date keys are not read
     * (`date-key-under-task`): a task's dates are its own line's `@`. A
     * line not read has one finding, which covers the lines under it too
     * (`PropertyFinding.end`): none of them is read either.
     */
    read(own: OwnPropertyLines, keys: ScopeKeys): PropertyReading {
        const findings: PropertyFinding[] = [];
        const dateKeys = own.owner.kind === 'task' ? [keys.start, keys.end, keys.due] : [];
        const considered: PropertyLine[] = [];
        for (const line of own.lines) {
            if (dateKeys.some(key => PropertyKey.same(key, line.key))) {
                findings.push(finding('date-key-under-task', line.line, line.end, line, own.owner));
            } else {
                considered.push(line);
            }
        }

        const values: Properties = {};
        const lineOf = new Map<string, number>();
        for (const line of considered) {
            const twins = considered.filter(other => PropertyKey.same(other.key, line.key));
            if (twins.length > 1) {
                findings.push(finding('duplicate-key', line.line, line.end, line, own.owner));
                continue;
            }
            const key = PropertyKey.fold(line.key);
            values[key] = { key: line.key, value: line.value };
            lineOf.set(key, line.line);
            findings.push(...line.findings);
        }
        findings.sort((a, b) => a.line - b.line);
        return { values, lineOf, findings };
    },
};

function finding(kind: PropertyFindingKind, line: number, end: number, of: Pick<PropertyLine, 'key' | 'line'>, owner: PropertyOwner): PropertyFinding {
    return {
        kind,
        severity: kind === 'duplicate-key' ? 'error' : 'warning',
        line,
        end,
        key: of.key,
        propertyLine: of.line,
        owner,
    };
}

/** The property line on `line`, its item's lines running to `end`. */
function readLine(outline: OutlineReading, line: number, end: number, owner: PropertyOwner): PropertyLine {
    const match = outline.lines[line].match(PROPERTY_LINE)!;
    const key = match[1].trim();
    const written = match[2].trim();
    const of = { key, line };
    const findings: PropertyFinding[] = [];
    const found = (kind: PropertyFindingKind, from: number, to: number) => findings.push(finding(kind, from, to, of, owner));

    if (written !== '') {
        // A value of its own: every line under it is a note, no item of a list.
        eachUnder(outline, line, end, (from, to) => found('lines-under-value', from, to));
        return { line, key, written, value: PropertyValues.fromText(written), items: [], end, findings };
    }

    const items: number[] = [];
    const scalars: PropertyScalar[] = [];
    eachUnder(outline, line, end, (from, to, isItem) => {
        if (!isItem) return found('not-a-list-item', from, to);
        // A task is read as one wherever it stands (`TaskLineClassifier.opensTask`).
        if (TaskLineClassifier.opensTask(outline, from)) return found('not-a-list-item', from, to);
        const text = outline.lines[from].match(ITEM_TEXT)?.[1]?.trim() ?? '';
        const value = PropertyValues.fromText(text);
        if (value.type === 'null' || value.type === 'list') return found('not-a-list-item', from, to);
        if (PROPERTY_LINE.test(outline.lines[from])) found('property-shaped-item', from, from + 1);
        items.push(from);
        scalars.push(value);
        // What the item holds below its own line (an item nested in it, its
        // text going on) is no item of the list.
        const below = firstNotBlank(outline, from + 1, to);
        if (below !== null) found('not-a-list-item', below, to);
    });
    const value: PropertyValue = scalars.length > 0 ? { type: 'list', items: scalars } : { type: 'null', spelling: '' };
    return { line, key, written, value, items, end, findings };
}

/**
 * The lines under the property line `line`, up to `end`, in pieces: each
 * item standing directly in it, with its subtree (`isItem`), and each run of
 * lines between them that are no such item (text going on, a quote, code).
 * Blank lines are no piece's own: a piece ends at its last line that is not
 * blank.
 */
function eachUnder(outline: OutlineReading, line: number, end: number, visit: (from: number, to: number, isItem: boolean) => void): void {
    let at = line + 1;
    let run: number | null = null;
    let runEnd = at;
    const closeRun = () => {
        if (run !== null) visit(run, runEnd, false);
        run = null;
    };
    while (at < end) {
        if (Outline.isBlank(outline.lines[at])) {
            at++;
            continue;
        }
        const item = outline.item(at);
        if (item !== null && item.parent === line && !outline.inCode(at)) {
            closeRun();
            const to = Math.min(item.end, end);
            visit(at, to, true);
            at = to;
            continue;
        }
        if (run === null) run = at;
        runEnd = at + 1;
        at++;
    }
    closeRun();
}

/** The first line from `from` up to `to` that is not blank; null for none. */
function firstNotBlank(outline: OutlineReading, from: number, to: number): number | null {
    for (let at = from; at < to; at++) if (!Outline.isBlank(outline.lines[at])) return at;
    return null;
}
