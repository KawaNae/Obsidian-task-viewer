import { type App, Component } from 'obsidian';
import { type Task, type DisplayTask, type TaskViewerSettings, type DoubleTapAction, isCompleteStatusChar, type TopRightConfig } from '../../types';
import { getOverdueLevel, type OverdueLevel } from '../../services/display/TaskStatusQuery';
import { resolveTopRightField } from './TopRightFieldResolver';

export type TopRightSpec =
    | { mode: 'time' }
    | { mode: 'template'; config: TopRightConfig }
    | { mode: 'none' };

/**
 * How one card is drawn. Every policy is its own field, so a caller that
 * draws cards apart from the views (the hub's preview) says what it wants
 * of each, and the renderer has no branch for that caller.
 */
export interface RenderOptions {
    /** Which card this is in its view; an opened card is kept by it. */
    key: CardKey;
    topRight?: TopRightSpec;
    compact?: boolean;
    /** Show every child, however many: no collapsed section. Default false. */
    expandChildren?: boolean;
    /** Links in the card can be clicked whatever `enableCardFileLink` says. Default false. */
    alwaysLinks?: boolean;
    /** A double tap on the card does the setting's action. Default true. */
    doubleTap?: boolean;
    /** The view's mask mode applies to the card. Default true. */
    mask?: boolean;
    hooks?: {
        /** A link in the card was followed. */
        onNavigate?: () => void;
        /** What the card's context menu does in place of its defaults. */
        menu?: TaskMenuHooks;
    };
}

/**
 * What a card does when the user acts on it, given once to the renderer.
 * Every handler is handed the task the card shows when it is used
 * (`CardHold`), or the child's name now.
 */
export interface CardActions {
    /** Open the task's details (the hub). */
    openDetail(task: Task): void;
    /** Open the task's context menu at a point. */
    showMenu(task: Task, x: number, y: number): void;
    /** Open a child's context menu, from its ⋯ button. */
    showChildMenu: ChildMenuCallback;
    /** Open the task's line in the editor. */
    openInEditor(task: Task): void;
    /** What a double tap on a card does, read when it happens. */
    doubleTapAction(): DoubleTapAction;
    /** Give the card its context menu (a right click, a long press). */
    bindMenu(card: HTMLElement, hooks?: TaskMenuHooks): void;
}

/** What a renderer draws with, given once. */
export interface TaskCardRendererDeps {
    app: App;
    readService: TaskReadService;
    index: IndexReads;
    operations: Operations;
    menuPresenter: MenuPresenter;
    linkRuntime: TaskCardLinkRuntime;
    getSettings: () => TaskViewerSettings;
    /**
     * The owning view's mask-mode toggle, read on every draw. When it is on,
     * a card that takes the mask (`RenderOptions.mask`) shows its task's
     * `tv-mask` value in place of its text (see `applyMaskToContent`).
     */
    getMaskMode: () => boolean;
    actions: CardActions;
}

/** The policies of `options`, with their defaults filled in. */
function policiesOf(options: RenderOptions) {
    return {
        expandChildren: options.expandChildren ?? false,
        alwaysLinks: options.alwaysLinks ?? false,
        doubleTap: options.doubleTap ?? true,
        mask: options.mask ?? true,
    };
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
import type { Operations } from '../../services/operations/Operations';
import type { IndexReads } from '../../services/core/TaskIndex';
import { getFileBaseName, hasTaskContent } from '../../services/display/TaskContent';
import { ChildItemBuilder } from './ChildItemBuilder';
import { ChildSectionRenderer, type ChildMenuCallback } from './ChildSectionRenderer';
import { CheckboxWiring } from './CheckboxWiring';
import type { MenuPresenter } from '../../interaction/menu/MenuPresenter';
import { TaskLinkInteractionManager } from './TaskLinkInteractionManager';
import { bindTapIntents } from '../../interaction/tap/TapIntent';
import type { ChildRenderItem, TaskCardLinkRuntime } from './types';
import { getEffectiveColor, getEffectiveLinestyle, getEffectiveMask } from '../../services/data/EffectiveProperties';
import { TaskStyling } from '../sharedUI/TaskStyling';
import type { TaskMenuHooks } from '../../interaction/menu/MenuHandler';
import { ExpandedCards, stampCardKey, type CardKey } from './CardKey';
import { holdCard, type CardHold } from './CardHold';
import { withoutEmbeds } from '../../services/parsing/utils/InlineNotation';
import { renderCardMarkdown, type LateContent } from './CardMarkdown';

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
    const policies = policiesOf(options);
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
        policies.expandChildren ? '1' : '0',
        policies.alwaysLinks ? '1' : '0',
        policies.doubleTap ? '1' : '0',
        policies.mask ? '1' : '0',
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
    private expanded = new ExpandedCards();
    private childItemBuilder: ChildItemBuilder;
    private childSectionRenderer: ChildSectionRenderer;
    private checkboxWiring: CheckboxWiring;
    private linkInteractionManager: TaskLinkInteractionManager;
    private readonly app: App;
    private readonly readService: TaskReadService;
    private readonly index: IndexReads;
    private readonly linkRuntime: TaskCardLinkRuntime;
    private readonly getMaskMode: () => boolean;
    private readonly actions: CardActions;
    private cardComponents: WeakMap<HTMLElement, Component> = new WeakMap();
    private unsubscribeTaskDeleted: (() => void) | null = null;

    constructor(deps: TaskCardRendererDeps) {
        super();
        const { app, readService, index } = deps;
        this.app = app;
        this.readService = readService;
        this.index = index;
        this.linkRuntime = deps.linkRuntime;
        this.getMaskMode = deps.getMaskMode;
        this.actions = deps.actions;
        this.checkboxWiring = new CheckboxWiring(deps.operations, deps.menuPresenter);
        this.childItemBuilder = new ChildItemBuilder(readService, index);
        this.childSectionRenderer = new ChildSectionRenderer(app, this.checkboxWiring, index, deps.actions.showChildMenu);
        this.linkInteractionManager = new TaskLinkInteractionManager(app, deps.getSettings);
        // Forget the opened cards of rows whose names ended (the index's
        // delete notification), segments included, in every place, so the
        // set does not grow over the renderer's lifetime.
        this.unsubscribeTaskDeleted = index.onTaskDeleted((taskId) => {
            this.expanded.forgetRow(taskId);
        });
    }

    onunload(): void {
        if (this.unsubscribeTaskDeleted) {
            this.unsubscribeTaskDeleted();
            this.unsubscribeTaskDeleted = null;
        }
        super.onunload();
    }

    /**
     * Draw `task` into `container`. The card is drawn whole when this
     * returns: its body, its children, their notation, its links and the
     * mask. Only content that is truly asynchronous (`LateContent`) comes in
     * later, and the mask is laid again once it has.
     */
    render(
        container: HTMLElement,
        task: DisplayTask,
        settings: TaskViewerSettings,
        options: RenderOptions
    ): void {
        const key = options.key;
        const topRight: TopRightSpec = options.topRight ?? { mode: 'time' };
        const compact = options.compact ?? false;
        const policies = policiesOf(options);
        const enableLinks = policies.alwaysLinks || settings.enableCardFileLink;
        const masked = policies.mask && this.getMaskMode();
        const onNavigate = options.hooks?.onNavigate;

        // What the card shows of its children, and the names behind them. A
        // compact card shows only their count, which the items still decide.
        const children = task.childEntries.length > 0
            ? this.childItemBuilder.buildChildItems(task, '')
            : [];
        // Every draw puts the task it draws in the hold, whether or not the
        // card is drawn anew: a kept card acts on the task it shows.
        const hold = holdCard(container, task, key, children.map(item => item.handler?.taskId ?? null));
        stampCardKey(container, key);

        // The card's look outside its content, and its menu, on every draw:
        // a kept card is drawn for a task whose color may have gone.
        TaskStyling.applyTaskColor(container, getEffectiveColor(task) ?? null);
        TaskStyling.applyTaskLinestyle(container, getEffectiveLinestyle(task) ?? null);
        TaskStyling.applyReadOnly(container, task);
        this.actions.bindMenu(container, options.hooks?.menu);

        // Compute content signature for render skip
        const topRightResolved = this.resolveTopRightString(task, settings, topRight);
        const isExpanded = this.expanded.isOpen(key, row => this.index.getTask(row)?.id);
        const overdueLevel = getOverdueLevel(
            task, settings.startHour, settings.statusDefinitions,
            this.readService,
        );
        const sig = computeContentSignature(
            task, settings, options, topRightResolved, overdueLevel,
            masked, isExpanded, children,
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
        if (policies.doubleTap) {
            bindTapIntents(container, {
                onDoubleTap: (x, y) => {
                    const action = this.actions.doubleTapAction();
                    if (action === 'menu') {
                        this.actions.showMenu(hold.task, x, y);
                    } else if (action === 'open') {
                        this.actions.openInEditor(hold.task);
                    } else {
                        this.actions.openDetail(hold.task);
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

        let late: LateContent;
        if (compact) {
            late = renderCardMarkdown(this.app, withoutEmbeds(parentMarkdown), contentContainer, task.file, cardComp);
            // The bar is there with or without children, so compact cards
            // of one lane keep one height.
            const countLabelSpan = container.createDiv('task-card__child-count').createSpan();
            const { completed, total } = this.getChildCompletion(task, settings);
            if (total > 0) {
                countLabelSpan.setText(`${this.getChildOverdueIcon(task, settings)}${completed}/${total}`);
            }
        } else if (task.childEntries.length > 0) {
            late = this.renderInlineChildren(contentContainer, task, children, hold, cardComp, settings, parentMarkdown, policies.expandChildren);
        } else {
            late = renderCardMarkdown(this.app, parentMarkdown, contentContainer, task.file, cardComp);
        }

        this.bindInternalLinks(contentContainer, task.file, enableLinks, onNavigate);
        this.bindParentCheckbox(contentContainer, hold, settings, task.isReadOnly);

        // Apply mask last so it overlays whatever child/inline renderer produced.
        const mask = getEffectiveMask(task);
        if (masked && mask) {
            TaskCardRenderer.applyMaskToContent(contentContainer, mask);
            // Text a post-processor puts in later would show unmasked: lay the
            // mask again once it is in, while the card still shows this draw.
            void late.then(() => {
                if (container.dataset.contentSig !== sig) return;
                if (this.cardComponents.get(container) !== cardComp) return;
                TaskCardRenderer.applyMaskToContent(contentContainer, mask);
            });
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
        const level = getOverdueLevel(task, settings.startHour, settings.statusDefinitions, this.readService);
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
        for (const entry of task.childEntries) {
            if (entry.kind !== 'task') continue;
            const child = this.index.getTask(entry.taskId);
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
    private renderInlineChildren(
        contentContainer: HTMLElement,
        task: DisplayTask,
        items: ChildRenderItem[],
        hold: CardHold,
        component: Component,
        settings: TaskViewerSettings,
        parentMarkdown: string,
        expandChildren = false
    ): LateContent {
        const nameAt = (index: number) => hold.childAt(index);
        if (!expandChildren && items.length >= settings.childCollapseThreshold) {
            const parentLate = renderCardMarkdown(this.app, parentMarkdown, contentContainer, task.file, component);
            const childrenLate = this.childSectionRenderer.renderCollapsed(
                contentContainer,
                items,
                nameAt,
                this.expanded,
                () => hold.key,
                task.file,
                component,
                settings,
                task.startDate,
                this.getChildOverdueIcon(task, settings)
            );
            return Promise.all([parentLate, childrenLate]).then(() => undefined);
        }

        // Under the parent's line, each item goes one level in.
        const indentedItems = items.map(item => ({ ...item, markdown: '    ' + item.markdown }));
        return this.childSectionRenderer.renderParentWithChildren(
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
     * count, checkbox — stays legible). Every draw starts from a freshly
     * built content subtree, so no restore is necessary. Laying it again on
     * the same subtree changes only text that came in since: the first run
     * already holds the mask, the rest are empty and the links hidden. That
     * is what the draw relies on to mask late content (`render`).
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
