/**
 * Storage key management, device/vault identification, and ID generation.
 */

import { App, FileSystemAdapter } from 'obsidian';
import {
    TIMER_TARGET_ID_PREFIX,
    isTimerTargetId
} from '../utils/TimerTargetIdUtils';
import {
    STORAGE_VERSION,
    STORAGE_KEY_PREFIX,
    LEGACY_STORAGE_KEY,
    DEVICE_ID_KEY,
} from './TimerContext';

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

    cleanupLegacyStorage(): void {
        try {
            window.localStorage.removeItem(LEGACY_STORAGE_KEY);
        } catch {
            // noop
        }
    }

    // ─── ID Generation ────────────────────────────────────────

    generateStableId(prefix: string): string {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return `${prefix}-${crypto.randomUUID()}`;
        }
        return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    generateTimerTargetId(): string {
        const raw = this.generateStableId('target').replace(/^target-/, '');
        return `${TIMER_TARGET_ID_PREFIX}${raw}`.replace(/[^A-Za-z0-9-]/g, '');
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
