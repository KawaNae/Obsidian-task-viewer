import type { TaskReadService } from '../../services/data/TaskReadService';
import type { TaskWriteService } from '../../services/data/TaskWriteService';
import type TaskViewerPlugin from '../../main';
import type { SelectionController } from '../selection/SelectionController';
import type { DragContext } from './DragStrategy';
import { DragRouter } from './DragRouter';
import { DragSession } from './DragSession';

/**
 * View が直接保持する drag 系の facade。
 *
 * 責務は 3 つに絞られている:
 *   1. DOM に listener を bind / unbind する (lifecycle ownership)
 *   2. popout window 切替時の document swap (ownerDocument 変更追従)
 *   3. View からもらった依存を `DragContext` 1 つに束ねて Router/Session に注入
 *
 * pointerdown の解析 / Strategy 生成は `DragRouter`、active gesture の
 * lifecycle (start/move/up + writeService 通知) は `DragSession` に委譲。
 */
export class DragHandler {
    private readonly context: DragContext;
    private readonly session: DragSession;
    private readonly router: DragRouter;

    private currentDoc: Document;

    private readonly boundPointerDown: (e: PointerEvent) => void;
    private readonly boundPointerMove: (e: PointerEvent) => void;
    private readonly boundPointerUp: (e: PointerEvent) => void;
    private readonly boundTouchStart: (e: TouchEvent) => void;
    private readonly boundTouchMove: (e: TouchEvent) => void;

    constructor(
        private readonly container: HTMLElement,
        readService: TaskReadService,
        writeService: TaskWriteService,
        plugin: TaskViewerPlugin,
        selectionController: SelectionController,
        onTaskClick: (taskId: string) => void,
        onTaskMove: () => void,
        getViewStartDate: () => string,
        getViewEndDate: () => string,
        getZoomLevel: () => number,
    ) {
        this.context = {
            container,
            readService,
            writeService,
            plugin,
            selectionController,
            onTaskClick,
            onTaskMove,
            getDateFromCol: (el) => el.dataset.date || null,
            getViewStartDate,
            getViewEndDate,
            getZoomLevel,
        };
        this.session = new DragSession(this.context, container, writeService);
        this.router = new DragRouter(this.context, this.session, container);

        this.boundPointerDown = this.onPointerDown.bind(this);
        this.boundPointerMove = this.onPointerMove.bind(this);
        this.boundPointerUp = this.onPointerUp.bind(this);
        this.boundTouchStart = this.onTouchStart.bind(this);
        this.boundTouchMove = this.onTouchMove.bind(this);

        this.container.addEventListener('pointerdown', this.boundPointerDown);
        this.container.addEventListener('touchstart', this.boundTouchStart, { capture: true, passive: false });
        this.container.addEventListener('touchmove', this.boundTouchMove, { passive: false });

        this.currentDoc = this.container.ownerDocument || document;
        this.currentDoc.addEventListener('pointermove', this.boundPointerMove);
        this.currentDoc.addEventListener('pointerup', this.boundPointerUp);
    }

    /** detail handle 押下時のハンドラ設定。内部で DragRouter に橋渡し。 */
    set onDetailClick(cb: ((taskId: string) => void) | null) {
        this.router.onDetailClick = cb;
    }
    get onDetailClick(): ((taskId: string) => void) | null {
        return this.router.onDetailClick;
    }

    destroy(): void {
        this.container.removeEventListener('pointerdown', this.boundPointerDown);
        this.container.removeEventListener('touchstart', this.boundTouchStart, { capture: true });
        this.container.removeEventListener('touchmove', this.boundTouchMove);
        this.currentDoc.removeEventListener('pointermove', this.boundPointerMove);
        this.currentDoc.removeEventListener('pointerup', this.boundPointerUp);
    }

    private onPointerDown(e: PointerEvent): void {
        // popout window 切替時に doc が変わるので、move/up listener を再取り付け。
        const newDoc = this.container.ownerDocument || document;
        if (newDoc !== this.currentDoc) {
            this.currentDoc.removeEventListener('pointermove', this.boundPointerMove);
            this.currentDoc.removeEventListener('pointerup', this.boundPointerUp);
            this.currentDoc = newDoc;
            this.currentDoc.addEventListener('pointermove', this.boundPointerMove);
            this.currentDoc.addEventListener('pointerup', this.boundPointerUp);
        }
        this.router.handle(e);
    }

    private onPointerMove(e: PointerEvent): void {
        if (!this.session.isActive()) return;
        e.preventDefault();
        this.session.handleMove(e);
    }

    private async onPointerUp(e: PointerEvent): Promise<void> {
        if (!this.session.isActive()) return;
        e.preventDefault();
        await this.session.handleUp(e);
    }

    /**
     * Capture-phase touchstart handler.
     * On a drag handle: stops propagation (blocks Obsidian's gesture recognizers)
     * and cancels the native scroll-gesture decision before WebKit/Blink lock it in.
     */
    private onTouchStart(e: TouchEvent): void {
        const target = e.target as HTMLElement;
        if (target.closest('.task-card__handle-btn')) {
            e.stopPropagation();
            // WebKit/Blink finalize the scroll-gesture decision at touchstart;
            // dynamic touchAction='none' in pointerdown arrives too late.
            if (e.cancelable) e.preventDefault();
        }
    }

    private onTouchMove(e: TouchEvent): void {
        if (this.session.isActive()) {
            e.preventDefault(); // browser gesture recognition を touch event レベルで遮断
        }
    }
}
