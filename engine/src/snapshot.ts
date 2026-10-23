import fs from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// Rename in the same directory: readers see either the previous complete snapshot
// or the next complete snapshot, never a partially overwritten JSON document.
export function saveSnapshot(path: string, snapshot: unknown) {
    const contents = JSON.stringify(snapshot);
    const temporary = `${path}.${randomUUID()}.tmp`;
    let fd: number | undefined;
    try {
        fd = fs.openSync(temporary,'wx',0o600);
        fs.writeFileSync(fd,contents,'utf8'); fs.fsyncSync(fd); fs.closeSync(fd); fd=undefined;
        fs.renameSync(temporary,path);
        const directory = fs.openSync(dirname(path),'r');
        try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}
