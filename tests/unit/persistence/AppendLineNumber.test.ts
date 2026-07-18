import { describe, it, expect } from 'vitest';

/**
 * InlineTaskWriter.appendTaskToFile の行番号計算ロジックを純関数として検証。
 * 実装内の計算式: fileContent.length === 0 ? 0
 *   : fileContent.split('\n').length + (prefix ? 0 : -1)
 * where prefix = fileContent.endsWith('\n') ? '' : '\n'
 */
function computeAppendLine(fileContent: string): number {
    if (fileContent.length === 0) return 0;
    const prefix = fileContent.endsWith('\n') ? '' : '\n';
    return fileContent.split('\n').length + (prefix ? 0 : -1);
}

function appendAndVerify(fileContent: string, taskLine: string): { insertedLine: number; result: string } {
    const insertedLine = computeAppendLine(fileContent);
    const prefix = fileContent.length > 0 && !fileContent.endsWith('\n') ? '\n' : '';
    const result = fileContent + prefix + taskLine;
    const lines = result.split('\n');
    expect(lines[insertedLine]).toBe(taskLine);
    return { insertedLine, result };
}

describe('appendTaskToFile 行番号計算', () => {
    it('空ファイル', () => {
        const { insertedLine } = appendAndVerify('', '- [ ] task');
        expect(insertedLine).toBe(0);
    });

    it('末尾改行ありファイル', () => {
        const { insertedLine } = appendAndVerify('line1\nline2\n', '- [ ] task');
        expect(insertedLine).toBe(2);
    });

    it('末尾改行なしファイル', () => {
        const { insertedLine } = appendAndVerify('line1\nline2', '- [ ] task');
        expect(insertedLine).toBe(2);
    });

    it('frontmatter のみのファイル（末尾改行あり）', () => {
        const { insertedLine } = appendAndVerify('---\ntv-color: fff\n---\n', '- [ ] task');
        expect(insertedLine).toBe(3);
    });

    it('frontmatter のみのファイル（末尾改行なし）', () => {
        const { insertedLine } = appendAndVerify('---\ntv-color: fff\n---', '- [ ] task');
        expect(insertedLine).toBe(3);
    });

    it('単一行ファイル（末尾改行なし）', () => {
        const { insertedLine } = appendAndVerify('existing', '- [ ] task');
        expect(insertedLine).toBe(1);
    });

    it('単一行ファイル（末尾改行あり）', () => {
        const { insertedLine } = appendAndVerify('existing\n', '- [ ] task');
        expect(insertedLine).toBe(1);
    });

    it('複数セクションのファイル', () => {
        const content = '# Header\n\nSome text\n\n## Tasks\n- [ ] old task\n';
        const { insertedLine } = appendAndVerify(content, '- [ ] new task');
        expect(insertedLine).toBe(6);
    });
});
