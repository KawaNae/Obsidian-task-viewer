import type { LocatedDiagnostic } from '../../lang/Diagnostic';
import type { ScopeKeys } from '../../../types';
import { NoteSections } from './NoteSections';
import { NoteTasks } from './NoteTasks';
import { Outline, type OutlineReading } from '../utils/Outline';
import { ITEM_TEXT, PropertyLines, type PropertyFinding, type PropertyFindingKind } from '../utils/PropertyLines';

/**
 * What each kind of finding says, in English, with the values every finding
 * gives (`FindingParams`) in `{{…}}`. A sentence says what the plugin did
 * with the line and how to write it instead, never what the line was meant
 * to be: the same shape is a slip of the indentation to one writer and a
 * nested property to another, and the fix is one.
 *
 * The one place a finding becomes words: a locale adds a translation as
 * `flowDiag.property.<kind>` (`diagnosticText`), and a new kind of finding
 * needs its sentence here and nothing else.
 */
const MESSAGES: Record<PropertyFindingKind, string> = {
    'duplicate-key':
        '`{{key}}::` is written on more than one line of the same task or section (a key\'s case aside), so none of them is read. '
        + 'A value the task or section inherits from a section, the lines above the first heading or the frontmatter is used instead. Keep one line',
    'date-key-under-task':
        '`{{key}}::` under a task is not read. Write a task\'s dates in the date block (@…) on its own line',
    'lines-under-value':
        '`{{key}}::` has a value, so this line under it is read as a note, not as an item of a list. '
        + 'To make a list, leave `{{key}}::` empty and write each value as an item under it',
    'property-shaped-item':
        '`{{text}}` is read as an item of the list `{{key}}`. To make it a property, write it at the depth of `{{key}}::`. '
        + 'Properties do not nest',
    'not-a-list-item':
        'This line is not read as an item of the list `{{key}}`. An item of the list is a `- value` one level under `{{key}}::`; '
        + 'a task, an item with no value (`-`, `- null`), a line under an item and a line that is no item are left out',
    'unreadable-value':
        'The value of `{{key}}::` is not one `{{key}}` can read (a list is none), so the line is read as if it were not written. '
        + 'A value the task or section inherits from a section, the lines above the first heading or the frontmatter is used instead. '
        + 'Write a value `{{key}}` reads, or leave `{{key}}::` empty with nothing under it to have no value',
};

/**
 * The values a finding's sentence is made of, the same for every kind: the
 * key of the property line it is about as written there, and the line it is
 * on as written, its indentation and list marker left off (`name:: Kawa`).
 */
interface FindingParams extends Record<string, string> {
    key: string;
    text: string;
}

/**
 * A finding as a diagnostic on its own line (`PropertyFinding.line`), given
 * that line's text: for a line under a property line, that line, not the
 * property line. It marks the line from its first character past the
 * indentation to its end; the lines below it that it covers too
 * (`PropertyFinding.end`) are not marked, the first one standing for them.
 */
export function propertyFindingDiagnostic(finding: PropertyFinding, lineText: string): LocatedDiagnostic {
    const params: FindingParams = { key: finding.key, text: textOf(lineText) };
    const message = MESSAGES[finding.kind].replace(/\{\{(\w+)\}\}/g, (whole, name: string) => params[name] ?? whole);
    return {
        severity: finding.severity,
        code: `property.${finding.kind}`,
        message,
        span: { start: Outline.indentOf(lineText).length, end: lineText.length },
        params,
        line: finding.line,
    };
}

/**
 * The editor's diagnostics on a note's property lines: every finding of
 * every owner the parser reads property lines for (`PropertyLines.read`),
 * each section's (the root's, above the first heading, too) and each task's,
 * with the scope keys the parser reads the note with. A finding of the
 * reading is a diagnostic, and nothing else is.
 */
export function propertyDiagnostics(outline: OutlineReading, keys: ScopeKeys): LocatedDiagnostic[] {
    const findings: PropertyFinding[] = [];
    for (const section of NoteSections.all(NoteSections.read(outline))) {
        findings.push(...PropertyLines.read(section.properties, keys).findings);
    }
    for (const line of NoteTasks.taskLines(outline)) {
        findings.push(...PropertyLines.read(PropertyLines.ofTask(outline, line), keys).findings);
    }
    return findings
        .sort((a, b) => a.line - b.line)
        .map(finding => propertyFindingDiagnostic(finding, outline.lines[finding.line]));
}

/** A line as written, its indentation and list marker left off. */
function textOf(lineText: string): string {
    const item = lineText.match(ITEM_TEXT);
    return item ? (item[1] ?? '').trim() : lineText.trim();
}
