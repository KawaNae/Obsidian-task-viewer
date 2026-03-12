/**
 * In-memory Obsidian App / Vault / MetadataCache stubs for integration tests.
 *
 * Usage:
 *   const vault = createInMemoryVault({ 'notes/a.md': '# A\ncontent' });
 *   const app   = createFakeApp(vault, createFakeMetadataCache({ 'notes/a.md': { frontmatter: { ... } } }));
 */

import { TFile } from 'obsidian';

// ---------------------------------------------------------------------------
// In-memory Vault
// ---------------------------------------------------------------------------

export interface InMemoryVault {
    files: Map<string, string>;
    getAbstractFileByPath(path: string): TFile | null;
    getMarkdownFiles(): TFile[];
    read(file: TFile): Promise<string>;
    process(file: TFile, fn: (data: string) => string): Promise<string>;
    create(path: string, content: string): Promise<TFile>;
    createFolder(path: string): Promise<void>;
    adapter: { exists(path: string): Promise<boolean> };
}

/**
 * Create a minimal Vault backed by an in-memory Map.
 * @param fileContents  Record of path → file content strings.
 */
export function createInMemoryVault(fileContents: Record<string, string> = {}): InMemoryVault {
    const files = new Map<string, string>(Object.entries(fileContents));

    // Cache TFile instances so identity checks work.
    const tfileCache = new Map<string, TFile>();

    function makeTFile(path: string): TFile {
        let tf = tfileCache.get(path);
        if (tf) return tf;
        tf = new TFile();
        tf.path = path;
        tf.name = path.split('/').pop() ?? path;
        tf.basename = tf.name.replace(/\.md$/, '');
        tf.extension = 'md';
        tfileCache.set(path, tf);
        return tf;
    }

    return {
        files,

        getAbstractFileByPath(path: string): TFile | null {
            if (files.has(path)) return makeTFile(path);
            return null;
        },

        getMarkdownFiles(): TFile[] {
            return Array.from(files.keys())
                .filter(p => p.endsWith('.md'))
                .map(p => makeTFile(p));
        },

        read(file: TFile): Promise<string> {
            const content = files.get(file.path);
            if (content === undefined) return Promise.reject(new Error(`File not found: ${file.path}`));
            return Promise.resolve(content);
        },

        process(file: TFile, fn: (data: string) => string): Promise<string> {
            const content = files.get(file.path);
            if (content === undefined) return Promise.reject(new Error(`File not found: ${file.path}`));
            const updated = fn(content);
            files.set(file.path, updated);
            return Promise.resolve(updated);
        },

        create(path: string, content: string): Promise<TFile> {
            files.set(path, content);
            return Promise.resolve(makeTFile(path));
        },

        createFolder(_path: string): Promise<void> {
            return Promise.resolve();
        },

        adapter: {
            exists(_path: string): Promise<boolean> {
                return Promise.resolve(false);
            },
        },
    };
}

// ---------------------------------------------------------------------------
// Fake MetadataCache
// ---------------------------------------------------------------------------

export interface FileCacheEntry {
    frontmatter?: Record<string, any>;
    tags?: Array<{ tag: string; position: any }>;
}

export interface FakeMetadataCache {
    getCache(path: string): FileCacheEntry | null;
    getFileCache(file: TFile): FileCacheEntry | null;
}

/**
 * Create a fake MetadataCache that returns pre-configured data per path.
 */
export function createFakeMetadataCache(
    entries: Record<string, FileCacheEntry> = {}
): FakeMetadataCache {
    const map = new Map<string, FileCacheEntry>(Object.entries(entries));
    return {
        getCache(path: string) { return map.get(path) ?? null; },
        getFileCache(file: TFile) { return map.get(file.path) ?? null; },
    };
}

// ---------------------------------------------------------------------------
// Fake App
// ---------------------------------------------------------------------------

export interface FakeApp {
    vault: InMemoryVault;
    metadataCache: FakeMetadataCache;
    workspace: Record<string, any>;
    fileManager: { getNewFileParent(path: string): { path: string } };
    internalPlugins: {
        getPluginById(id: string): any;
    };
}

/**
 * Assemble a fake App from vault + metadataCache.
 * Optionally configure a daily-notes plugin stub.
 */
export function createFakeApp(
    vault: InMemoryVault,
    metadataCache?: FakeMetadataCache,
    dailyNoteSettings?: { format?: string; folder?: string; template?: string },
): FakeApp {
    return {
        vault,
        metadataCache: metadataCache ?? createFakeMetadataCache(),
        workspace: {},
        fileManager: { getNewFileParent: () => ({ path: '' }) },
        internalPlugins: {
            getPluginById(id: string) {
                if (id === 'daily-notes' && dailyNoteSettings) {
                    return {
                        instance: {
                            options: {
                                format: dailyNoteSettings.format ?? 'YYYY-MM-DD',
                                folder: dailyNoteSettings.folder ?? '',
                                template: dailyNoteSettings.template ?? '',
                            },
                        },
                    };
                }
                return null;
            },
        },
    };
}
