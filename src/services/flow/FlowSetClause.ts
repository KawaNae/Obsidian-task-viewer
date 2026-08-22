import type { Task } from '../../types';
import { evalExpr } from '../lang/ExprEvaluator';
import { valueToDisplay } from '../lang/Value';
import { buildEvalContext } from './FlowEvalContext';
import { type FlowProgram, SET_FIELD_ORDER } from './FlowAst';
import { type FlowPlanDeps } from './FlowPlanner';

export function applySet(newTask: Task, program: FlowProgram, deps: FlowPlanDeps): void {
    if (!program.sets) return;

    // All RHS evaluate against the same post-shift snapshot, then apply at
    // once — setter order carries no meaning (matches order-free syntax).
    const postCtx = buildEvalContext(newTask, deps);
    const results = SET_FIELD_ORDER
        .filter(field => program.sets![field])
        .map(field => ({ field, value: evalExpr(program.sets![field]!.expr, postCtx) }));

    for (const { field, value } of results) {
        switch (field) {
            case 'content':
                newTask.content = value.type === 'none' ? '' : valueToDisplay(value);
                break;
            case 'start':
                if (value.type === 'none') {
                    newTask.startDate = undefined;
                    newTask.startTime = undefined;
                } else if (value.type === 'datetime') {
                    newTask.startDate = value.date;
                    newTask.startTime = value.time;
                } else if (value.type === 'date') {
                    newTask.startDate = value.value;
                    newTask.startTime = undefined;
                }
                break;
            case 'startTime':
                if (value.type === 'none') {
                    newTask.startTime = undefined;
                } else if (value.type === 'time' && newTask.startDate) {
                    newTask.startTime = value.value;
                }
                break;
            case 'end':
                if (value.type === 'none') {
                    newTask.endDate = undefined;
                    newTask.endTime = undefined;
                } else if (value.type === 'datetime') {
                    newTask.endDate = value.date;
                    newTask.endTime = value.time;
                } else if (value.type === 'date') {
                    newTask.endDate = value.value;
                    newTask.endTime = undefined;
                }
                break;
            case 'endTime':
                if (value.type === 'none') {
                    newTask.endTime = undefined;
                } else if (value.type === 'time' && newTask.endDate) {
                    newTask.endTime = value.value;
                }
                break;
            case 'due':
                if (value.type === 'none') {
                    newTask.due = undefined;
                } else if (value.type === 'datetime') {
                    newTask.due = `${value.date}T${value.time}`;
                } else if (value.type === 'date') {
                    newTask.due = value.value;
                }
                break;
            case 'dueTime':
                if (newTask.due) {
                    const dueDate = newTask.due.split('T')[0];
                    if (value.type === 'none') {
                        newTask.due = dueDate;
                    } else if (value.type === 'time') {
                        newTask.due = `${dueDate}T${value.value}`;
                    }
                }
                break;
        }
    }
}
