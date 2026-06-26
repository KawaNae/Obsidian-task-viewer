import { TFile, moment } from 'obsidian';
import type { App, HoverParent } from 'obsidian';
import TaskViewerPlugin from '../../main';
import { DailyNoteUtils } from '../../utils/DailyNoteUtils';
import { DateUtils } from '../../utils/DateUtils';
import { withWeekStartDay } from '../../utils/momentWeekLocale';
import { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../../constants/hover';

interface PeriodicHeaderRendererDeps {
    app: App;
    plugin: TaskViewerPlugin;
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
            this.parseLocalDate(todayVisualDate),
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

        this.deps.linkInteractionManager.bind(container, {
            sourcePath: '',
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            hoverParent: this.deps.hoverParent,
        }, { bindClick: false });

        return container;
    }

    private appendWeekSegment(row: HTMLElement, seg: Segment): void {
        const segEl = row.createDiv('periodic-header__segment periodic-header__segment--week');
        segEl.style.gridColumn = `${seg.startIdx + 2} / span ${seg.span}`;
        if (seg.isCurrent) segEl.addClass('is-current');

        const dateObj = this.parseLocalDate(seg.anchorDate);
        const m = withWeekStartDay(dateObj, this.deps.plugin.settings.weekStartDay);

        const link = segEl.createEl('a', {
            cls: 'internal-link periodic-header__link periodic-header__link--week',
            text: m.format('[W]ww'),
        });
        const target = DailyNoteUtils.getWeeklyNoteLinkTarget(this.deps.plugin.settings, dateObj);
        link.dataset.href = target;
        link.setAttribute('href', target);
        link.setAttribute('aria-label', `Open weekly note: ${m.format('gggg-[W]ww')}`);
        link.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            void this.openOrCreateWeeklyNote(dateObj);
        });
    }

    private async openOrCreateWeeklyNote(date: Date): Promise<void> {
        const { app, plugin } = this.deps;
        let file: TFile | null = DailyNoteUtils.getWeeklyNote(app, plugin.settings, date);
        if (!file) file = await DailyNoteUtils.createWeeklyNote(app, plugin.settings, date);
        if (file) await app.workspace.getLeaf(false).openFile(file);
    }

    private computeWeekSegments(
        dates: string[],
        weekStartDay: 0 | 1,
        todayVisualWeekKey: string,
    ): Segment[] {
        const segments: Segment[] = [];
        let current: Segment | null = null;
        for (let i = 0; i < dates.length; i++) {
            const dateObj = this.parseLocalDate(dates[i]);
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

    private parseLocalDate(date: string): Date {
        const [year, month, day] = date.split('-').map(Number);
        return new Date(year, month - 1, day, 0, 0, 0, 0);
    }
}
