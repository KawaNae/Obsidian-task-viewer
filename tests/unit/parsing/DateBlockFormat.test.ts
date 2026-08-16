import { describe, it, expect } from 'vitest';
import { formatDateBlock } from '../../../src/services/parsing/tv-inline/DateBlockFormat';
import { TaskParser } from '../../../src/services/parsing/TaskParser';
import { makeTask } from '../helpers/makeTask';

/**
 * The `@` block, written once and read by two.
 *
 * The line formatter puts it in the line and the `dates` built-in hands the
 * same string to a generation block. These pin the shapes; the last one pins
 * that the two readers really are one implementation, which is the whole
 * reason the function exists.
 */

describe('formatDateBlock', () => {
    it('writes a start, with its time when there is one', () => {
        expect(formatDateBlock({ startDate: '2026-08-19' })).toBe('@2026-08-19');
        expect(formatDateBlock({ startDate: '2026-08-19', startTime: '09:00' }))
            .toBe('@2026-08-19T09:00');
    });

    it('writes a bare time when there is no date to put it on', () => {
        expect(formatDateBlock({ startTime: '09:00' })).toBe('@09:00');
    });

    it('writes an end that falls on another day in full', () => {
        expect(formatDateBlock({ startDate: '2026-08-19', endDate: '2026-08-23' }))
            .toBe('@2026-08-19>2026-08-23');
    });

    it('writes an end on the same day as a time', () => {
        // 同日の終わりは記法の既定なので、時刻を持つときだけ書かれる。
        expect(formatDateBlock({ startDate: '2026-08-19', endDate: '2026-08-19' }))
            .toBe('@2026-08-19');
        expect(formatDateBlock({ startDate: '2026-08-19', endDate: '2026-08-19', endTime: '10:30' }))
            .toBe('@2026-08-19>10:30');
    });

    it('keeps the due in its own position when there is no end', () => {
        expect(formatDateBlock({ startDate: '2026-08-19', due: '2026-08-25' }))
            .toBe('@2026-08-19>>2026-08-25');
        expect(formatDateBlock({ due: '2026-08-25' })).toBe('@>>2026-08-25');
    });

    it('writes all three when the task has all three', () => {
        expect(formatDateBlock({ startDate: '2026-08-19', endDate: '2026-08-23', due: '2026-08-25' }))
            .toBe('@2026-08-19>2026-08-23>2026-08-25');
    });

    it('writes nothing for a task with no dates', () => {
        expect(formatDateBlock({})).toBe('');
    });

    it('is the block the line formatter writes', () => {
        // 二重実装にしないことが要件そのもの。片方だけ変えたらここで落ちる。
        const cases = [
            { startDate: '2026-08-19' },
            { startDate: '2026-08-19', startTime: '09:00', endTime: '10:30' },
            { startDate: '2026-08-19', endDate: '2026-08-23', due: '2026-08-25' },
            { due: '2026-08-25' },
            {},
        ];
        for (const dates of cases) {
            const task = makeTask({ content: '週報', originalText: '- [ ] 週報', ...dates });
            const block = formatDateBlock(task);
            expect(TaskParser.format(task)).toBe(`- [ ] 週報${block ? ` ${block}` : ''}`);
        }
    });
});
