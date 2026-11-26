import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="48" fill="white"/><g fill="none" stroke="#293e50" stroke-width="12" stroke-linecap="round"><path d="m83 72 100 53M72 91l35 103m69-51-53 52"/><circle cx="64" cy="62" r="28"/><circle cx="190" cy="130" r="28"/><circle cx="112" cy="208" r="22"/></g></svg>';
const png = await sharp(Buffer.from(svg)).png().toBuffer();
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
await mkdir(new URL('../resources/', import.meta.url), { recursive: true });
await writeFile(new URL('../resources/icon.ico', import.meta.url), Buffer.concat([header, png]));
