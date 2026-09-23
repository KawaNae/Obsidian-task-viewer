import { type App, type EventRef, type WorkspaceLeaf, type Editor, type MarkdownFileInfo, MarkdownView } from 'obsidian';
import type { EditorSignal } from './EditorSignal';
import { editorCm } from '../../utils/editorCm';

/**
 * How soon after a key or a press an editor's change is taken for the hand's.
 * A command bound to a key (Ctrl+Enter's checkbox toggle), a checkbox clicked
 * in Live Preview, a button on the mobile toolbar: each changes the note in
 * the same task as the input, milliseconds after it (4–34ms on Dev). A change
 * with no input that recent came from somewhere else.
 */
export const HAND_WINDOW_MS = 1000;

/** What the observer listens on for keys and presses: the window, in the app. */
export interface InputSource {
    addEventListener(type: string, listener: (e: Event) => void, options?: boolean): void;
    removeEventListener(type: string, listener: (e: Event) => void, options?: boolean): void;
}

/**
 * エディタオブザーバー - エディタイベントの監視
 * ユーザーによるローカル編集とファイル同期を区別するための監視機能
 *
 * What it raises is the editor's signal (see `EditorSignal`): that a hand
 * changed a note in an editor. Two ways say so. Typing says it directly: a
 * `beforeinput` in the editor's content. Everything else — a checkbox clicked
 * in Live Preview, a command run from a key or the palette, the mobile
 * toolbar — changes the note through the editor without a `beforeinput`, so
 * what says it is a change to the editor that has the focus, within
 * {@link HAND_WINDOW_MS} of a key or a press. A press alone says nothing: a
 * click that places the cursor changes no note, and taking it for a hand's
 * change made the next sync fire as one. The focus is what ties the change to
 * the hand: Obsidian also reports a change when it reloads an open note that
 * something else wrote — a sync, or a write of ours from a card — and a key
 * typed into another note, or a click on a card, is not in that editor.
 */
export class EditorObserver {
    private currentEditorEl: HTMLElement | null = null;
    private editorListenerBound: ((e: InputEvent) => void) | null = null;
    private leafChangeRef: EventRef | null = null;
    private editorChangeRef: EventRef | null = null;
    /** When a key or a press last reached the app, or -Infinity. */
    private lastHand = -Infinity;
    private readonly onHand = (e: Event) => {
        if (e.isTrusted) this.lastHand = this.now();
    };

    constructor(
        private app: App,
        private editorSignal: EditorSignal,
        private readonly inputs: InputSource | null = typeof window === 'undefined' ? null : window,
        private readonly now: () => number = () => Date.now(),
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

        // Captured, so a handler that stops the event on its way down does not
        // hide the key or the press from here.
        this.inputs?.addEventListener('keydown', this.onHand, true);
        this.inputs?.addEventListener('pointerdown', this.onHand, true);
        this.editorChangeRef = this.app.workspace.on('editor-change', (editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
            if (this.now() - this.lastHand > HAND_WINDOW_MS) return;
            if (!editor.hasFocus()) return;
            const file = info.file;
            if (file) this.editorSignal.mark(file.path);
        });

        // 初回
        this.attachEditorListener(this.app.workspace.activeLeaf);
    }

    /**
     * Stop watching, and leave no listener behind.
     *
     * What this observer marks is "the user's hand changed this note", which
     * decides whether a completion no write of ours made may fire. An observer
     * that outlives its index goes on marking edits into a signal nobody
     * reads, and the workspace subscription would keep re-attaching the
     * listener to whichever editor is opened next.
     */
    dispose(): void {
        if (this.leafChangeRef) {
            this.app.workspace.offref(this.leafChangeRef);
            this.leafChangeRef = null;
        }
        if (this.editorChangeRef) {
            this.app.workspace.offref(this.editorChangeRef);
            this.editorChangeRef = null;
        }
        this.inputs?.removeEventListener('keydown', this.onHand, true);
        this.inputs?.removeEventListener('pointerdown', this.onHand, true);
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
                    this.editorSignal.mark(file.path);
                }
            }
        };
        editorEl.addEventListener('beforeinput', this.editorListenerBound as EventListener);
        // A popped-out window's keys and presses do not reach the main one.
        editorEl.addEventListener('keydown', this.onHand, true);
        editorEl.addEventListener('pointerdown', this.onHand, true);
    }

    /** Take the listener off whichever editor currently carries it. */
    private detachEditorListener(): void {
        if (!this.currentEditorEl) return;
        if (this.editorListenerBound) {
            this.currentEditorEl.removeEventListener('beforeinput', this.editorListenerBound as EventListener);
        }
        this.currentEditorEl.removeEventListener('keydown', this.onHand, true);
        this.currentEditorEl.removeEventListener('pointerdown', this.onHand, true);
        this.currentEditorEl = null;
        this.editorListenerBound = null;
    }
}
