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
 *
 * "Within" is measured from when the key or the press happened, not from when
 * this observer heard it. A hotkey's command runs from Obsidian's own
 * listener, which is ahead of this one on the same key: the editor's change
 * arrives first, and the key after it, in the same dispatch. A change on the
 * focused editor with no hand before it waits for a key or a press that
 * happened before the change, and is marked when one arrives.
 */
export class EditorObserver {
    private currentEditorEl: HTMLElement | null = null;
    private editorListenerBound: ((e: InputEvent) => void) | null = null;
    private leafChangeRef: EventRef | null = null;
    private editorChangeRef: EventRef | null = null;
    /** When the last key or press happened, or -Infinity. */
    private lastHand = -Infinity;
    /** A change to the focused editor that no hand was heard before yet. */
    private unclaimed: { path: string; at: number } | null = null;
    private readonly onHand = (e: Event) => {
        if (!e.isTrusted) return;
        if (e.type === 'keydown' && !editsByKey(e as KeyboardEvent)) return;
        const at = this.happenedAt(e);
        this.lastHand = Math.max(this.lastHand, at);
        const change = this.unclaimed;
        this.unclaimed = null;
        if (change && change.at >= at && change.at - at <= HAND_WINDOW_MS) this.editorSignal.mark(change.path);
    };

    constructor(
        private app: App,
        private editorSignal: EditorSignal,
        private readonly inputs: InputSource | null = typeof window === 'undefined' ? null : window,
        private readonly now: () => number = () => performance.timeOrigin + performance.now(),
    ) { }

    /**
     * When an input happened, on the clock {@link now} reads: its time stamp,
     * from the time origin of the window it happened in (a popped-out window
     * has its own). Now, for an event that carries none.
     */
    private happenedAt(e: Event): number {
        const view = (e as UIEvent).view ?? (e.target as Node | null)?.ownerDocument?.defaultView ?? null;
        const origin = view?.performance?.timeOrigin;
        return typeof e.timeStamp === 'number' && e.timeStamp > 0 && typeof origin === 'number'
            ? origin + e.timeStamp
            : this.now();
    }

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
            const file = info.file;
            if (!file || !editor.hasFocus()) return;
            const at = this.now();
            if (at >= this.lastHand && at - this.lastHand <= HAND_WINDOW_MS) {
                this.editorSignal.mark(file.path);
                return;
            }
            this.unclaimed = { path: file.path, at };
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

/** Keys that move, select or wait for another key: they change no note. */
const QUIET_KEYS = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
    'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Escape', 'Tab',
]);

/**
 * Whether a key is one the hand changes a note with. Not a key that only
 * moves or selects: a sync that reloads the note a moment after an arrow key
 * is not the hand's. Not undo or redo either: what they bring back is a state
 * the note was in, not a completion the hand made — undoing a flow's write
 * would otherwise complete the task again and fire it a second time.
 */
export function editsByKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey'>): boolean {
    if (QUIET_KEYS.has(e.key)) return false;
    if ((e.ctrlKey || e.metaKey) && ['z', 'Z', 'y', 'Y'].includes(e.key)) return false;
    return true;
}
