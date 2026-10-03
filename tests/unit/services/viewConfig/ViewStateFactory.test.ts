import { describe, it, expect, vi } from 'vitest';
import type { App } from 'obsidian';
import { buildViewStateFromParams } from '../../../../src/services/viewConfig/ViewStateFactory';

/** An app whose template folder does not exist; records whether it was looked in. */
function appWithoutTemplates() {
    const getAbstractFileByPath = vi.fn(() => null);
    return { app: { vault: { getAbstractFileByPath } } as unknown as App, getAbstractFileByPath };
}

describe('buildViewStateFromParams', () => {
    it('reads the timer view state from the query through its schema', async () => {
        const { app } = appWithoutTemplates();

        const result = await buildViewStateFromParams(app, 'Templates', 'timer-view', {
            view: 'timer', timerViewMode: 'interval', intervalTemplate: '朝', name: '集中',
        });

        expect(result.state).toEqual({ timerViewMode: 'interval', intervalTemplate: '朝', customName: '集中' });
        expect(result.templateNotFound).toBeUndefined();
    });

    it('reads the older `mode=` of a timer URI', async () => {
        const { app } = appWithoutTemplates();

        const result = await buildViewStateFromParams(app, 'Templates', 'timer-view', { mode: 'countdown' });

        expect(result.state).toEqual({ timerViewMode: 'countdown' });
    });

    it('reads no template for a view that keeps none', async () => {
        const { app, getAbstractFileByPath } = appWithoutTemplates();

        const result = await buildViewStateFromParams(app, 'Templates', 'timer-view', { template: 'Sprint' });

        expect(getAbstractFileByPath).not.toHaveBeenCalled();
        expect(result.templateNotFound).toBeUndefined();
    });

    it('says a missing template is missing for a view that keeps them', async () => {
        const { app } = appWithoutTemplates();

        const result = await buildViewStateFromParams(app, 'Templates', 'kanban-view', { template: 'Sprint' });

        expect(result.templateNotFound).toBe('Sprint');
    });
});
