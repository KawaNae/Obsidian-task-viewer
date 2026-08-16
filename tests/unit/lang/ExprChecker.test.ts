import { describe, it, expect } from 'vitest';
import { Diagnostic } from '../../../src/services/lang/Diagnostic';
import {
    FN_NAMES, LITERAL_WORDS, NAMESPACE_WORDS, PROP_NAMES, UNIT_KEYWORDS,
} from '../../../src/services/lang/ExprAst';
import { FLOW_TYPE_ENV, checkExpr, isReservedName } from '../../../src/services/lang/ExprChecker';
import { REFUSED_EXPR_KEYWORDS, parseExpr } from '../../../src/services/lang/ExprParser';
import { StaticType } from '../../../src/services/lang/functions';
import { tokenize } from '../../../src/services/lang/Lexer';
import { TokenCursor } from '../../../src/services/lang/Token';

function check(src: string): { type: StaticType; diagnostics: Diagnostic[] } {
    const { tokens, diagnostics } = tokenize(src);
    const expr = parseExpr(new TokenCursor(tokens), diagnostics);
    if (!expr) return { type: 'error', diagnostics };
    const type = checkExpr(expr, FLOW_TYPE_ENV, diagnostics);
    return { type, diagnostics };
}

describe('ExprChecker', () => {
    it('types date arithmetic as datish', () => {
        expect(check('start + 3d')).toMatchObject({ type: 'datish', diagnostics: [] });
        expect(check('2026-07-15 + 1mo')).toMatchObject({ type: 'date', diagnostics: [] });
        expect(check('done - 2h')).toMatchObject({ type: 'datetime', diagnostics: [] });
    });

    it('types string concatenation', () => {
        expect(check('"a" + content')).toMatchObject({ type: 'string', diagnostics: [] });
    });

    it('types comparisons across the datish family', () => {
        expect(check('start < due')).toMatchObject({ type: 'bool', diagnostics: [] });
        expect(check('done > 2026-07-15')).toMatchObject({ type: 'bool', diagnostics: [] });
    });

    it('types function results', () => {
        expect(check('format(start, "MM/DD")')).toMatchObject({ type: 'string', diagnostics: [] });
        expect(check('next("tue")')).toMatchObject({ type: 'date', diagnostics: [] });
        expect(check('endOf(month, start)')).toMatchObject({ type: 'date', diagnostics: [] });
        expect(check('date(start)')).toMatchObject({ type: 'date', diagnostics: [] });
    });

    it('types date + time as datetime, rejects datish + time', () => {
        expect(check('date(start) + 13:00')).toMatchObject({ type: 'datetime', diagnostics: [] });
        const { type, diagnostics } = check('start + 13:00');
        expect(type).toBe('error');
        expect(diagnostics.some(d => d.code === 'type.datetime-plus-time')).toBe(true);
    });

    it('types conditionals', () => {
        expect(check('start < due ? start : due')).toMatchObject({ type: 'datish', diagnostics: [] });
        expect(check('true ? 1 : 2')).toMatchObject({ type: 'number', diagnostics: [] });
    });

    it('rejects date + date', () => {
        const { type, diagnostics } = check('start + due');
        expect(type).toBe('error');
        expect(diagnostics.some(d => d.code === 'type.cannot-combine')).toBe(true);
        expect(diagnostics[0].params).toMatchObject({ op: '+', left: 'datish', right: 'datish' });
    });

    it('rejects string vs number comparison', () => {
        expect(check('content < 3').type).toBe('error');
    });

    it('rejects wrong argument types', () => {
        const { diagnostics } = check('format(3, "MM/DD")');
        expect(diagnostics.some(d => d.code === 'type.arg-mismatch')).toBe(true);
    });

    it('rejects wrong argument counts', () => {
        const { diagnostics } = check('format(start)');
        expect(diagnostics.some(d => d.code === 'type.arg-count')).toBe(true);
    });

    it('rejects invalid unit keywords in startOf', () => {
        const { diagnostics } = check('startOf("day")');
        expect(diagnostics.some(d => d.code === 'type.bad-unit-keyword')).toBe(true);
    });

    it('rejects non-bool condition', () => {
        const { diagnostics } = check('3 ? 1 : 2');
        expect(diagnostics.some(d => d.code === 'type.cond-not-bool')).toBe(true);
    });

    it('poisons upward without duplicate diagnostics', () => {
        const { diagnostics } = check('(start + due) + 1d');
        expect(diagnostics.filter(d => d.severity === 'error')).toHaveLength(1);
    });

    it('types none literal as none', () => {
        expect(check('none')).toMatchObject({ type: 'none', diagnostics: [] });
    });

    it('types time() as time', () => {
        expect(check('time(start)')).toMatchObject({ type: 'time', diagnostics: [] });
    });

    it('rejects time + duration with specific diagnostic', () => {
        expect(check('14:00 + 2h').diagnostics.some(d => d.code === 'type.time-arithmetic')).toBe(true);
        expect(check('2h + 14:00').diagnostics.some(d => d.code === 'type.time-arithmetic')).toBe(true);
    });

    it('absorbs none in conditional branches', () => {
        expect(check('start < due ? none : start + 1d')).toMatchObject({ type: 'datish', diagnostics: [] });
        expect(check('start < due ? start : none')).toMatchObject({ type: 'datish', diagnostics: [] });
        expect(check('start < due ? none : 14:00')).toMatchObject({ type: 'time', diagnostics: [] });
        expect(check('start < due ? none : none')).toMatchObject({ type: 'none', diagnostics: [] });
    });

    it('rejects the remainder of a duration', () => {
        // 1d % 2 は 1d、24h % 2 は 0h。同じ長さなのに答えが変わるので通さない。
        expect(check('1d % 2').diagnostics.map(d => d.code)).toContain('type.cannot-combine');
        expect(check('1d * 2')).toMatchObject({ type: 'duration', diagnostics: [] });
    });

    it('types members and methods by receiver', () => {
        expect(check('"abc".length')).toMatchObject({ type: 'number', diagnostics: [] });
        expect(check('start.format("MM")')).toMatchObject({ type: 'string', diagnostics: [] });
        expect(check('start.weekday()')).toMatchObject({ type: 'string', diagnostics: [] });
    });

    it('rejects unknown members', () => {
        expect(check('"abc".nope()').diagnostics.map(d => d.code)).toContain('type.unknown-member');
    });
    it('types ?? by the surviving side', () => {
        expect(check('time(start) ?? 09:00')).toMatchObject({ type: 'time', diagnostics: [] });
        expect(check('content ?? "fallback"')).toMatchObject({ type: 'string', diagnostics: [] });
        expect(check('content ?? 3').diagnostics.map(d => d.code)).toContain('type.nullish-mismatch');
    });

    it('rejects a weekday name that is not one', () => {
        expect(check('next("mon")')).toMatchObject({ type: 'date', diagnostics: [] });
        expect(check('next("monday")').diagnostics.map(d => d.code)).toContain('type.bad-weekday-name');
    });

    it('rejects a missing required argument', () => {
        expect(check('start.format()').diagnostics.map(d => d.code)).toContain('type.member-arity');
        expect(check('content.replace("a")').diagnostics.map(d => d.code)).toContain('type.member-arity');
        expect(check('content.slice(1)')).toMatchObject({ type: 'string', diagnostics: [] });
        // JS で省略できる引数は省略できる（slice() は複製、toFixed() は0桁）
        expect(check('content.slice()')).toMatchObject({ type: 'string', diagnostics: [] });
        expect(check('content.length.toFixed()')).toMatchObject({ type: 'string', diagnostics: [] });
    });
});

describe('the built-in vocabulary is one description', () => {
    // 組み込みを 1 つ足すときに触る場所が複数あると、抜けた 1 か所だけが
    // 静かに壊れる（読めない・型が付かない・隠せてしまう）。導出であることを
    // ここで固定する。

    it('offers a type for every property the language declares', () => {
        // 全域型なので、欠け（TS2741）も余り（余剰プロパティ検査の TS2353）も
        // ビルドが止める。実測済みで、この一致を守っているのは型のほう。
        // ここに残しているのは、型が Partial に戻された日の番人として。
        expect(Object.keys(FLOW_TYPE_ENV).sort()).toEqual([...PROP_NAMES].sort());
    });

    /**
     * 名前 1 語を js セクションのプロファイルで読ませ、パーサがそれを束縛より
     * 先に取ったかを見る。var ノードとして残れば束縛、そうでなければ（値・
     * プロパティ・名前空間・拒否のどれであっても）先に取られた。
     *
     * 予約とは本来この問いのことなので、答えはパーサに聞く。RESERVED_NAMES の
     * 定義式をここで組み直すと、式を書き換えたとき期待値も一緒に動いて何も
     * 固定できない。
     */
    function claimedBeforeBinding(name: string): boolean {
        const { tokens, diagnostics } = tokenize(name);
        const expr = parseExpr(new TokenCursor(tokens), diagnostics, 'stmt');
        return expr === null || expr.kind !== 'var';
    }

    /** 予約なのにパーサが取らない語。括弧が続く位置でだけ呼び出しになる。 */
    const RESERVED_BUT_LEFT_AS_A_BINDING = ['format', 'next', 'startOf', 'endOf', 'nextCycle', 'date', 'time'];

    /**
     * かつて「パーサは取るのに予約でない」側にいた 7 語。拒否表が束縛を探すより
     * 先に当たるのに予約されておらず、typeof という名前のセルが作れて、読んだ
     * 瞬間にブロック内で expr.no-typeof になっていた。いまは予約側にいる。
     */
    const REFUSED_AND_NOW_RESERVED = ['new', 'Date', 'console', 'function', 'await', 'typeof', 'delete'];

    it('reserves what the parser claims, apart from one gap it does not close yet', () => {
        const vocabulary = [...new Set([
            ...Object.keys(LITERAL_WORDS),
            ...UNIT_KEYWORDS,
            ...PROP_NAMES.map(p => p.split('.')[0]),
            ...FN_NAMES.map(f => f.split('.')[0]),
            ...NAMESPACE_WORDS,
            ...REFUSED_EXPR_KEYWORDS,
            // 対照。曜日はフロー記法だけの語で、js セクションでは普通の名前。
            'mon', 'n', 'label', 'startTime',
        ])];
        const claimed = vocabulary.filter(word => claimedBeforeBinding(word));
        const reserved = vocabulary.filter(word => isReservedName(word));

        // 残っているずれは 1 方向だけ。裸の関数名は var のまま残るので、警告文
        // の this binding cannot be read はその位置では偽になる。これは意図の
        // ある広さで（format という名前の局所を作らせない）、doc がそう書いて
        // いる。
        expect(reserved.filter(word => !claimed.includes(word)).sort())
            .toEqual([...RESERVED_BUT_LEFT_AS_A_BINDING].sort());
        // もう 1 方向は閉じた。パーサが束縛より先に取る語で予約でないものは、
        // もう無い。
        expect(claimed.filter(word => !reserved.includes(word))).toEqual([]);
    });

    it('reserves every word the parser refuses, wherever it stands', () => {
        // 一覧は verbatim。REFUSED_EXPR_KEYWORDS から導くと、表が動いたとき
        // 期待値も一緒に動いて何も固定できない。
        for (const word of REFUSED_AND_NOW_RESERVED) {
            expect({ word, reserved: isReservedName(word) }).toEqual({ word, reserved: true });
        }
    });

    it('reserves nothing else', () => {
        // 節の頭（setStartTime の startTime）は式の名前ではないので、変数名に
        // 使えなければならない。
        for (const name of ['n', 'label', 'xs', 'weekly', 'startTime', 'dueTime', 'use']) {
            expect({ name, reserved: isReservedName(name) }).toEqual({ name, reserved: false });
        }
    });

    it('reads a property the moment it is declared', () => {
        for (const prop of PROP_NAMES) {
            const result = check(prop);
            expect({ prop, codes: result.diagnostics.map(d => d.code) }).toEqual({ prop, codes: [] });
        }
    });
});
