import { type App, type EventRef, type WorkspaceLeaf, MarkdownView } from 'obsidian';
import type { SyncDetector } from './SyncDetector';
import { editorCm } from '../../utils/editorCm';

/**
 * エディタオブザーバー - エディタイベントの監視
 * ユーザーによるローカル編集とファイル同期を区別するための監視機能
 */
export class EditorObserver {
    private currentEditorEl: HTMLElement | null = null;
    private editorListenerBound: ((e: InputEvent) => void) | null = null;
    private mousedownListenerBound: ((e: MouseEvent) => void) | null = null;
    private leafChangeRef: EventRef | null = null;

    constructor(
        private app: App,
        private syncDetector: SyncDetector
    ) { }

    /**
     * インタラクションリスナーを設定
     * エディタの切り替えを監視し、ローカル編集を検出
     */
    setupInteractionListeners(): void {
        // アクティブリーフが変わるたびに、そのeditorにbeforeinputリスナーを付け直す
        this.leafChangeRef = this.app.workspace.on('active-leaf-change', (leaf: WorkspaceLeaf | null) => {
            this.attachEditorListener(leaf);
        });

        // 初回
        this.attachEditorListener(this.app.workspace.activeLeaf);
    }

    /**
     * Stop watching, and leave no listener behind.
     *
     * What this observer marks is "the user typed here", which decides whether
     * a change is local and therefore whether a completed command may fire. An
     * observer that outlives its index goes on marking edits into a detector
     * nobody reads, and the workspace subscription would keep re-attaching the
     * pair to whichever editor is opened next.
     */
    dispose(): void {
        if (this.leafChangeRef) {
            this.app.workspace.offref(this.leafChangeRef);
            this.leafChangeRef = null;
        }
        this.detachEditorListener();
    }

    /**
     * 指定リーフのエディタにリスナーを設定
     */
    private attachEditorListener(leaf: WorkspaceLeaf | null): void {
        this.detachEditorListener();

        if (!leaf) return;
        const view = leaf.view;
        if (!(view instanceof MarkdownView)) return;

        const editor = view.editor;
        const editorEl = editorCm(editor)?.contentDOM;
        if (!editorEl) return;

        this.currentEditorEl = editorEl;

        // beforeinput: ユーザーが実際にタイプする直前
        this.editorListenerBound = (e: InputEvent) => {
            // e.dataがnullでない = 文字入力、削除など (ペーストも含む)
            if (e.data !== null || e.inputType === 'deleteContentBackward' || e.inputType === 'insertFromPaste') {
                const file = view.file;
                if (file) {
                    this.syncDetector.markLocalEdit(file.path);
                }
            }
        };
        editorEl.addEventListener('beforeinput', this.editorListenerBound as EventListener);

        // mousedown: チェックボックスクリック対応
        // Obsidianのチェックボックスクリックはbeforeinputを発火しないため、
        // mousedownでローカル編集をマーキングする
        this.mousedownListenerBound = () => {
            const file = view.file;
            if (file) {
                this.syncDetector.markLocalEdit(file.path);
            }
        };
        editorEl.addEventListener('mousedown', this.mousedownListenerBound);
    }

    /** Take the pair off whichever editor currently carries it. */
    private detachEditorListener(): void {
        if (!this.currentEditorEl) return;
        if (this.editorListenerBound) {
            this.currentEditorEl.removeEventListener('beforeinput', this.editorListenerBound as EventListener);
        }
        if (this.mousedownListenerBound) {
            this.currentEditorEl.removeEventListener('mousedown', this.mousedownListenerBound);
        }
        this.currentEditorEl = null;
        this.editorListenerBound = null;
        this.mousedownListenerBound = null;
    }
}
