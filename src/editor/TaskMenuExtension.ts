import { ViewPlugin, ViewUpdate, Decoration, WidgetType, EditorView, DecorationSet } from '@codemirror/view';
import { StateEffect, RangeSet, type Extension } from '@codemirror/state';
import { editorInfoField, Menu, setIcon, MarkdownView } from 'obsidian';
import type { App } from 'obsidian';
import type { TaskIndex } from '../services/core/TaskIndex';
import type { TaskViewerSettings } from '../types';
import type { PropertiesMenuBuilder } from '../interaction/menu/builders/PropertiesMenuBuilder';
import type { TimerMenuBuilder } from '../interaction/menu/builders/TimerMenuBuilder';
import type { TaskActionsMenuBuilder } from '../interaction/menu/builders/TaskActionsMenuBuilder';
import type { EditorCheckboxMenuBuilder } from '../interaction/menu/builders/EditorCheckboxMenuBuilder';

const taskIndexChanged = StateEffect.define<void>();
const CHECKBOX_LINE_REGEX = /^\s*-\s*\[.\]/;

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
}

export function createTaskMenuExtension(
    app: App,
    taskIndex: TaskIndex,
    propertiesBuilder: PropertiesMenuBuilder,
    timerBuilder: TimerMenuBuilder,
    actionsBuilder: TaskActionsMenuBuilder,
    checkboxBuilder: EditorCheckboxMenuBuilder,
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
            propertiesBuilder.addStatusSubmenu(menu, task);
            menu.addSeparator();
            propertiesBuilder.buildPropertiesSubmenu(menu, task, null);
            menu.addSeparator();
            timerBuilder.addTimerSubmenu(menu, task);
            menu.addSeparator();
            actionsBuilder.addTaskActions(menu, task);
        } else {
            // Plain checkbox: status + basic actions
            const editorInfo = info as any;
            if (editorInfo?.editor) {
                checkboxBuilder.addFullMenu(
                    menu, editorInfo.editor, lineNumber,
                    getSettings()
                );
            }
        }

        const rect = btnEl.getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom });
    };

    const buildDecorations = (view: EditorView): DecorationSet => {
        const widgets: { from: number; deco: Decoration }[] = [];

        for (const { from, to } of view.visibleRanges) {
            let pos = from;
            while (pos <= to) {
                const line = view.state.doc.lineAt(pos);
                const lineNumber = line.number - 1; // CM6 is 1-based, Task.line is 0-based
                const lineText = view.state.doc.sliceString(line.from, line.to);

                if (CHECKBOX_LINE_REGEX.test(lineText)) {
                    widgets.push({
                        from: line.to,
                        deco: Decoration.widget({
                            widget: new TaskMenuWidget(lineNumber, showMenu),
                            side: 1,
                        }),
                    });
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
                        tr.effects.some(e => e.is(taskIndexChanged))
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

    return {
        extension: plugin,
        cleanup: unsubscribe,
    };
}
