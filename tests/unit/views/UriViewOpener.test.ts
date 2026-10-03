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
const buildViewStateFromParams = vi.fn(async () => ({ state: {} as Record<string, unknown>, templateNotFound: undefined as string | undefined, issues: [] as { field: string; text: string }[] }));
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
    buildViewStateFromParams.mockResolvedValue({ state: {}, templateNotFound: undefined, issues: [] });
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
        buildViewStateFromParams.mockResolvedValue({ state: { startDate: '2026-08-22' }, templateNotFound: undefined, issues: [] });

        await openViewFromUri(app, settings, { view: 'kanban', template: 'Sprint', position: 'tab' });

        expect(openLeafFromState).toHaveBeenCalledWith(
            app, settings, 'kanban-view', 'tab', { startDate: '2026-08-22' },
        );
    });

    it('still opens the view when the named template is missing, and says so', async () => {
        resolveViewTypeFromShortName.mockReturnValue('kanban-view');
        buildViewStateFromParams.mockResolvedValue({ state: {}, templateNotFound: 'Sprint', issues: [] });

        await openViewFromUri(app, settings, { view: 'kanban', template: 'Sprint' });

        // Mutation: swallow templateNotFound and a misspelled template opens a
        // default view with nothing to say it was not the one asked for.
        expect(notices).toHaveLength(1);
        expect(notices[0]).toContain('Sprint');
        expect(openLeafFromState).toHaveBeenCalledOnce();
    });

    it('opens the view without the conditions it could not read, and says how many', async () => {
        resolveViewTypeFromShortName.mockReturnValue('kanban-view');
        buildViewStateFromParams.mockResolvedValue({
            state: {}, templateNotFound: undefined,
            issues: [{ field: 'filterState', text: 'filters[0]: Unknown filter property: tagg' }, { field: 'grid', text: 'list "A" sort rules[0]: x' }],
        });

        await openViewFromUri(app, settings, { view: 'kanban', template: 'Sprint' });

        expect(notices).toHaveLength(1);
        expect(notices[0]).toContain('2');
        expect(openLeafFromState).toHaveBeenCalledOnce();
    });

    it('drops a position the URI got wrong rather than refusing to open', async () => {
        resolveViewTypeFromShortName.mockReturnValue('kanban-view');

        await openViewFromUri(app, settings, { view: 'kanban', position: 'centre' });

        expect(openLeafFromState.mock.calls[0][3]).toBeUndefined();
    });
});

describe('openViewFromUri: the timer view', () => {
    // The timer view takes the same road as every other view: its state is
    // what buildViewStateFromParams reads from the query through its schema.
    beforeEach(() => {
        resolveViewTypeFromShortName.mockImplementation(
            (name: string) => (name === 'timer' ? 'timer-view' : undefined),
        );
    });

    it('is reachable by its short name', async () => {
        await openViewFromUri(app, settings, { view: 'timer' });

        expect(openLeafFromState).toHaveBeenCalledOnce();
        expect(openLeafFromState.mock.calls[0][2]).toBe('timer-view');
    });

    it('reads its state from the query through the schema, as the other views do', async () => {
        buildViewStateFromParams.mockResolvedValue({
            state: { timerViewMode: 'countdown' }, templateNotFound: undefined, issues: [],
        });
        const params = { view: 'timer', mode: 'countdown', name: '朝の集中' };

        await openViewFromUri(app, settings, params);

        expect(buildViewStateFromParams).toHaveBeenCalledWith(app, 'Templates', 'timer-view', params);
        expect(openLeafFromState.mock.calls[0][4]).toEqual({ timerViewMode: 'countdown' });
    });
});
