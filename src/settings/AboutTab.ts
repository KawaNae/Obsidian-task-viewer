import { Setting } from 'obsidian';
import TaskViewerPlugin from '../main';
import { t } from '../i18n';

const REPO_URL = 'https://github.com/KawaNae/Obsidian-task-viewer';

/**
 * Third-party copyright notices for code bundled into the distributed
 * `main.js`. Kept in sync with THIRD_PARTY_LICENSES.md at the repo root —
 * both are required so the notices are visible both at runtime (here) and in
 * the source tree.
 */
const THIRD_PARTY_LICENSES = `suncalc (v1.9.0) — BSD 2-Clause
https://github.com/mourner/suncalc

Copyright (c) 2014, Vladimir Agafonkin
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are
permitted provided that the following conditions are met:

   1. Redistributions of source code must retain the above copyright notice, this list of
      conditions and the following disclaimer.

   2. Redistributions in binary form must reproduce the above copyright notice, this list
      of conditions and the following disclaimer in the documentation and/or other materials
      provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

────────────────────────────────────────────────────────────

date-fns (v3.6.0) — MIT
https://github.com/date-fns/date-fns

MIT License

Copyright (c) 2021 Sasha Koss and Lesha Koss https://kossnocorp.mit-license.org

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

────────────────────────────────────────────────────────────

html-to-image (v1.11.13) — MIT
https://github.com/bubkoo/html-to-image

MIT License

Copyright (c) 2017-2025 W.Y.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

export function render(el: HTMLElement, plugin: TaskViewerPlugin): void {
    const manifest = plugin.manifest;

    // Plugin info
    el.createEl('h3', { text: t('settings.about.plugin'), cls: 'setting-section-header' });

    new Setting(el)
        .setName(t('settings.about.version'))
        .setDesc(manifest.version);

    new Setting(el)
        .setName(t('settings.about.author'))
        .setDesc(manifest.author);

    new Setting(el)
        .setName(t('settings.about.repository'))
        .setDesc(REPO_URL)
        .addButton(btn => btn
            .setButtonText(t('settings.about.openInBrowser'))
            .onClick(() => window.open(REPO_URL, '_blank')));

    new Setting(el)
        .setName(t('settings.about.license'))
        .setDesc('MIT')
        .addButton(btn => btn
            .setButtonText(t('settings.about.openInBrowser'))
            .onClick(() => window.open(`${REPO_URL}/blob/main/LICENSE`, '_blank')));

    // Resources
    el.createEl('h3', { text: t('settings.about.resources'), cls: 'setting-section-header' });

    new Setting(el)
        .setName(t('settings.about.releaseNotes'))
        .setDesc(t('settings.about.releaseNotesDesc'))
        .addButton(btn => btn
            .setButtonText(t('settings.about.openInBrowser'))
            .onClick(() => window.open(`${REPO_URL}/releases`, '_blank')));

    new Setting(el)
        .setName(t('settings.about.issueTracker'))
        .setDesc(t('settings.about.issueTrackerDesc'))
        .addButton(btn => btn
            .setButtonText(t('settings.about.openInBrowser'))
            .onClick(() => window.open(`${REPO_URL}/issues`, '_blank')));

    // Third-party licenses
    el.createEl('h3', { text: t('settings.about.thirdPartyLicenses'), cls: 'setting-section-header' });

    el.createEl('p', {
        text: t('settings.about.thirdPartyLicensesIntro'),
        cls: 'setting-item-description tv-about__third-party-intro',
    });

    const pre = el.createEl('pre', { cls: 'tv-about__third-party-text' });
    pre.textContent = THIRD_PARTY_LICENSES;
}
