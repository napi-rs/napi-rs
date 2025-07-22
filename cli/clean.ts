import { readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'

for (const file of await readdir('./dist', {
  recursive: true,
  withFileTypes: true,
})) {
  if (file.isFile() && !file.name.endsWith('.d.ts')) {
    await unlink(join(file.parentPath, file.name))
  }
}
