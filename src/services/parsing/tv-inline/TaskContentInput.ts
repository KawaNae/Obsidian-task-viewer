import type { FieldCodec, NotationKind, Read } from '../../../utils/values/Read';
import { readFail, readOk } from '../../../utils/values/Read';
import { cutFlowTail } from '../utils/FlowLineScanner';
import { TaskLineClassifier } from '../utils/TaskLineClassifier';
import { readDateBlock } from './DateBlock';

/**
 * The notation in `text` that a task's line, `text` written as its name,
 * would read as something other than the name (入力の論点 A): a trailing
 * block ID (`^id`), the command (`==>` with text after it), a date block
 * (`@2026-10-05`, `@10:00`). Read as the line is read (`taskContentText`,
 * `readDateBlock`), so `@alice` or a bare `==>` is the name's own text. Null
 * when there is none.
 */
export function notationInName(text: string): NotationKind | null {
    const { text: body, blockId } = TaskLineClassifier.extractBlockId(text);
    if (blockId !== undefined) return 'blockId';
    const cut = cutFlowTail(body);
    if (cut) return 'command';
    return readDateBlock(body) ? 'dateBlock' : null;
}

/**
 * A task's name typed in a field (the hub, the create dialog): free text,
 * written as typed, but none of the notation the line would read as
 * something else ({@link notationInName}). A name is no field to write the
 * dates in: they have their own, and a date block in the name would be
 * read in place of them. An empty name reads, as the empty name a line may
 * have; a dialog that needs one asks for it itself.
 */
export const TaskContentInput: FieldCodec<string> = {
    read(text: string): Read<string> {
        const kind = notationInName(text);
        return kind ? readFail({ code: 'notation', kind }) : readOk(text);
    },
    show: (name) => name,
};
