import { describe, expect, it } from 'vitest';
import { parseTemplateGroups } from '../../../src/timer/IntervalTemplateLoader';

/**
 * テンプレートの JSON から区間を読む。種類は work、break、prepare のどれかで、
 * それ以外は work。ラベルが無いか長さが正でない区間は読まず、区間の残らない
 * グループは落とす。
 */

describe('parseTemplateGroups', () => {
    it('reads prepare as prepare, alongside work and break', () => {
        const groups = parseTemplateGroups([{
            repeatCount: 2,
            segments: [
                { label: 'Get ready', durationSeconds: 10, type: 'prepare' },
                { label: 'Deep Work', durationSeconds: 1500, type: 'work' },
                { label: 'Rest', durationSeconds: 300, type: 'Break' },
            ],
        }]);
        expect(groups).toEqual([{
            repeatCount: 2,
            segments: [
                { label: 'Get ready', durationSeconds: 10, type: 'prepare' },
                { label: 'Deep Work', durationSeconds: 1500, type: 'work' },
                { label: 'Rest', durationSeconds: 300, type: 'break' },
            ],
        }]);
    });

    it('reads an unknown or missing type as work', () => {
        const [group] = parseTemplateGroups([{
            segments: [
                { label: 'A', durationSeconds: 60, type: 'sprint' },
                { label: 'B', durationSeconds: 60 },
            ],
        }]);
        expect(group.segments.map((s) => s.type)).toEqual(['work', 'work']);
        expect(group.repeatCount).toBe(1);
    });

    it('skips a segment without a label or a positive length, and a group left empty', () => {
        expect(parseTemplateGroups([
            { segments: [{ label: '', durationSeconds: 60 }, { label: 'X', durationSeconds: 0 }] },
            { segments: [{ label: 'Y', durationSeconds: 5 }] },
        ])).toEqual([{ repeatCount: 1, segments: [{ label: 'Y', durationSeconds: 5, type: 'work' }] }]);
    });

    it('reads nothing from what is not a list', () => {
        expect(parseTemplateGroups(undefined)).toEqual([]);
        expect(parseTemplateGroups({})).toEqual([]);
    });
});
