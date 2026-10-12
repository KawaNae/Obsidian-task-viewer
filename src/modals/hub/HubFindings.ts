import type { ScopeKeys, Task } from '../../types';
import { builtinsByKey, type Builtin } from '../../services/parsing/utils/BuiltinValues';
import { PropertyKey } from '../../services/parsing/utils/PropertyKey';
import type { PropertyFinding } from '../../services/parsing/utils/PropertyLines';
import { propertyFindingDiagnostic } from '../../services/parsing/tree/PropertyDiagnostics';
import { diagnosticText } from '../../services/lang/flow/diagnosticText';

/**
 * The hub's field a finding is of: a style field, the tags, a custom
 * property by its key folded (`prop:<key>`), or the form as a whole.
 */
export type FindingField = 'color' | 'linestyle' | 'mask' | 'tags' | `prop:${string}` | 'form';

/** A finding of the row's own property lines, as the hub says it. */
export interface HubFinding {
    kind: PropertyFinding['kind'];
    /** Where it is said; every field but the form's is locked by it. */
    field: FindingField;
    tone: 'error' | 'warning';
    /** The editor's sentence for it, in the user's language (`diagnosticText`). */
    text: string;
    /** The key as the line writes it: what a locked row with no value is labelled by. */
    key: string;
    /** The line it is on, in the row's reading (`Task.line`'s coordinates). */
    line: number;
}

/**
 * What the row's own property lines hold that is wrong (`Task.propertyFindings`),
 * by the hub's field it is of. A finding in a property's block is of that
 * property's field: the style's three and the tags by their keys
 * (`builtinsByKey`), any other key a custom property's. A date key under a
 * task is of no field: the dates' fields write the row's `@`, and a line
 * under it is read by none of them, so it is said of the form and locks
 * nothing.
 *
 * The sentence is the editor's diagnostic for the finding's line
 * (`propertyFindingDiagnostic`), so the hub and the editor say one thing.
 */
export function hubFindings(task: Task, keys: ScopeKeys): HubFinding[] {
    const findings = task.propertyFindings ?? [];
    if (findings.length === 0) return [];
    const builtins = builtinsByKey(keys);
    return findings.map(finding => ({
        kind: finding.kind,
        field: fieldOf(finding, builtins.get(PropertyKey.fold(finding.key))),
        tone: finding.severity,
        text: diagnosticText(propertyFindingDiagnostic(finding, lineText(task, finding.line))),
        key: finding.key,
        line: finding.line,
    }));
}

/** The fields a row's findings lock: every field a finding is of, the form aside. */
export function lockedFields(findings: readonly HubFinding[]): ReadonlySet<FindingField> {
    return new Set(findings.map(f => f.field).filter(field => field !== 'form'));
}

function fieldOf(finding: PropertyFinding, builtin: Builtin | undefined): FindingField {
    if (finding.kind === 'date-key-under-task') return 'form';
    switch (builtin) {
        case 'color': case 'linestyle': case 'mask': case 'tags': return builtin;
        case 'start': case 'end': case 'due': return 'form';
        default: return `prop:${PropertyKey.fold(finding.key)}`;
    }
}

/** The text of line `line` of the row's reading, from the subtree the parse kept; empty when it kept none. */
function lineText(task: Task, line: number): string {
    return task.subtreeLines?.[line - task.line] ?? '';
}

/**
 * The line of `finding` on another copy of the row: the finding of the same
 * kind on the same key as written, the same one of them counted from the
 * top. Null when that copy has no such finding (the line was fixed).
 */
export function lineOfFinding(finding: HubFinding, among: readonly HubFinding[], on: Task, keys: ScopeKeys): number | null {
    const same = (f: HubFinding) => f.kind === finding.kind && f.key === finding.key;
    const nth = among.filter(same).indexOf(finding);
    return hubFindings(on, keys).filter(same)[nth]?.line ?? null;
}
