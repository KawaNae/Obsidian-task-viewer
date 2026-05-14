import { describe, it, expect, vi, beforeAll } from 'vitest';
import realMoment from 'moment';
import { registerWeekStartLocales, withWeekStartDay } from '../../../src/utils/momentWeekLocale';

vi.mock('obsidian', async () => {
    const actual = await vi.importActual<typeof import('../mocks/obsidian')>('../mocks/obsidian');
    return { ...actual, moment: realMoment };
});

describe('momentWeekLocale', () => {
    // Capture the locale Vitest's moment defaults to (typically 'en') so we can
    // assert it is preserved across registration.
    const initialLocale = realMoment.locale();

    beforeAll(() => {
        registerWeekStartLocales();
    });

    describe('registerWeekStartLocales', () => {
        it('registers both tv-week-0 and tv-week-1', () => {
            const locales = realMoment.locales();
            expect(locales).toContain('tv-week-0');
            expect(locales).toContain('tv-week-1');
        });

        it('restores the global locale to the previous value', () => {
            expect(realMoment.locale()).toBe(initialLocale);
        });

        it('is idempotent — repeat calls do not re-register or warn', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            registerWeekStartLocales();
            registerWeekStartLocales();
            // moment emits a deprecation warning via console.warn when defineLocale
            // is called for an existing locale name; we should never see that.
            const deprecationCalls = warnSpy.mock.calls.filter(args =>
                args.some(a => typeof a === 'string' && a.includes('use moment.updateLocale'))
            );
            expect(deprecationCalls).toHaveLength(0);
            warnSpy.mockRestore();
        });
    });

    describe('withWeekStartDay — week() value', () => {
        it('Sunday 2026-04-19 + weekStartDay=0 → week 17 (Sunday-start)', () => {
            expect(withWeekStartDay(new Date(2026, 3, 19), 0).week()).toBe(17);
        });

        it('Sunday 2026-04-19 + weekStartDay=1 → week 16 (Monday-start, ISO)', () => {
            expect(withWeekStartDay(new Date(2026, 3, 19), 1).week()).toBe(16);
        });

        it('Monday 2026-04-20 + weekStartDay=1 → week 17', () => {
            expect(withWeekStartDay(new Date(2026, 3, 20), 1).week()).toBe(17);
        });

        it('Monday 2026-04-20 + weekStartDay=0 → week 17 (locale wk containing this Mon)', () => {
            expect(withWeekStartDay(new Date(2026, 3, 20), 0).week()).toBe(17);
        });
    });

    describe('withWeekStartDay — format() output', () => {
        it('formats gggg-[W]ww differently across the two locales', () => {
            const sun = new Date(2026, 3, 19);
            expect(withWeekStartDay(sun, 0).format('gggg-[W]ww')).toBe('2026-W17');
            expect(withWeekStartDay(sun, 1).format('gggg-[W]ww')).toBe('2026-W16');
        });

        it('year boundary: Sunday 2025-12-28', () => {
            const d = new Date(2025, 11, 28);
            expect(withWeekStartDay(d, 0).format('gggg-[W]ww')).toBe('2026-W01');
            expect(withWeekStartDay(d, 1).format('gggg-[W]ww')).toBe('2025-W52');
        });

        it('non-week tokens are identical across the two locales', () => {
            const d = new Date(2026, 3, 19, 14, 30);
            expect(withWeekStartDay(d, 0).format('YYYY-MM-DD HH:mm')).toBe('2026-04-19 14:30');
            expect(withWeekStartDay(d, 1).format('YYYY-MM-DD HH:mm')).toBe('2026-04-19 14:30');
        });
    });

    describe('withWeekStartDay — no global locale leak', () => {
        it('global locale is unchanged after per-instance switches', () => {
            withWeekStartDay(new Date(2026, 3, 19), 0).format('gggg-[W]ww');
            withWeekStartDay(new Date(2026, 3, 19), 1).format('gggg-[W]ww');
            expect(realMoment.locale()).toBe(initialLocale);
        });
    });
});
