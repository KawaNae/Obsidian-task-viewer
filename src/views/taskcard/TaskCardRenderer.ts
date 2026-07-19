import { type App, MarkdownRenderer, Component } from 'obsidian';
import { type Task, type DisplayTask, type TaskViewerSettings, type DoubleTapAction, isCompleteStatusChar, isTvFile, type TopRightConfig } from '../../types';
import { getOverdueLevel } from '../../services/display/TaskStatusQuery';
import { resolveTopRightField } from './TopRightFieldResolver';

export type TopRightSpec =
    | { mode: 'time' }
    | { mode: 'template'; config: TopRightConfig }
    | { mode: 'none' };

interface RenderOptions {
    cardInstanceId: string;
    context?: 'inline' | 'hub-preview';
    topRight?: TopRightSpec;
    compact?: boolean;
    hooks?: { onNavigate?: () => void };
}

/**
 * render() が直下に作る要素のクラス一覧。冪等再描画のため render() 冒頭で
 * `:scope >` 修飾でこの set のみを除去する。view 層が post-inject する
 * `task-card__handle*` は対象外なので保護される。`__content` 内部の
 * `__children` 等は子孫なので `:scope >` で誤爆しない。
 *
 * `task-card__shape` は装飾オーバーレイ（CSS で split-continues を表現する
 * 純表示要素）であり、view 側で重複生成されやすい温床だったため renderer に
 * 取り込んだ。delete + recreate ではなく「無ければ作る」運用で安定させる。
 */
const RENDERER_OWNED_CHILD_CLASSES = [
    'task-card__time',
    'task-card__content',
    'task-card__child-count',
] as const;

const SHAPE_CLASS = 'task-card__shape';
import type { TaskReadService } from '../../services/data/TaskReadService';
import type { TaskWriteService } from '../../services/data/TaskWriteService';
import { getFileBaseName, hasTaskContent, isContentMatchingBaseName } from '../../services/parsing/utils/TaskContent';
import { ChildItemBuilder } from './ChildItemBuilder';
import { ChildSectionRenderer, type ChildMenuCallback, type ChildLineEditCallback } from './ChildSectionRenderer';
import { CheckboxWiring } from './CheckboxWiring';
import type { MenuPresenter } from '../../interaction/menu/MenuPresenter';
import { TaskLinkInteractionManager } from './TaskLinkInteractionManager';
import { bindTapIntents } from '../../interaction/tap/TapIntent';
import type { TaskCardLinkRuntime } from './types';
import { getEffectiveMask } from '../../services/data/EffectiveProperties';

export function computeContentSignature(
    task: DisplayTask,
    settings: TaskViewerSettings,
    options: RenderOptions,
    topRightResolved: string,
    maskMode: boolean,
    isExpanded: boolean,
    readService: TaskReadService,
): string {
    const childSig = task.childEntries.map(e => {
        if (e.kind === 'task') {
            const child = readService.getTask(e.taskId);
            return `t:${e.taskId}:${child?.statusChar ?? '?'}:${child?.content ?? ''}`;
        }
        if (e.kind === 'wikilink') {
            return `w:${e.target}:${e.line.text}`;
        }
        return `l:${e.line.text}`;
    });

    // JSON.stringify: field values are escaped, so no separator can collide
    // with content, and the result never contains raw control characters.
    // The signature is stored in a data-* attribute; XMLSerializer consumers
    // (html-to-image's SVG foreignObject export) reject XML-invalid chars
    // like \x00, so the serialized form must stay XML-safe.
    return JSON.stringify([
        task.statusChar,
        task.content,
        task.file,
        task.parserId,
        task.effectiveStartDate,
        task.effectiveStartTime ?? '',
        task.effectiveEndDate ?? '',
        task.effectiveEndTime ?? '',
        task.startTimeImplicit ? '1' : '0',
        task.endTimeImplicit ? '1' : '0',
        task.effectiveDue ?? '',
        task.isReadOnly ? '1' : '0',
        topRightResolved,
        options.compact ? '1' : '0',
        maskMode ? '1' : '0',
        isExpanded ? '1' : '0',
        settings.startHour,
        settings.childCollapseThreshold,
        settings.enableCardFileLink ? '1' : '0',
        settings.statusDefinitions.map(d => `${d.char}:${d.label}`).join(','),
        childSig,
    ]);
}

export class TaskCardRenderer extends Component {
    private expandedTaskIds: Set<string> = new Set();
    private childItemBuilder: ChildItemBuilder;
    private childSectionRenderer: ChildSectionRenderer;
    private checkboxWiring: CheckboxWiring;
    private linkInteractionManager: TaskLinkInteractionManager;
    private onDetailClick: ((task: Task) => void) | null = null;
    private onContextMenu: ((task: Task, x: number, y: number) => void) | null = null;
    private onOpenInEditor: ((task: Task) => void) | null = null;
    private getDoubleTapAction: () => DoubleTapAction = () => 'detail';
    private cardComponents: WeakMap<HTMLElement, Component> = new WeakMap();
    private unsubscribeTaskDeleted: (() => void) | null = null;

    constructor(
        private app: App,
        readService: TaskReadService,
        writeService: TaskWriteService,
        menuPresenter: MenuPresenter,
        private linkRuntime: TaskCardLinkRuntime,
        getSettings: () => TaskViewerSettings,
        /**
         * Lazy reader for the owning view's mask-mode toggle. When it returns
         * true, every card rendered through this renderer substitutes its
         * content with the task's `tv-mask` value (see `applyMaskToContent`).
         * Default returns false so the renderer keeps working uninstrumented
         * in tests and lightweight call sites.
         */
        private getMaskMode: () => boolean = () => false
    ) {
        super();
        this.checkboxWiring = new CheckboxWiring(writeService, menuPresenter);
        this.childItemBuilder = new ChildItemBuilder(readService);
        this.childSectionRenderer = new ChildSectionRenderer(app, this.checkboxWiring, readService);
        this.linkInteractionManager = new TaskLinkInteractionManager(app, getSettings);
        // Clean up expandedTaskIds entries for tasks deleted via the UI so the
        // set does not grow unbounded over the renderer's lifetime. Keys are
        // `${viewId}::${scope}::${task.id}` (cardInstanceId), with frontmatter
        // children adding a `::fm-children` suffix. Match by suffix so all
        // card instances of the deleted task are dropped regardless of view /
        // scope (main grid, pinned list, etc.).
        this.unsubscribeTaskDeleted = writeService.onTaskDeleted((taskId) => {
            const suffix = `::${taskId}`;
            const fmSuffix = `::${taskId}::fm-children`;
            for (const key of [...this.expandedTaskIds]) {
                if (key.endsWith(fmSuffix) || key.endsWith(suffix)) {
                    this.expandedTaskIds.delete(key);
                }
            }
        });
    }

    onunload(): void {
        if (this.unsubscribeTaskDeleted) {
            this.unsubscribeTaskDeleted();
            this.unsubscribeTaskDeleted = null;
        }
        super.onunload();
    }

    setChildMenuCallback(cb: ChildMenuCallback): void {
        this.childSectionRenderer.setChildMenuCallback(cb);
    }

    setChildLineEditCallback(cb: ChildLineEditCallback): void {
        this.childSectionRenderer.setChildLineEditCallback(cb);
    }

    setDetailCallback(cb: (task: Task) => void): void {
        this.onDetailClick = cb;
    }

    setContextMenuCallback(cb: (task: Task, x: number, y: number) => void): void {
        this.onContextMenu = cb;
    }

    setOpenInEditorCallback(cb: (task: Task) => void): void {
        this.onOpenInEditor = cb;
    }

    setDoubleTapActionGetter(getter: () => DoubleTapAction): void {
        this.getDoubleTapAction = getter;
    }

    async render(
        container: HTMLElement,
        task: DisplayTask,
        settings: TaskViewerSettings,
        options: RenderOptions
    ): Promise<void> {
        const cardInstanceId = options.cardInstanceId;
        const topRight: TopRightSpec = options.topRight ?? { mode: 'time' };
        const compact = options.compact ?? false;
        const isHubPreview = options.context === 'hub-preview';
        const forceExpand = isHubPreview;
        const enableLinks = isHubPreview || settings.enableCardFileLink;
        const onNavigate = options.hooks?.onNavigate;

        container.dataset.cardInstanceId = cardInstanceId;

        if (isHubPreview) {
            container.addClass('task-card--in-hub-preview');
        }

        // Compute content signature for render skip
        const topRightResolved = this.resolveTopRightString(task, settings, topRight);
        const isExpanded = this.expandedTaskIds.has(cardInstanceId);
        const sig = computeContentSignature(
            task, settings, options, topRightResolved,
            this.getMaskMode(), isExpanded,
            this.childItemBuilder.getReadService(),
        );

        if (container.dataset.contentSig === sig) {
            return;
        }
        container.dataset.contentSig = sig;

        const ownedSelector = RENDERER_OWNED_CHILD_CLASSES
            .map(c => `:scope > .${c}`).join(', ');
        container.querySelectorAll(ownedSelector).forEach(el => el.remove());

        // `__shape` is renderer-owned but persistent (not torn down between
        // renders) — purely decorative, no per-render state to refresh.
        // Ensure exactly one exists at the head of the card.
        if (!container.querySelector(`:scope > .${SHAPE_CLASS}`)) {
            const shape = container.createDiv(SHAPE_CLASS);
            container.insertBefore(shape, container.firstChild);
        }

        const prev = this.cardComponents.get(container);
        if (prev) this.removeChild(prev);
        const cardComp = new Component();
        this.addChild(cardComp);
        this.cardComponents.set(container, cardComp);

        this.renderTopRightMeta(container, task, settings, topRight);
        if (!isHubPreview) {
            bindTapIntents(container, {
                onDoubleTap: (x, y) => {
                    const action = this.getDoubleTapAction();
                    if (action === 'menu') {
                        this.onContextMenu?.(task, x, y);
                    } else if (action === 'open') {
                        this.onOpenInEditor?.(task);
                    } else {
                        this.onDetailClick?.(task);
                    }
                },
            }, {
                // Skip dbltap on handles / checkboxes — these have their own
                // activation. Links are intentionally included: capture-phase
                // registration lets the counter see link clicks before the
                // link handler's stopPropagation, and on double-tap the
                // capture stopPropagation prevents the link from navigating.
                targetFilter: (t) =>
                    !t.closest('.task-card__handle') &&
                    !t.closest('input[type="checkbox"]'),
                capture: true,
                component: cardComp,
            });
        }

        const contentContainer = container.createDiv('task-card__content');
        const parentMarkdown = this.buildParentMarkdown(task, settings);

        if (compact) {
            // Reserve the child-count bar synchronously, BEFORE the markdown await.
            // Without this, the bar appears in a microtask after MarkdownRenderer
            // resolves, briefly shrinking compact cards by ~21px. For allday
            // cards stacked on a CSS grid, that transient propagates to the
            // allday-section height, which combined with the sync scroll-restore
            // in TimelineView.performRender produces a 1-frame flicker of timed
            // cards shifting up then settling back.
            const childCountBar = container.createDiv('task-card__child-count');
            const countLabelSpan = childCountBar.createSpan();

            const strippedMarkdown = parentMarkdown
                .replace(/!\[\[([^\]]*)\]\]/g, '')
                .replace(/!\[([^\]]*)\]\([^)]*\)/g, '');
            await MarkdownRenderer.render(this.app, strippedMarkdown, contentContainer, task.file, cardComp);

            const { completed, total } = this.getChildCompletion(task, settings);
            if (total > 0) {
                countLabelSpan.setText(`${this.getChildOverdueIcon(task, settings)}${completed}/${total}`);
            }
        } else if (isTvFile(task)) {
            await MarkdownRenderer.render(this.app, parentMarkdown, contentContainer, task.file, cardComp);
            await this.renderFrontmatterChildren(contentContainer, task, cardComp, settings, cardInstanceId, forceExpand);
        } else if (task.childEntries.length > 0) {
            await this.renderInlineChildren(contentContainer, task, cardComp, settings, parentMarkdown, cardInstanceId, forceExpand);
        } else {
            await MarkdownRenderer.render(this.app, parentMarkdown, contentContainer, task.file, cardComp);
        }

        this.bindInternalLinks(contentContainer, task.file, enableLinks, onNavigate);
        this.bindParentCheckbox(contentContainer, task.originalTaskId ?? task.id, settings, task.isReadOnly);

        // Apply mask last so it overlays whatever child/inline renderer produced.
        // Detail modal opts out — the user explicitly asked to inspect this task.
        const mask = getEffectiveMask(task);
        if (!isHubPreview && this.getMaskMode() && mask) {
            TaskCardRenderer.applyMaskToContent(contentContainer, mask);
        }
    }

    dispose(container: HTMLElement): void {
        const comp = this.cardComponents.get(container);
        if (comp) {
            this.removeChild(comp);
            this.cardComponents.delete(container);
        }
    }

    disposeInside(root: HTMLElement): void {
        const cards = root.querySelectorAll<HTMLElement>('.task-card');
        cards.forEach(card => this.dispose(card));
    }

    private getOverdueIcon(task: DisplayTask, settings: TaskViewerSettings): string {
        const level = getOverdueLevel(task, settings.startHour, settings.statusDefinitions, this.childItemBuilder.getReadService());
        return level === 'past-due' ? '🚨 '
            : level === 'past-end' ? '⚠️ '
            : '';
    }

    /**
     * Overdue icon shown next to the n/m child counter — only when the
     * overdue is child-caused (parent's own status is complete but an
     * unchecked child keeps the task incomplete).
     */
    private getChildOverdueIcon(task: DisplayTask, settings: TaskViewerSettings): string {
        if (!isCompleteStatusChar(task.statusChar, settings.statusDefinitions)) return '';
        return this.getOverdueIcon(task, settings);
    }

    private getChildCompletion(task: DisplayTask, settings: TaskViewerSettings): { completed: number; total: number } {
        let completed = 0;
        let total = 0;
        const lookup = this.childItemBuilder.getReadService();

        for (const entry of task.childEntries) {
            if (entry.kind === 'task' || entry.kind === 'wikilink') {
                const child = entry.kind === 'task'
                    ? lookup.getTask(entry.taskId)
                    : this.resolveWikilinkChild(task, entry.target);
                if (!child) continue;
                total++;
                if (isCompleteStatusChar(child.statusChar, settings.statusDefinitions)) completed++;
            } else if (entry.kind === 'line' && entry.line.checkboxChar !== null) {
                total++;
                if (isCompleteStatusChar(entry.line.checkboxChar, settings.statusDefinitions)) completed++;
            }
        }

        return { completed, total };
    }

    private resolveWikilinkChild(parent: DisplayTask, target: string): Task | undefined {
        const t = target.split('|')[0].trim();
        const lookup = this.childItemBuilder.getReadService();
        for (const entry of parent.childEntries) {
            if (entry.kind !== 'task') continue;
            const c = lookup.getTask(entry.taskId);
            if (!c || !isTvFile(c)) continue;
            const baseName = c.file.replace(/\.md$/, '').split('/').pop() || '';
            const fullPath = c.file.replace(/\.md$/, '');
            if (t === baseName || t === fullPath || t === c.file) return c;
        }
        return undefined;
    }

    private resolveTopRightString(task: DisplayTask, settings: TaskViewerSettings, spec: TopRightSpec): string {
        if (spec.mode === 'none') return '';
        if (spec.mode === 'time') {
            if (!task.effectiveStartTime || task.startTimeImplicit) return '';
            const end = (task.effectiveEndTime && !task.endTimeImplicit) ? `>${task.effectiveEndTime}` : '';
            return `${task.effectiveStartTime}${end}`;
        }
        const { fields, separator, prefix, suffix } = spec.config;
        const segments = fields
            .map(f => resolveTopRightField(task, f, settings))
            .filter((v): v is string => v != null && v !== '');
        if (segments.length === 0) return '';
        return `${prefix ?? ''}${segments.join(separator ?? '')}${suffix ?? ''}`;
    }

    private renderTopRightMeta(
        container: HTMLElement,
        task: DisplayTask,
        settings: TaskViewerSettings,
        spec: TopRightSpec,
    ): void {
        if (spec.mode === 'none') return;

        if (spec.mode === 'time') {
            if (!task.effectiveStartTime || task.startTimeImplicit) return;
            const el = container.createDiv('task-card__time');
            el.createSpan('task-card__time-start').textContent = task.effectiveStartTime;
            if (task.effectiveEndTime && !task.endTimeImplicit) {
                el.createSpan('task-card__time-end').textContent = `>${task.effectiveEndTime}`;
            }
            return;
        }

        const { fields, separator, prefix, suffix } = spec.config;
        const segments = fields
            .map(f => resolveTopRightField(task, f, settings))
            .filter((v): v is string => v != null && v !== '');
        if (segments.length === 0) return;

        const el = container.createDiv('task-card__time');
        if (prefix) el.createSpan('task-card__time-seg').textContent = prefix;
        for (let i = 0; i < segments.length; i++) {
            if (i > 0 && separator) {
                el.createSpan('task-card__time-sep').textContent = separator;
            }
            el.createSpan('task-card__time-seg').textContent = segments[i];
        }
        if (suffix) el.createSpan('task-card__time-seg').textContent = suffix;
    }

    private buildParentMarkdown(task: DisplayTask, settings: TaskViewerSettings): string {
        const statusChar = task.statusChar || ' ';

        // Icon placement disambiguates the overdue cause: the parent line
        // only carries the icon when the parent's own status is incomplete;
        // child-caused overdue (parent complete, child unchecked) shows the
        // icon next to the n/m child counter instead.
        const overdueIcon = isCompleteStatusChar(task.statusChar, settings.statusDefinitions)
            ? ''
            : this.getOverdueIcon(task, settings);

        const filePath = task.file.replace(/\.md$/, '');
        const fileBaseName = getFileBaseName(task.file) || filePath;
        const fileLink = `[[${filePath}|${fileBaseName}]]`;
        const shouldShowContent = hasTaskContent(task) && !isContentMatchingBaseName(task);

        if (shouldShowContent) {
            return `- [${statusChar}] ${overdueIcon}${task.content} : ${fileLink}`;
        }

        return `- [${statusChar}] ${overdueIcon}${fileLink}`;
    }

    /**
     * The `task.startDate` passed down as parentStartDate is deliberately
     * RAW (not effective): child notation labels are built from raw Tasks
     * (see NotationUtils contract), so the parent date substituted into
     * time-only child notations must live in the same raw coordinate system.
     */
    private async renderInlineChildren(
        contentContainer: HTMLElement,
        task: DisplayTask,
        component: Component,
        settings: TaskViewerSettings,
        parentMarkdown: string,
        cardInstanceId: string,
        forceExpand = false
    ): Promise<void> {
        const items = this.childItemBuilder.buildChildItems(task, '');
        if (!forceExpand && items.length >= settings.childCollapseThreshold) {
            await MarkdownRenderer.render(this.app, parentMarkdown, contentContainer, task.file, component);
            await this.childSectionRenderer.renderCollapsed(
                contentContainer,
                items,
                this.expandedTaskIds,
                cardInstanceId,
                task.file,
                component,
                settings,
                task.startDate,
                this.getChildOverdueIcon(task, settings)
            );
            return;
        }

        const indentedItems = this.childItemBuilder.buildChildItems(task, '    ');
        await this.childSectionRenderer.renderParentWithChildren(
            contentContainer,
            parentMarkdown,
            indentedItems,
            task.file,
            component,
            settings,
            task.startDate
        );
    }

    private async renderFrontmatterChildren(
        contentContainer: HTMLElement,
        task: DisplayTask,
        component: Component,
        settings: TaskViewerSettings,
        cardInstanceId: string,
        forceExpand = false
    ): Promise<void> {
        if (task.childEntries.length === 0) {
            return;
        }

        const items = this.childItemBuilder.buildChildItems(task);
        if (items.length === 0) {
            return;
        }

        const shouldCollapse = !forceExpand && items.length >= settings.childCollapseThreshold;
        if (shouldCollapse) {
            await this.childSectionRenderer.renderCollapsed(
                contentContainer,
                items,
                this.expandedTaskIds,
                `${cardInstanceId}::fm-children`,
                task.file,
                component,
                settings,
                task.startDate,
                this.getChildOverdueIcon(task, settings)
            );
            return;
        }

        await this.childSectionRenderer.renderExpanded(
            contentContainer,
            items,
            task.file,
            component,
            settings,
            task.startDate
        );
    }

    private bindInternalLinks(contentContainer: HTMLElement, sourcePath: string, enableClick: boolean, onNavigate?: () => void): void {
        this.linkInteractionManager.bind(contentContainer, {
            sourcePath,
            hoverSource: this.linkRuntime.hoverSource,
            hoverParent: this.linkRuntime.getHoverParent(),
        }, { bindClick: enableClick, onNavigate });
    }

    private bindParentCheckbox(
        contentContainer: HTMLElement,
        taskId: string,
        settings: TaskViewerSettings,
        readOnly?: boolean
    ): void {
        const mainCheckbox = contentContainer.querySelector(':scope > ul > li > input[type="checkbox"]');
        if (mainCheckbox) {
            this.checkboxWiring.wireParentCheckbox(mainCheckbox, taskId, settings, readOnly);
        }
    }

    /**
     * Replace card-visible text with the mask string and hide any wikilinks /
     * internal links so the file name itself does not leak. Operates on the
     * `.task-card__content` subtree only (other card chrome — time, child
     * count, checkbox — stays legible). Idempotent: every render starts from
     * a freshly built content subtree, so no restore is necessary.
     *
     * Mirrors the old ExportUtils.applyMasking logic but as a forward-only
     * render-time transform — masking is now a live visual mode, not an
     * export-time DOM walk-and-restore.
     */
    private static applyMaskToContent(contentEl: HTMLElement, maskText: string): void {
        const listItem = contentEl.querySelector('.task-list-item');
        if (!listItem) return;

        // Walk the visible text nodes: replace the first run with the mask,
        // strip the rest. Skip time / child-notation / checkbox / link texts
        // so the structural cues stay readable.
        let replaced = false;
        const walker = document.createTreeWalker(listItem, NodeFilter.SHOW_TEXT);
        const textNodes: Text[] = [];
        let n: Text | null;
        while ((n = walker.nextNode() as Text | null)) textNodes.push(n);

        for (const textNode of textNodes) {
            const parent = textNode.parentElement;
            if (parent?.closest('.task-card__time, .task-card__child-notation, input')) continue;
            if (parent?.closest('.internal-link')) continue;
            if (!textNode.textContent?.trim()) continue;

            if (!replaced) {
                textNode.textContent = maskText;
                replaced = true;
            } else {
                textNode.textContent = '';
            }
        }

        // Hide internal links entirely and clear any preceding " : " separator
        // so the line doesn't end with a dangling colon.
        const links = Array.from(listItem.querySelectorAll<HTMLElement>('.internal-link'));
        for (const link of links) {
            link.style.display = 'none';
            const prev = link.previousSibling;
            if (prev?.nodeType === Node.TEXT_NODE && prev.textContent?.includes(':')) {
                prev.textContent = '';
            }
        }
    }
}
