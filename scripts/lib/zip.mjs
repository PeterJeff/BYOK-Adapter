// @ts-check
// Minimal zip writer and reader (deflate or store, no zip64). Node built-ins only.

import { deflateRawSync, inflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** @param {Uint8Array} buf */
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {Date} d */
function dosDateTime(d) {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const UTF8_FLAG = 0x0800;

/**
 * @param {{ name: string, data: Buffer }[]} entries paths use forward slashes
 * @param {{ date?: Date }} [options]
 */
export function createZip(entries, options = {}) {
  if (entries.length > 0xffff) throw new Error('too many entries for a non-zip64 archive');
  const { time, date } = dosDateTime(options.date || new Date());
  /** @type {Buffer[]} */
  const locals = [];
  /** @type {Buffer[]} */
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    let method = 8;
    /** @type {Buffer} */
    let body = deflateRawSync(data, { level: 9 });
    if (body.length >= data.length) {
      method = 0;
      body = data;
    }
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(UTF8_FLAG, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(UTF8_FLAG, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    // extra length, comment length, disk number, internal attrs: 0
    ch.writeUInt32LE(0, 38); // external attrs
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + body.length;
    if (offset > 0xffffffff) throw new Error('archive too large for a non-zip64 archive');
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/**
 * Reads an archive written by createZip (used by tests and `pack-vsix --list`).
 * @param {Buffer} zip
 * @returns {{ name: string, data: Buffer }[]}
 */
export function readZip(zip) {
  const eocdAt = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdAt < 0) throw new Error('not a zip archive');
  const count = zip.readUInt16LE(eocdAt + 10);
  let p = zip.readUInt32LE(eocdAt + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const compSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localAt = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    const lNameLen = zip.readUInt16LE(localAt + 26);
    const lExtraLen = zip.readUInt16LE(localAt + 28);
    const start = localAt + 30 + lNameLen + lExtraLen;
    const raw = zip.subarray(start, start + compSize);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    if (crc32(data) !== crc) throw new Error(`crc mismatch for ${name}`);
    out.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
