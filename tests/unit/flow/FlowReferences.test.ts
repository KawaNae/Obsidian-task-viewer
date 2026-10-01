import { describe, it, expect } from 'vitest';
import { unresolvedAt } from '../../../src/services/flow/FlowReferences';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { namesOutsideIndex } from '../../../src/services/core/RowNames';
import { DEFAULT_SETTINGS } from '../../../src/types';

/** The rows of `lines`, each as the index reads it. */
const rowsOf = (lines: string[]) => FileParsePipeline.parse('from.md', lines, DEFAULT_SETTINGS, namesOutsideIndex('from.md')).tasks;

const GEN = ['```tv-gen 週報', '- [ ] 資料集め', '```'];

describe('unresolvedAt', () => {
    it('move([[#見出し]]) の見出しが送り先に無い', () => {
        const rows = rowsOf(['## 完了', '- [ ] 片づける @2026-09-28 ==> move([[#完了]])']);
        const found = unresolvedAt(rows, ['# 別のノート', '## Tasks']);
        expect(found).toEqual([{ kind: 'heading', task: rows[0], name: '完了', found: 'none' }]);
    });

    it('送り先に見出しがあれば解決する。レベルと大文字小文字は問わない（リンクと同じ引き方）', () => {
        const rows = rowsOf(['- [ ] 片づける @2026-09-28 ==> move([[#Done]])']);
        expect(unresolvedAt(rows, ['### done'])).toEqual([]);
    });

    it('送り先に同じ見出しが2つあれば many', () => {
        const rows = rowsOf(['- [ ] 片づける @2026-09-28 ==> move([[#Done]])']);
        expect(unresolvedAt(rows, ['## Done', '## Done'])).toMatchObject([{ kind: 'heading', found: 'many' }]);
    });

    it('use("名前") の生成ブロックが送り先に無い', () => {
        const rows = rowsOf(['- [ ] 週報 @2026-09-28 ==> every mon use("週報")', '', ...GEN]);
        expect(unresolvedAt(rows, ['## Tasks'])).toEqual([{ kind: 'block', task: rows[0], name: '週報' }]);
        expect(unresolvedAt(rows, ['## Tasks', '', ...GEN])).toEqual([]);
    });

    it('式で書かれた名前は判定しない', () => {
        const rows = rowsOf(['- [ ] 週報 @2026-09-28 ==> every mon use("週" + "報")']);
        expect(rows[0].flow?.program?.use?.name.kind).toBe('binary');
        expect(unresolvedAt(rows, [])).toEqual([]);
    });

    it('子の行のコマンドも、その行について答える', () => {
        const rows = rowsOf([
            '- [ ] 親',
            '    - [ ] 子 @2026-09-28',
            '        - ==> move([[#完了]])',
        ]);
        const child = rows.find(t => t.content === '子')!;
        expect(unresolvedAt(rows, [])).toEqual([{ kind: 'heading', task: child, name: '完了', found: 'none' }]);
    });

    it('見出しを指さない move は判定しない（コマンドが読めず、パーサが誤りを出す）', () => {
        const rows = rowsOf(['- [ ] 片づける @2026-09-28 ==> move()']);
        expect(unresolvedAt(rows, [])).toEqual([]);
    });
});
