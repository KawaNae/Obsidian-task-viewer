import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import realMoment from 'moment';
import {
    processTemplate,
    normalizeTrailingNewline,
    type TemplateContext,
} from '../../../src/utils/NoteTemplateProcessor';
import { registerWeekStartLocales } from '../../../src/utils/momentWeekLocale';

// Replace the obsidian mock's moment stub with the real library so format() returns
// realistic values. This is scoped per-test-file via vi.mock hoisting.
vi.mock('obsidian', async () => {
    const actual = await vi.importActual<typeof import('../mocks/obsidian')>('../mocks/obsidian');
    return { ...actual, moment: realMoment };
});

// processTemplate now routes its anchorMoment through withWeekStartDay, which
// requires the tv-week-N locales to exist on the (real) moment instance.
beforeAll(() => {
    registerWeekStartLocales();
});

const baseCtx = (overrides: Partial<TemplateContext>): TemplateContext => ({
    noteType: 'daily',
    triggerDate: new Date(2026, 4, 13), // 2026-05-13 (Wed)
    filenameFormat: 'YYYY-MM-DD',
    weekStartDay: 0,
    ...overrides,
});

describe('NoteTemplateProcessor', () => {
    describe('{{date}} anchor by noteType', () => {
        it('daily: uses trigger date', () => {
            const out = processTemplate('{{date}}', baseCtx({ noteType: 'daily' }));
            expect(out).toBe('2026-05-13');
        });

        it('weekly: anchors to Sunday when weekStartDay=0', () => {
            const out = processTemplate('{{date}}', baseCtx({ noteType: 'weekly', weekStartDay: 0 }));
            expect(out).toBe('2026-05-10'); // Sunday of the week containing 5/13
        });

        it('weekly: anchors to Monday when weekStartDay=1', () => {
            const out = processTemplate('{{date}}', baseCtx({ noteType: 'weekly', weekStartDay: 1 }));
            expect(out).toBe('2026-05-11'); // Monday of the same week
        });

        it('monthly: anchors to month start', () => {
            const out = processTemplate('{{date}}', baseCtx({ noteType: 'monthly' }));
            expect(out).toBe('2026-05-01');
        });

        it('yearly: anchors to year start', () => {
            const out = processTemplate('{{date}}', baseCtx({ noteType: 'yearly' }));
            expect(out).toBe('2026-01-01');
        });
    });

    describe('{{date:FMT}} format override', () => {
        it('respects custom format', () => {
            const out = processTemplate('{{date:MMM D}}', baseCtx({ noteType: 'weekly', weekStartDay: 1 }));
            expect(out).toBe('May 11');
        });

        it('weekly + ISO week format', () => {
            const out = processTemplate(
                '{{date:gggg-[W]ww}}',
                baseCtx({ noteType: 'weekly', weekStartDay: 1 }),
            );
            expect(out).toBe(realMoment(new Date(2026, 4, 11)).format('gggg-[W]ww'));
        });
    });

    describe('{{time}}', () => {
        beforeEach(() => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 4, 13, 14, 30));
        });
        afterEach(() => vi.useRealTimers());

        it('expands to current HH:mm by default', () => {
            const out = processTemplate('{{time}}', baseCtx({}));
            expect(out).toBe('14:30');
        });

        it('respects format override', () => {
            const out = processTemplate('{{time:HH-mm}}', baseCtx({}));
            expect(out).toBe('14-30');
        });
    });

    describe('{{title}}', () => {
        it('expands using filename format (daily)', () => {
            const out = processTemplate('{{title}}', baseCtx({ filenameFormat: 'YYYY-MM-DD' }));
            expect(out).toBe('2026-05-13');
        });

        it('preserves literal segments in format (regression for the old hardcode bug)', () => {
            const out = processTemplate(
                '{{title}}',
                baseCtx({ filenameFormat: '[Daily ]YYYY-MM-DD' }),
            );
            expect(out).toBe('Daily 2026-05-13');
        });

        it('weekly title uses week anchor', () => {
            const out = processTemplate('{{title}}', baseCtx({
                noteType: 'weekly',
                weekStartDay: 1,
                filenameFormat: 'gggg-[W]ww',
            }));
            expect(out).toBe(realMoment(new Date(2026, 4, 11)).format('gggg-[W]ww'));
        });

        it('monthly title uses month anchor', () => {
            const out = processTemplate('{{title}}', baseCtx({
                noteType: 'monthly',
                filenameFormat: 'YYYY-MM',
            }));
            expect(out).toBe('2026-05');
        });

        it('yearly title uses year anchor', () => {
            const out = processTemplate('{{title}}', baseCtx({
                noteType: 'yearly',
                filenameFormat: 'YYYY',
            }));
            expect(out).toBe('2026');
        });
    });

    describe('combined placeholders', () => {
        it('expands multiple placeholders in one pass', () => {
            const tpl = '# {{title}}\n\nCreated {{date:MMMM D, YYYY}}';
            const out = processTemplate(tpl, baseCtx({
                noteType: 'monthly',
                filenameFormat: 'YYYY-MM',
            }));
            expect(out).toBe('# 2026-05\n\nCreated May 1, 2026');
        });

        it('leaves unknown placeholders untouched', () => {
            const out = processTemplate('{{foo}} {{date}}', baseCtx({}));
            expect(out).toBe('{{foo}} 2026-05-13');
        });
    });
});

describe('normalizeTrailingNewline', () => {
    it('empty string stays empty', () => {
        expect(normalizeTrailingNewline('')).toBe('');
    });

    it('content ending with newline is unchanged', () => {
        expect(normalizeTrailingNewline('hello\n')).toBe('hello\n');
    });

    it('content without trailing newline gets one appended', () => {
        expect(normalizeTrailingNewline('hello')).toBe('hello\n');
    });
});
