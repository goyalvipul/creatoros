import { PassThrough, Readable } from 'node:stream';

const CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crcUpdate(crc: number, buf: Buffer) {
  let c = crc;
  for (let i = 0; i < buf.length; i += 1) c = CRC[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return c >>> 0;
}

function write(out: PassThrough, chunk: Buffer) {
  if (out.write(chunk)) return Promise.resolve();
  return new Promise<void>((resolve) => out.once('drain', resolve));
}

/** Uncompressed zip. Each file is stored as itself, so a phone can save one archive of separate videos. */
export function zipStored(files: { name: string; open: () => Readable }[]): Readable {
  const out = new PassThrough();
  void (async () => {
    const central: Buffer[] = [];
    let offset = 0;
    for (const file of files) {
      const name = Buffer.from(file.name, 'utf8');
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0808, 6);
      local.writeUInt16LE(name.length, 26);
      await write(out, local);
      await write(out, name);
      let crc = 0xffffffff;
      let size = 0;
      for await (const chunk of file.open()) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        crc = crcUpdate(crc, buf);
        size += buf.length;
        await write(out, buf);
      }
      crc = (crc ^ 0xffffffff) >>> 0;
      const desc = Buffer.alloc(16);
      desc.writeUInt32LE(0x08074b50, 0);
      desc.writeUInt32LE(crc, 4);
      desc.writeUInt32LE(size, 8);
      desc.writeUInt32LE(size, 12);
      await write(out, desc);
      const head = Buffer.alloc(46);
      head.writeUInt32LE(0x02014b50, 0);
      head.writeUInt16LE(20, 4);
      head.writeUInt16LE(20, 6);
      head.writeUInt16LE(0x0808, 8);
      head.writeUInt32LE(crc, 16);
      head.writeUInt32LE(size, 20);
      head.writeUInt32LE(size, 24);
      head.writeUInt16LE(name.length, 28);
      head.writeUInt32LE(offset, 42);
      central.push(head, name);
      offset += local.length + name.length + size + desc.length;
    }
    const centralStart = offset;
    let centralSize = 0;
    for (const part of central) {
      await write(out, part);
      centralSize += part.length;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(centralStart, 16);
    await write(out, end);
    out.end();
  })().catch((error: unknown) => {
    out.destroy(error instanceof Error ? error : new Error('The archive could not be built.'));
  });
  return out;
}
