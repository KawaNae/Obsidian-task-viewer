const BRACKET_PAIRS: Record<string, string> = {
    '(': ')', '[': ']',
    '（': '）', '［': '］',
    '「': '」', '『': '』', '【': '】',
    '｛': '｝', '〈': '〉', '《': '》',
};

const BRACKET_CLOSERS: Set<string> = new Set(Object.values(BRACKET_PAIRS));

export interface BracketPairingHandle {
    /** IME composition 中か（Enter 確定の無視判定などに使う） */
    isComposing(): boolean;
}

/**
 * IME 対応の括弧オートペアリングを text input に取り付ける共有 widget。
 * CreateTaskModal と TaskHubForm が共用する。
 *
 * Post-insertion reactive pairing: ブラウザ（または IME）が編集を適用した
 * **後**に、'beforeinput' で取ったスナップショットとの diff で反応する。
 * 'beforeinput.preventDefault()' は iOS WebKit の IME 入力で不安定なため
 * 使わない。
 *
 * `onInput` は input イベント（composition 中含む）と compositionend の
 * 都度呼ばれる。呼び出し側はここで値の取り込み・バリデーションを行う。
 */
export function attachBracketPairing(input: HTMLInputElement, onInput: () => void): BracketPairingHandle {
    let composing = false;
    let lastValueBeforeInput = '';
    let lastSelectionBeforeInput = 0;

    const applyPairingReactive = () => {
        const newVal = input.value;
        const newPos = input.selectionStart ?? 0;
        const oldVal = lastValueBeforeInput;
        const oldPos = lastSelectionBeforeInput;

        // Case 1: exactly one character was inserted at the caret.
        if (newVal.length === oldVal.length + 1 && newPos === oldPos + 1) {
            const ch = newVal[oldPos];

            // Opening bracket: insert closing partner unless it's already there.
            const closing = BRACKET_PAIRS[ch];
            if (closing) {
                if (newVal[newPos] === closing) return;
                input.value = newVal.slice(0, newPos) + closing + newVal.slice(newPos);
                input.setSelectionRange(newPos, newPos);
                return;
            }

            // Closing bracket skip-over: if a matching closer was already at
            // this position before the user typed, drop the duplicate and
            // leave the caret past the pre-existing closer.
            if (BRACKET_CLOSERS.has(ch) && oldVal[oldPos] === ch) {
                input.value = newVal.slice(0, newPos) + newVal.slice(newPos + 1);
                input.setSelectionRange(newPos, newPos);
                return;
            }
            return;
        }

        // Case 2: exactly one character was deleted at the caret (backspace).
        // If we deleted the opener of an empty pair, also remove the closer.
        if (newVal.length === oldVal.length - 1 && newPos === oldPos - 1) {
            const deletedChar = oldVal[oldPos - 1];
            const nextChar = oldVal[oldPos];
            const closing = deletedChar ? BRACKET_PAIRS[deletedChar] : undefined;
            if (closing && nextChar === closing) {
                input.value = newVal.slice(0, newPos) + newVal.slice(newPos + 1);
                input.setSelectionRange(newPos, newPos);
            }
        }
    };

    input.addEventListener('compositionstart', () => {
        composing = true;
    });
    input.addEventListener('compositionend', () => {
        composing = false;
        // The composition-commit 'input' event has already fired (with
        // isComposing=true, so the listener below skipped pairing). Run
        // pairing reactively against the snapshot taken in 'beforeinput'.
        applyPairingReactive();
        onInput();
    });
    input.addEventListener('beforeinput', () => {
        // Snapshot so the following 'input' event (or 'compositionend') can diff.
        lastValueBeforeInput = input.value;
        lastSelectionBeforeInput = input.selectionStart ?? 0;
    });
    input.addEventListener('input', (e: Event) => {
        const ie = e as InputEvent;
        if (!composing && !ie.isComposing) {
            applyPairingReactive();
        }
        onInput();
    });

    return { isComposing: () => composing };
}
