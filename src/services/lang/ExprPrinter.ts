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
                case '||': return 2;
                case '&&': return 3;
                case '+': case '-': return 5;
                default: return 4; // comparisons
            }
        case 'unary': return 6;
        default: return 7;
    }
}

function print(expr: Expr, parentPrec: number): string {
    const myPrec = precOf(expr);
    const body = (() => {
        switch (expr.kind) {
            case 'lit': return valueToLiteral(expr.value);
            case 'prop': return expr.name;
            case 'unary': return `${expr.op}${print(expr.operand, myPrec)}`;
            case 'binary':
                return `${print(expr.left, myPrec)} ${expr.op} ${print(expr.right, myPrec + 1)}`;
            case 'cond':
                return `${print(expr.cond, myPrec + 1)} ? ${print(expr.then, myPrec)} : ${print(expr.else, myPrec)}`;
            case 'call':
                return `${expr.fn}(${expr.args.map(a => print(a, 0)).join(', ')})`;
        }
    })();
    return myPrec < parentPrec ? `(${body})` : body;
}
