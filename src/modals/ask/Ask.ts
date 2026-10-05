import type { CloseAnswer, Focusable, OverlayOpenOpts } from '../../views/sharedUI/OverlayShell';

/**
 * What a question asks of the overlay it stands in (`OverlayShell`): to
 * open with a body, to close now, and to close as the user asks (the close
 * button, Escape, the back, a click outside, a swipe), which `beforeClose`
 * may hold. However it closes, it calls `onClose` once.
 */
export interface AskShell {
    open(opts: OverlayOpenOpts): void;
    close(): void;
    requestClose(): Promise<boolean>;
}

/** What the body of a question is given to answer with. */
export interface AskHands<A> {
    /** Answer `a` and close. The first answer given is the one. */
    answer(a: A): void;
    /** Close as the user asks, the cancel button's way: through `beforeClose`. */
    cancel(): void;
}

/** What the body of a question tells the shell once drawn. */
export interface AskBody {
    /** The first focus (論点4: cancel in a dialog of buttons, the field in one of text). */
    focus: Focusable | null;
    /** Whether a close asked for may go on (one waiting for a write). */
    beforeClose?: () => CloseAnswer;
}

export interface AskSpec<A> {
    keymap: OverlayOpenOpts['keymap'];
    /** A class of the panel besides the dialog's, for what only this question has. */
    panelClass?: string;
    draw(bodyEl: HTMLElement, hands: AskHands<A>): AskBody;
}

/**
 * Put a question on `shell`, centered (a sheet from below on a phone), and
 * answer once: the answer the body gives first, else `'cancel'` whichever
 * way it closes. The answer comes when the dialog has closed.
 */
export function ask<A>(shell: AskShell, spec: AskSpec<A>): Promise<A | 'cancel'> {
    return new Promise((resolve) => {
        let given: { readonly a: A } | null = null;
        let body: AskBody | null = null;
        shell.open({
            mode: 'centered',
            panelClass: spec.panelClass ? `tv-overlay__panel--dialog tv-ask ${spec.panelClass}` : 'tv-overlay__panel--dialog tv-ask',
            keymap: spec.keymap,
            build: (bodyEl) => {
                body = spec.draw(bodyEl, {
                    answer: (a) => {
                        if (given) return;
                        given = { a };
                        shell.close();
                    },
                    cancel: () => { void shell.requestClose(); },
                });
            },
            initialFocus: () => body?.focus ?? null,
            beforeClose: () => body?.beforeClose?.() ?? 'close',
            onClose: () => resolve(given ? given.a : 'cancel'),
        });
    });
}
