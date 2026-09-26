import { type App, MarkdownRenderer, Component } from 'obsidian';
import { type Task, type DisplayTask, type TaskViewerSettings, type DoubleTapAction, isCompleteStatusChar, type TopRightConfig } from '../../types';
import { getOverdueLevel, type OverdueLevel } from '../../services/display/TaskStatusQuery';
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
import { getFileBaseName, hasTaskContent } from '../../services/parsing/utils/TaskContent';
import { ChildItemBuilder } from './ChildItemBuilder';
import { ChildSectionRenderer, type ChildMenuCallback } from './ChildSectionRenderer';
import { CheckboxWiring } from './CheckboxWiring';
import type { MenuPresenter } from '../../interaction/menu/MenuPresenter';
import { TaskLinkInteractionManager } from './TaskLinkInteractionManager';
import { bindTapIntents } from '../../interaction/tap/TapIntent';
import type { ChildRenderItem, TaskCardLinkRuntime } from './types';
import { getEffectiveMask } from '../../services/data/EffectiveProperties';
import { TaskIdGenerator } from '../../services/display/TaskIdGenerator';
import { holdCard, type CardHold } from './CardHold';

/**
 * What a card shows, to tell whether a kept card can stay as it is drawn.
 *
 * Everything the card shows is in it, and nothing else: not the task's name,
 * which changes with every reading of its file while the card shows the same
 * thing. What the card acts on is held apart and put in on every draw
 * (`CardHold`), so a card kept across a reading acts on the task it shows.
 *
 * @param children the card's child items, as `ChildItemBuilder` builds them
 *   (the drawn lines of the children and their children, with their notation)
 */
export function computeContentSignature(
    task: DisplayTask,
    settings: TaskViewerSettings,
    options: RenderOptions,
    topRightResolved: string,
    overdueLevel: OverdueLevel,
    maskMode: boolean,
    isExpanded: boolean,
    children: readonly ChildRenderItem[],
): string {
    const childSig = children.map(item => [
        item.isCheckbox ? 1 : 0,
        item.markdown,
        item.notation ?? '',
        item.propertyKey ?? '',
    ]);

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
        // A child's time-only notation is shown with the parent's own date.
        task.startDate ?? '',
        task.effectiveStartDate,
        task.effectiveStartTime ?? '',
        task.effectiveEndDate ?? '',
        task.effectiveEndTime ?? '',
        task.startTimeImplicit ? '1' : '0',
        task.endTimeImplicit ? '1' : '0',
        task.effectiveDue ?? '',
        task.isReadOnly ? '1' : '0',
        topRightResolved,
        // Overdue is judged against the clock, not against task fields, so
        // nothing else here moves when a card crosses its end or due. Without
        // it the signature matches and the card keeps its pre-overdue content
        // for as long as the task is not edited.
        overdueLevel,
        options.compact ? '1' : '0',
        options.context ?? '',
        maskMode ? '1' : '0',
        maskMode ? (getEffectiveMask(task) ?? '') : '',
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
        // `${viewId}::${scope}::${task.id}` (cardInstanceId). Match by suffix so
        // all card instances of the deleted task are dropped regardless of view /
        // scope (main grid, pinned list, etc.).
        this.unsubscribeTaskDeleted = writeService.onTaskDeleted((taskId) => {
            const suffix = `::${taskId}`;
            for (const key of [...this.expandedTaskIds]) {
                if (key.endsWith(suffix)) {
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

    /**
     * Whether the card `cardInstanceId`, drawing the task `taskId`, was left
     * expanded. A key ends in the name the task had when it was expanded, and
     * a name lasts one reading of its file: one given before a write of ours
     * is followed to the row's name now (`getTask`), and the key is taken
     * over by this card. One from before a change that was not ours names
     * nothing, and the card is drawn collapsed.
     */
    private isExpanded(cardInstanceId: string, taskId: string): boolean {
        if (this.expandedTaskIds.has(cardInstanceId)) return true;
        if (!cardInstanceId.endsWith(taskId)) return false;
        const scope = cardInstanceId.slice(0, cardInstanceId.length - taskId.length);
        const readService = this.childItemBuilder.getReadService();
        for (const key of this.expandedTaskIds) {
            if (!key.startsWith(scope)) continue;
            const held = key.slice(scope.length);
            const now = TaskIdGenerator.mapRow(held, row => readService.getTask(row)?.id);
            if (now !== taskId) continue;
            this.expandedTaskIds.delete(key);
            this.expandedTaskIds.add(cardInstanceId);
            return true;
        }
        return false;
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

        // What the card shows of its children, and the names behind them. A
        // compact card shows only their count, which the items still decide.
        const children = task.childEntries.length > 0
            ? this.childItemBuilder.buildChildItems(task, '')
            : [];
        // Every draw puts the task it draws in the hold, whether or not the
        // card is drawn anew: a kept card acts on the task it shows.
        const hold = holdCard(container, task, cardInstanceId, children.map(item => item.handler?.taskId ?? null));
        container.dataset.cardInstanceId = cardInstanceId;

        if (isHubPreview) {
            container.addClass('task-card--in-hub-preview');
        }

        // Compute content signature for render skip
        const topRightResolved = this.resolveTopRightString(task, settings, topRight);
        const isExpanded = this.isExpanded(cardInstanceId, task.id);
        const overdueLevel = getOverdueLevel(
            task, settings.startHour, settings.statusDefinitions,
            this.childItemBuilder.getReadService(),
        );
        const sig = computeContentSignature(
            task, settings, options, topRightResolved, overdueLevel,
            this.getMaskMode(), isExpanded, children,
        );

        if (container.dataset.contentSig === sig) {
            return;
        }
        container.dataset.contentSig = sig;
        this.applyOverdueAttributes(container, task, settings, overdueLevel);

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
                        this.onContextMenu?.(hold.task, x, y);
                    } else if (action === 'open') {
                        this.onOpenInEditor?.(hold.task);
                    } else {
                        this.onDetailClick?.(hold.task);
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
        } else if (task.childEntries.length > 0) {
            await this.renderInlineChildren(contentContainer, task, children, hold, cardComp, settings, parentMarkdown, forceExpand);
        } else {
            await MarkdownRenderer.render(this.app, parentMarkdown, contentContainer, task.file, cardComp);
        }

        this.bindInternalLinks(contentContainer, task.file, enableLinks, onNavigate);
        this.bindParentCheckbox(contentContainer, hold, settings, task.isReadOnly);

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

    /**
     * Publish the card's overdue state as attributes, so styling can reach it
     * without re-deriving the judgement.
     *
     * `data-overdue` carries the level and is absent when the card is not
     * overdue. `data-overdue-cause` says where the overdue comes from:
     * `child` when the task's own status is complete and an unchecked child
     * is what keeps it open, `self` otherwise. The inline-expanded card has
     * no n/m counter and so shows no child-caused icon today; the attribute
     * is there either way.
     *
     * No CSS here on purpose — how overdue asserts itself is a design
     * decision, and this is only the ground it stands on.
     */
    private applyOverdueAttributes(
        container: HTMLElement,
        task: DisplayTask,
        settings: TaskViewerSettings,
        level: OverdueLevel,
    ): void {
        if (level === 'none') {
            delete container.dataset.overdue;
            delete container.dataset.overdueCause;
            return;
        }
        container.dataset.overdue = level;
        container.dataset.overdueCause =
            isCompleteStatusChar(task.statusChar, settings.statusDefinitions) ? 'child' : 'self';
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
            if (entry.kind !== 'task') continue;
            const child = lookup.getTask(entry.taskId);
            if (!child) continue;
            total++;
            if (isCompleteStatusChar(child.statusChar, settings.statusDefinitions)) completed++;
        }

        return { completed, total };
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
        if (hasTaskContent(task)) {
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
        items: ChildRenderItem[],
        hold: CardHold,
        component: Component,
        settings: TaskViewerSettings,
        parentMarkdown: string,
        forceExpand = false
    ): Promise<void> {
        const nameAt = (index: number) => hold.childAt(index);
        if (!forceExpand && items.length >= settings.childCollapseThreshold) {
            await MarkdownRenderer.render(this.app, parentMarkdown, contentContainer, task.file, component);
            await this.childSectionRenderer.renderCollapsed(
                contentContainer,
                items,
                nameAt,
                this.expandedTaskIds,
                () => hold.cardInstanceId,
                task.file,
                component,
                settings,
                task.startDate,
                this.getChildOverdueIcon(task, settings)
            );
            return;
        }

        // Under the parent's line, each item goes one level in.
        const indentedItems = items.map(item => ({ ...item, markdown: '    ' + item.markdown }));
        await this.childSectionRenderer.renderParentWithChildren(
            contentContainer,
            parentMarkdown,
            indentedItems,
            nameAt,
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
        hold: CardHold,
        settings: TaskViewerSettings,
        readOnly?: boolean
    ): void {
        const mainCheckbox = contentContainer.querySelector(':scope > ul > li > input[type="checkbox"]');
        if (mainCheckbox) {
            this.checkboxWiring.wireParentCheckbox(mainCheckbox, () => hold.name, settings, readOnly);
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
