import { TFile, moment, setIcon } from 'obsidian';
import type { App, HoverParent } from 'obsidian';
import TaskViewerPlugin from '../../main';
import { DailyNoteUtils } from '../../utils/DailyNoteUtils';
import { DateUtils } from '../../utils/DateUtils';
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
    /**
     * Wires the date-header axis cell as the focus-stop / primary toggle target,
     * installs the chevron button, and aria-syncs the cell. The YM/W axis cells
     * (built inside render) are already click-wired internally to the same
     * onToggle handler so the three axis cells behave as one toggle region.
     */
    mountInAxisCell(dateHeaderAxis: HTMLElement): void;
}

type Tier = 'YM' | 'W';

interface Segment {
    key: string;
    startIdx: number;
    span: number;
    anchorDate: string;
    isCurrent: boolean;
}

export class PeriodicHeaderRenderer {
    constructor(private deps: PeriodicHeaderRendererDeps) {}

    render(parent: HTMLElement, params: PeriodicHeaderRenderParams): PeriodicHeaderRenderResult {
        const { dates, gridTemplateColumns, collapsed, onToggle } = params;

        const todayVisualDate = DateUtils.getVisualDateOfNow(this.deps.plugin.settings.startHour);
        const todayMoment = moment(todayVisualDate, 'YYYY-MM-DD');
        const weekStartDay = this.deps.plugin.settings.weekStartDay;
        const todayVisualWeekKey = DateUtils.getVisualWeekKey(
            this.parseLocalDate(todayVisualDate),
            weekStartDay,
        );

        const container = parent.createDiv('periodic-header');
        if (collapsed) container.addClass('periodic-header--collapsed');

        // Three axis cells (YM-axis, W-axis, date-header axis) form one fused
        // hover region. Each binds mouseenter/mouseleave that toggles the
        // is-fused-hover class on all three together; mouseleave inside the
        // region (cursor moving between fused cells) is suppressed via
        // relatedTarget so the highlight doesn't flicker.
        const fusedCells: HTMLElement[] = [];
        const setFused = (on: boolean) => {
            for (const c of fusedCells) c.toggleClass('is-fused-hover', on);
        };
        const wireFusedHover = (cell: HTMLElement) => {
            cell.addEventListener('mouseenter', () => setFused(true));
            cell.addEventListener('mouseleave', (e: MouseEvent) => {
                const next = e.relatedTarget as Node | null;
                if (next && fusedCells.some(c => c === next || c.contains(next))) return;
                setFused(false);
            });
        };

        const { row: ymRow, axis: ymAxis } = this.buildRow(container, 'periodic-header__row--year-month', gridTemplateColumns, onToggle);
        fusedCells.push(ymAxis);
        wireFusedHover(ymAxis);
        const ymSegments = this.computeSegments(dates, 'YM', todayMoment, weekStartDay, todayVisualWeekKey);
        for (const seg of ymSegments) {
            this.appendYearMonthSegment(ymRow, seg);
        }

        const { row: wRow, axis: wAxis } = this.buildRow(container, 'periodic-header__row--week', gridTemplateColumns, onToggle);
        fusedCells.push(wAxis);
        wireFusedHover(wAxis);
        const wSegments = this.computeSegments(dates, 'W', todayMoment, weekStartDay, todayVisualWeekKey);
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

        const mountInAxisCell = (dateHeaderAxis: HTMLElement): void => {
            const chevron = document.createElement('button');
            chevron.className = 'tv-section-toggle tv-section-toggle--axis periodic-header__toggle';
            chevron.tabIndex = -1;
            dateHeaderAxis.appendChild(chevron);

            this.wireAxisToggleCell(dateHeaderAxis, onToggle, /*isPrimary*/ true);
            fusedCells.push(dateHeaderAxis);
            wireFusedHover(dateHeaderAxis);
            this.applyToggleState(dateHeaderAxis, chevron, collapsed);
        };

        return { container, mountInAxisCell };
    }

    private buildRow(container: HTMLElement, modifier: string, gridTemplateColumns: string, onToggle: () => void): { row: HTMLElement; axis: HTMLElement } {
        const row = container.createDiv(`tv-grid-row periodic-header__row ${modifier}`);
        row.style.gridTemplateColumns = gridTemplateColumns;
        const axis = row.createDiv('periodic-header__axis');
        axis.style.gridColumn = '1';
        this.wireAxisToggleCell(axis, onToggle, /*isPrimary*/ false);
        return { row, axis };
    }

    private wireAxisToggleCell(cell: HTMLElement, onToggle: () => void, isPrimary: boolean): void {
        cell.setAttribute('role', 'button');
        cell.tabIndex = isPrimary ? 0 : -1;
        cell.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggle();
        });
        cell.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onToggle();
            }
        });
    }

    private applyToggleState(primaryCell: HTMLElement, chevron: HTMLElement, collapsed: boolean): void {
        setIcon(chevron, collapsed ? 'chevron-down' : 'chevron-up');
        const ariaLabel = collapsed ? t('periodicHeader.expand') : t('periodicHeader.collapse');
        primaryCell.setAttribute('aria-expanded', String(!collapsed));
        primaryCell.setAttribute('aria-label', ariaLabel);
    }

    private appendYearMonthSegment(row: HTMLElement, seg: Segment): void {
        const segEl = row.createDiv('periodic-header__segment periodic-header__segment--year-month');
        segEl.style.gridColumn = `${seg.startIdx + 2} / span ${seg.span}`;
        if (seg.isCurrent) segEl.addClass('is-current');

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
        if (seg.isCurrent) segEl.addClass('is-current');

        const dateObj = this.parseLocalDate(seg.anchorDate);
        const m = moment(dateObj);

        this.appendPeriodicLink(segEl, {
            text: m.format('[W]ww'),
            target: DailyNoteUtils.getWeeklyNoteLinkTarget(this.deps.plugin.settings, dateObj),
            ariaLabel: `Open weekly note: ${m.format('gggg-[W]ww')}`,
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

    private computeSegments(
        dates: string[],
        tier: Tier,
        todayMoment: moment.Moment,
        weekStartDay: 0 | 1,
        todayVisualWeekKey: string,
    ): Segment[] {
        const segments: Segment[] = [];
        let current: Segment | null = null;
        for (let i = 0; i < dates.length; i++) {
            const d = dates[i];
            const dateObj = this.parseLocalDate(d);
            // W tier groups by the visual-week-start date so weekStartDay is honored.
            // YM tier is unaffected by week-start choice.
            const k = tier === 'YM'
                ? moment(dateObj).format('YYYY-MM')
                : DateUtils.getVisualWeekKey(dateObj, weekStartDay);
            if (current && current.key === k) {
                current.span++;
            } else {
                if (current) segments.push(current);
                const isCurrent: boolean = tier === 'YM'
                    ? moment(dateObj).isSame(todayMoment, 'month')
                    : k === todayVisualWeekKey;
                // For W tier the anchor is the visual week start (= key), so all
                // downstream renderers (label, aria, weekly link target, click date)
                // operate on the canonical anchor — symmetric with CalendarView.
                const anchorDate: string = tier === 'W' ? k : d;
                current = { key: k, startIdx: i, span: 1, anchorDate, isCurrent };
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
