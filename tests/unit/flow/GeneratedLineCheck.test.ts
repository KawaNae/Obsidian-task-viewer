import { describe, it, expect } from 'vitest';
import {
    checkGeneratedChildLine,
    checkGeneratedParentLine,
} from '../../../src/services/flow/GeneratedLineCheck';

/**
 * What a generation block may not write on the line that becomes the next
 * instance, and what the engine corrects instead of refusing.
 *
 * The check is pure and takes the composed text, so the planning layer can
 * run it before it emits a single effect. Refusing there is what keeps a
 * failed generation from consuming the command.
 */

const ok = (line: string) => {
    const result = checkGeneratedParentLine(line);
    if (!result.ok) throw new Error(`expected a pass, got ${result.error.code}`);
    return result;
};

const failure = (line: string) => {
    const result = checkGeneratedParentLine(line);
    if (result.ok) throw new Error(`expected a failure, got "${result.line}"`);
    return result.error;
};

describe('a generated parent line the engine can write', () => {
    it('passes an ordinary task line through untouched', () => {
        const result = ok('- [ ] 週報 第4回 @2026-08-24');

        expect(result.line).toBe('- [ ] 週報 第4回 @2026-08-24');
        expect(result.warnings).toEqual([]);
    });

    it('drops indentation the caller left on the value', () => {
        // The write layer decides the real indent, so the text it receives
        // carries none — the same contract the children travel under.
        expect(ok('    - [ ] 週報 第4回  ').line).toBe('- [ ] 週報 第4回');
    });

    it('leaves a caret that is not a trailing block id alone', () => {
        expect(ok('- [ ] ^abc の意味を調べる').line).toBe('- [ ] ^abc の意味を調べる');
    });
});

describe('a generated parent line the engine refuses', () => {
    it('refuses a flow command', () => {
        expect(failure('- [ ] 週報 第4回 ==> every mon').code).toBe('gen.generated-command');
    });

    it('refuses a command written as prose, because the reader would run it', () => {
        // Nothing distinguishes this from a command once the line is parsed,
        // so accepting it would generate an instance whose command nobody
        // wrote deliberately.
        expect(failure('- [ ] 矢印 ==> の意味').code).toBe('gen.generated-command');
    });

    it('refuses a block id', () => {
        const err = failure('- [ ] 週報 第4回 ^weekly');

        expect(err.code).toBe('gen.generated-block-id');
        expect(err.params).toEqual({ blockId: 'weekly' });
    });

    it('refuses a block id the parser would still read, trailing space and all', () => {
        // The check has to answer the way the reader does. A stricter reading
        // would pass a line here that comes back as an anchored task on the
        // next scan.
        expect(failure('- [ ] 週報 第4回 ^weekly ').code).toBe('gen.generated-block-id');
    });

    it('refuses a line that is not a checkbox', () => {
        expect(failure('週報 第4回 @2026-08-24').code).toBe('gen.generated-not-a-task');
    });

    it('names the command first when a line carries both faults', () => {
        expect(failure('- [ ] 週報 ==> every mon ^weekly').code).toBe('gen.generated-command');
    });
});

describe('a generated parent line the engine corrects', () => {
    it('unchecks a completed task and says so', () => {
        const result = ok('- [x] 週報 第4回 @2026-08-24');

        expect(result.line).toBe('- [ ] 週報 第4回 @2026-08-24');
        expect(result.warnings.map(w => w.code)).toEqual(['gen.generated-status']);
        expect(result.warnings[0].params).toEqual({ status: 'x' });
    });

    it('unchecks any status, not only the ones that read as complete', () => {
        // Which characters count as complete is a setting, so a check that
        // read settings would accept a line in one vault and correct it in
        // another. A generated instance starts at the beginning either way.
        const result = ok('- [/] 週報 第4回');

        expect(result.line).toBe('- [ ] 週報 第4回');
        expect(result.warnings[0].params).toEqual({ status: '/' });
    });

    it('keeps the bullet, the content and the dates as written', () => {
        expect(ok('* [X] 週報 第4回 @2026-08-24>2026-08-24T18:00').line)
            .toBe('* [ ] 週報 第4回 @2026-08-24>2026-08-24T18:00');
    });

    it('corrects an ordered-list task line too', () => {
        expect(ok('1. [x] 週報 第4回').line).toBe('1. [ ] 週報 第4回');
    });
});

describe('a generated child line', () => {
    const childOk = (line: string) => {
        const result = checkGeneratedChildLine(line);
        if (!result.ok) throw new Error(`expected a pass, got ${result.error.code}`);
        return result;
    };

    it('passes an ordinary child', () => {
        expect(childOk('- [ ] 資料集め').line).toBe('- [ ] 資料集め');
    });

    it('passes a child carrying its own command', () => {
        // A template item that fires on its own is written this way, and the
        // command belongs to the child rather than to the instance around it.
        expect(childOk('- [ ] 経費 @2026-08-24 ==> every 1mo').warnings).toEqual([]);
    });

    it('passes a line that is not a checkbox', () => {
        expect(childOk('- 参考: 先週の議事録').line).toBe('- 参考: 先週の議事録');
    });

    it('leaves a checked child as the block wrote it', () => {
        // Nothing fires from a child, so a checked one starts no runaway.
        // Correcting it would edit a body the engine does not normalize.
        expect(childOk('- [x] 定型の確認').line).toBe('- [x] 定型の確認');
    });

    it('refuses a block id, the one fault it shares with the parent', () => {
        const result = checkGeneratedChildLine('- [ ] 資料集め ^weekly-note');

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('gen.generated-block-id');
        expect(result.error.params).toEqual({ blockId: 'weekly-note' });
    });

    it('drops indentation the caller left on the value', () => {
        expect(childOk('\t- [ ] 資料集め ').line).toBe('- [ ] 資料集め');
    });
});
