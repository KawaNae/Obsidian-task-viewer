/**
 * Strip a trailing `|alias` from a wikilink target, e.g. `note|Display Name`
 * -> `note`. The single implementation shared across parsing/data/view
 * layers — a leaf utility with no domain dependency, so any layer can import
 * it without opening a new dependency direction.
 */
export function extractWikilinkTarget(linkName: string): string {
    return linkName.split('|')[0].trim();
}
