import { describe, it, expect } from 'vitest';
import { CompletionDetector } from '../../../../src/services/core/CompletionDetector';
import { FileParsePipeline } from '../../../../src/services/parsing/FileParsePipeline';
import { DEFAULT_SETTINGS, type Task } from '../../../../src/types';

/**
 * Rows with one signature cannot say which of them is the new completion. A
 * flow's own write can put a completed row with the same words beside the
 * user's (a generated child, a move that carries the row): it may not ride on
 * the user's completion to fire as well (F6).
 */

const FILE = 'note.md';
const parse = (lines: string[]): Task[] => FileParsePipeline.parse(FILE, lines, DEFAULT_SETTINGS).tasks;
const opts = (mayFire: (task: Task) => boolean) => ({
    mayFire, isInitializing: false, statusDefinitions: DEFAULT_SETTINGS.statusDefinitions,
});

describe('CompletionDetector: rows that share a signature', () => {
    const OPEN = ['- [ ] 甲 ==> every 1d', '- [ ] 乙'];
    const TWO_DONE = ['- [x] 甲 ==> every 1d', '- [x] 甲 ==> every 1d', '- [ ] 乙'];

    it('fire no more often than the rows that may fire', () => {
        const detector = new CompletionDetector();
        detector.detect(FILE, parse(OPEN), opts(() => true));
        const tasks = parse(TWO_DONE);
        const fired = detector.detect(FILE, tasks, opts(task => task.line === 0));
        expect(fired.map(task => task.line)).toEqual([0]);
    });

    it('fire the row that may, not the first of the signature', () => {
        const detector = new CompletionDetector();
        detector.detect(FILE, parse(OPEN), opts(() => true));
        const fired = detector.detect(FILE, parse(TWO_DONE), opts(task => task.line === 1));
        expect(fired.map(task => task.line)).toEqual([1]);
    });

    it('fire each new completion when every row may', () => {
        const detector = new CompletionDetector();
        detector.detect(FILE, parse(OPEN), opts(() => true));
        expect(detector.detect(FILE, parse(TWO_DONE), opts(() => true))).toHaveLength(2);
    });

    it('fire nothing on the first scan of a file, or while the vault is being read', () => {
        const detector = new CompletionDetector();
        expect(detector.detect(FILE, parse(TWO_DONE), opts(() => true))).toHaveLength(0);
        const starting = new CompletionDetector();
        starting.detect(FILE, parse(OPEN), opts(() => true));
        expect(starting.detect(FILE, parse(TWO_DONE), { ...opts(() => true), isInitializing: true })).toHaveLength(0);
    });
});
