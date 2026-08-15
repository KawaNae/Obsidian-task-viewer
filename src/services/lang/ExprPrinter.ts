import type { Expr } from './ExprAst';
import { valueToLiteral } from './Value';

/**
 * Print an expression back to canonical source form. Together with the
 * parser this must round-trip: parse(print(e)) is structurally equal to e.
 */
export function printExpr(expr: Expr): string {
    return print(expr, 0);
}

/** Precedence levels (higher binds tighter). */
function precOf(expr: Expr): number {
    switch (expr.kind) {
        case 'cond': return 1;
        case 'binary':
            switch (expr.op) {
                case '??': return 2;
                case '||': return 3;
                case '&&': return 4;
                case '+': case '-': return 6;
                case '*': case '/': case '%': return 7;
                default: return 5; // comparisons
            }
        case 'unary': return 8;
        default: return 9;
    }
}

/**
 * An operand of a binary expression.
 *
 * `??` cannot be written next to `||`/`&&` without parentheses — the parser
 * refuses it — so this boundary's parentheses are no longer implied by
 * precedence. They have to be printed unconditionally: a flow command is
 * re-serialized on every firing, and dropping them would hand the next scan a
 * line the parser rejects, stopping the task from firing again.
 */
function printOperand(parent: Expr & { kind: 'binary' }, child: Expr, prec: number): string {
    const mixesLogic = parent.op === '??'
        && child.kind === 'binary' && (child.op === '||' || child.op === '&&');
    return mixesLogic ? `(${print(child, 0)})` : print(child, prec);
}

function print(expr: Expr, parentPrec: number): string {
    const myPrec = precOf(expr);
    const body = (() => {
        switch (expr.kind) {
            case 'lit': return valueToLiteral(expr.value);
            case 'prop': return expr.name;
            case 'unary': return `${expr.op}${print(expr.operand, myPrec)}`;
            case 'binary':
                return `${printOperand(expr, expr.left, myPrec)} ${expr.op} ${printOperand(expr, expr.right, myPrec + 1)}`;
            case 'cond':
                return `${print(expr.cond, myPrec + 1)} ? ${print(expr.then, myPrec)} : ${print(expr.else, myPrec)}`;
            case 'call':
                return `${expr.fn}(${expr.args.map(a => print(a, 0)).join(', ')})`;
            case 'member':
                return `${print(expr.obj, myPrec)}${expr.optional ? '?.' : '.'}${expr.name}`;
            case 'method':
                return `${print(expr.obj, myPrec)}${expr.optional ? '?.' : '.'}${expr.name}(${expr.args.map(a => print(a, 0)).join(', ')})`;
        }
    })();
    return myPrec < parentPrec ? `(${body})` : body;
}
