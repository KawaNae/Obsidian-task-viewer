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
import { RowHost, type MoveOpening } from './RowHost';
import type { MoveStart } from './RowMove';
import { getOriginalTaskId } from '../../services/display/DisplayTaskConverter';
import { RowPlace } from './RowPlace';
import { DraftHost } from './DraftHost';
import type { HubForm, HubPlace, PlaceMaker, PanelHost } from './HubHost';
import type { CreatePlace, CreatePlaces } from '../../services/data/CreatePlaces';
import type { DraftSeed } from '../../services/data/TaskDraft';
import { indentUnit } from '../../utils/ObsidianConfig';
import type { DestinationAsk, NotePlaces } from '../../services/data/NotePlaces';
import { NoteName } from '../../services/data/NoteName';
import { PlacePane } from '../place/PlacePane';
import { PlaceShown } from '../place/PlaceShown';

export interface TaskHubDeps {
    taskRenderer: TaskCardRenderer;
    index: IndexReads;
    operations: Operations;
    plugin: PluginContext;
}

export interface TaskHubPanelOptions {
    focusField?: TaskHubFocusField;
}

/**
 * How a hub on a row opens: on a field (`focusField`), or in a move of the
 * row (`move`), the fields of where it goes opened as `MoveStart` says.
 */
export type RowHubOptions = TaskHubPanelOptions | { move: MoveStart };

/** Where the panel lets a source mode be built, and what it may ask of the panel. */
export interface SourceSlots {
    /** Where its switch goes: on the title's line, after the title. */
    toggle: HTMLElement;
    /** Where it says why it cannot open: the body's first row, above the card. */
    shut: HTMLElement;
    /** The card's element, hidden while the source is open. */
    card: HTMLElement;
    /** Where the source goes, in the card's place. */
    pane: HTMLElement;
    /** Where its row of controls goes: the overlay's foot, below the body. */
    foot: HTMLElement;
}

/** What the panel asks of its source mode (`TaskHubSource`) as the hub closes. */
export type HubSource = Pick<TaskHubSource, 'beforeClose' | 'yieldsEscape' | 'takesBack' | 'dispose'>;

/** Builds the source mode in the panel's slots, once, as the hub is built. */
export type SourceMaker = (slots: SourceSlots) => HubSource;

/** What an entry makes of a hub besides its host. */
interface HubShape {
    /** Builds the source mode; null, the hub has none, nor its switch. */
    source: SourceMaker | null;
    /** The hubs this one opens one at a time with; null, it opens over whatever is open. */
    turns: OneAtATime | null;
    /** Builds where the task goes, in the form's basic tab; null, the hub says no place. */
    place: PlaceMaker | null;
    /** The hub's title: what kind of hub it is, whatever its host holds not written yet. */
    title: string;
    /** What the card menu's item that moves the row does in this hub; null, the item opens a hub of its own. */
    beginMove: (() => void) | null;
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
 * フォーム（値の読み書きはホスト `PanelHost`）。フォームは欄を「基本」と
 * 「詳細」のタブに分けて持ち、パネルはタブを知らない。read-only タスクは
 * プレビューのみに縮退。ソースモードを作る関数を入口が渡したときだけ、
 * 題の行の切り替えで、カードの代わりに行と部分木のソースを編集
 * できる（TaskHubSource）。渡さなければ切り替えも作らない。
 * 位置を作る関数（`PlaceMaker`）を入口が渡したときは、それをフォームへ
 * 渡し、フォームが「基本」の日付の後ろで呼ぶ。初めのフォーカスの欄も
 * フォームへ渡し、フォームはその欄のタブで開く。
 * 殻の上の場所に題を出す。まだ書いていないタスクのハブは「新しいタスクを作成」
 * （子を作るときも同じ題）、今あるタスクのハブは、どの入口から開いても
 * 「タスクを編集」である。
 * 開く入口は2つある。今あるタスクのハブ（`openRowHub`）は、今あるタスクの
 * ハブどうしで同時に1つだけ開く（`OneAtATime`）。まだ書いていないタスクの
 * ハブ（`openDraftHub`）は、その規則に入らず、開いているハブの上に重なって
 * 開き、閉じると下のハブがそのまま残る。
 * カードは、ホストが行を渡すとき（`PanelHost.cardRows`）はその行から、子も
 * 進み具合の数も描き、何もできない形になる。まだ書いていないタスクのハブと、
 * 移動の間の今あるタスクのハブがそれに当たる。ほかは索引から描く。
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
    /** A row read only: where it stands, in the form's place, which has no field. */
    private placeOnly: PlaceOnly | null = null;
    private source: HubSource | null = null;

    /**
     * Open the hub on a row the note already has (a segment of a split task
     * opens its row's): its host writes each change to the row at once and
     * follows the row in the index (`RowHost`), and the source mode edits
     * the row and its subtree, following the row as the host does. Its basic
     * tab, or, on a row that is read only, the place under the notice, shows
     * where the row stands with no field: the note, the heading and the
     * parent the host reads (`RowPlace`). On a row that is not read only, a
     * button there begins a move, the fields of where the row goes in the
     * place's stead, the changes held until the move (`RowHost.beginMove`);
     * the card menu's item that moves the row begins one too, on where a send
     * goes (`'defaults'`).
     *
     * Opened in a move (`RowHubOptions.move`), the row is read from the disk
     * first (`NoteOps.previewSend`), and the hub opens only on a row read as
     * the index's copy, which the user is told otherwise: the basic tab chosen
     * and the fields of where the row goes in the place, the focus on the note.
     */
    static async openRowHub(app: App, task: Task, deps: TaskHubDeps, options: RowHubOptions = {}): Promise<void> {
        const noteOps = deps.plugin.getNoteOps();
        let opening: MoveOpening | null = null;
        if ('move' in options) {
            const preview = await noteOps.previewSend([getOriginalTaskId(task)]);
            if (!preview) return;
            opening = { preview, start: options.move };
        }
        let source: TaskHubSource | null = null;
        const host = new RowHost(
            task,
            {
                app, plugin: deps.plugin, index: deps.index, operations: deps.operations,
                noteOps, indentUnit: () => indentUnit(app),
            },
            { redraw: () => source?.redraw(), hold: (held) => source?.hold(held) },
            opening,
        );
        const makeSource: SourceMaker = (slots) => {
            const apply = host.sourceApply;
            const view = new TaskHubSourceView(app, slots, {
                enter: () => { void source?.enter(); },
                back: () => source?.back(),
                draftText: () => source?.draftText() ?? null,
                cancel: () => apply.back(),
                apply: () => { void apply.apply(); },
                discard: () => apply.discard(),
                keep: () => apply.keep(),
            });
            source = new TaskHubSource({ seat: () => host.seat(), indentUnit: () => indentUnit(app) }, view);
            return source;
        };
        const makePlace: PlaceMaker = (parent) => new RowPlace(app, parent, host, !host.task().isReadOnly);
        const panelOptions: TaskHubPanelOptions = 'move' in options ? { focusField: 'place' } : options;
        return new TaskHubPanel(app, host, deps, panelOptions, {
            source: makeSource, turns: TaskHubPanel.rowHubs, place: makePlace, title: t('modal.hub.title'),
            beginMove: () => { void host.beginMove('defaults'); },
        }).open();
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
     * In a note, or in none, its basic tab has the place's fields
     * (`PlacePane`), which move the draft as they are typed in: opened on
     * the note and its heading, the focus is on the name; on none, the note
     * field empty and the heading the settings' task heading, it is on the
     * note. A new note's folder is reckoned from no note. Under a row, where
     * the place cannot be changed, the basic tab shows the parent's note, the
     * heading it stands under and the parent, with no field (`PlaceShown`),
     * as the place is read; the focus is on the name.
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
        const makePlace: PlaceMaker = initial
            ? (parent) => new PlacePane(app, parent, {
                initial,
                host: {
                    read: (ask) => deps.notePlaces.readFields(ask, NoteName.defaultFolder(app, '')),
                    reading: () => host.reading(),
                    answered: (answer) => host.answered(answer),
                },
            })
            : (parent) => new PlaceShown(parent, () => host.shown(), { why: t('modal.newTask.childFixed') });
        const options: TaskHubPanelOptions = { focusField: place === null ? 'place' : 'name' };
        return new TaskHubPanel(app, host, deps, options, {
            source: null, turns: null, place: makePlace, title: t('modal.newTask.title'), beginMove: null,
        }).open();
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
            // The form is built on this field's tab (`TaskHubFormDeps.opensOn`).
            initialFocus: () => (focusField ? this.form?.focusOf(focusField) ?? null : null),
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
        // The hub is named for what it does, by its entry: creating a task
        // not written yet, or editing a row, whatever its host holds not
        // written yet meanwhile.
        frame.head.createEl('h2', { text: this.shape.title, cls: 'tv-form__title' });

        // The source's switch shares the title's line, so the body starts
        // with the card; why the source cannot open is the body's first row.
        const makeSource = this.shape.source;
        if (makeSource) frame.head.addClass('task-hub__head');
        const toggle = makeSource ? frame.head.createDiv() : null;
        const shut = makeSource ? bodyEl.createDiv() : null;
        const card = bodyEl.createDiv({ cls: 'task-hub__preview' });
        this.previewEl = card;
        const pane = makeSource ? bodyEl.createDiv() : null;
        const formHost = bodyEl.createDiv({ cls: 'task-hub__form' });

        this.renderPreview();

        if (this.host.task().isReadOnly) {
            formHost.createDiv({
                cls: 'task-hub__read-only-notice',
                text: t('modal.hub.readOnlyNotice'),
            });
            if (this.shape.place) {
                this.placeOnly = new PlaceOnly(this.shape.place(formHost));
                this.host.bind(this.placeOnly);
            }
        } else {
            // The body lays the form's tabs out with the card (`_task-hub.css`).
            bodyEl.addClass('task-hub__body--tabs');
            const focusField = this.options.focusField;
            this.form = new TaskHubForm(formHost, this.host, {
                app: this.app,
                plugin: this.deps.plugin,
                index: this.deps.index,
                requestClose: () => { void this.overlay.requestClose(); },
                foot: frame.foot,
                hasFocus: () => this.hasFocus(),
                ...(this.shape.place && { place: this.shape.place }),
                ...(focusField && { opensOn: focusField }),
            });
        }

        if (makeSource && toggle && shut && pane) {
            this.source = makeSource({ toggle, shut, card, pane, foot: frame.foot });
        }
    }

    /** Whether the focus is on something in the hub's panel: not on the panel itself, which holds it while nothing else does. */
    private hasFocus(): boolean {
        const panel = this.overlay.getPanel();
        const active = panel?.ownerDocument.activeElement ?? null;
        return panel !== null && active !== null && active !== panel && panel.contains(active);
    }

    private renderPreview(): void {
        if (!this.previewEl) return;
        const settings = this.deps.plugin.settings;

        this.deps.taskRenderer.disposeInside(this.previewEl);
        this.previewEl.empty();

        const card = this.previewEl.createDiv('task-card task-card--in-hub-preview');
        const closePanel = () => this.close();

        // The host's rows, where the index holds none of the task as the card
        // shows it: the card is then one nothing is done on.
        const rows = this.host.cardRows();
        const dt = toDisplayTask(this.host.task(), settings.startHour, rows ?? ((id) => this.deps.index.getTask(id)));
        this.deps.taskRenderer.render(card, dt, settings, {
            key: { scope: 'hub', name: dt.id },
            // The user asked to look at this task: all of it, its links
            // live, unmasked. A double tap would open the hub it is in.
            expandChildren: true,
            alwaysLinks: true,
            doubleTap: false,
            mask: false,
            ...(rows && { rows }),
            hooks: {
                onNavigate: closePanel,
                // The menu's destructive items close the hub, and its
                // Properties items and its move go to this hub, not a hub on top.
                menu: {
                    onDestructiveAction: closePanel,
                    onOpenPropertiesFocus: (field) => this.form?.focusField(field),
                    ...(this.shape.beginMove && { onBeginMove: this.shape.beginMove }),
                },
            },
        });
    }

    private teardown(): void {
        this.shape.turns?.release(this.turn);

        this.host.dispose();
        this.source?.dispose();
        this.source = null;
        this.form?.dispose();
        this.placeOnly?.dispose();
        this.placeOnly = null;
        if (this.previewEl) this.deps.taskRenderer.disposeInside(this.previewEl);
        this.previewEl = null;
        this.form = null;
    }

    /** Close now, asking nothing: a navigation away, or a destructive action. */
    close(): void {
        this.overlay.close();
    }
}

/**
 * The form of a hub on a row that is read only: no field, only where the
 * task stands (the entry's place), drawn again as the host tells a form to.
 * There is nothing to shut, to write or to create.
 */
class PlaceOnly implements HubForm {
    constructor(private readonly place: HubPlace) { }

    refresh(): void {
        this.place.refresh();
    }

    showShut(): void { }
    sayPut(): void { }
    sayWrite(): void { }
    sayPlace(): void { }
    showDraft(): void { }
    write(): void { }
    putTyped(): boolean {
        return false;
    }
    notWritten(): void { }

    dispose(): void {
        this.place.dispose();
    }
}
