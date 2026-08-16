import { describe, it, expect } from 'vitest';
import { parseFlow, parseFlowCells } from '../../../src/services/flow/FlowParser';
import { serializeFlow } from '../../../src/services/flow/FlowSerializer';

function errorsIn(diagnostics: { severity: string; code: string }[]): string[] {
    return diagnostics.filter(d => d.severity === 'error').map(d => d.code);
}

function errors(raw: string): string[] {
    return errorsIn(parseFlow(raw).diagnostics);
}

describe('FlowParser', () => {
    describe('schedule clauses', () => {
        it('parses every with a single weekday', () => {
            const { program, diagnostics } = parseFlow('every mon');
            expect(diagnostics).toEqual([]);
            expect(program?.schedule).toMatchObject({ kind: 'every', rule: { type: 'weekdays', days: [1] } });
        });

        it('parses every with a weekday list', () => {
            const { program } = parseFlow('every tue,fri');
            expect(program?.schedule).toMatchObject({ rule: { type: 'weekdays', days: [2, 5] } });
        });

        it('parses every with an interval', () => {
            const { program } = parseFlow('every 2w');
            expect(program?.schedule).toMatchObject({ rule: { type: 'interval', amount: 2, unit: 'w' } });
        });

        it('parses every mo@N and mo@last', () => {
            expect(parseFlow('every mo@25').program?.schedule).toMatchObject({
                rule: { type: 'monthday', intervalMonths: 1, day: 25 },
            });
            expect(parseFlow('every mo@last').program?.schedule).toMatchObject({
                rule: { type: 'monthday', intervalMonths: 1, day: 'last' },
            });
            expect(parseFlow('every 2mo@15').program?.schedule).toMatchObject({
                rule: { type: 'monthday', intervalMonths: 2, day: 15 },
            });
        });

        it('parses +duration as an anchor offset (what the notation reads as)', () => {
            const { program, diagnostics } = parseFlow('+3d');
            expect(diagnostics).toEqual([]);
            expect(program?.schedule).toMatchObject({ kind: 'plus', amount: 3, unit: 'd' });
        });

        it('parses completion-relative offsets as expressions', () => {
            const { program, diagnostics } = parseFlow('at(today + 3d)');
            expect(diagnostics).toEqual([]);
            expect(program?.schedule?.kind).toBe('at');
        });

        it('parses at(expr) escape hatch', () => {
            const { program, diagnostics } = parseFlow('at(startOf(month, done + 1mo) + 4d)');
            expect(diagnostics).toEqual([]);
            expect(program?.schedule?.kind).toBe('at');
        });

        it('parses nextCycle() so every is expressible as an expression', () => {
            const { program, diagnostics } = parseFlow('at(nextCycle(start, 3d))');
            expect(diagnostics).toEqual([]);
            expect(program?.schedule?.kind).toBe('at');
        });
    });

    describe('lifetime / options / move', () => {
        it('parses the full clause set order-free', () => {
            const canonical = parseFlow('every mon x14 until(2026-09-28) nochildren move([[Log/Done]])');
            const shuffled = parseFlow('nochildren until(2026-09-28) move([[Log/Done]]) x14 every mon');
            // Errors, not diagnostics: `nochildren` is retired and says so,
            // and a warning is what order-freedom is being read through here.
            expect(errorsIn(canonical.diagnostics)).toEqual([]);
            expect(errorsIn(shuffled.diagnostics)).toEqual([]);
            expect(serializeFlow(shuffled.program!)).toBe(serializeFlow(canonical.program!));
        });

        it('parses telomere count', () => {
            expect(parseFlow('at(today + 1d) x14').program?.lifetime).toMatchObject({ count: 14 });
        });

        it('rejects x0', () => {
            expect(errors('at(today + 1d) x0')).toContain('flow.zero-lifetime');
        });

        it('parses independent setter clauses', () => {
            const { program, diagnostics } = parseFlow('every mon setContent("週報 " + format(start, "MM/DD")) setDue(start + 3d)');
            expect(diagnostics).toEqual([]);
            expect(Object.keys(program!.sets!)).toEqual(['content', 'due']);
        });

        it('rejects duplicate setter clauses', () => {
            expect(errors('every mon setDue(start + 1d) setDue(start + 2d)')).toContain('flow.duplicate-node');
        });

        it('parses move alone (no schedule)', () => {
            const { program, diagnostics } = parseFlow('move([[Archive]])');
            expect(diagnostics).toEqual([]);
            expect(program?.schedule).toBeUndefined();
            expect(program?.move).toBeDefined();
        });
    });

    describe('diagnostics', () => {
        it('rejects misordered heads like "tue every"', () => {
            expect(errors('tue every')).toContain('flow.unknown-head');
        });

        it('rejects duplicate schedule clauses', () => {
            expect(errors('every mon at(today + 3d)')).toContain('flow.duplicate-schedule');
        });

        it('rejects duplicate lifetimes', () => {
            expect(errors('at(today + 1d) x5 x3')).toContain('flow.duplicate-node');
        });

        it('rejects orphan modifiers without a schedule', () => {
            expect(errors('x5')).toContain('flow.orphan-modifier');
            expect(errors('until(2026-09-28)')).toContain('flow.orphan-modifier');
            expect(errors('use("週報")')).toContain('flow.orphan-modifier');
        });

        it('reads nochildren, warns, and keeps nothing of it', () => {
            // Refusing the token would take the whole command down with it —
            // an error nulls the program, so a line that used to run would
            // stop running on the release that retires one of its clauses.
            // Keeping it on the AST would put it back on the line every time
            // a fire regenerates the clause.
            const { program, diagnostics } = parseFlow('every mon nochildren');

            expect(program).not.toBeNull();
            expect(diagnostics.map(d => [d.code, d.severity]))
                .toEqual([['flow.nochildren-retired', 'warning']]);
            expect(serializeFlow(program!)).toBe('every mon');
        });

        it('says only that the clause is retired when it is all there is', () => {
            // Dropping the clause leaves an empty command, but flow.empty
            // only speaks when nothing else has explained the line — and the
            // retirement notice has, in a message that names the fix.
            const { program, diagnostics } = parseFlow('nochildren');

            expect(program).not.toBeNull();
            expect(diagnostics.map(d => d.code)).toEqual(['flow.nochildren-retired']);
        });

        it('parses use() and keeps the name as an expression', () => {
            const { program, diagnostics } = parseFlow('every mon use("週報")');
            expect(diagnostics).toEqual([]);
            expect(program?.use?.name.kind).toBe('lit');
        });

        it('accepts a computed block name', () => {
            // 引数を式のまま持つ判断の pin。リテラル限定にすると後で文法が広がる。
            const { diagnostics } = parseFlow('every mon use("週報" + "2")');
            expect(diagnostics).toEqual([]);
        });

        it('rejects a non-string block name', () => {
            expect(errors('every mon use(3d)')).toContain('type.use-name');
        });

        it('rejects duplicate use clauses', () => {
            expect(errors('every mon use("a") use("b")')).toContain('flow.duplicate-node');
        });

        it('reports legacy syntax as an unknown clause', () => {
            expect(errors('repeat(weekly)')).toContain('flow.unknown-head');
            expect(errors('next(monday).as(text)')).toContain('flow.unknown-head');
        });

        it('rejects bare until without parentheses', () => {
            expect(errors('every mon until 2026-02-30')).toContain('flow.expected-lparen');
        });

        it('rejects bad set field types', () => {
            expect(errors('every mon setDue("text")')).toContain('type.set-date-mismatch');
            expect(errors('every mon setContent(3d)')).toContain('type.set-content-not-string');
        });

        it('rejects non-datish at()', () => {
            expect(errors('at("text")')).toContain('type.at-not-datish');
        });

        it('returns null program with raw preserved semantics on prose', () => {
            const { program, diagnostics } = parseFlow('see https://example.com for details');
            expect(program).toBeNull();
            expect(diagnostics.length).toBeGreaterThan(0);
        });

        it('program is null iff there are error diagnostics', () => {
            for (const src of ['every mon', 'garbage', 'every mon x0', 'move([[A]])']) {
                const { program, diagnostics } = parseFlow(src);
                const hasError = diagnostics.some(d => d.severity === 'error');
                expect(program === null).toBe(hasError);
            }
        });
    });

    describe('round-trip', () => {
        it.each([
            'every mon',
            'every tue,fri',
            'every 2w',
            'every mo@25',
            'every mo@last',
            'every 2mo@15',
            '+3d',
            '+30min',
            'at(today + 3d)',
            'at(done + 30min)',
            'at(nextCycle(start, 3d))',
            'every mon x14',
            'every mon until(2026-09-28)',
            'every mon x14 until(2026-09-28) nochildren',
            'every mon use("週報")',
            'every mon x14 use("週報") move([[Log]])',
            'move([[Archive/Done]])',
            'every mon move([[Log]])',
            'at(startOf(month, done + 1mo) + 4d)',
            'every mon setContent("週報 " + format(start, "MM/DD")) setDue(start + 3d)',
            'every mon until(endOf(year))',
            'every mon setStartTime(14:00)',
            '+3d setStartTime(none)',
            '+3d setEndTime(time(start))',
            '+3d setDueTime(none)',
            '+3d setStart(none)',
            'at(today + 3d * 2)',
            'at(today + (1d + 2d) * 3)',
            'at(next("mon", start))',
            '+3d setStartTime(time(start) ?? 09:00)',
            'every mon setContent(content ?? "untitled")',
            'every mon setContent((true || false) ?? none ? "a" : "b")',
        ])('parse → serialize → parse is stable: %s', (src) => {
            const first = parseFlow(src);
            expect(first.program).not.toBeNull();
            const printed = serializeFlow(first.program!);
            const second = parseFlow(printed);
            // Errors only: a retired clause survives printing in this stage
            // and warns again on the way back in, which is round-trip
            // working rather than failing.
            expect(errorsIn(second.diagnostics)).toEqual([]);
            expect(serializeFlow(second.program!)).toBe(printed);
        });

        it('keeps multiplicative precedence when printing', () => {
            // 印字は優先順位に従って括弧を復元する。ここが崩れると、発火の
            // たびに式の意味が変わる。
            expect(serializeFlow(parseFlow('at(today + 1d * 2 + 3d)').program!))
                .toBe('at(today + 1d * 2 + 3d)');
            expect(serializeFlow(parseFlow('at(today + (1d + 2d) * 3)').program!))
                .toBe('at(today + (1d + 2d) * 3)');
        });

        it('prints ?? with the parentheses its precedence needs', () => {
            // ?? は || より緩い。括弧が落ちると発火のたびに意味が変わる。
            expect(serializeFlow(parseFlow('+3d setStartTime((time(start) ?? 09:00))').program!))
                .toBe('+3d setStartTime(time(start) ?? 09:00)');
            expect(serializeFlow(parseFlow('every mon setContent((content ?? "a") + "b")').program!))
                .toBe('every mon setContent((content ?? "a") + "b")');
        });

        it('prints accepted variants in one canonical form', () => {
            // 受理は広く、印字は狭く。異形ごとに canonical 形を 1 つに決める。
            expect(serializeFlow(parseFlow("every mon setContent('text')").program!))
                .toBe('every mon setContent("text")');
            expect(serializeFlow(parseFlow('every mon setContent(1 === 1 ? "a" : "b")').program!))
                .toBe('every mon setContent(1 == 1 ? "a" : "b")');
        });

        it('normalizes clause order canonically', () => {
            const { program } = parseFlow('move([[A]]) until(2026-09-28) every mon x3');
            expect(serializeFlow(program!)).toBe('every mon x3 until(2026-09-28) move([[A]])');
        });
    });

    describe('setStartTime / setEndTime / setDueTime', () => {
        it('parses time patch clauses', () => {
            const { program, diagnostics } = parseFlow('every mon setStartTime(14:00) setEndTime(17:00)');
            expect(diagnostics).toEqual([]);
            expect(program!.sets!.startTime).toBeDefined();
            expect(program!.sets!.endTime).toBeDefined();
        });

        it('parses setStartTime(none)', () => {
            const { program, diagnostics } = parseFlow('every mon setStartTime(none)');
            expect(diagnostics).toEqual([]);
            expect(program!.sets!.startTime).toBeDefined();
        });

        it('parses setDueTime with time() extractor', () => {
            const { program, diagnostics } = parseFlow('every mon setDueTime(time(start))');
            expect(diagnostics).toEqual([]);
            expect(program!.sets!.dueTime).toBeDefined();
        });

        it('rejects non-time types in time patch clauses', () => {
            expect(errors('every mon setStartTime("text")')).toContain('type.set-time-mismatch');
            expect(errors('every mon setStartTime(2026-07-15)')).toContain('type.set-time-mismatch');
        });
    });

    describe('until(expr)', () => {
        it('parses until with expression', () => {
            const { program, diagnostics } = parseFlow('every mon until(endOf(year))');
            expect(diagnostics).toEqual([]);
            expect(program!.until).toBeDefined();
        });

        it('rejects non-datish until expression', () => {
            expect(errors('every mon until("text")')).toContain('type.until-not-datish');
        });
    });

    describe('none literal in set clauses', () => {
        it('accepts none for date fields', () => {
            const { diagnostics } = parseFlow('every mon setStart(none)');
            expect(diagnostics).toEqual([]);
        });

        it('accepts none for content', () => {
            const { diagnostics } = parseFlow('every mon setContent(none)');
            expect(diagnostics).toEqual([]);
        });
    });

    describe('state(...) cells', () => {
        it('parses one cell', () => {
            const { program, diagnostics } = parseFlow('every mon state(n: 3) use("週報")');
            expect(diagnostics).toEqual([]);
            expect(program!.cells!.entries).toMatchObject([{ name: 'n', value: { type: 'number', value: 3 } }]);
        });

        it('parses several cells in one clause', () => {
            const { program, diagnostics } = parseFlow('every mon state(n: 3, label: "第", sent: false)');
            expect(diagnostics).toEqual([]);
            expect(program!.cells!.entries.map(c => c.name)).toEqual(['n', 'label', 'sent']);
        });

        it('takes every printable type', () => {
            const { diagnostics } = parseFlow(
                'every mon state(n: 3, s: "text", b: true, d: 2026-08-17, t: 10:30, dur: 3d, l: [[Note]])');
            expect(diagnostics).toEqual([]);
        });

        it('takes a negative number, which is what a countdown writes back', () => {
            const { program } = parseFlow('every mon state(n: -2)');
            expect(program!.cells!.entries[0].value).toEqual({ type: 'number', value: -2 });
        });

        it('prints back what it read, in canonical order', () => {
            // 印字→解析→印字 が不動点であることがフロー行の生命線（毎発火で
            // 書き直されるため、一度でも読めない形を書いたら鎖が止まる）。
            const sources = [
                'every mon state(n: 3) use("週報")',
                'every mon x5 until(2026-12-31) state(n: 3, s: "text") use("週報")',
                'every mon state(d: 2026-08-17, t: 10:30, dur: 3d, b: false, l: [[Note]])',
                'every mon state(n: -2)',
            ];
            for (const src of sources) {
                const once = serializeFlow(parseFlow(src).program!);
                expect(once).toBe(src);
                expect(serializeFlow(parseFlow(once).program!)).toBe(once);
            }
        });

        it('prints a computed string back as one line', () => {
            // セルは「計算された文字列」が印字器に流れる最初の経路で、
            // join("\n") はこの機能の看板イディオム。生の改行を書くと
            // コマンドが 2 行になり、次のスキャンが読めなくなる。
            const printed = serializeFlow({
                ...parseFlow('every mon state(c: "x")').program!,
                cells: {
                    entries: [{
                        name: 'c',
                        value: { type: 'string', value: '- [ ] a\n- [ ] b\tあと' },
                        nameSpan: { start: 0, end: 0 },
                        valueSpan: { start: 0, end: 0 },
                    }],
                    span: { start: 0, end: 0 },
                },
            });
            expect(printed).not.toContain('\n');
            const back = parseFlow(printed);
            expect(back.diagnostics).toEqual([]);
            expect(back.program!.cells!.entries[0].value)
                .toEqual({ type: 'string', value: '- [ ] a\n- [ ] b\tあと' });
        });

        it('puts state between until and use whatever order it was written in', () => {
            const { program } = parseFlow('use("週報") state(n: 3) every mon x2');
            expect(serializeFlow(program!)).toBe('every mon x2 state(n: 3) use("週報")');
        });

        it('accepts a trailing comma, as every other list does', () => {
            const { program, diagnostics } = parseFlow('every mon state(n: 3,)');
            expect(diagnostics).toEqual([]);
            expect(program!.cells!.entries).toHaveLength(1);
        });

        it('refuses a computed initial value', () => {
            // 初期値は毎発火で書き戻される場所なので、式を書くと 1 回目の発火で
            // その結果に置き換わり、書いた式が行から消える。
            expect(errors('every mon state(n: 1 + 2)')).toContain('flow.cell-not-literal');
            expect(errors('every mon state(d: today)')).toContain('flow.cell-not-literal');
        });

        it('refuses a value it cannot print and read back', () => {
            // リストとレコードはフロー・プロファイルの文法から先に落ちる。
            // セル側で二重に言う必要は無く、none だけがここまで届く。
            expect(errors('every mon state(xs: [1, 2])')).toContain('expr.list-not-here');
            expect(errors('every mon state(r: {a: 1})')).toContain('expr.record-not-here');
            expect(errors('every mon state(n: none)')).toContain('type.cell-not-storable');
        });

        // セル名は式言語の名前と衝突しない。読むときは state.start であって
        // start ではないので、この行が禁じるものは何も無い。一覧は verbatim:
        // 表から導くと、表が動いたとき期待値も一緒に動いて何も固定できない。
        it('takes a name the expression language uses, since a cell is not read bare', () => {
            expect(errors('every mon state(start: 3)')).toEqual([]);
            expect(errors('every mon state(mon: 3)')).toEqual([]);
            for (const name of ['new', 'Date', 'console', 'function', 'await', 'typeof', 'delete']) {
                expect({ name, errors: errors(`every mon state(${name}: 3)`) })
                    .toEqual({ name, errors: [] });
            }
        });

        it('takes state as a cell name too, since the namespace is the only way in', () => {
            // 質問として上がった形（tv-xparse）。読むときは state.state で、
            // 名前空間そのものと取り違えようが無い。禁じれば、衝突しない名前を
            // 断る規則がまた 1 つ増える。認めた上でここに書いておく。
            expect(errors('every mon state(state: 3)')).toEqual([]);
        });

        it('refuses the same cell twice', () => {
            expect(errors('every mon state(n: 3, n: 4)')).toContain('flow.duplicate-cell');
        });

        it('refuses a second state clause', () => {
            expect(errors('every mon state(n: 3) state(m: 4)')).toContain('flow.duplicate-node');
        });

        it('says the shape when the pair is malformed', () => {
            expect(errors('every mon state(3)')).toContain('flow.expected-cell');
            expect(errors('every mon state(n 3)')).toContain('flow.expected-cell');
            expect(errors('every mon state()')).toContain('flow.expected-cell');
        });

        it('needs a schedule to carry the state on to', () => {
            expect(errors('state(n: 3)')).toContain('flow.orphan-modifier');
        });

        it('reads the declarations of a command that does not parse on its own', () => {
            // 多行フローの子行は単独では program にならない。宣言は書かれた
            // とおりに存在するので、エディタはそれを読む。
            expect(parseFlowCells('state(n: 3)').map(c => c.name)).toEqual(['n']);
            expect(parseFlowCells('every mon use("週報")')).toEqual([]);
        });

        it('does not know the old name any more', () => {
            // let は残さず消した。読める節でなくなるので、宣言だけが落ちて
            // 発火が続く形にはならない。program が null になるところまでが
            // この約束で、そこから先は canTriggerFlow が発火を止める。
            const { program, diagnostics } = parseFlow('every mon let(n: 3) use("週報")');
            expect(diagnostics.map(d => d.code)).toContain('flow.unknown-head');
            expect(program).toBeNull();
            // 宣言としても読まれない。ブロックは n を「誰も宣言していない名前」
            // として扱い、初期値のまま静かに回り続けることがない。
            expect(parseFlowCells('let(n: 3)')).toEqual([]);
        });
    });
});
