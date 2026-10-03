import { Platform } from 'obsidian';
import type { DeviceInfo } from './markdown-formatter';
import { deviceMemoryGb, jsHeapStats, nodeOs } from '../utils/hostEnv';

/**
 * The host the plugin runs on, for the diagnostics report of a log export.
 * Every reading is best effort: what the host does not tell is left out.
 */

/** The OS as the report names it: Node's platform on desktop, the app's OS and version on mobile. */
export function deriveOsLabel(): string {
    if (typeof process !== 'undefined' && process.platform) return process.platform;
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    if (Platform.isAndroidApp) {
        const m = /Android (\d+(?:\.\d+)?)/.exec(ua);
        return m ? `android ${m[1]}` : 'android';
    }
    if (Platform.isIosApp) {
        const base = Platform.isTablet ? 'ipados' : 'ios';
        const m = /OS (\d+(?:_\d+)*)/.exec(ua);
        return m ? `${base} ${m[1].replace(/_/g, '.')}` : base;
    }
    return 'unknown';
}

/** The device's CPU, memory and JS heap, as far as the host tells. */
export function collectDeviceInfo(): DeviceInfo {
    const d: DeviceInfo = {};
    try {
        if (typeof navigator !== 'undefined') {
            if (typeof navigator.hardwareConcurrency === 'number') {
                d.cpuCores = navigator.hardwareConcurrency;
            }
            if (navigator.userAgent) d.userAgent = navigator.userAgent;
            const dm = deviceMemoryGb();
            if (dm !== undefined) d.deviceMemoryGb = dm;
        }
    } catch { /* best effort */ }
    try {
        const pm = jsHeapStats();
        if (pm) {
            if (typeof pm.usedJSHeapSize === 'number') {
                d.jsHeapUsedMb = Math.round(pm.usedJSHeapSize / 1048576);
            }
            if (typeof pm.jsHeapSizeLimit === 'number') {
                d.jsHeapLimitMb = Math.round(pm.jsHeapSizeLimit / 1048576);
            }
        }
    } catch { /* best effort */ }
    try {
        const os = nodeOs();
        if (os) {
            d.arch = os.arch();
            d.osRelease = os.release();
            const cpus = os.cpus();
            if (cpus?.length) {
                d.cpuCores = cpus.length;
                const model = (cpus[0]?.model ?? '').trim();
                if (model) d.cpuModel = model;
            }
            d.totalRamGb = Math.round((os.totalmem() / 1073741824) * 10) / 10;
            d.freeRamGb = Math.round((os.freemem() / 1073741824) * 10) / 10;
        }
    } catch { /* best effort */ }
    return d;
}
