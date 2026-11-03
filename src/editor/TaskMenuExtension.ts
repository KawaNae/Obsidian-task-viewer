import { ViewPlugin, type ViewUpdate, Decoration, WidgetType, type EditorView, type DecorationSet } from '@codemirror/view';
import { StateEffect, RangeSet, type Extension, type Transaction, type TransactionSpec } from '@codemirror/state';
import { editorInfoField, setIcon, MarkdownView, Notice } from 'obsidian';
import type { App } from 'obsidian';
import type { IndexReads } from '../services/core/TaskIndex';
import type { TaskViewerSettings } from '../types';
import { toDisplayTask } from '../services/display/DisplayTaskConverter';
import type { PropertiesMenuBuilder } from '../interaction/menu/builders/PropertiesMenuBuilder';
import type { TimerMenuBuilder } from '../interaction/menu/builders/TimerMenuBuilder';
import type { TaskActionsMenuBuilder } from '../interaction/menu/builders/TaskActionsMenuBuilder';
import type { CheckboxMenuBuilder, CheckboxLineOps } from '../interaction/menu/builders/CheckboxMenuBuilder';
import type { ValidationMenuBuilder } from '../interaction/menu/builders/ValidationMenuBuilder';
import type { MenuPresenter } from '../interaction/menu/MenuPresenter';
import type { TaskHubOpener } from '../interaction/menu/MenuHandler';
import { TaskLineClassifier } from '../services/parsing/utils/TaskLineClassifier';
import { lineMenuOf } from './LineMenu';
import { t } from '../i18n';
import { editorCm } from '../utils/editorCm';
import { outlineFor } from './EditorOutline';
import { subtreeAt } from '../services/persistence/RowBasis';
import { keyOf } from './EditorDoc';
import { writeEditorLine, type EditorLineHost } from './EditorWrite';
import { taskShownAt, type ShownTaskLookup } from './ShownTask';
import type { ContentKey } from '../services/core/ContentKey';
import { editorRow, type RowRef } from '../services/persistence/FileLines';
import type { TaskOp } from '../services/persistence/TaskOps';

const taskIndexChanged = StateEffect.define<void>();
const settingsChanged = StateEffect.define<void>();

/**
 * Ask an editor to draw its buttons again, `why` being the index or the
 * settings changed: a transaction of ours, unless the IME is composing in
 * the editor.
 *
 * While a composition is under way, CodeMirror on iOS reads what the IME
 * puts in the document only on the next frame (Chrome on Windows does too,
 * at a composition's start), and a transaction dispatched before that frame
 * drops what it had not read: the browser loses the composition, and the
 * reading the keyboard still holds is typed again behind what it left
 * (かんてn観点). The index changes on a save, every two seconds while typing,
 * at no moment of the input's choosing. So an editor composing is only told
 * to hold the change (`hold`), and draws its buttons at its first update once
 * the composition is over (`redrawsOn`).
 */
export function askToRedraw(
    view: { readonly compositionStarted: boolean; dispatch(spec: TransactionSpec): void },
    why: StateEffect<void>,
    hold: () => void,
): void {
    if (view.compositionStarted) {
        hold();
        return;
    }
    view.dispatch({ effects: why });
}

/**
 * Whether an editor's update draws its buttons again: the document, the
 * part shown, the index or the settings changed, or a change was held while
 * the editor composed (`held`) and the composition is over.
 */
export function redrawsOn(
    update: {
        readonly docChanged: boolean;
        readonly viewportChanged: boolean;
        readonly transactions: readonly Transaction[];
        readonly view: { readonly compositionStarted: boolean };
    },
    held: boolean,
): boolean {
    return update.docChanged
        || update.viewportChanged
        || update.transactions.some(tr => tr.effects.some(e => e.is(taskIndexChanged) || e.is(settingsChanged)))
        || (held && !update.view.compositionStarted);
}

class TaskMenuWidget extends WidgetType {
    constructor(
        private lineNumber: number,
        private showMenu: (view: EditorView, lineNumber: number, btnEl: HTMLElement) => void
    ) {
        super();
    }

    eq(other: TaskMenuWidget): boolean {
        return this.lineNumber === other.lineNumber;
    }

    toDOM(view: EditorView): HTMLElement {
        const btn = document.createElement('button');
        btn.className = 'tv-icon-btn tv-editor-menu-btn';
        btn.setAttribute('aria-label', t('aria.taskMenu'));
        btn.setAttribute('tabindex', '-1');

        const span = document.createElement('span');
        btn.appendChild(span);
        setIcon(span, 'more-horizontal');

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showMenu(view, this.lineNumber, btn);
        });

        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
        });

        return btn;
    }

    ignoreEvent(event: Event): boolean {
        return event.type === 'mousedown';
    }
}

export interface TaskMenuExtensionResult {
    extension: Extension;
    cleanup: () => void;
    notifySettingsChanged: () => void;
}

export function createTaskMenuExtension(
    app: App,
    index: IndexReads,
    lineHost: EditorLineHost,
    propertiesBuilder: PropertiesMenuBuilder,
    timerBuilder: TimerMenuBuilder,
    actionsBuilder: TaskActionsMenuBuilder,
    checkboxBuilder: CheckboxMenuBuilder,
    validationBuilder: ValidationMenuBuilder,
    menuPresenter: MenuPresenter,
    getSettings: () => TaskViewerSettings,
    openTaskHub: TaskHubOpener
): TaskMenuExtensionResult {

    const lookup: ShownTaskLookup = {
        taskAtEditorLine: (path, line, key) => index.taskAtEditorLine(path, line, key),
        readShown: async (editor) => {
            const info = editor.state.field(editorInfoField, false);
            if (info instanceof MarkdownView) await info.save();
            if (info?.file) await index.requestScan(info.file);
        },
    };

    const showMenu = async (view: EditorView, lineNumber: number, btnEl: HTMLElement) => {
        const info = view.state.field(editorInfoField);
        const filePath = info?.file?.path;
        if (!filePath) return;
        // Where the button is now: the scan below may draw it again.
        const rect = btnEl.getBoundingClientRect();

        // The task on the line in what the editor shows, not on the same
        // number of what the index last read.
        const task = await taskShownAt(view, filePath, lineNumber, lookup);
        if (task === null) {
            new Notice(t('notice.editorMenuNotRead'));
            return;
        }
        // Read again since the button was drawn: the line may offer none now.
        const kind = lineMenuOf(task, getSettings());
        if (kind === 'none') return;

        menuPresenter.present((menu) => {
            if (kind === 'task' && task) {
                // Recognized taskviewer-notation task: full menu (G1〜G5)
                validationBuilder.addValidationWarning(menu, task);
                const dt = toDisplayTask(task, getSettings().startHour, (id) => index.getTask(id));
                // G1: 自身のデータ操作
                propertiesBuilder.addStatusSubmenu(menu, task);
                actionsBuilder.addOwnDataActions(menu, task);
                propertiesBuilder.buildPropertiesSubmenu(menu, dt, null,
                    (field) => openTaskHub(task.id, { focusField: field }));
                menu.addSeparator();
                // G2: 自身を記録
                timerBuilder.addTrackSelfItems(menu, task);
                menu.addSeparator();
                // G3: 子のデータ操作
                actionsBuilder.addChildActions(menu, task);
                menu.addSeparator();
                // G4: 複製
                actionsBuilder.addDuplicateActions(menu, task);
                menu.addSeparator();
                // G5: 破壊的変更
                actionsBuilder.addDestructiveActions(menu, task);
            } else {
                // A checkbox the index reads no task on: status and the basic
                // actions, written through CheckboxLineOps as the line stands.
                const lineText = view.state.doc.line(lineNumber + 1).text; // CM6 lines are 1-based

                // The line holds only in the content the menu was opened in.
                const key = keyOf(view.state.doc);
                const at = editorRow(lineNumber, lineText, key);
                // What a delete takes, as the editor shows it now: the line
                // and its subtree. The write takes it only if they still
                // read so.
                const subtree = subtreeAt(outlineFor(view.state.doc), lineNumber);
                // Written in this editor while it shows the note, as the
                // user's own edit is; to the file once it does not (`shows`).
                const write = (target: RowRef, ops: readonly TaskOp[]) =>
                    writeEditorLine(view, filePath, target, ops, lineHost);
                const ops: CheckboxLineOps = {
                    updateLine: (content) => write(at, [{ kind: 'update', text: content }]),
                    insertLineAfter: (content) => write(at, [{ kind: 'copies', side: 'below', lines: [content], children: false }]),
                    deleteLine: () => write(editorRow(lineNumber, lineText, key, subtree), [{ kind: 'remove' }]),
                };

                checkboxBuilder.addFullMenu(menu, lineText, getSettings(), ops);
            }
        }, { kind: 'belowRect', rect });
    };

    const buildDecorations = (view: EditorView): DecorationSet => {
        const settings = getSettings();
        if (!settings.editorMenuForTasks && !settings.editorMenuForCheckboxes) {
            return RangeSet.of([]);
        }
        // Whatever the settings, each line asks the index what it holds: a
        // line of the Tasks or Day Planner notation has no button.
        const filePath = view.state.field(editorInfoField)?.file?.path;

        const widgets: { from: number; deco: Decoration }[] = [];
        const seen = new Set<number>();
        // A checkbox line in code, or one that opens no list item, is text,
        // not a task — the extraction (NoteTasks) reads it so from the same
        // reading; this scan is independent of the extraction (see the TaskLineClassifier
        // import above), so it asks the reading itself.
        const outline = outlineFor(view.state.doc);
        // The key of what the editor shows, made once and only if asked.
        let key: ContentKey | undefined;

        for (const { from, to } of view.visibleRanges) {
            let pos = from;
            while (pos <= to) {
                const line = view.state.doc.lineAt(pos);
                const lineNumber = line.number - 1; // CM6 is 1-based, Task.line is 0-based

                if (TaskLineClassifier.opensTask(outline, lineNumber) && !seen.has(line.number)) {
                    seen.add(line.number);
                    // Not read yet in what the editor shows: a checkbox
                    // until the scan's change draws the buttons again.
                    key ??= keyOf(view.state.doc);
                    const found = filePath ? index.taskAtEditorLine(filePath, lineNumber, key) : undefined;
                    const show = lineMenuOf(found, settings) !== 'none';
                    if (show) {
                        widgets.push({
                            from: line.to,
                            deco: Decoration.widget({
                                widget: new TaskMenuWidget(lineNumber, showMenu),
                                side: 1,
                            }),
                        });
                    }
                }

                pos = line.to + 1;
            }
        }

        widgets.sort((a, b) => a.from - b.from);
        return RangeSet.of(widgets.map(w => w.deco.range(w.from)));
    };

    const plugin = ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;
            /** A change held while the editor composed (`askToRedraw`), not drawn yet. */
            held = false;

            constructor(view: EditorView) {
                this.decorations = buildDecorations(view);
            }

            update(update: ViewUpdate) {
                if (redrawsOn(update, this.held)) {
                    // Drawn from the index and the settings as they are now,
                    // so nothing held is left behind.
                    this.decorations = buildDecorations(update.view);
                    this.held = false;
                }
            }
        },
        {
            decorations: (v) => v.decorations,
        }
    );

    const redrawAll = (why: StateEffect<void>) => {
        app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view instanceof MarkdownView) {
                const cm = editorCm(leaf.view.editor);
                if (!cm) return;
                askToRedraw(cm, why, () => {
                    const drawn = cm.plugin(plugin);
                    if (drawn) drawn.held = true;
                });
            }
        });
    };

    const unsubscribe = index.onChange(() => redrawAll(taskIndexChanged.of(undefined)));

    const notifySettingsChanged = () => redrawAll(settingsChanged.of(undefined));

    return {
        extension: plugin,
        cleanup: unsubscribe,
        notifySettingsChanged,
    };
}
