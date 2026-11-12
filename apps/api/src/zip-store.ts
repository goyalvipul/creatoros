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

function dosStamp(now = new Date()) {
  const year = Math.max(1980, now.getFullYear());
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const date = ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  return { time, date };
}

/** Uncompressed zip. Windows saves a video as 0 KB when the header uses a data trailer or the UTF-8 flag. */
export function zipStored(files: { name: string; open: () => Readable }[]): Readable {
  const out = new PassThrough();
  const stamp = dosStamp();
  void (async () => {
    const central: Buffer[] = [];
    let offset = 0;
    for (const file of files) {
      const name = Buffer.from(file.name, 'utf8');
      const chunks: Buffer[] = [];
      let crc = 0xffffffff;
      let size = 0;
      for await (const chunk of file.open()) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        crc = crcUpdate(crc, buf);
        size += buf.length;
        if (size > 512 * 1024 * 1024) throw new Error('One section video is over 512 MB.');
        chunks.push(buf);
      }
      if (!size) throw new Error(`${file.name} has no video bytes.`);
      crc = (crc ^ 0xffffffff) >>> 0;
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0, 6);
      local.writeUInt16LE(stamp.time, 10);
      local.writeUInt16LE(stamp.date, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(size, 18);
      local.writeUInt32LE(size, 22);
      local.writeUInt16LE(name.length, 26);
      await write(out, local);
      await write(out, name);
      for (const buf of chunks) await write(out, buf);
      const head = Buffer.alloc(46);
      head.writeUInt32LE(0x02014b50, 0);
      head.writeUInt16LE(20, 4);
      head.writeUInt16LE(20, 6);
      head.writeUInt16LE(0, 8);
      head.writeUInt16LE(stamp.time, 12);
      head.writeUInt16LE(stamp.date, 14);
      head.writeUInt32LE(crc, 16);
      head.writeUInt32LE(size, 20);
      head.writeUInt32LE(size, 24);
      head.writeUInt16LE(name.length, 28);
      head.writeUInt32LE(offset, 42);
      central.push(head, name);
      offset += local.length + name.length + size;
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
