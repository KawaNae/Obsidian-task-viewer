import { describe, it, expect } from 'vitest';
import {
    collectFlowLineIndices,
    flowLineTail,
    formatFlowLine,
    isFlowLine,
    matchFlowLine,
} from '../../../src/services/flow/FlowLineScanner';

describe('FlowLineScanner', () => {
    describe('flowLineTail / isFlowLine', () => {
        it('matches the canonical form', () => {
            expect(flowLineTail('- ==> every mon')).toBe('every mon');
            expect(flowLineTail('\t- ==> setDue(start + 3d)')).toBe('setDue(start + 3d)');
        });

        it('accepts all list bullets', () => {
            expect(flowLineTail('* ==> every mon')).toBe('every mon');
            expect(flowLineTail('+ ==> every mon')).toBe('every mon');
            expect(flowLineTail('1. ==> every mon')).toBe('every mon');
            expect(flowLineTail('2) ==> every mon')).toBe('every mon');
        });

        it('trims the tail', () => {
            expect(flowLineTail('- ==>   every mon  ')).toBe('every mon');
        });

        it('rejects non-flow lines', () => {
            expect(flowLineTail('- plain note')).toBeNull();
            expect(flowLineTail('- [ ] task ==> every mon')).toBeNull(); // checkbox line, not a flow child line
            expect(flowLineTail('prose with ==> inside')).toBeNull();
            expect(isFlowLine('- key:: value')).toBe(false);
        });
    });

    describe('matchFlowLine', () => {
        it('reports the untrimmed tail and its column offset', () => {
            const m = matchFlowLine('\t- ==>  every mon');
            expect(m).not.toBeNull();
            expect(m!.indent).toBe('\t');
            expect(m!.tail).toBe(' every mon');
            expect('\t- ==>  every mon'.slice(m!.tailStart)).toBe(m!.tail);
        });
    });

    describe('collectFlowLineIndices', () => {
        it('collects direct flow children (tab indent)', () => {
            const lines = [
                '- [ ] task ==> every mon',
                '\t- ==> setDue(start + 3d)',
                '\t- ==> x3',
                '\t- plain note',
            ];
            expect(collectFlowLineIndices(lines, 0)).toEqual([1, 2]);
        });

        it('collects direct flow children (4-space indent)', () => {
            const lines = [
                '- [ ] task',
                '    - ==> every mon',
            ];
            expect(collectFlowLineIndices(lines, 0)).toEqual([1]);
        });

        it('does not steal flow lines owned by a child checkbox', () => {
            const lines = [
                '- [ ] parent ==> every mon',
                '\t- [ ] child @2026-07-10',
                '\t\t- ==> x3',
                '\t- ==> nochildren',
            ];
            // Line 2 belongs to the child checkbox; line 3 is back at direct level.
            expect(collectFlowLineIndices(lines, 0)).toEqual([3]);
            expect(collectFlowLineIndices(lines, 1)).toEqual([2]);
        });

        it('does not steal flow lines nested under a plain note bullet', () => {
            const lines = [
                '- [ ] task ==> every mon',
                '\t- memo',
                '\t\t- ==> x3',
            ];
            expect(collectFlowLineIndices(lines, 0)).toEqual([]);
        });

        it('stops at a blank line (end of child block)', () => {
            const lines = [
                '- [ ] task',
                '\t- ==> every mon',
                '',
                '\t- ==> x3',
            ];
            expect(collectFlowLineIndices(lines, 0)).toEqual([1]);
        });

        it('stops at a sibling (indent <= task line)', () => {
            const lines = [
                '- [ ] task ==> every mon',
                '- [ ] sibling',
                '\t- ==> x3',
            ];
            expect(collectFlowLineIndices(lines, 0)).toEqual([]);
            expect(collectFlowLineIndices(lines, 1)).toEqual([2]);
        });

        it('works for an indented task line', () => {
            const lines = [
                '- [ ] outer',
                '\t- [ ] inner',
                '\t\t- ==> every mon',
            ];
            expect(collectFlowLineIndices(lines, 1)).toEqual([2]);
        });
    });

    describe('formatFlowLine', () => {
        it('emits the canonical physical form', () => {
            expect(formatFlowLine('\t', 'every mon x2')).toBe('\t- ==> every mon x2');
        });
    });
});
