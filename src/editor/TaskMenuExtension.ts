import { ViewPlugin, ViewUpdate, Decoration, WidgetType, EditorView, DecorationSet } from '@codemirror/view';
import { StateEffect, RangeSet, type Extension } from '@codemirror/state';
import { editorInfoField, setIcon, MarkdownView } from 'obsidian';
import type { App } from 'obsidian';
import type { TaskReadService } from '../services/data/TaskReadService';
import type { TaskWriteService } from '../services/data/TaskWriteService';
import type { TaskViewerSettings } from '../types';
import { toDisplayTask } from '../services/display/DisplayTaskConverter';
import type { PropertiesMenuBuilder } from '../interaction/menu/builders/PropertiesMenuBuilder';
import type { TimerMenuBuilder } from '../interaction/menu/builders/TimerMenuBuilder';
import type { TaskActionsMenuBuilder } from '../interaction/menu/builders/TaskActionsMenuBuilder';
import type { CheckboxMenuBuilder, CheckboxLineOps } from '../interaction/menu/builders/CheckboxMenuBuilder';
import type { ValidationMenuBuilder } from '../interaction/menu/builders/ValidationMenuBuilder';
import type { MenuPresenter } from '../interaction/menu/MenuPresenter';
import { TaskLineClassifier } from '../services/parsing/utils/TaskLineClassifier';
import { getTaskNotation } from '../services/filter/parserTaxonomy';

const taskIndexChanged = StateEffect.define<void>();
const settingsChanged = StateEffect.define<void>();

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
        btn.className = 'tv-editor-menu-btn';
        btn.setAttribute('aria-label', 'Task menu');
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
    readService: TaskReadService,
    writeService: TaskWriteService,
    propertiesBuilder: PropertiesMenuBuilder,
    timerBuilder: TimerMenuBuilder,
    actionsBuilder: TaskActionsMenuBuilder,
    checkboxBuilder: CheckboxMenuBuilder,
    validationBuilder: ValidationMenuBuilder,
    menuPresenter: MenuPresenter,
    getSettings: () => TaskViewerSettings
): TaskMenuExtensionResult {

    const showMenu = (view: EditorView, lineNumber: number, btnEl: HTMLElement) => {
        const info = view.state.field(editorInfoField);
        const filePath = info?.file?.path;
        if (!filePath) return;

        const task = readService.getTaskByFileLine(filePath, lineNumber);
        const isTaskviewerTask = !!task && getTaskNotation(task.parserId) === 'taskviewer';
        const rect = btnEl.getBoundingClientRect();

        menuPresenter.present((menu) => {
            if (isTaskviewerTask && task) {
                // Recognized taskviewer-notation task: full menu (G1〜G4)
                validationBuilder.addValidationWarning(menu, task);
                const dt = toDisplayTask(task, getSettings().startHour, (id) => readService.getTask(id));
                // G1: 自身のデータ操作
                propertiesBuilder.addStatusSubmenu(menu, task);
                propertiesBuilder.buildPropertiesSubmenu(menu, dt, null);
                actionsBuilder.addOwnDataActions(menu, task);
                timerBuilder.addTimerSubmenu(menu, task);
                menu.addSeparator();
                // G2: 子のデータ操作
                actionsBuilder.addChildActions(menu, task);
                menu.addSeparator();
                // G3: 複製
                actionsBuilder.addDuplicateActions(menu, task);
                menu.addSeparator();
                // G4: 破壊的変更
                actionsBuilder.addDestructiveActions(menu, task);
            } else {
                // Plain checkbox or external-notation task (tasks-plugin / day-planner):
                // status + basic actions, writing through CheckboxLineOps preserves the original notation.
                const lineText = view.state.doc.line(lineNumber + 1).text; // CM6 lines are 1-based

                const ops: CheckboxLineOps = {
                    updateLine: (content) => writeService.updateLine(filePath, lineNumber, content),
                    insertLineAfter: (content) => writeService.insertLineAfterLine(filePath, lineNumber, content),
                    deleteLine: () => writeService.deleteLine(filePath, lineNumber),
                };

                checkboxBuilder.addFullMenu(menu, lineText, getSettings(), ops, filePath);
            }
        }, { kind: 'belowRect', rect });
    };

    const buildDecorations = (view: EditorView): DecorationSet => {
        const settings = getSettings();
        if (!settings.editorMenuForTasks && !settings.editorMenuForCheckboxes) {
            return RangeSet.of([]);
        }

        const needsFilter = !settings.editorMenuForTasks || !settings.editorMenuForCheckboxes;
        let filePath: string | undefined;
        if (needsFilter) {
            const info = view.state.field(editorInfoField);
            filePath = info?.file?.path;
        }

        const widgets: { from: number; deco: Decoration }[] = [];
        const seen = new Set<number>();

        for (const { from, to } of view.visibleRanges) {
            let pos = from;
            while (pos <= to) {
                const line = view.state.doc.lineAt(pos);
                const lineNumber = line.number - 1; // CM6 is 1-based, Task.line is 0-based
                const lineText = view.state.doc.sliceString(line.from, line.to);

                if (TaskLineClassifier.isTaskLine(lineText) && !seen.has(line.number)) {
                    seen.add(line.number);
                    let show = true;
                    if (needsFilter && filePath) {
                        const found = readService.getTaskByFileLine(filePath, lineNumber);
                        const isTaskviewerTask = !!found && getTaskNotation(found.parserId) === 'taskviewer';
                        show = isTaskviewerTask ? settings.editorMenuForTasks : settings.editorMenuForCheckboxes;
                    }
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

            constructor(view: EditorView) {
                this.decorations = buildDecorations(view);
            }

            update(update: ViewUpdate) {
                if (
                    update.docChanged ||
                    update.viewportChanged ||
                    update.transactions.some(tr =>
                        tr.effects.some(e => e.is(taskIndexChanged) || e.is(settingsChanged))
                    )
                ) {
                    this.decorations = buildDecorations(update.view);
                }
            }
        },
        {
            decorations: (v) => v.decorations,
        }
    );

    const unsubscribe = readService.onChange(() => {
        app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view instanceof MarkdownView) {
                const cm = (leaf.view.editor as any).cm as EditorView | undefined;
                if (cm) {
                    cm.dispatch({ effects: taskIndexChanged.of(undefined) });
                }
            }
        });
    });

    const notifySettingsChanged = () => {
        app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view instanceof MarkdownView) {
                const cm = (leaf.view.editor as any).cm as EditorView | undefined;
                cm?.dispatch({ effects: settingsChanged.of(undefined) });
            }
        });
    };

    return {
        extension: plugin,
        cleanup: unsubscribe,
        notifySettingsChanged,
    };
}
