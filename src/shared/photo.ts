import { imageSize } from 'image-size';
import { photoAssetSchema, PROJECT_LIMITS, type PhotoAsset } from './project';

export const PHOTO_LIMITS = { inputBytes: 10 * 1024 * 1024, pixels: 20_000_000 } as const;
type PhotoInfo = { width: number; height: number; type: 'png' | 'jpg' | 'webp' };

function malformed(): never {
  throw new Error('图片文件已损坏或格式不完整');
}

function animated(): never {
  throw new Error('不支持动画图片，请选择静态 PNG、JPEG 或 WebP 图片');
}

function text(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});

function inspectPng(bytes: Uint8Array): void {
  const data = view(bytes);
  let offset = 8;
  let color = -1;
  let depth = 0;
  let palette = false;
  let dataEnded = false;
  let compressedBytes = 0;
  const zlibHeader: number[] = [];
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) malformed();
    const length = data.getUint32(offset);
    if (length > bytes.length - offset - 12) malformed();
    const kind = text(bytes, offset + 4, 4);
    const start = offset + 8;
    const end = start + length;
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(kind)) malformed();
    if (kind === 'acTL' || kind === 'fcTL' || kind === 'fdAT') animated();
    let crc = 0xffffffff;
    for (let i = offset + 4; i < end; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xff];
    if (((crc ^ 0xffffffff) >>> 0) !== data.getUint32(end)) malformed();
    if (offset === 8 && kind !== 'IHDR') malformed();
    if (kind === 'IHDR') {
      if (offset !== 8 || length !== 13) malformed();
      depth = bytes[start + 8];
      color = bytes[start + 9];
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[color]?.includes(depth) || bytes[start + 10] !== 0
        || bytes[start + 11] !== 0 || bytes[start + 12] > 1) malformed();
    } else if (kind === 'PLTE') {
      if (palette || compressedBytes || color === 0 || color === 4
        || !length || length % 3 || length > 768 || (color === 3 && length / 3 > 2 ** depth)) malformed();
      palette = true;
    } else if (kind === 'IDAT') {
      if (dataEnded || (color === 3 && !palette)) malformed();
      for (let i = start; i < end && zlibHeader.length < 2; i++) zlibHeader.push(bytes[i]);
      compressedBytes += length;
    } else if (kind === 'IEND') {
      if (length !== 0 || end + 4 !== bytes.length || compressedBytes < 6) malformed();
      const [cmf, flg] = zlibHeader;
      if ((cmf & 0x0f) !== 8 || cmf >>> 4 > 7 || (flg & 0x20) || ((cmf << 8) + flg) % 31) malformed();
      return;
    } else if (kind[0] === kind[0].toUpperCase()) {
      malformed(); // Unknown critical chunks cannot be safely interpreted.
    }
    if (kind !== 'IDAT' && compressedBytes) dataEnded = true;
    offset = end + 4;
  }
  malformed();
}

function inspectJpeg(bytes: Uint8Array): void {
  const data = view(bytes);
  let offset = 2;
  let frame = false;
  let scan = false;
  let quantization = false;
  let huffman = false;
  const components = new Set<number>();
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) malformed();
    while (bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) malformed();
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!frame || !scan || offset !== bytes.length) malformed();
      return;
    }
    if (marker === 0 || marker === 0xd8 || marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) malformed();
    if (offset + 2 > bytes.length) malformed();
    const length = data.getUint16(offset);
    if (length < 2 || length > bytes.length - offset) malformed();
    const end = offset + length;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (frame || ![0xc0, 0xc1, 0xc2].includes(marker) || length < 11 || bytes[offset + 2] !== 8) malformed();
      const count = bytes[offset + 7];
      if (count < 1 || count > 4 || length !== 8 + 3 * count) malformed();
      for (let i = offset + 8; i < end; i += 3) {
        if (components.has(bytes[i]) || !(bytes[i + 1] & 15) || (bytes[i + 1] & 15) > 4
          || !(bytes[i + 1] >>> 4) || bytes[i + 1] >>> 4 > 4 || bytes[i + 2] > 3) malformed();
        components.add(bytes[i]);
      }
      frame = true;
    } else if (marker === 0xdb || marker === 0xc4) {
      let cursor = offset + 2;
      if (cursor === end) malformed();
      while (cursor < end) {
        const table = bytes[cursor++];
        if ((table & 15) > 3 || table >>> 4 > 1) malformed();
        if (marker === 0xdb) {
          cursor += 64 * (1 + (table >>> 4));
          quantization = true;
        } else {
          if (cursor + 16 > end) malformed();
          let symbols = 0;
          for (let i = 0; i < 16; i++) symbols += bytes[cursor++];
          if (!symbols || symbols > 256) malformed();
          cursor += symbols;
          huffman = true;
        }
        if (cursor > end) malformed();
      }
    } else if (marker === 0xdd && length !== 4) {
      malformed();
    } else if (marker === 0xda) {
      const count = bytes[offset + 2];
      if (!frame || !quantization || !huffman || !count || count > components.size || length !== 6 + 2 * count) malformed();
      const selected = new Set<number>();
      for (let i = offset + 3; i < end - 3; i += 2) {
        if (!components.has(bytes[i]) || selected.has(bytes[i]) || (bytes[i + 1] & 15) > 3 || bytes[i + 1] >>> 4 > 3) malformed();
        selected.add(bytes[i]);
      }
      offset = end;
      let entropyBytes = 0;
      // Walk stuffed bytes/restart markers, including all progressive scans, to the real EOI.
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) { offset++; entropyBytes++; continue; }
        const start = offset++;
        while (bytes[offset] === 0xff) offset++;
        const code = bytes[offset];
        if (code === 0 || (code >= 0xd0 && code <= 0xd7)) {
          offset++;
          if (code === 0) entropyBytes++;
        } else {
          offset = start;
          break;
        }
      }
      if (!entropyBytes) malformed();
      scan = true;
      continue;
    }
    offset = end;
  }
  malformed();
}

function inspectWebp(bytes: Uint8Array, info: PhotoInfo): void {
  const data = view(bytes);
  if (bytes.length < 20 || data.getUint32(4, true) !== bytes.length - 8) malformed();
  let offset = 12;
  let extended = false;
  let image = false;
  let alpha = false;
  let flags = 0;
  while (offset < bytes.length) {
    if (bytes.length - offset < 8) malformed();
    const kind = text(bytes, offset, 4);
    const length = data.getUint32(offset + 4, true);
    const start = offset + 8;
    if (length > bytes.length - start) malformed();
    const end = start + length;
    const next = end + (length & 1);
    if (next > bytes.length || ((length & 1) && bytes[end] !== 0)) malformed();
    if (kind === 'ANIM' || kind === 'ANMF') animated();
    if (offset === 12 && !['VP8X', 'VP8 ', 'VP8L'].includes(kind)) malformed();
    if (kind === 'VP8X') {
      if (extended || offset !== 12 || length !== 10) malformed();
      flags = bytes[start];
      if (flags & 2) animated();
      if ((flags & 0xc1) || bytes[start + 1] || bytes[start + 2] || bytes[start + 3]) malformed();
      extended = true;
    } else if (kind === 'VP8 ' || kind === 'VP8L') {
      if (image) malformed();
      let width: number;
      let height: number;
      if (kind === 'VP8 ') {
        if (length <= 10 || text(bytes, start + 3, 3) !== '\x9d\x01\x2a') malformed();
        const tag = bytes[start] | bytes[start + 1] << 8 | bytes[start + 2] << 16;
        if ((tag & 1) || ((tag >>> 1) & 7) > 3 || !(tag & 16) || !(tag >>> 5) || (tag >>> 5) > length - 10) malformed();
        width = data.getUint16(start + 6, true);
        height = data.getUint16(start + 8, true);
        if (width > 0x3fff || height > 0x3fff) malformed();
      } else {
        if (alpha || length <= 5 || bytes[start] !== 0x2f || (bytes[start + 4] & 0xe0)) malformed();
        const bits = data.getUint32(start + 1, true);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
      }
      // VP8X alone is not an image; its advertised canvas must match the actual bitstream.
      if (width !== info.width || height !== info.height) malformed();
      image = true;
    } else if (kind === 'ALPH') {
      if (!extended || !(flags & 16) || alpha || image || length < 2 || (bytes[start] & 0xc0)
        || (bytes[start] & 3) > 1 || ((bytes[start] >>> 4) & 3) > 1) malformed();
      alpha = true;
    } else if (['ICCP', 'EXIF', 'XMP '].includes(kind) && !extended) {
      malformed();
    }
    offset = next;
  }
  if (!image) malformed();
}

/** Header/container inspection only: compressed pixels are decoded later by the renderer. */
export function inspectPhoto(bytes: Uint8Array, forAsset = false): PhotoInfo {
  const limit = forAsset ? PROJECT_LIMITS.assetBytes : PHOTO_LIMITS.inputBytes;
  if (bytes.byteLength > limit) throw new Error(forAsset ? '照片资产不能超过 256 KiB' : '原始照片不能超过 10 MiB');
  if (!bytes.byteLength) malformed();
  let type: PhotoInfo['type'];
  if (text(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') type = 'png';
  else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) type = 'jpg';
  else if (text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 4) === 'WEBP') type = 'webp';
  else throw new Error('仅支持真实的静态 PNG、JPEG 或 WebP 图片');
  if (forAsset && type !== 'webp') throw new Error('照片资产必须是静态 WebP 图片');

  let dimensions: ReturnType<typeof imageSize>;
  try { dimensions = imageSize(bytes); } catch { malformed(); }
  const { width, height } = dimensions;
  if (dimensions.type !== type || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) malformed();
  if (width * height > PHOTO_LIMITS.pixels) throw new Error('照片像素不能超过 20,000,000');
  if (forAsset && (width !== height || width > PROJECT_LIMITS.photoSide)) throw new Error('照片资产必须为不超过 512 × 512 的正方形');
  const info = { width, height, type };
  if (type === 'png') inspectPng(bytes);
  else if (type === 'jpg') inspectJpeg(bytes);
  else inspectWebp(bytes, info);
  return info;
}

export function validatePhotoAsset(asset: PhotoAsset): void {
  if (!photoAssetSchema.safeParse(asset).success) throw new Error('照片资产格式无效，须为不超过 256 KiB 的正方形 WebP');
  let binary: string;
  try {
    binary = atob(asset.dataBase64);
    // Reject non-canonical padding as well as malformed Base64; no Node Buffer dependency.
    if (btoa(binary) !== asset.dataBase64) malformed();
  } catch {
    throw new Error('照片资产的 Base64 数据无效');
  }
  // A plain loop: Uint8Array.from with a callback costs about 6 ms per 150 KiB asset, a loop 0.2 ms.
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < bytes.length; index++) bytes[index] = binary.charCodeAt(index);
  const info = inspectPhoto(bytes, true);
  if (info.width !== asset.width || info.height !== asset.height) throw new Error('照片资产声明的宽高与图片真实尺寸不一致');
}
