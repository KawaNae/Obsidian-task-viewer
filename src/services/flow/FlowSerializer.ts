import { printExpr } from '../lang/ExprPrinter';
import { WEEKDAY_NAMES } from '../lang/Value';
import { EveryRule, FlowProgram, SET_FIELD_ORDER, ScheduleNode, setHeadName } from './FlowAst';

/**
 * Serialize a FlowProgram to canonical source form.
 *
 * Input is accepted order-free, but every regeneration (each fire rewrites
 * the command into the next instance, decrementing the telomere) emits this
 * canonical order — files converge to it naturally over generations:
 *   schedule → xN → until → nochildren → set → move
 */
export function serializeFlow(program: FlowProgram): string {
    const parts: string[] = [];
    if (program.schedule) parts.push(serializeSchedule(program.schedule));
    if (program.lifetime) parts.push(`x${program.lifetime.count}`);
    if (program.until) parts.push(`until ${program.until.date}`);
    if (program.nochildren) parts.push('nochildren');
    if (program.sets) {
        for (const field of SET_FIELD_ORDER) {
            const node = program.sets[field];
            if (node) parts.push(`${setHeadName(field)}(${printExpr(node.expr)})`);
        }
    }
    if (program.move) parts.push(`move(${printExpr(program.move.target)})`);
    return parts.join(' ');
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
