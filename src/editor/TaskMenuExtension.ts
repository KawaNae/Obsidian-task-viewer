import { ViewPlugin, ViewUpdate, Decoration, WidgetType, EditorView, DecorationSet } from '@codemirror/view';
import { StateEffect, RangeSet, type Extension } from '@codemirror/state';
import { editorInfoField, Menu, setIcon, MarkdownView } from 'obsidian';
import type { App } from 'obsidian';
import type { TaskIndex } from '../services/core/TaskIndex';
import type { TaskViewerSettings } from '../types';
import { toDisplayTask } from '../utils/DisplayTaskConverter';
import type { PropertiesMenuBuilder } from '../interaction/menu/builders/PropertiesMenuBuilder';
import type { TimerMenuBuilder } from '../interaction/menu/builders/TimerMenuBuilder';
import type { TaskActionsMenuBuilder } from '../interaction/menu/builders/TaskActionsMenuBuilder';
import type { CheckboxMenuBuilder, CheckboxLineOps } from '../interaction/menu/builders/CheckboxMenuBuilder';
import { TaskLineClassifier } from '../utils/TaskLineClassifier';

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
    taskIndex: TaskIndex,
    propertiesBuilder: PropertiesMenuBuilder,
    timerBuilder: TimerMenuBuilder,
    actionsBuilder: TaskActionsMenuBuilder,
    checkboxBuilder: CheckboxMenuBuilder,
    getSettings: () => TaskViewerSettings
): TaskMenuExtensionResult {

    const showMenu = (view: EditorView, lineNumber: number, btnEl: HTMLElement) => {
        const info = view.state.field(editorInfoField);
        const filePath = info?.file?.path;
        if (!filePath) return;

        const task = taskIndex.getTaskByFileLine(filePath, lineNumber);
        const menu = new Menu();

        if (task) {
            // Recognized task: full menu
            const dt = toDisplayTask(task, getSettings().startHour);
            propertiesBuilder.addStatusSubmenu(menu, task);
            propertiesBuilder.buildPropertiesSubmenu(menu, dt, null);
            menu.addSeparator();
            timerBuilder.addTimerSubmenu(menu, task);
            menu.addSeparator();
            actionsBuilder.addTaskActions(menu, task);
        } else {
            // Plain checkbox: status + basic actions
            const lineText = view.state.doc.line(lineNumber + 1).text; // CM6 lines are 1-based

            const ops: CheckboxLineOps = {
                updateLine: (content) => taskIndex.updateLine(filePath, lineNumber, content),
                insertLineAfter: (content) => taskIndex.insertLineAfterLine(filePath, lineNumber, content),
                deleteLine: () => taskIndex.deleteLine(filePath, lineNumber),
            };

            checkboxBuilder.addFullMenu(menu, lineText, getSettings(), ops);
        }

        const rect = btnEl.getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom });
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
                        const isTask = !!taskIndex.getTaskByFileLine(filePath, lineNumber);
                        show = isTask ? settings.editorMenuForTasks : settings.editorMenuForCheckboxes;
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

    const unsubscribe = taskIndex.onChange(() => {
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
