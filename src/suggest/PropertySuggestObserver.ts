import type { App, WorkspaceWindow } from 'obsidian';
import type { TaskViewerSettings } from '../types';
import type TaskViewerPlugin from '../main';
import { WindowAttachment, type AttachmentContext } from './WindowAttachment';

/**
 * Properties View の tv-color / tv-linestyle 行に AbstractInputSuggest と
 * カラーピッカーアイコンを attach し、ネイティブサジェストを抑制する。
 *
 * メインウィンドウとすべてのポップアウトウィンドウ (`workspace.on('window-open')`)
 * を統一的に扱う薄いファサード。実体は WindowAttachment が window 単位で保持する。
 */
export class PropertySuggestObserver {
    private attachments: Map<Window, WindowAttachment> = new Map();
    private ctx: AttachmentContext;

    constructor(
        app: App,
        getSettings: () => TaskViewerSettings,
        suggestHost: TaskViewerPlugin
    ) {
        this.ctx = {
            app,
            getSettings,
            suggestHost,
            attachedInputs: new WeakSet<HTMLElement>(),
        };
    }

    start(): void {
        this.addWindow(window, document);

        const seen = new Set<Window>([window]);
        this.ctx.app.workspace.iterateAllLeaves((leaf) => {
            const container = leaf.getContainer();
            const win = container?.win;
            if (!win || seen.has(win)) return;
            seen.add(win);
            this.addWindow(win, container.doc);
        });

        this.ctx.suggestHost.registerEvent(
            this.ctx.app.workspace.on('window-open', (ww: WorkspaceWindow) => {
                this.addWindow(ww.win, ww.doc);
            })
        );
        this.ctx.suggestHost.registerEvent(
            this.ctx.app.workspace.on('window-close', (ww: WorkspaceWindow) => {
                this.removeWindow(ww.win);
            })
        );
    }

    destroy(): void {
        for (const attachment of this.attachments.values()) {
            attachment.dispose();
        }
        this.attachments.clear();
    }

    private addWindow(win: Window, doc: Document): void {
        if (this.attachments.has(win)) return;
        const attachment = new WindowAttachment(win, doc, this.ctx);
        this.attachments.set(win, attachment);
        attachment.attach();
    }

    private removeWindow(win: Window): void {
        const attachment = this.attachments.get(win);
        if (!attachment) return;
        attachment.dispose();
        this.attachments.delete(win);
    }
}
