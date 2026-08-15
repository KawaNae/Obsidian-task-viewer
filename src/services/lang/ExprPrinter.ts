import { type BinaryOp, type Expr, isExprBody } from './ExprAst';
import { fieldKeyLiteral, valueToLiteral } from './Value';

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
        // Looser than everything: an assignment is read only at the top of
        // an interpolation or inside parentheses, so anywhere an operand or
        // an argument expects one, the parentheses have to be printed.
        case 'assign': return 0;
        case 'cond': return 1;
        // A function body runs to the end of the expression, so it must be
        // parenthesized anywhere an operand is expected.
        case 'arrow': return 1;
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
    if (child.kind === 'binary' && mustParenthesize(parent.op, child.op)) {
        return `(${print(child, 0)})`;
    }
    return print(child, prec);
}

/** Comparisons do not chain, so two of them can only have come from parentheses. */
const NON_ASSOCIATIVE: ReadonlySet<string> = new Set(['==', '!=', '<', '<=', '>', '>=']);

/**
 * Boundaries where precedence does not decide the parentheses.
 *
 * Both cases are the same shape: the parser refuses to read the two operators
 * next to each other, so a tree that has them nested can only have come from
 * parentheses — and must be printed back with them, whatever the levels say.
 */
function mustParenthesize(parentOp: BinaryOp, childOp: BinaryOp): boolean {
    if (parentOp === '??') return childOp === '||' || childOp === '&&';
    return NON_ASSOCIATIVE.has(parentOp) && NON_ASSOCIATIVE.has(childOp);
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
                // Arguments print at level 1: everything except an assignment
                // is untouched, and an assignment gets the parentheses the
                // argument position needs to read it back.
                return `${expr.fn}(${expr.args.map(a => print(a, 1)).join(', ')})`;
            case 'member':
                return `${print(expr.obj, myPrec)}${expr.optional ? '?.' : '.'}${expr.name}`;
            case 'method':
                return `${print(expr.obj, myPrec)}${expr.optional ? '?.' : '.'}${expr.name}(${expr.args.map(a => print(a, 1)).join(', ')})`;
            case 'var': return expr.name;
            case 'record':
                return `{${expr.entries.map(e => `${fieldKeyLiteral(e.key)}: ${print(e.value, 1)}`).join(', ')}}`;
            case 'spread': return `...${print(expr.arg, myPrec)}`;
            case 'template':
                // Block-only, like lists: a flow command joins with + and is
                // the only surface whose printing has to read back.
                return '`' + expr.parts
                    // The escape was folded away when the text was read, so it
                    // goes back on: printing the bare form would turn what was
                    // written as literal text into a live interpolation.
                    .map(part => part.kind === 'text'
                        ? part.text.split('${').join('\\${')
                        : '${' + print(part.expr, 0) + '}')
                    .join('') + '`';
            case 'array': {
                const items = expr.items.map(i => print(i, 1));
                // `[[` opens a wikilink, which wins the longest match. A list
                // whose first element is a list has to be written with the
                // brackets apart, or it reads back as a link to nowhere.
                const pad = items.length > 0 && items[0].startsWith('[') ? ' ' : '';
                return `[${pad}${items.join(', ')}${pad}]`;
            }
            case 'index': return `${print(expr.obj, myPrec)}${expr.optional ? '?.' : ''}[${print(expr.index, 1)}]`;
            case 'arrow':
                // Always parenthesized: a single bare parameter would re-parse
                // the same, but one form is easier to read back than two. A
                // block body is verbatim-only source and never prints.
                if (!isExprBody(expr.body)) {
                    throw new Error('A block-bodied arrow has no canonical print — it lives in verbatim source only');
                }
                return `(${expr.params.join(', ')}) => ${print(expr.body, 1)}`;
            case 'assign':
                // Read back at the top of an interpolation, or inside the
                // parentheses the precedence above forces everywhere else.
                return `${expr.name} ${expr.op} ${print(expr.value, 0)}`;
        }
    })();
    return myPrec < parentPrec ? `(${body})` : body;
}
