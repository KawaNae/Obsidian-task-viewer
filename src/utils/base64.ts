/**
 * Unicode-safe base64 encode/decode.
 *
 * Native btoa/atob only handle Latin1 (0x00–0xFF).
 * These helpers go through UTF-8 bytes so any Unicode string round-trips safely.
 */

export function unicodeBtoa(str: string): string {
    return btoa(Array.from(new TextEncoder().encode(str), b => String.fromCharCode(b)).join(''));
}

export function unicodeAtob(b64: string): string {
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}
