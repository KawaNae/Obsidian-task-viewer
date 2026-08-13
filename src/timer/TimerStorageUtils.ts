/**
 * Storage key management, device/vault identification, and ID generation.
 */

import { type App, FileSystemAdapter } from 'obsidian';
import {
    generateTimerTargetId,
    isTimerTargetId
} from '../utils/TimerTargetIdUtils';
/**
 * v6: runState / sessionCount / recordedElapsedTime を追加（セッション状態機械）。
 * ストレージキーにバージョンが入るので、v5 の状態は読まれない。restore 時に
 * 旧キーを掃除する（放置すると localStorage に残り続ける）。
 */
export const STORAGE_VERSION = 6;
/** 掃除対象の旧バージョン。 */
export const OBSOLETE_STORAGE_VERSIONS = [5];
export const STORAGE_KEY_PREFIX = 'task-viewer.active-timers';
export const DEVICE_ID_KEY = 'task-viewer.device-id.v1';

export class TimerStorageUtils {
    readonly deviceId: string;
    readonly vaultFingerprint: string;

    constructor(private app: App) {
        this.deviceId = this.getOrCreateDeviceId();
        this.vaultFingerprint = this.resolveVaultFingerprint();
    }

    // ─── Storage Keys ─────────────────────────────────────────

    getStorageKey(): string {
        return this.getStorageKeyForVersion(STORAGE_VERSION);
    }

    getStorageKeyForVersion(version: number): string {
        return `${STORAGE_KEY_PREFIX}.v${version}:${this.vaultFingerprint}`;
    }

    // ─── ID Generation ────────────────────────────────────────

    generateStableId(prefix: string): string {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return `${prefix}-${crypto.randomUUID()}`;
        }
        return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    generateTimerTargetId(): string {
        return generateTimerTargetId();
    }

    isAutoManagedTimerTargetId(timerTargetId?: string): boolean {
        return isTimerTargetId(timerTargetId);
    }

    // ─── Device / Vault ───────────────────────────────────────

    private getOrCreateDeviceId(): string {
        try {
            const existing = window.localStorage.getItem(DEVICE_ID_KEY);
            if (existing && existing.trim()) {
                return existing;
            }
            const newId = this.generateStableId('dev');
            window.localStorage.setItem(DEVICE_ID_KEY, newId);
            return newId;
        } catch {
            return 'dev-unknown';
        }
    }

    private resolveVaultFingerprint(): string {
        const adapter = this.app.vault.adapter;
        const basePath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '';
        const fallbackName = this.app.vault.getName();
        const rawIdentity = basePath && basePath.trim() ? basePath : fallbackName;
        const normalizedIdentity = (rawIdentity || 'unknown-vault').trim().toLowerCase();
        return this.hashToHex(normalizedIdentity);
    }

    private hashToHex(raw: string): string {
        let hash = 5381;
        for (let i = 0; i < raw.length; i++) {
            hash = ((hash << 5) + hash) + raw.charCodeAt(i);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }
}
