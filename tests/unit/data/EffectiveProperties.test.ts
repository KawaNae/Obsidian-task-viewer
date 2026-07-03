import { describe, it, expect } from 'vitest';
import {
    getEffectiveColor, getEffectiveLinestyle, getEffectiveMask,
    getEffectiveTags, getEffectiveProperties,
} from '../../../src/services/data/EffectiveProperties';
import { makeTask } from '../helpers/makeTask';

describe('EffectiveProperties', () => {
    describe('style (color / linestyle / mask): own ?? cascade', () => {
        it('raw が無ければ cascade にフォールバック', () => {
            const t = makeTask({ cascadeContext: { color: 'ff0000', linestyle: 'dashed', mask: '***' } });
            expect(getEffectiveColor(t)).toBe('ff0000');
            expect(getEffectiveLinestyle(t)).toBe('dashed');
            expect(getEffectiveMask(t)).toBe('***');
        });

        it('raw があれば cascade を隠す', () => {
            const t = makeTask({
                color: '00ff00',
                cascadeContext: { color: 'ff0000' },
            });
            expect(getEffectiveColor(t)).toBe('00ff00');
        });

        it('両方無ければ undefined', () => {
            const t = makeTask({});
            expect(getEffectiveColor(t)).toBeUndefined();
            expect(getEffectiveLinestyle(t)).toBeUndefined();
            expect(getEffectiveMask(t)).toBeUndefined();
        });
    });

    describe('tags: union（sorted / deduped）', () => {
        it('cascade と raw の union', () => {
            const t = makeTask({
                tags: ['own'],
                cascadeContext: { tags: ['section', 'shared'] },
            });
            expect(getEffectiveTags(t)).toEqual(['own', 'section', 'shared']);
        });

        it('重複は dedup される', () => {
            const t = makeTask({
                tags: ['shared'],
                cascadeContext: { tags: ['shared'] },
            });
            expect(getEffectiveTags(t)).toEqual(['shared']);
        });

        it('cascade が無ければ raw 配列をそのまま返す（新規割当なし）', () => {
            const t = makeTask({ tags: ['a', 'b'] });
            expect(getEffectiveTags(t)).toBe(t.tags);
        });
    });

    describe('properties: キー単位 child-wins', () => {
        it('cascade を raw が上書きし、非衝突キーは合流する', () => {
            const t = makeTask({
                properties: { priority: { value: '5', type: 'number' } },
                cascadeContext: {
                    properties: {
                        priority: { value: '1', type: 'number' },
                        category: { value: 'work', type: 'string' },
                    },
                },
            });
            const props = getEffectiveProperties(t);
            expect(props['priority']).toEqual({ value: '5', type: 'number' });
            expect(props['category']).toEqual({ value: 'work', type: 'string' });
        });

        it('cascade が無ければ raw オブジェクトをそのまま返す（新規割当なし）', () => {
            const t = makeTask({ properties: { note: { value: 'x', type: 'string' } } });
            expect(getEffectiveProperties(t)).toBe(t.properties);
        });
    });
});
