import { Editor, Menu } from 'obsidian';
import { buildStatusOptions, createStatusTitle } from '../../../constants/statusOptions';

/** Regex to detect checkbox lines: `- [ ]`, `- [x]`, `- [!]`, etc. */
const CHECKBOX_LINE_REGEX = /^(\s*-\s*\[)(.)(\].*)$/;

/**
 * Adds a status-change submenu to the editor context menu
 * for plain checkbox lines (not recognized as @notation tasks).
 */
export class EditorCheckboxMenuBuilder {
    /**
     * Try to add a status submenu for a plain checkbox line.
     * Returns true if the line is a checkbox and a menu was added.
     */
    addStatusMenu(menu: Menu, editor: Editor, line: number, enabled: boolean, statusMenuChars: string[]): boolean {
        if (!enabled) return false;
        const lineText = editor.getLine(line);
        const match = lineText.match(CHECKBOX_LINE_REGEX);
        if (!match) return false;

        const currentChar = match[2];
        const options = buildStatusOptions(statusMenuChars);

        menu.addSeparator();
        menu.addItem((item) => {
            const statusDisplay = `[${currentChar}]`;
            (item as any).setTitle(`Status: ${statusDisplay}`)
                .setIcon('check-square')
                .setSubmenu();

            const statusMenu = (item as any).submenu as Menu;

            options.forEach(s => {
                statusMenu.addItem(sub => {
                    sub.setTitle(createStatusTitle(s))
                        .setChecked(currentChar === s.char)
                        .onClick(() => {
                            const newLine = match[1] + s.char + match[3];
                            editor.setLine(line, newLine);
                        });
                });
            });
        });

        return true;
    }
}
