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

    it('turns a value of several lines into several lines', () => {
        // 配列は「要素が行」。前置きのテキストは 1 行目に付く
        const result = render(['- [ ] ${["a", "b"]}']);
        expect(result).toMatchObject({ ok: true, parentText: '- [ ] a\nb' });
    });

    it('refuses a value of several lines with text after it', () => {
        // 後ろのテキストに行き場が無い。推測せずに発火しない
        const result = render(['- [ ] ${["a", "b"]} tail']);
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toBeInstanceOf(EvalError);
        expect(!result.ok && result.error.message).toContain('several lines');
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
