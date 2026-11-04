import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRODUCER_FILES = Object.freeze(['application.mjs', 'capacity.mjs', 'certificate.mjs', 'diagnostic.mjs',
  'endpoint.mjs', 'plan.json', 'producer.mjs', 'public-endpoint.mjs', 'resources.mjs', 'server.mjs', 'snapshot.mjs', 'upstream.mjs']);

export async function loadProducer() {
  try {
    // Node resolves the imported module to the immutable ConfigMap version directory.
    const root = await realpath(dirname(fileURLToPath(import.meta.url)));
    const hash = createHash('sha256').update('hupo-state-producer-v1\0');
    let plan;
    for (const name of PRODUCER_FILES) {
      const bytes = await boundedFile(root, name);
      hash.update(name + '\0' + bytes.length + '\0'); hash.update(bytes); hash.update('\0');
      if (name === 'plan.json') plan = JSON.parse(bytes.toString('utf8'));
    }
    return { producerSha256: hash.digest('hex'), plan };
  } catch { throw new Error('PRODUCER_INVALID'); }
}

async function boundedFile(root, name) {
  const path = join(root, name);
  const initial = await lstat(path, { bigint: true });
  if (!initial.isFile() || initial.size > 65536 || await realpath(path) !== path) throw new Error();
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > 65536 || !unchanged(initial, before)) throw new Error();
    const buffer = Buffer.alloc(65537);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > 65536 || BigInt(size) !== before.size || !unchanged(before, await handle.stat({ bigint: true })) ||
        !unchanged(before, await lstat(path, { bigint: true })) || await realpath(path) !== path) throw new Error();
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}

function unchanged(a, b) {
  // Windows lstat omits the volume ID that fstat supplies; inode checks stay exact.
  const device = a.dev === b.dev || (process.platform === 'win32' && (a.dev === 0n || b.dev === 0n));
  return device && ['ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);
}
