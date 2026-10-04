import type { FieldCodec, Read } from '../../../utils/values/Read';
import { readFail, readOk } from '../../../utils/values/Read';
import { TaskLineClassifier } from './TaskLineClassifier';

/**
 * A status's character typed in the settings: one a checkbox can hold
 * (`TaskLineClassifier.isStatusChar`, the predicate the API and the writes
 * ask), and none of the other statuses' (`others`). The text is read as
 * typed: a space is a status (`[ ]`), and a full-width character is its own.
 */
export const StatusCharInput = {
    read(text: string, others: Iterable<string>): Read<string> {
        if (text === '') return readFail({ code: 'empty' });
        if (!TaskLineClassifier.isStatusChar(text)) return readFail({ code: 'shape', kind: 'statusChar' });
        for (const other of others) {
            if (other === text) return readFail({ code: 'duplicate' });
        }
        return readOk(text);
    },
    /** The reading of a field of one status's character; `others` answers the other statuses' as they are when it reads. */
    codec(others: () => Iterable<string>): FieldCodec<string> {
        return { read: (text) => StatusCharInput.read(text, others()), show: (c) => c };
    },
};
