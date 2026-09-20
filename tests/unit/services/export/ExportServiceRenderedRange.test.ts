import { describe, it, expect } from 'vitest';
import { getExportedDateRange } from '../../../../src/services/export/ExportService';
import type { View } from 'obsidian';

function fakeView(overrides: Record<string, unknown> = {}): View {
    return overrides as unknown as View;
}

describe('getExportedDateRange', () => {
    it('calls the view\'s getExportedDateRange() and returns its result', () => {
        const range = { anchor: '2026-01-01', from: '2026-01-01', to: '2026-01-05' };
        const view = fakeView({ getExportedDateRange: () => range });
        expect(getExportedDateRange(view)).toEqual(range);
    });

    it('returns null when the view has no getExportedDateRange (e.g. Kanban)', () => {
        const view = fakeView({});
        expect(getExportedDateRange(view)).toBeNull();
    });

    it('returns null when the view reports it has no range (e.g. Schedule before its first date is set)', () => {
        const view = fakeView({ getExportedDateRange: () => null });
        expect(getExportedDateRange(view)).toBeNull();
    });

    it('ignores a same-named property that is not a function', () => {
        const view = fakeView({ getExportedDateRange: 'not-a-function' });
        expect(getExportedDateRange(view)).toBeNull();
    });

    it('calls the getter bound to the view instance (reads instance state via `this`)', () => {
        class FakeTimelineView {
            startDate = '2026-03-01';
            getExportedDateRange() {
                return { anchor: this.startDate, from: this.startDate, to: this.startDate };
            }
        }
        const view = new FakeTimelineView() as unknown as View;
        expect(getExportedDateRange(view)).toEqual({
            anchor: '2026-03-01', from: '2026-03-01', to: '2026-03-01',
        });
    });
});
