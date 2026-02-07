import { App, WorkspaceLeaf, MarkdownView } from 'obsidian';
import { SyncDetector } from './SyncDetector';

/**
 * エディタオブザーバー - エディタイベントの監視
 * ユーザーによるローカル編集とファイル同期を区別するための監視機能
 */
export class EditorObserver {
    private currentEditorEl: HTMLElement | null = null;
    private editorListenerBound: ((e: InputEvent) => void) | null = null;

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
        this.app.workspace.on('active-leaf-change', (leaf: WorkspaceLeaf | null) => {
            this.attachEditorListener(leaf);
        });

        // 初回
        this.attachEditorListener(this.app.workspace.activeLeaf);
    }

    /**
     * 指定リーフのエディタにリスナーを設定
     */
    private attachEditorListener(leaf: WorkspaceLeaf | null): void {
        // 既存のリスナーを解除
        if (this.currentEditorEl && this.editorListenerBound) {
            this.currentEditorEl.removeEventListener('beforeinput', this.editorListenerBound as any);
            this.currentEditorEl = null;
            this.editorListenerBound = null;
        }

        if (!leaf) return;
        const view = leaf.view;
        if (!(view instanceof MarkdownView)) return;

        const editor = view.editor;
        const editorEl = (editor as any).cm?.contentDOM as HTMLElement | undefined;
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

        editorEl.addEventListener('beforeinput', this.editorListenerBound as any);
    }
}
