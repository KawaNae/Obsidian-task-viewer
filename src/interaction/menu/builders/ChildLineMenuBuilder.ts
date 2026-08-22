import type { App } from 'obsidian';
import type { TaskWriteService } from '../../../services/data/TaskWriteService';
import { CheckboxMenuBuilder, type CheckboxLineOps } from './CheckboxMenuBuilder';
import { createTvFileCallback } from './createTvFileCallback';
import type { PluginContext } from '../../../PluginContext';
import type { Task, ChildLine } from '../../../types';

/**
 * Menu builder for plain checkbox child lines on task cards.
 * Delegates menu construction to CheckboxMenuBuilder,
 * providing TaskWriteService-based line operations.
 */
export class ChildLineMenuBuilder {
    private checkboxMenuBuilder: CheckboxMenuBuilder;

    constructor(
        private app: App,
        private writeService: TaskWriteService,
        private plugin: PluginContext
    ) {
        this.checkboxMenuBuilder = new CheckboxMenuBuilder(
            app,
            () => plugin.settings.startHour,
            createTvFileCallback(writeService)
        );
    }

    showMenu(parentTask: Task, line: ChildLine, bodyLine: number, x: number, y: number): void {
        if (bodyLine < 0) return;
        const settings = this.plugin.settings;

        const ops: CheckboxLineOps = {
            updateLine: (content) => this.writeService.updateChildLine(parentTask.id, bodyLine, content),
            insertLineAfter: (content) => this.writeService.insertChildLineAfter(parentTask.id, bodyLine, content),
            deleteLine: () => this.writeService.deleteChildLine(parentTask.id, bodyLine),
        };

        this.plugin.menuPresenter.present((menu) => {
            this.checkboxMenuBuilder.addFullMenu(menu, line.text, settings, ops, parentTask.file);
        }, { kind: 'position', x, y });
    }
}
