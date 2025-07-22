import * as memfsExported from 'memfs'
import { Buffer } from 'buffer'

const { createFsFromVolume, Volume, fs, memfs } = memfsExported

export { createFsFromVolume, Volume, fs, memfs, memfsExported, Buffer }
