import { describe, expect, it } from 'vitest';
import { EvalContext, EvalError } from '../../../src/services/lang/ExprEvaluator';
import type { EvalHost } from '../../../src/services/lang/functions';
import { parseGenBody } from '../../../src/services/parsing/gen/GenBodyParser';
import { renderGenBody } from '../../../src/services/parsing/gen/GenBodyRenderer';

const stubHost: EvalHost = {
    formatDate: (value, tokens) => `[${tokens}:${value.type === 'date' ? value.value : '?'}]`,
};

function ctx(props: EvalContext['props'] = {}): EvalContext {
    return {
        props,
        today: '2026-08-15',
        now: { date: '2026-08-15', time: '10:00' },
        weekStartDay: 1,
        host: stubHost,
    };
}

function render(lines: string[], props: EvalContext['props'] = {}) {
    return renderGenBody(parseGenBody(lines, 1), ctx(props));
}

describe('renderGenBody', () => {
    it('renders the parent line and its children', () => {
        const result = render([
            '- [ ] 週報 ${content}',
            '    - [ ] 資料集め',
            '\t- [ ] 下書き ${today}',
        ], {
            content: { type: 'string', value: '第3週' },
            today: { type: 'date', value: '2026-08-15' },
        });

        expect(result).toEqual({
            ok: true,
            parentText: '- [ ] 週報 第3週',
            children: [
                { depth: 1, body: '- [ ] 資料集め' },
                { depth: 1, body: '- [ ] 下書き 2026-08-15' },
            ],
        });
    });

    it('leaves the parent line exactly as the block wrote it', () => {
        // フロー節は付けない。付けてから検査すると、エンジンが書いた ==> を
        // 検査が拾って拒否する。
        const result = render(['- [ ] 週報']);
        expect(result).toMatchObject({ ok: true, parentText: '- [ ] 週報' });
    });

    it('has no parent when the block is children-only', () => {
        const result = render(['    - [ ] 子だけ']);
        expect(result).toMatchObject({ ok: true, parentText: null });
        expect(result.ok && result.children).toEqual([{ depth: 1, body: '- [ ] 子だけ' }]);
    });

    it('turns a value of several lines into several children', () => {
        // 配列は「要素が行」。前置きのテキストは 1 行目に付き、値が持ってきた
        // 行はホスト行の段数を基底に、自分のインデントを段数へ換算して並ぶ
        const result = render([
            '- [ ] 親',
            '    - ${["a", "\tb", "        c"].join("\n")}',
        ]);
        expect(result.ok && result.children).toEqual([
            { depth: 1, body: '- a' },
            { depth: 2, body: 'b' },
            { depth: 3, body: 'c' },
        ]);
    });

    it('drops the blank lines a value brings', () => {
        // 空行は子の並びを終わらせるので、残すと生成物がそこで切れる
        const result = render([
            '- [ ] 親',
            '    - ${["a", "", "b"].join("\n")}',
        ]);
        expect(result.ok && result.children).toEqual([
            { depth: 1, body: '- a' },
            { depth: 1, body: 'b' },
        ]);
    });

    it('refuses a value of several lines on the parent line', () => {
        // 1 回の発火が生む親は 1 つ。理由の分かる文言で落とす
        const result = render(['- [ ] ${["a", "b"]}']);
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.message).toContain('one line');
    });

    it('refuses a value of several lines with text after it', () => {
        // 後ろのテキストに行き場が無い。推測せずに発火しない
        const result = render(['- [ ] ${["a", "b"]} tail']);
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toBeInstanceOf(EvalError);
        expect(!result.ok && result.error.message).toContain('several lines');
    });

    it('evaluates the lines in document order, parent line included', () => {
        // 今は式に効果が無いので順序は結果に現れない — 段 3 の代入
        // ${n = n + 1} が入った日に、書き手の読む順で走ることが要る。
        // 観測手段はエラーの発生順: 両方の行が失敗する形で、文書で先に
        // 読む行のエラーが返ることを pin する
        const result = render([
            '${start}',
            '- [ ] 親 ${end}',
        ]);
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.message).toContain("'start' is not set");
    });

    it('reports a failed expression instead of writing a partial instance', () => {
        // 2 相: 1 つでも評価に失敗したら、効果を 1 つも出さない
        const result = render([
            '- [ ] 親 ${start}',
            '    - [ ] 子',
        ]);
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.message).toContain("'start' is not set");
    });

    it('points the failure at the expression, not the line', () => {
        // 位置は行頭からの絶対位置で、しかも失敗した式そのものを指す
        const line = '- [ ] 親 ${start}';
        const result = render([line]);
        expect(!result.ok && result.error.span).toEqual({
            start: line.indexOf('start'),
            end: line.indexOf('start') + 'start'.length,
        });
    });
});

describe('a line that is only an interpolation', () => {
    it('takes the depth its value carries, as the canonical sample writes it', () => {
        // 設計のサンプル 4 の形。差し込み行はカラム 0 に置かれ、階層は
        // 文字列の中に書かれる（LLM が実際に書いた形で、R1 が verbatim に
        // なった理由そのもの）
        const result = render([
            '- [ ] 週次レビュー',
            '${["    - [ ] 仕事", "    - [ ] 健康"].join("\n")}',
        ]);
        expect(result).toEqual({
            ok: true,
            parentText: '- [ ] 週次レビュー',
            children: [
                { depth: 1, body: '- [ ] 仕事' },
                { depth: 1, body: '- [ ] 健康' },
            ],
        });
    });

    it('is not a second root, so the static rules leave it alone', () => {
        const body = parseGenBody([
            '- [ ] 親',
            '${"    - [ ] 子"}',
        ], 1);
        // 深さ 0 でも親候補にならないので multiple-roots も root-not-a-task も出ない
        expect(body.diagnostics).toEqual([]);
        expect(body.parent?.text).toBe('- [ ] 親');
        expect(body.children).toHaveLength(1);
    });

    it('can be the generated task itself when its value says so', () => {
        const result = render(['${"- [ ] 生成された親"}']);
        expect(result).toMatchObject({ ok: true, parentText: '- [ ] 生成された親' });
    });

    it('refuses two lines at the top level, whoever produced them', () => {
        const result = render(['${["- [ ] a", "- [ ] b"].join("\n")}']);
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.message).toContain('one task');
    });

    it('refuses a top-level line that is not a checkbox', () => {
        const result = render(['${"ただのテキスト"}']);
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.message).toContain('checkbox');
    });
});

describe('renderGenBody — the js section', () => {
    it('runs the section first and lets the body read what it left', () => {
        expect(render([
            '<js',
            'const areas = ["仕事", "健康"]',
            'const rows = areas.map(a => "    - [ ] " + a).join("\\n")',
            '/js>',
            '- [ ] 週報',
            '${rows}',
        ])).toEqual({
            ok: true,
            parentText: '- [ ] 週報',
            children: [
                { depth: 1, body: '- [ ] 仕事' },
                { depth: 1, body: '- [ ] 健康' },
            ],
        });
    });

    // 文書順が規則そのもの。後続の差し込みは更新後の値を見る。
    it('reads the body in document order, updates included', () => {
        expect(render([
            '<js', 'let n = 0', '/js>',
            '- [ ] 第${n += 1}回',
            '    - [ ] その次は第${n + 1}回',
        ])).toMatchObject({
            ok: true,
            parentText: '- [ ] 第1回',
            children: [{ depth: 1, body: '- [ ] その次は第2回' }],
        });
    });

    it('lets a function the section declared build a line', () => {
        expect(render([
            '<js',
            'const title = n => "- [ ] 第" + n + "回"',
            '/js>',
            '${title("3")}',
        ])).toMatchObject({ ok: true, parentText: '- [ ] 第3回' });
    });

    // 失敗は結果であって例外ではない。2 相なので、ここで落ちれば何も書かれない。
    it('hands back the failure rather than throwing it', () => {
        const result = render(['<js', 'const n = 1 / 0', '/js>', '- [ ] 週報']);
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.message).toContain('Division by zero');
    });

    it('stops a section that will not stop on its own', () => {
        const result = render(['<js', 'let n = 0', 'while (true) { n = n + 1 }', '/js>', '- [ ] 週報']);
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.message).toContain('ran past');
    });

    it('refuses more lines than a task can be', () => {
        const result = render([
            '<js',
            'let rows = []',
            'for (let i = 0; i < 300; i += 1) { rows = rows.concat(["    - [ ] row"]) }',
            'const body = rows.join("\\n")',
            '/js>',
            '- [ ] 週報',
            '${body}',
        ]);
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.message).toContain('more than 200 lines');
    });

    // 1 ソース行が複数行の値で複数エントリに展開されるので、深い行が最後に
    // 来るとは限らない。最後の 1 本だけを見ると素通りする。
    it('refuses a deep line even when a shallow one follows it', () => {
        const result = render([
            '<js',
            `const rows = ["${' '.repeat(4 * 12)}- [ ] 底", "    - [ ] 浅"].join("\\n")`,
            '/js>',
            '- [ ] 週報',
            '${rows}',
        ]);
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.message).toContain('levels deep');
    });

    it('refuses a line nested deeper than a task can hold', () => {
        const result = render([
            '<js',
            `const deep = "${' '.repeat(4 * 11)}- [ ] 底"`,
            '/js>',
            '- [ ] 週報',
            '${deep}',
        ]);
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.message).toContain('levels deep');
    });
});
