import { describe, it, expect, vi } from 'vitest';
import type { App } from 'obsidian';
import {
    openLeafFromState, parseLeafPosition, defaultPositionFor,
} from '../../../src/services/viewConfig/LeafOpener';
import { DEFAULT_SETTINGS } from '../../../src/types';
import type { TaskViewerSettings } from '../../../src/types';

/**
 * Which leaf a view opens in.
 *
 * Three branches, and they differ in what a *second* open means — an explicit
 * position always builds that position, `override` re-aims the pane the view
 * is already in, and saying nothing gives the configured home first and a new
 * tab thereafter. The rules had never been exercised anywhere: they lived in
 * `main.ts`, reachable only by driving a real workspace.
 */

const settings = {
    ...DEFAULT_SETTINGS,
    defaultViewPositions: {
        timeline: 'tab', schedule: 'right', calendar: 'tab',
        miniCalendar: 'left', timer: 'right', kanban: 'tab',
    },
} as TaskViewerSettings;

function makeWorkspace(existing: unknown[] = []) {
    const made: string[] = [];
    const leaf = (tag: string) => {
        made.push(tag);
        return { setViewState: vi.fn(async () => { }) };
    };
    const workspace = {
        getLeavesOfType: vi.fn(() => existing),
        getLeftLeaf: vi.fn(() => leaf('left')),
        getRightLeaf: vi.fn(() => leaf('right')),
        getLeaf: vi.fn((arg: unknown) => leaf(arg === true ? 'new-tab' : String(arg))),
        revealLeaf: vi.fn(),
    };
    return { app: { workspace } as unknown as App, workspace, made };
}

describe('parseLeafPosition', () => {
    it('accepts the five positions a URI may name', () => {
        for (const p of ['left', 'right', 'tab', 'window', 'override']) {
            expect(parseLeafPosition(p)).toBe(p);
        }
    });

    it('rejects anything else, including the empty string', () => {
        // Mutation: drop the membership check and a typo'd URI reaches
        // openLeafFromState as a position no branch knows how to build.
        expect(parseLeafPosition('centre')).toBeUndefined();
        expect(parseLeafPosition('')).toBeUndefined();
        expect(parseLeafPosition(undefined)).toBeUndefined();
    });
});

describe('defaultPositionFor', () => {
    it('reads each view its own configured home', () => {
        expect(defaultPositionFor(settings, 'timeline-view')).toBe('tab');
        expect(defaultPositionFor(settings, 'mini-calendar-view')).toBe('left');
        expect(defaultPositionFor(settings, 'timer-view')).toBe('right');
    });

    it('puts a view with no configured home on the right', () => {
        // The log view is the one outside the registry.
        expect(defaultPositionFor(settings, 'task-viewer-log-view')).toBe('right');
    });
});

describe('openLeafFromState: an explicit position', () => {
    it('builds the leaf that position names, existing leaves notwithstanding', async () => {
        const { app, workspace, made } = makeWorkspace([{ existing: true }]);

        await openLeafFromState(app, settings, 'timeline-view', 'window', {});

        expect(made).toEqual(['window']);
        expect(workspace.getLeaf).toHaveBeenCalledWith('window');
    });

    it('seeds the leaf with the state and reveals it', async () => {
        const { app, workspace } = makeWorkspace();

        await openLeafFromState(app, settings, 'kanban-view', 'tab', { startDate: '2026-08-22' });

        const leaf = workspace.getLeaf.mock.results[0].value;
        expect(leaf.setViewState).toHaveBeenCalledWith({
            type: 'kanban-view', active: true, state: { startDate: '2026-08-22' },
        });
        expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
    });
});

describe('openLeafFromState: override', () => {
    it('re-aims the pane the view is already in', async () => {
        const existing = { setViewState: vi.fn(async () => { }) };
        const { app, workspace, made } = makeWorkspace([existing]);

        await openLeafFromState(app, settings, 'timeline-view', 'override', { day: 1 });

        // Mutation: treat override like a plain position and each URI fires a
        // new pane instead of re-aiming the one already open.
        expect(made).toEqual([]);
        expect(existing.setViewState).toHaveBeenCalledOnce();
        expect(workspace.revealLeaf).toHaveBeenCalledWith(existing);
    });

    it('falls back to the configured home when the view is not open', async () => {
        const { app, made } = makeWorkspace([]);

        await openLeafFromState(app, settings, 'mini-calendar-view', 'override', {});

        expect(made).toEqual(['left']);
    });
});

describe('openLeafFromState: no position given', () => {
    it('sends the first open to the view configured home', async () => {
        const { app, made } = makeWorkspace([]);

        await openLeafFromState(app, settings, 'schedule-view', undefined, {});

        // Mutation: always take the home branch and every ribbon click after
        // the first re-uses one pane instead of opening a second.
        expect(made).toEqual(['right']);
    });

    it('gives every open after the first a new tab', async () => {
        const { app, workspace, made } = makeWorkspace([{ existing: true }]);

        await openLeafFromState(app, settings, 'schedule-view', undefined, {});

        expect(made).toEqual(['new-tab']);
        expect(workspace.getLeaf).toHaveBeenCalledWith(true);
    });
});

describe('openLeafFromState: no leaf to be had', () => {
    it('does nothing rather than throwing', async () => {
        const workspace = {
            getLeavesOfType: vi.fn(() => []),
            getLeftLeaf: vi.fn(() => null),
            getRightLeaf: vi.fn(() => null),
            getLeaf: vi.fn(() => null),
            revealLeaf: vi.fn(),
        };
        const app = { workspace } as unknown as App;

        await openLeafFromState(app, settings, 'timeline-view', 'left', {});

        expect(workspace.revealLeaf).not.toHaveBeenCalled();
    });
});
