import { TFile, moment, setIcon } from 'obsidian';
import type { App, HoverParent } from 'obsidian';
import TaskViewerPlugin from '../../main';
import { DailyNoteUtils } from '../../utils/DailyNoteUtils';
import { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../../constants/hover';
import { t } from '../../i18n';

interface PeriodicHeaderRendererDeps {
    app: App;
    plugin: TaskViewerPlugin;
    hoverParent: HoverParent;
    linkInteractionManager: TaskLinkInteractionManager;
}

export interface PeriodicHeaderRenderParams {
    dates: string[];
    gridTemplateColumns: string;
    collapsed: boolean;
    onToggle: () => void;
}

export interface PeriodicHeaderRenderResult {
    container: HTMLElement;
    toggleButton: HTMLElement;
}

type Tier = 'YM' | 'W';

interface Segment {
    key: string;
    startIdx: number;
    span: number;
    anchorDate: string;
}

export class PeriodicHeaderRenderer {
    constructor(private deps: PeriodicHeaderRendererDeps) {}

    render(parent: HTMLElement, params: PeriodicHeaderRenderParams): PeriodicHeaderRenderResult {
        const { dates, gridTemplateColumns, collapsed, onToggle } = params;

        const container = parent.createDiv('periodic-header');
        if (collapsed) container.addClass('periodic-header--collapsed');

        const ymRow = this.buildRow(container, 'periodic-header__row--year-month', gridTemplateColumns);
        const ymSegments = this.computeSegments(dates, 'YM');
        for (const seg of ymSegments) {
            this.appendYearMonthSegment(ymRow, seg);
        }

        const wRow = this.buildRow(container, 'periodic-header__row--week', gridTemplateColumns);
        const wSegments = this.computeSegments(dates, 'W');
        for (const seg of wSegments) {
            this.appendWeekSegment(wRow, seg);
        }

        // Bind hover-link emission once after DOM is fully built. The
        // manager queries `a.internal-link[data-href]` descendants, so a
        // single bind on the container picks up every year/month/week link.
        // (Binding on each <a> directly is a no-op because querySelectorAll
        // doesn't include the element itself.)
        this.deps.linkInteractionManager.bind(container, {
            sourcePath: '',
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            hoverParent: this.deps.hoverParent,
        }, { bindClick: false });

        const toggleButton = this.buildToggleButton(collapsed, onToggle);

        return { container, toggleButton };
    }

    private buildRow(container: HTMLElement, modifier: string, gridTemplateColumns: string): HTMLElement {
        const row = container.createDiv(`tv-grid-row periodic-header__row ${modifier}`);
        row.style.gridTemplateColumns = gridTemplateColumns;
        const axis = row.createDiv('periodic-header__axis');
        axis.style.gridColumn = '1';
        return row;
    }

    private appendYearMonthSegment(row: HTMLElement, seg: Segment): void {
        const segEl = row.createDiv('periodic-header__segment periodic-header__segment--year-month');
        segEl.style.gridColumn = `${seg.startIdx + 2} / span ${seg.span}`;

        const dateObj = this.parseLocalDate(seg.anchorDate);
        const m = moment(dateObj);

        this.appendPeriodicLink(segEl, {
            text: String(m.year()),
            target: DailyNoteUtils.getYearlyNoteLinkTarget(this.deps.plugin.settings, dateObj),
            ariaLabel: `Open yearly note: ${m.year()}`,
            extraClass: 'periodic-header__link--year',
            kind: 'yearly',
            date: dateObj,
        });

        segEl.createSpan({ cls: 'periodic-header__separator', text: '-' });

        this.appendPeriodicLink(segEl, {
            text: String(m.month() + 1).padStart(2, '0'),
            target: DailyNoteUtils.getMonthlyNoteLinkTarget(this.deps.plugin.settings, dateObj),
            ariaLabel: `Open monthly note: ${m.format('YYYY-MM')}`,
            extraClass: 'periodic-header__link--month',
            kind: 'monthly',
            date: dateObj,
        });
    }

    private appendWeekSegment(row: HTMLElement, seg: Segment): void {
        const segEl = row.createDiv('periodic-header__segment periodic-header__segment--week');
        segEl.style.gridColumn = `${seg.startIdx + 2} / span ${seg.span}`;

        const dateObj = this.parseLocalDate(seg.anchorDate);
        const m = moment(dateObj);

        this.appendPeriodicLink(segEl, {
            text: m.format('[W]WW'),
            target: DailyNoteUtils.getWeeklyNoteLinkTarget(this.deps.plugin.settings, dateObj),
            ariaLabel: `Open weekly note: ${m.format('GGGG-[W]WW')}`,
            extraClass: 'periodic-header__link--week',
            kind: 'weekly',
            date: dateObj,
        });
    }

    private appendPeriodicLink(parent: HTMLElement, opts: {
        text: string;
        target: string;
        ariaLabel: string;
        extraClass: string;
        kind: 'yearly' | 'monthly' | 'weekly';
        date: Date;
    }): void {
        const link = parent.createEl('a', {
            cls: `internal-link periodic-header__link ${opts.extraClass}`,
            text: opts.text,
        });
        link.dataset.href = opts.target;
        link.setAttribute('href', opts.target);
        link.setAttribute('aria-label', opts.ariaLabel);
        link.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            void this.openOrCreatePeriodicNote(opts.kind, opts.date);
        });
        // hover-link binding happens once at the end of render() on the
        // container, so the link itself doesn't need to bind individually.
    }

    private async openOrCreatePeriodicNote(kind: 'yearly' | 'monthly' | 'weekly', date: Date): Promise<void> {
        const { app, plugin } = this.deps;
        let file: TFile | null;
        switch (kind) {
            case 'yearly':
                file = DailyNoteUtils.getYearlyNote(app, plugin.settings, date);
                if (!file) file = await DailyNoteUtils.createYearlyNote(app, plugin.settings, date);
                break;
            case 'monthly':
                file = DailyNoteUtils.getMonthlyNote(app, plugin.settings, date);
                if (!file) file = await DailyNoteUtils.createMonthlyNote(app, plugin.settings, date);
                break;
            case 'weekly':
                file = DailyNoteUtils.getWeeklyNote(app, plugin.settings, date);
                if (!file) file = await DailyNoteUtils.createWeeklyNote(app, plugin.settings, date);
                break;
        }
        if (file) {
            await app.workspace.getLeaf(false).openFile(file);
        }
    }

    private buildToggleButton(collapsed: boolean, onToggle: () => void): HTMLElement {
        const btn = document.createElement('button');
        btn.className = 'tv-section-toggle tv-section-toggle--axis periodic-header__toggle';
        btn.tabIndex = 0;
        btn.setAttribute('role', 'button');
        this.applyToggleState(btn, collapsed);

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggle();
        });
        btn.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onToggle();
            }
        });
        return btn;
    }

    private applyToggleState(btn: HTMLElement, collapsed: boolean): void {
        setIcon(btn, collapsed ? 'chevron-down' : 'chevron-up');
        btn.setAttribute('aria-expanded', String(!collapsed));
        btn.setAttribute('aria-label', collapsed
            ? t('periodicHeader.expand')
            : t('periodicHeader.collapse'));
    }

    private computeSegments(dates: string[], tier: Tier): Segment[] {
        const segments: Segment[] = [];
        let current: Segment | null = null;
        for (let i = 0; i < dates.length; i++) {
            const d = dates[i];
            const k = this.tierKey(d, tier);
            if (current && current.key === k) {
                current.span++;
            } else {
                if (current) segments.push(current);
                current = { key: k, startIdx: i, span: 1, anchorDate: d };
            }
        }
        if (current) segments.push(current);
        return segments;
    }

    private tierKey(date: string, tier: Tier): string {
        const d = this.parseLocalDate(date);
        switch (tier) {
            case 'YM': return moment(d).format('YYYY-MM');
            case 'W':  return moment(d).format('GGGG-[W]WW');
        }
    }

    private parseLocalDate(date: string): Date {
        const [year, month, day] = date.split('-').map(Number);
        return new Date(year, month - 1, day, 0, 0, 0, 0);
    }
}
