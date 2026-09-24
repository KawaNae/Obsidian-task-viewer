import { describe, it, expect } from 'vitest';
import { completes, isOperation } from '../../../src/services/flow/FlowTrigger';
import { DEFAULT_STATUS_DEFINITIONS, type StatusDefinition } from '../../../src/types';

const defs = DEFAULT_STATUS_DEFINITIONS;

describe('completes', () => {
    it('is true from an incomplete task line to a complete one', () => {
        expect(completes('- [ ] T', '- [x] T', defs)).toBe(true);
        expect(completes('- [/] T', '- [-] T', defs)).toBe(true);
        expect(completes('    * [?] T ==> next', '    * [!] T ==> next', defs)).toBe(true);
        expect(completes('10.   [ ] T', '10.   [x] T', defs)).toBe(true);
    });

    it('is false from a complete task line, whatever it becomes', () => {
        expect(completes('- [x] T', '- [x] T', defs)).toBe(false);
        expect(completes('- [x] T', '- [-] T', defs)).toBe(false);
        expect(completes('- [x] T', '- [ ] T', defs)).toBe(false);
    });

    it('is false to an incomplete task line', () => {
        expect(completes('- [ ] T', '- [ ] T edited', defs)).toBe(false);
        expect(completes('- [ ] T', '- [/] T', defs)).toBe(false);
    });

    it('is false when either line is no task line', () => {
        expect(completes('- [ ] T', 'T', defs)).toBe(false);
        expect(completes('- T', '- [x] T', defs)).toBe(false);
        expect(completes('- [] T', '- [x] T', defs)).toBe(false);
        expect(completes('', '- [x] T', defs)).toBe(false);
    });

    it('reads complete from the settings', () => {
        const custom: StatusDefinition[] = [
            { char: ' ', label: 'Todo', isComplete: false },
            { char: 'x', label: 'Done', isComplete: false },
            { char: 'D', label: 'Done', isComplete: true },
        ];
        expect(completes('- [ ] T', '- [x] T', custom)).toBe(false);
        expect(completes('- [x] T', '- [D] T', custom)).toBe(true);
        expect(completes('- [ ] T', '- [z] T', custom)).toBe(false);
    });

    it('never reads a blank status as complete', () => {
        const blankComplete: StatusDefinition[] = [
            { char: ' ', label: 'Todo', isComplete: true },
            { char: 'x', label: 'Done', isComplete: true },
        ];
        expect(completes('- [ ] T', '- [x] T', blankComplete)).toBe(true);
        expect(completes('- [/] T', '- [ ] T', [...blankComplete, { char: '/', label: 'Doing', isComplete: false }])).toBe(false);
    });
});

describe('isOperation', () => {
    it('is true with no mark', () => {
        expect(isOperation(undefined)).toBe(true);
    });

    it('is true for the marks of typing, pasting, replacing and the rest', () => {
        for (const mark of ['input', 'input.type', 'input.paste', 'input.complete', 'delete.backward',
            'searchReplace', 'move.drop', 'select']) {
            expect(isOperation(mark)).toBe(true);
        }
    });

    it('is false for set, undo and redo, with their sub-marks', () => {
        for (const mark of ['set', 'set.external', 'undo', 'undo.selection', 'redo', 'redo.selection']) {
            expect(isOperation(mark)).toBe(false);
        }
    });

    it('reads a mark only as a whole word before the dot', () => {
        expect(isOperation('setup')).toBe(true);
        expect(isOperation('undone')).toBe(true);
        expect(isOperation('redoing.x')).toBe(true);
    });
});
