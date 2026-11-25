import type { App } from 'obsidian';
import { t } from '../../i18n';
import type { Task } from '../../types';
import type { PluginContext } from '../../PluginContext';
import type { TaskCardRenderer } from '../../views/taskcard/TaskCardRenderer';
import type { IndexReads } from '../../services/core/TaskIndex';
import type { Operations } from '../../services/operations/Operations';
import { toDisplayTask } from '../../services/display/DisplayTaskConverter';
import { OverlayShell, type OverlayFrame } from '../../views/sharedUI/OverlayShell';
import { TaskHubForm, type TaskHubFocusField } from './TaskHubForm';
import { TaskHubSource } from './TaskHubSource';
import { TaskHubSourceView } from './TaskHubSourceView';
import { RowHost } from './RowHost';
import { DraftHost } from './DraftHost';
import type { PanelHost } from './HubHost';
import type { CreatePlace, CreatePlaces } from '../../services/data/CreatePlaces';
import type { DraftSeed } from '../../services/data/TaskDraft';
import { indentUnit } from '../../utils/ObsidianConfig';
import type { FieldFocus } from '../../utils/FieldFocus';
import { TabStrip } from '../../views/sharedUI/TabStrip';
import type { DestinationAsk, NotePlaces } from '../../services/data/NotePlaces';
import { NoteName } from '../../services/data/NoteName';
import { PlacePane } from '../place/PlacePane';

export interface TaskHubDeps {
    taskRenderer: TaskCardRenderer;
    index: IndexReads;
    operations: Operations;
    plugin: PluginContext;
}

export interface TaskHubPanelOptions {
    focusField?: TaskHubFocusField;
}

/** Where the panel lets a source mode be built, and what it may ask of the panel. */
export interface SourceSlots {
    /** Where its switch goes, above the card. */
    bar: HTMLElement;
    /** The card's element, hidden while the source is open. */
    card: HTMLElement;
    /** Where the source goes, in the card's place. */
    pane: HTMLElement;
    /** Where its row of controls goes: the overlay's foot, below the body. */
    foot: HTMLElement;
    /** Close the hub, asking nothing more. */
    close(): void;
}

/** What the panel asks of its source mode (`TaskHubSource`) as the hub closes. */
export type HubSource = Pick<TaskHubSource, 'beforeClose' | 'yieldsEscape' | 'takesBack' | 'dispose'>;

/** Builds the source mode in the panel's slots, once, as the hub is built. */
export type SourceMaker = (slots: SourceSlots) => HubSource;

/**
 * What an entry builds in the place tab's pane of a hub: fields that say
 * where the task goes, or a place shown with no field. The form shuts it
 * with its own fields and focuses its first field (`'place'`).
 */
export interface HubPane {
    /** Where the focus goes for its first field, and how its text is met there; null when it has no field. */
    focus(): FieldFocus | null;
    /** Its fields enabled or not, as the form's are. */
    setEnabled(enabled: boolean): void;
    /** The hub closed: it takes nothing more. */
    dispose(): void;
}

/** Builds the place tab's pane in `pane`, once, as the hub is built. */
export type PaneMaker = (pane: HTMLElement) => HubPane;

/** The tabs of a hub that has a place tab. */
type HubTab = 'properties' | 'place';

/** What an entry makes of a hub besides its host. */
interface HubShape {
    /** Builds the source mode; null, the hub has none, nor its switch. */
    source: SourceMaker | null;
    /** Whether the card is drawn as one nothing is done on (`RenderOptions.inert`). */
    inert: boolean;
    /** The hubs this one opens one at a time with; null, it opens over whatever is open. */
    turns: OneAtATime | null;
    /** Builds the place tab's pane; null, the hub has no tabs, the form alone under the card. */
    place: PaneMaker | null;
}

/** A hub as the hubs it opens one at a time with see it: what closing it as the user would does. */
interface Turn {
    requestClose(): Promise<boolean>;
}

/**
 * Hubs that are open one at a time: one opens once the one open now has
 * given way as the user closing it would — not while it holds a draft,
 * which it asks about in its own place. The one asked for is not opened
 * then, nor later: throwing the draft away there closes that hub and goes no
 * further. A close that waits (`CloseAnswer`) is waited for; a hub asked for
 * meanwhile goes first. With none open, the hub opens within the call that
 * asks for it, so its caller finds it open and drawn as the call returns.
 */
class OneAtATime {
    private active: Turn | null = null;
    /** The hub asked for last; one asked for while another waits for a hub to close goes before it. */
    private wanted: Turn | null = null;

    /**
     * Open `turn` by `openIt` once the hub open now has given way; not at
     * all if it does not, or if another is asked for meanwhile. The body of
     * an async function runs within the call up to its first await: with no
     * hub open the loop awaits nothing, and `openIt` runs before this returns.
     */
    async open(turn: Turn, openIt: () => void): Promise<void> {
        this.wanted = turn;
        for (let current = this.active; current; current = this.active) {
            const closed = await current.requestClose();
            if (this.wanted !== turn) return;
            if (!closed) {
                this.wanted = null;
                return;
            }
            // Closed: its teardown let go of the place, which this makes sure of.
            if (this.active === current) this.active = null;
        }
        this.wanted = null;
        this.active = turn;
        openIt();
    }

    /** `turn` has closed: the next one asked for opens with nothing to wait for. */
    release(turn: Turn): void {
        if (this.active === turn) this.active = null;
    }
}

/**
 * タスクハブパネル — 「タスクを開く」の単一の目的地。
 *
 * 上部にカードプレビュー（ホストが描き直させる）、下部にプロパティ編集
 * フォーム（値の読み書きはホスト `PanelHost`）。read-only タスクは
 * プレビューのみに縮退。ソースモードを作る関数を入口が渡したときだけ、
 * プレビューの上の切り替えで、カードの代わりに行と部分木のソースを編集
 * できる（TaskHubSource）。渡さなければ切り替えの bar も作らない。
 * 位置の中身を作る関数（`PaneMaker`）を入口が渡したときだけ、カードの下に
 * 「プロパティ」と「位置」のタブ（TabStrip）を置き、フォームをプロパティの
 * 中身に、入口の作る中身を位置の中身にする。初めのタブは初めのフォーカスの
 * 欄のタブで、フォームは欄にフォーカスを置く前にそのタブを選ぶ。
 * 殻の上の場所に題を出す。まだ書いていないタスクのハブは「新しいタスクを作成」
 * （子を作るときも同じ題）、今あるタスクのハブは、どの入口から開いても
 * 「プロパティを編集」である。
 * 開く入口は2つある。今あるタスクのハブ（`openRowHub`）は、今あるタスクの
 * ハブどうしで同時に1つだけ開く（`OneAtATime`）。まだ書いていないタスクの
 * ハブ（`openDraftHub`）は、その規則に入らず、開いているハブの上に重なって
 * 開き、閉じると下のハブがそのまま残る。カードは何もできない形で描く。
 * 待つ相手（閉じるのを待つ今あるタスクのハブ）が無ければ、開く呼び出しが
 * 返る時点でハブは開き、カードを描き終えている。
 * 利用者が閉じる経路（×、Escape、外側、下へ払う、戻る、別のハブを開く）は
 * どれも OverlayShell.beforeClose を通る。ソースに下書きがあれば捨てるかを
 * 確かめ、無ければフォームが打ちかけの欄を保存し、保存できない値があれば
 * 問い、書き込みを待つ（TaskHubForm.beforeClose）。閉じなかったなら、別の
 * ハブを開こうとした操作は忘れる。
 * パネルにフォーカスがある間は Obsidian のホットキーを止める（OverlayShell の
 * keymap）。フォームの欄やソースのエディタのキーが背後のノートに効かないように。
 * 初めのフォーカスは focusField の欄、無ければパネル自身（OverlayShell の
 * initialFocus）。開いた直後から止まり、スマホでキーボードは上がらない。
 * 欄の文字は、メニューから欄を選んだときと同じ規則で、全部
 * 選ぶか末尾にカーソルを置く（TaskHubForm の selectionOnFocus）。
 *
 * DOM スケルトン・swipe dismiss・close animation・keyboard awareness・
 * escape handling は OverlayShell (mode: 'centered') に委譲。
 * このクラスは domain logic（開く規則、preview、form、source）のみ。
 */
export class TaskHubPanel {
    /** The hubs on rows: one at a time. */
    private static readonly rowHubs = new OneAtATime();

    private overlay = new OverlayShell();
    private readonly turn: Turn = { requestClose: () => this.overlay.requestClose() };
    private previewEl: HTMLElement | null = null;
    private form: TaskHubForm | null = null;
    private source: HubSource | null = null;
    private tabs: TabStrip<HubTab> | null = null;
    private placePane: HubPane | null = null;

    /**
     * Open the hub on a row the note already has (a segment of a split task
     * opens its row's): its host writes each change to the row at once and
     * follows the row in the index (`RowHost`), and the source mode edits
     * the row and its subtree, following the row as the host does.
     */
    static openRowHub(app: App, task: Task, deps: TaskHubDeps, options: TaskHubPanelOptions = {}): Promise<void> {
        let source: TaskHubSource | null = null;
        const host = new RowHost(
            task,
            { app, plugin: deps.plugin, index: deps.index, operations: deps.operations },
            (row) => source?.follow(row),
        );
        const makeSource: SourceMaker = ({ bar, card, pane, foot, close }) => {
            const view = new TaskHubSourceView(app, bar, card, pane, foot, {
                enter: () => { void source?.enter(); },
                apply: () => { void source?.apply(); },
                cancel: () => source?.cancel(),
                discard: () => source?.discard(),
                keep: () => source?.keep(),
                draftText: () => source?.draftText() ?? null,
            });
            source = new TaskHubSource(host.task(), {
                drained: () => host.drained(),
                confirm: (id) => deps.operations.confirmTask(id),
                reread: (id) => deps.index.getTask(id),
                // The refusal is shown under the draft it leaves; a notice would say it twice.
                replace: (id, base, replacement) => deps.operations.replaceSubtree(id, base, replacement, { tellRefusal: false }),
                indentUnit: () => indentUnit(app),
                lockForm: (locked) => host.setSourceOpen(locked),
                closeHub: close,
            }, view);
            return source;
        };
        return new TaskHubPanel(app, host, deps, options, { source: makeSource, inert: false, turns: TaskHubPanel.rowHubs, place: null }).open();
    }

    /**
     * Open the hub on a task not written yet, to be put in `place`, or in a
     * note the user chooses when `place` is null, holding `seed`'s values:
     * its host puts what the fields hand on over the draft and writes nothing
     * until the create (`DraftHost`). There is no row to edit the source of,
     * nor to do anything on from its card. It opens over a hub open now,
     * which stays as it was once this one closes, and it is not one of the
     * hubs on rows that open one at a time.
     *
     * In a note, or in none, it has a place tab whose fields (`PlacePane`)
     * move the draft as they are typed in: opened on the note and its
     * heading, the hub opens on the properties with the focus on the name;
     * on none, the note field empty and the heading the settings' task
     * heading, it opens on the place with the focus on the note. A new
     * note's folder is reckoned from no note. Under a row it has no tabs.
     */
    static openDraftHub(
        app: App,
        place: CreatePlace | null,
        seed: DraftSeed,
        deps: TaskHubDeps & { places: CreatePlaces; notePlaces: Pick<NotePlaces, 'readFields'> },
    ): Promise<void> {
        const host = new DraftHost(place, seed, {
            places: deps.places,
            scopeKeys: () => deps.plugin.settings.scopeKeys,
        });
        const initial: DestinationAsk | null = place === null
            ? { note: { text: '', picked: null }, heading: deps.plugin.settings.taskHeading }
            : place.kind === 'note' ? deps.places.askOf(place) : null;
        const makePlace: PaneMaker | null = initial && ((pane) => new PlacePane(app, pane, {
            initial,
            host: {
                read: (ask) => deps.notePlaces.readFields(ask, NoteName.defaultFolder(app, '')),
                reading: () => host.reading(),
                answered: (answer) => host.answered(answer),
            },
        }));
        const options: TaskHubPanelOptions = { focusField: place === null ? 'place' : 'name' };
        return new TaskHubPanel(app, host, deps, options, { source: null, inert: true, turns: null, place: makePlace }).open();
    }

    private constructor(
        private app: App,
        private readonly host: PanelHost,
        private deps: TaskHubDeps,
        private options: TaskHubPanelOptions,
        private readonly shape: HubShape,
    ) { }

    /**
     * Open, once the hubs it opens one at a time with let it (`OneAtATime`);
     * one opened over whatever is open opens at once. With nothing to wait
     * for, the hub is open and its card drawn as this returns.
     */
    private open(): Promise<void> {
        if (this.overlay.isOpen()) return Promise.resolve();
        if (!this.shape.turns) {
            this.show();
            return Promise.resolve();
        }
        return this.shape.turns.open(this.turn, () => this.show());
    }

    private show(): void {
        const focusField = this.options.focusField;
        this.overlay.open({
            mode: 'centered',
            panelClass: 'tv-overlay__panel--dialog task-hub',
            keymap: this.app.keymap,
            initialFocus: () => {
                const focus = focusField ? this.form?.focusOf(focusField) ?? null : null;
                // The hub is built on this field's tab; a field in another pane would take no focus.
                if (focus) this.tabs?.reveal(focus.to as unknown as Element);
                return focus;
            },
            build: (bodyEl, frame) => this.buildContent(bodyEl, frame),
            onClose: () => this.teardown(),
            // The source's draft first: while the source is open the form is shut.
            beforeClose: () => ((this.source?.beforeClose() ?? true) ? this.form?.beforeClose() ?? 'close' : 'stay'),
            yieldsEscape: () => this.source?.yieldsEscape() ?? false,
            takesBack: () => this.source?.takesBack() ?? false,
        });

        this.host.attach({
            redrawPreview: () => this.renderPreview(),
            close: () => this.close(),
        });
    }

    private buildContent(bodyEl: HTMLElement, frame: OverlayFrame): void {
        // The hub is named for what it does: creating a task not written
        // yet, or editing the properties of a row.
        frame.head.createEl('h2', {
            text: t(this.host.draft ? 'modal.newTask.title' : 'modal.hub.title'),
            cls: 'tv-form__title',
        });

        const makeSource = this.shape.source;
        const bar = makeSource ? bodyEl.createDiv() : null;
        const card = bodyEl.createDiv({ cls: 'task-hub__preview' });
        this.previewEl = card;
        const pane = makeSource ? bodyEl.createDiv() : null;
        const formHost = this.buildTabs(bodyEl).createDiv({ cls: 'task-hub__form' });

        this.renderPreview();

        if (this.host.task().isReadOnly) {
            formHost.createDiv({
                cls: 'task-hub__read-only-notice',
                text: t('modal.hub.readOnlyNotice'),
            });
        } else {
            this.form = new TaskHubForm(formHost, this.host, {
                app: this.app,
                plugin: this.deps.plugin,
                index: this.deps.index,
                requestClose: () => { void this.overlay.requestClose(); },
                foot: frame.foot,
                ...(this.tabs && this.placePane && {
                    place: { el: this.tabs.pane('place'), pane: this.placePane },
                    reveal: (el: Element) => { this.tabs?.reveal(el); },
                }),
            });
        }

        if (makeSource && bar && pane) {
            this.source = makeSource({ bar, card, pane, foot: frame.foot, close: () => this.close() });
        }
    }

    /**
     * The tabs under the card, the place's pane built by the entry, opened on
     * the tab of the field the hub focuses first: where the form goes, the
     * properties' pane. With no place pane, no tabs: the form goes in `bodyEl`.
     */
    private buildTabs(bodyEl: HTMLElement): HTMLElement {
        const makePlace = this.shape.place;
        if (!makePlace) return bodyEl;
        bodyEl.addClass('task-hub__body--tabs');
        const panes = bodyEl.createDiv();
        const tabs = new TabStrip<HubTab>(bodyEl, panes, [
            { id: 'properties', label: t('modal.hub.tabProperties'), icon: 'list' },
            { id: 'place', label: t('modal.hub.tabPlace'), icon: 'map-pin' },
        ], { initial: this.options.focusField === 'place' ? 'place' : 'properties' });
        panes.addClass('tv-tabs__panes--stacked');
        // The row of tabs goes between the card and the panes.
        bodyEl.appendChild(panes);
        this.tabs = tabs;
        this.placePane = makePlace(tabs.pane('place'));
        return tabs.pane('properties');
    }

    private renderPreview(): void {
        if (!this.previewEl) return;
        const settings = this.deps.plugin.settings;

        this.deps.taskRenderer.disposeInside(this.previewEl);
        this.previewEl.empty();

        const card = this.previewEl.createDiv('task-card task-card--in-hub-preview');
        const closePanel = () => this.close();

        const dt = toDisplayTask(this.host.task(), settings.startHour, (id) => this.deps.index.getTask(id));
        this.deps.taskRenderer.render(card, dt, settings, {
            key: { scope: 'hub', name: dt.id },
            // The user asked to look at this task: all of it, its links
            // live, unmasked. A double tap would open the hub it is in.
            expandChildren: true,
            alwaysLinks: true,
            doubleTap: false,
            mask: false,
            inert: this.shape.inert,
            hooks: {
                onNavigate: closePanel,
                // The menu's destructive items close the hub, and its
                // Properties items go to this hub's form, not a hub on top.
                menu: {
                    onDestructiveAction: closePanel,
                    onOpenPropertiesFocus: (field) => this.form?.focusField(field),
                },
            },
        });
    }

    private teardown(): void {
        this.shape.turns?.release(this.turn);

        this.host.dispose();
        this.source?.dispose();
        this.source = null;
        this.placePane?.dispose();
        this.placePane = null;
        this.tabs = null;
        if (this.previewEl) this.deps.taskRenderer.disposeInside(this.previewEl);
        this.previewEl = null;
        this.form = null;
    }

    /** Close now, asking nothing: a navigation away, or a destructive action. */
    close(): void {
        this.overlay.close();
    }
}
