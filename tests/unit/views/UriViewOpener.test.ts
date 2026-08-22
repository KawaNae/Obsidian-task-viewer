import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { App } from 'obsidian';

/**
 * `obsidian://task-viewer?...` — what the query turns into before a view opens.
 *
 * The collaborators are stubbed because none of them is the subject: the
 * schema registry needs every view module imported to answer at all, and the
 * template loader reads the vault. What is under test is the routing — which
 * views a URI can name, which of them take a template, and what happens when
 * the named template is not there.
 */

const openLeafFromState = vi.fn(async () => { });
const buildViewStateFromParams = vi.fn(async () => ({ state: {} as Record<string, unknown>, templateNotFound: undefined as string | undefined }));
const resolveViewTypeFromShortName = vi.fn((_: string) => undefined as string | undefined);
const notices: string[] = [];

vi.mock('../../../src/services/viewConfig/LeafOpener', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../src/services/viewConfig/LeafOpener')>();
    return { ...actual, openLeafFromState: (...args: unknown[]) => openLeafFromState(...args as []) };
});
vi.mock('../../../src/services/viewConfig/ViewStateFactory', () => ({
    buildViewStateFromParams: (...args: unknown[]) => buildViewStateFromParams(...args as []),
}));
vi.mock('../../../src/services/viewConfig/SchemaRegistry', () => ({
    resolveViewTypeFromShortName: (name: string) => resolveViewTypeFromShortName(name),
}));
vi.mock('obsidian', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        Notice: class { constructor(msg: string) { notices.push(msg); } },
    };
});

const { openViewFromUri } = await import('../../../src/services/viewConfig/UriViewOpener');

const app = {} as App;
const settings = { viewTemplateFolder: 'Templates' } as never;

beforeEach(() => {
    openLeafFromState.mockClear();
    buildViewStateFromParams.mockClear();
    buildViewStateFromParams.mockResolvedValue({ state: {}, templateNotFound: undefined });
    resolveViewTypeFromShortName.mockReturnValue(undefined);
    notices.length = 0;
});

describe('openViewFromUri', () => {
    it('says nothing and opens nothing for a view name it does not know', async () => {
        await openViewFromUri(app, settings, { view: 'kanbn' });

        // A URI is typed by hand or written into a note; a typo should not
        // raise a dialog.
        expect(openLeafFromState).not.toHaveBeenCalled();
        expect(notices).toEqual([]);
    });

    it('opens a registered view with the state its template produced', async () => {
        resolveViewTypeFromShortName.mockReturnValue('kanban-view');
        buildViewStateFromParams.mockResolvedValue({ state: { startDate: '2026-08-22' }, templateNotFound: undefined });

        await openViewFromUri(app, settings, { view: 'kanban', template: 'Sprint', position: 'tab' });

        expect(openLeafFromState).toHaveBeenCalledWith(
            app, settings, 'kanban-view', 'tab', { startDate: '2026-08-22' },
        );
    });

    it('still opens the view when the named template is missing, and says so', async () => {
        resolveViewTypeFromShortName.mockReturnValue('kanban-view');
        buildViewStateFromParams.mockResolvedValue({ state: {}, templateNotFound: 'Sprint' });

        await openViewFromUri(app, settings, { view: 'kanban', template: 'Sprint' });

        // Mutation: swallow templateNotFound and a misspelled template opens a
        // default view with nothing to say it was not the one asked for.
        expect(notices).toHaveLength(1);
        expect(notices[0]).toContain('Sprint');
        expect(openLeafFromState).toHaveBeenCalledOnce();
    });

    it('drops a position the URI got wrong rather than refusing to open', async () => {
        resolveViewTypeFromShortName.mockReturnValue('kanban-view');

        await openViewFromUri(app, settings, { view: 'kanban', position: 'centre' });

        expect(openLeafFromState.mock.calls[0][3]).toBeUndefined();
    });
});

describe('openViewFromUri: the timer view', () => {
    it('is reachable by short name even though it has no schema', async () => {
        // Mutation: drop the legacy lookup and every timer URI stops working,
        // silently — the registry has never known this name.
        await openViewFromUri(app, settings, { view: 'timer' });

        expect(openLeafFromState).toHaveBeenCalledOnce();
        expect(openLeafFromState.mock.calls[0][2]).toBe('timer-view');
    });

    it('takes its state from the query, not from a template', async () => {
        await openViewFromUri(app, settings, {
            view: 'timer', mode: 'countdown', intervalTemplate: 'pomodoro', name: '朝の集中',
        });

        expect(buildViewStateFromParams).not.toHaveBeenCalled();
        expect(openLeafFromState.mock.calls[0][4]).toEqual({
            timerViewMode: 'countdown', intervalTemplate: 'pomodoro', customName: '朝の集中',
        });
    });

    it('carries only the query fields that were given', async () => {
        await openViewFromUri(app, settings, { view: 'timer', mode: 'stopwatch' });

        expect(openLeafFromState.mock.calls[0][4]).toEqual({ timerViewMode: 'stopwatch' });
    });
});
