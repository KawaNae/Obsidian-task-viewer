/**
 * The desktop app's Node and Electron surfaces, named.
 *
 * Obsidian runs in Electron on desktop and in a plain WebView on mobile, so
 * these are all optional at runtime — and none of them are in Obsidian's
 * typings, which is why the call sites reached for `as any`. Declaring the
 * shapes keeps the escape hatch in one file and tells the reader exactly how
 * much of each API is relied on.
 */

/** Electron's `require`, present on the window in the desktop app only. */
type ElectronRequire = (id: string) => unknown;

interface ElectronWindow extends Window {
    require?: ElectronRequire;
}

export function electronRequire(win: Window): ElectronRequire | undefined {
    const req = (win as ElectronWindow).require;
    return typeof req === 'function' ? req : undefined;
}

/** The slice of Electron's BrowserWindow the export path drives. */
export interface BrowserWindowLike {
    setSize(width: number, height: number): void;
    setOpacity(opacity: number): void;
    close?(): void;
}

interface ElectronRemote {
    getCurrentWindow?: () => BrowserWindowLike;
}

/** The popout's own BrowserWindow, or null off the desktop app. */
export function currentBrowserWindow(win: Window): BrowserWindowLike | null {
    const req = electronRequire(win);
    if (!req) return null;
    const remote = (req('electron') as { remote?: ElectronRemote } | undefined)?.remote
        ?? (req('@electron/remote') as ElectronRemote | undefined);
    return remote?.getCurrentWindow?.() ?? null;
}

/** The slice of Node's `os` the diagnostics collector reads. */
export interface NodeOs {
    arch(): string;
    release(): string;
    cpus(): { model: string }[];
    totalmem(): number;
    freemem(): number;
}

export function nodeOs(): NodeOs | undefined {
    if (typeof window === 'undefined') return undefined;
    return electronRequire(window)?.('os') as NodeOs | undefined;
}

/**
 * `navigator.deviceMemory` — approximate device RAM in GB. A Chrome
 * extension to the standard, absent on iOS.
 */
export function deviceMemoryGb(): number | undefined {
    if (typeof navigator === 'undefined') return undefined;
    const value = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    return typeof value === 'number' ? value : undefined;
}

/** `performance.memory` — Chrome-only JS heap counters, in bytes. */
export interface JsHeapStats {
    usedJSHeapSize?: number;
    jsHeapSizeLimit?: number;
}

export function jsHeapStats(): JsHeapStats | undefined {
    if (typeof performance === 'undefined') return undefined;
    return (performance as Performance & { memory?: JsHeapStats }).memory;
}
