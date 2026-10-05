import type { App, HoverParent } from 'obsidian';
import type { PluginContext } from '../../PluginContext';
import { periodicNotes } from '../../utils/PeriodicNotes';
import { periodicNoteLink } from './PeriodicNoteLink';
import { DateUtils } from '../../utils/DateUtils';
import { withWeekStartDay } from '../../utils/momentWeekLocale';
import { t } from '../../i18n';
import type { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';

interface PeriodicHeaderRendererDeps {
    app: App;
    plugin: PluginContext;
    hoverParent: HoverParent;
    linkInteractionManager: TaskLinkInteractionManager;
}

export interface PeriodicHeaderRenderParams {
    dates: string[];
    gridTemplateColumns: string;
}

interface Segment {
    key: string;
    startIdx: number;
    span: number;
    anchorDate: string;
    isCurrent: boolean;
}

export class PeriodicHeaderRenderer {
    constructor(private deps: PeriodicHeaderRendererDeps) {}

    render(parent: HTMLElement, params: PeriodicHeaderRenderParams): HTMLElement | null {
        if (!this.deps.plugin.settings.showWeekRow) return null;

        const { dates, gridTemplateColumns } = params;
        const todayVisualDate = DateUtils.getVisualDateOfNow(this.deps.plugin.settings.startHour);
        const weekStartDay = this.deps.plugin.settings.weekStartDay;
        const todayVisualWeekKey = DateUtils.getVisualWeekKey(
            DateUtils.parseDate(todayVisualDate),
            weekStartDay,
        );

        const container = parent.createDiv('periodic-header');

        const row = container.createDiv('tv-grid-row periodic-header__row periodic-header__row--week');
        row.style.gridTemplateColumns = gridTemplateColumns;
        row.createDiv('periodic-header__axis');

        const segments = this.computeWeekSegments(dates, weekStartDay, todayVisualWeekKey);
        for (const seg of segments) {
            this.appendWeekSegment(row, seg);
        }

        return container;
    }

    private appendWeekSegment(row: HTMLElement, seg: Segment): void {
        const segEl = row.createDiv('periodic-header__segment periodic-header__segment--week');
        segEl.style.gridColumn = `${seg.startIdx + 2} / span ${seg.span}`;
        if (seg.isCurrent) segEl.addClass('is-current');

        const dateObj = DateUtils.parseDate(seg.anchorDate);
        const m = withWeekStartDay(dateObj, this.deps.plugin.settings.weekStartDay);

        const { app, plugin, linkInteractionManager, hoverParent } = this.deps;
        periodicNoteLink(segEl, { app, notes: plugin.getOperations(), links: linkInteractionManager, hoverParent },
            periodicNotes(plugin.settings, 'weekly'), seg.anchorDate, {
                cls: 'periodic-header__link periodic-header__link--week',
                text: m.format('[W]ww'),
                ariaLabel: t('aria.openWeeklyNote', { label: m.format('gggg-[W]ww') }),
            });
    }

    private computeWeekSegments(
        dates: string[],
        weekStartDay: 0 | 1,
        todayVisualWeekKey: string,
    ): Segment[] {
        const segments: Segment[] = [];
        let current: Segment | null = null;
        for (let i = 0; i < dates.length; i++) {
            const dateObj = DateUtils.parseDate(dates[i]);
            const k = DateUtils.getVisualWeekKey(dateObj, weekStartDay);
            if (current && current.key === k) {
                current.span++;
            } else {
                if (current) segments.push(current);
                current = {
                    key: k,
                    startIdx: i,
                    span: 1,
                    anchorDate: k,
                    isCurrent: k === todayVisualWeekKey,
                };
            }
        }
        if (current) segments.push(current);
        return segments;
    }
}
