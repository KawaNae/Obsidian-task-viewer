import { Span } from '../lang/Diagnostic';
import { printExpr } from '../lang/ExprPrinter';
import { WEEKDAY_NAMES } from '../lang/Value';
import { EveryRule, FlowProgram, SET_FIELD_ORDER, ScheduleNode, setHeadName } from './FlowAst';
import { SegmentTable, segmentIndexAt } from './FlowSegments';

/**
 * Serialize a FlowProgram to canonical source form.
 *
 * Input is accepted order-free, but every regeneration (each fire rewrites
 * the command into the next instance, decrementing the telomere) emits this
 * canonical order — files converge to it naturally over generations:
 *   schedule → xN → until → nochildren → set → move
 */
export function serializeFlow(program: FlowProgram): string {
    return serializeParts(program).map(p => p.text).join(' ');
}

/**
 * Line-level canonical serialization for multi-line flows: each node keeps
 * the segment (line) the user wrote it on — derived from its span via the
 * segment table — while the content of each line is regenerated in
 * canonical order. Empty child buckets vanish (their line is not emitted);
 * with a single-segment table this degenerates to exactly serializeFlow.
 */
export function serializeFlowLines(
    program: FlowProgram,
    table: SegmentTable
): { taskLine: string; childLines: string[] } {
    const segmentCount = Math.max(1, table.spans.length);
    const buckets: string[][] = Array.from({ length: segmentCount }, () => []);
    for (const part of serializeParts(program)) {
        const seg = Math.min(segmentIndexAt(table, part.span.start), segmentCount - 1);
        buckets[seg].push(part.text);
    }
    const [taskBucket, ...childBuckets] = buckets;
    return {
        taskLine: taskBucket.join(' '),
        childLines: childBuckets.map(b => b.join(' ')).filter(line => line !== ''),
    };
}

/** Canonical-order node emission shared by both serializers. */
function serializeParts(program: FlowProgram): { text: string; span: Span }[] {
    const parts: { text: string; span: Span }[] = [];
    if (program.schedule) parts.push({ text: serializeSchedule(program.schedule), span: program.schedule.span });
    if (program.lifetime) parts.push({ text: `x${program.lifetime.count}`, span: program.lifetime.span });
    if (program.until) parts.push({ text: `until ${program.until.date}`, span: program.until.span });
    if (program.nochildren) parts.push({ text: 'nochildren', span: program.nochildren.span });
    if (program.sets) {
        for (const field of SET_FIELD_ORDER) {
            const node = program.sets[field];
            if (node) parts.push({ text: `${setHeadName(field)}(${printExpr(node.expr)})`, span: node.span });
        }
    }
    if (program.move) parts.push({ text: `move(${printExpr(program.move.target)})`, span: program.move.span });
    return parts;
}

function serializeSchedule(schedule: ScheduleNode): string {
    switch (schedule.kind) {
        case 'every': return `every ${serializeEveryRule(schedule.rule)}`;
        case 'plus': return `+${schedule.amount}${schedule.unit}`;
        case 'at': return `at(${printExpr(schedule.expr)})`;
    }
}

function serializeEveryRule(rule: EveryRule): string {
    switch (rule.type) {
        case 'weekdays': return rule.days.map(d => WEEKDAY_NAMES[d]).join(',');
        case 'interval': return `${rule.amount}${rule.unit}`;
        case 'monthday': {
            const prefix = rule.intervalMonths === 1 ? 'mo' : `${rule.intervalMonths}mo`;
            return `${prefix}@${rule.day}`;
        }
    }
}
