/**
 * Block IDs the timer writes onto the line it is currently recording into.
 *
 * The timer puts one on in a write of its own and takes it off when the widget
 * closes. Which ids a timer put on is recorded by the write that put them on
 * (`TimerBase.ownedAnchors`), never read off the id's shape. It is still visible
 * in the note while it is there, which is why the form is deliberately short —
 * the long UUID form it replaced read as noise in the middle of a task line.
 */

/** `tv-t-` + 7 lowercase alphanumerics (12 chars total). */
export const TIMER_TARGET_ID_PREFIX = 'tv-t-';

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ID_LENGTH = 7;

/**
 * Random bytes, from the platform CSPRNG where there is one. The fallback only
 * matters for exotic hosts — collision, not predictability, is the property
 * that matters here.
 */
function randomBytes(count: number): Uint8Array {
    const bytes = new Uint8Array(count);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(bytes);
        return bytes;
    }
    for (let i = 0; i < count; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
    }
    return bytes;
}

/**
 * A fresh timer-target block ID, e.g. `tv-t-k3f9x2q`.
 *
 * 36^7 ≈ 7.8e10 values against the handful of ids a vault holds at once, so a
 * collision is not a case worth designing for. The alphabet stays inside
 * Obsidian's block-ID character set (`[A-Za-z0-9-]`).
 *
 * Byte values from 252 up are discarded rather than folded, so every character
 * stays equally likely (256 is not a multiple of 36).
 */
export function generateTimerTargetId(): string {
    const limit = 256 - (256 % ID_ALPHABET.length);
    let suffix = '';
    while (suffix.length < ID_LENGTH) {
        for (const byte of randomBytes(ID_LENGTH - suffix.length)) {
            if (byte >= limit) continue;
            suffix += ID_ALPHABET[byte % ID_ALPHABET.length];
        }
    }
    return `${TIMER_TARGET_ID_PREFIX}${suffix}`;
}
