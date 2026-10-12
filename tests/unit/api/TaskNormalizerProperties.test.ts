import { describe, it, expect } from 'vitest';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { namesOutsideIndex } from '../../../src/services/core/RowNames';
import { DEFAULT_SETTINGS } from '../../../src/types';
import { toDisplayTask, NO_TASK_LOOKUP } from '../../../src/services/display/DisplayTaskConverter';
import { normalizeTask } from '../../../src/api/TaskNormalizer';
import { pickFields } from '../../../src/cli/CliOutputFormatter';

const properties = (lines: string[]) => {
    const [task] = FileParsePipeline.parse('n.md', lines, DEFAULT_SETTINGS, namesOutsideIndex('n.md')).tasks;
    return normalizeTask(toDisplayTask(task, 0, NO_TASK_LOOKUP), () => undefined);
};

/** A task's properties as the API and the CLI give them. */
describe('a task\'s properties in the API', () => {
    it('are each value as its type says: a quoted text without its quotes, a number, a boolean, a list, no value as null', () => {
        const record = properties([
            '- [ ] t',
            '    - id:: "123"',
            '    - n:: 0x1F',
            '    - done:: True',
            '    - name:: Lab',
            '    - none::',
            '    - items::',
            '        - a',
            '        - 2',
        ]);
        expect(record.properties).toEqual({ id: '123', n: 31, done: true, name: 'Lab', none: null, items: ['a', 2] });
    });

    it('are each under its key as the layer whose value it is spells it', () => {
        const record = properties(['---', 'Area: desk', 'Zone: north', '---', '- [ ] t', '    - AREA:: lab']);
        expect(record.properties).toEqual({ Zone: 'north', AREA: 'lab' });
    });

    it('in the CLI\'s JSON, give a number JSON cannot write as its spelling, apart from no value', () => {
        const record = properties(['---', 'big: .inf', 'none:', '---', '- [ ] t']);
        expect(pickFields(record, ['properties']).properties).toEqual({ big: '.inf', none: null });
    });
});
