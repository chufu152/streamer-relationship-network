import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectPhoto, PHOTO_LIMITS, validatePhotoAsset } from '../../src/shared/photo';
import { processPhoto } from '../../src/renderer/photo';
import { PROJECT_LIMITS, type PhotoAsset } from '../../src/shared/project';

// Real, browser-encoded 1×1 black pixels, with no photographs or personal metadata.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGD4DwAAAP//cGajQwAAAAZJREFUAwABDgEC81VxbAAAAABJRU5ErkJggg==';
const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJVAA//Z';
const WEBP = 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v02aAA=';
const LOSSLESS = 'UklGRhoAAABXRUJQVlA4TA4AAAAvAAAAAAcQEf0PRET/Aw==';
const decode = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const ascii = (value: string) => Uint8Array.from(value, (c) => c.charCodeAt(0));

function join(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function pngChunk(kind: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = join(new Uint8Array(4), ascii(kind), payload, new Uint8Array(4));
  const data = new DataView(bytes.buffer);
  data.setUint32(0, payload.length);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(4, bytes.length - 4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  data.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0);
  return bytes;
}

// Dimension-only mutations test container policy, not compressed-pixel decoding.
function pngHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = decode(PNG);
  const header = bytes.slice(16, 29);
  const data = new DataView(header.buffer);
  data.setUint32(0, width);
  data.setUint32(4, height);
  return join(bytes.slice(0, 8), pngChunk('IHDR', header), bytes.slice(33));
}

function webpChunk(kind: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = join(ascii(kind), new Uint8Array(4), payload, new Uint8Array(payload.length % 2));
  new DataView(bytes.buffer).setUint32(4, payload.length, true);
  return bytes;
}

function riff(...chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const bytes = join(ascii('RIFF'), new Uint8Array(4), ascii('WEBP'), ...chunks);
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  return bytes;
}

function extended(width = 1, height = 1, flags = 0): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(10);
  bytes[0] = flags;
  for (let i = 0; i < 3; i++) {
    bytes[4 + i] = ((width - 1) >>> (8 * i)) & 255;
    bytes[7 + i] = ((height - 1) >>> (8 * i)) & 255;
  }
  return webpChunk('VP8X', bytes);
}

function webpHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = decode(WEBP);
  const data = new DataView(bytes.buffer);
  data.setUint16(26, width, true);
  data.setUint16(28, height, true);
  return bytes;
}

function asset(overrides: Partial<PhotoAsset> = {}): PhotoAsset {
  return { id: crypto.randomUUID(), mimeType: 'image/webp', width: 1, height: 1, dataBase64: WEBP, ...overrides };
}

const vp8 = () => decode(WEBP).slice(12);

afterEach(() => vi.unstubAllGlobals());

describe('inspectPhoto', () => {
  it.each([
    ['png', PNG], ['jpg', JPEG], ['webp', WEBP], ['webp', LOSSLESS],
  ])('reads a real 1×1 %s image', (type, encoded) => {
    expect(inspectPhoto(decode(encoded))).toEqual({ width: 1, height: 1, type });
  });

  it('supports Uint8Array subviews without inspecting unrelated buffer bytes', () => {
    const bytes = join(new Uint8Array(7), decode(WEBP), new Uint8Array(5));
    expect(inspectPhoto(bytes.subarray(7, bytes.length - 5), true).width).toBe(1);
  });

  it.each(['<svg xmlns="http://www.w3.org/2000/svg"/>', 'GIF89a\x01\0\x01\0', 'not a photo'])('rejects unsupported content %s', (content) => {
    expect(() => inspectPhoto(ascii(content))).toThrow(/仅支持/);
  });

  it('enforces input and asset byte limits on the actual byte array', () => {
    expect(() => inspectPhoto(new Uint8Array(PHOTO_LIMITS.inputBytes + 1))).toThrow(/10 MiB/);
    expect(() => inspectPhoto(new Uint8Array(PROJECT_LIMITS.assetBytes + 1), true)).toThrow(/256 KiB/);
    const exactAsset = riff(vp8(), webpChunk('JUNK', new Uint8Array(PROJECT_LIMITS.assetBytes - decode(WEBP).length - 8)));
    expect(exactAsset.length).toBe(PROJECT_LIMITS.assetBytes);
    expect(inspectPhoto(exactAsset, true).width).toBe(1);
    const exactInput = riff(vp8(), webpChunk('JUNK', new Uint8Array(PHOTO_LIMITS.inputBytes - decode(WEBP).length - 8)));
    expect(inspectPhoto(exactInput).width).toBe(1);
  });

  it('accepts 20 million pixels but refuses any larger header before decoding', () => {
    expect(inspectPhoto(pngHeader(5000, 4000))).toMatchObject({ width: 5000, height: 4000 });
    expect(() => inspectPhoto(pngHeader(5000, 4001))).toThrow(/20,000,000/);
    expect(() => inspectPhoto(pngHeader(0xffffffff, 0xffffffff))).toThrow(/20,000,000/);
    expect(() => inspectPhoto(pngHeader(0, 1))).toThrow(/损坏/);
  });

  it('enforces the real asset format, square shape and 512-side limit', () => {
    expect(() => inspectPhoto(decode(PNG), true)).toThrow(/WebP/);
    expect(() => inspectPhoto(decode(JPEG), true)).toThrow(/WebP/);
    expect(inspectPhoto(webpHeader(512, 512), true).width).toBe(512);
    expect(() => inspectPhoto(webpHeader(513, 513), true)).toThrow(/512/);
    expect(() => inspectPhoto(webpHeader(2, 1), true)).toThrow(/正方形/);
  });

  it.each(['acTL', 'fcTL', 'fdAT'])('rejects PNG animation chunk %s even after IDAT', (kind) => {
    const png = decode(PNG);
    const bytes = join(png.slice(0, -12), pngChunk(kind, new Uint8Array(8)), png.slice(-12));
    expect(() => inspectPhoto(bytes)).toThrow(/动画/);
  });

  it('rejects VP8X animation flags, ANIM and ANMF chunks anywhere in the container', () => {
    expect(() => inspectPhoto(riff(extended(1, 1, 2), vp8()))).toThrow(/动画/);
    for (const kind of ['ANIM', 'ANMF']) {
      expect(() => inspectPhoto(riff(vp8(), webpChunk(kind, new Uint8Array(6))))).toThrow(/动画/);
      expect(() => inspectPhoto(riff(extended(), webpChunk(kind, new Uint8Array(6)), vp8()), true)).toThrow(/动画/);
    }
  });

  it('does not mistake animation words inside payloads for animation chunks', () => {
    expect(inspectPhoto(riff(vp8(), webpChunk('JUNK', ascii('ANIMANMFVP8X')))).width).toBe(1);
    const png = decode(PNG);
    expect(inspectPhoto(join(png.slice(0, 33), pngChunk('tEXt', ascii('note\0acTL')), png.slice(33))).width).toBe(1);
  });

  it.each([PNG, JPEG, WEBP, LOSSLESS])('rejects every truncation of a real image', (encoded) => {
    const bytes = decode(encoded);
    for (let length = 0; length < bytes.length; length++) {
      expect(() => inspectPhoto(bytes.slice(0, length)), `truncated at ${length}`).toThrow();
    }
    expect(() => inspectPhoto(join(bytes, new Uint8Array(1)))).toThrow();
  });

  it('rejects PNG CRC errors, huge lengths, duplicate IHDR, missing data and bad chunk order', () => {
    const png = decode(PNG);
    const badCrc = png.slice(); badCrc[29] ^= 1;
    const huge = png.slice(); new DataView(huge.buffer).setUint32(8, 0xffffffff);
    const idat = pngChunk('IDAT', Uint8Array.of(1));
    const badFiles = [
      badCrc, huge, join(png.slice(0, 33), png.slice(8)),
      join(png.slice(0, 33), png.slice(-12)),
      join(png.slice(0, -12), pngChunk('tEXt', ascii('k\0v')), idat, png.slice(-12)),
      join(png.slice(0, 33), pngChunk('ABCD', new Uint8Array()), png.slice(33)),
    ];
    for (const bytes of badFiles) expect(() => inspectPhoto(bytes)).toThrow(/损坏/);
  });

  it('rejects PNG invalid bit depth, compression and deflate header', () => {
    const png = decode(PNG);
    for (const index of [8, 9, 10, 11, 12]) {
      const header = png.slice(16, 29); header[index] = 255;
      expect(() => inspectPhoto(join(png.slice(0, 8), pngChunk('IHDR', header), png.slice(33)))).toThrow(/损坏/);
    }
    expect(() => inspectPhoto(join(png.slice(0, 33), pngChunk('IDAT', new Uint8Array(6)), png.slice(-12)))).toThrow(/损坏/);
  });

  it('rejects WebP invalid RIFF/chunk lengths, reserved bits, padding and fake bitstreams', () => {
    const badRiff = decode(WEBP); badRiff[4]++;
    const badLength = decode(WEBP); new DataView(badLength.buffer).setUint32(16, 0xffffffff, true);
    const badSignature = decode(WEBP); badSignature[23] = 0;
    const badPartition = decode(WEBP); badPartition[22] = 255;
    const badPadding = riff(vp8(), webpChunk('JUNK', Uint8Array.of(1))); badPadding[badPadding.length - 1] = 1;
    const badLossless = decode(LOSSLESS); badLossless[24] |= 0xe0;
    const badFiles = [badRiff, badLength, badSignature, badPartition, badPadding, badLossless,
      riff(extended()), riff(extended(2, 2), vp8()), riff(vp8(), vp8()),
      riff(extended(1, 1, 1), vp8()), riff(extended(), extended(), vp8()),
      riff(webpChunk('VP8L', Uint8Array.of(0x2f, 0, 0, 0, 0))),
    ];
    for (const bytes of badFiles) expect(() => inspectPhoto(bytes)).toThrow(/损坏/);
  });

  it('rejects JPEG segment overflow, invalid tables, missing SOS and concatenated images', () => {
    const jpeg = decode(JPEG);
    const overflow = jpeg.slice(); overflow[4] = 255; overflow[5] = 255;
    const short = jpeg.slice(); short[4] = 0; short[5] = 1;
    const sos = jpeg.findIndex((byte, index) => byte === 0xff && jpeg[index + 1] === 0xda);
    const dqt = jpeg.findIndex((byte, index) => byte === 0xff && jpeg[index + 1] === 0xdb);
    const badTable = jpeg.slice(); badTable[dqt + 4] = 0xff;
    const emptyScan = join(jpeg.slice(0, sos + 2 + ((jpeg[sos + 2] << 8) | jpeg[sos + 3])), Uint8Array.of(0xff, 0xd9));
    for (const bytes of [overflow, short, badTable, emptyScan, join(jpeg.slice(0, sos), Uint8Array.of(0xff, 0xd9)), join(jpeg, jpeg)]) {
      expect(() => inspectPhoto(bytes)).toThrow(/损坏/);
    }
  });
});

describe('validatePhotoAsset', () => {
  it('validates real bytes using browser-compatible Base64 functions without Buffer', () => {
    vi.stubGlobal('Buffer', undefined);
    expect(() => validatePhotoAsset(asset())).not.toThrow();
    expect(() => validatePhotoAsset(asset({ dataBase64: LOSSLESS }))).not.toThrow();
  });

  it('rejects forged metadata, MIME, IDs, format and animation', () => {
    const animation = base64(riff(extended(1, 1, 2), vp8()));
    for (const value of [
      asset({ width: 2, height: 2 }), asset({ dataBase64: base64(webpHeader(2, 2)) }),
      asset({ mimeType: 'image/png' as 'image/webp' }), asset({ id: 'bad' }),
      asset({ dataBase64: PNG }), asset({ dataBase64: animation }), asset({ width: NaN }),
    ]) expect(() => validatePhotoAsset(value)).toThrow();
    expect(() => validatePhotoAsset(asset({ width: 2, height: 2 }))).toThrow(/真实尺寸/);
  });

  it.each(['', 'AAAA', '!!!!', 'data:image/webp;base64,' + WEBP, WEBP + '\n', WEBP.slice(0, -1), WEBP.slice(0, -2) + 'B='])('rejects invalid or noncanonical Base64', (dataBase64) => {
    expect(() => validatePhotoAsset(asset({ dataBase64 }))).toThrow();
  });

  it('rejects decoded bytes over 256 KiB even when the Base64 length rounds to the same limit', () => {
    const dataBase64 = base64(new Uint8Array(PROJECT_LIMITS.assetBytes + 1));
    expect(dataBase64.length).toBe(Math.ceil(PROJECT_LIMITS.assetBytes / 3) * 4);
    expect(() => validatePhotoAsset(asset({ dataBase64 }))).toThrow(/256 KiB/);
  });
});

function mockCanvas(width = 1, height = 1, useHtml = false) {
  const bitmap = { width, height, close: vi.fn() };
  const decodeBitmap = vi.fn().mockResolvedValue(bitmap);
  const drawImage = vi.fn();
  const context = { drawImage, imageSmoothingEnabled: false, imageSmoothingQuality: 'low' };
  const canvases: MockCanvas[] = [];
  class MockCanvas {
    width = 0;
    height = 0;
    constructor() { canvases.push(this); }
    getContext = vi.fn().mockReturnValue(context);
    convertToBlob = vi.fn(async (options: { quality: number; type: string }): Promise<Blob> => {
      return new Blob([webpHeader(this.width, this.height)], { type: options.type });
    });
  }
  const htmlCanvas = new MockCanvas();
  const toBlob = vi.fn((callback: BlobCallback, type: string, quality: number) => {
    void htmlCanvas.convertToBlob({ type, quality }).then(callback);
  });
  vi.stubGlobal('createImageBitmap', decodeBitmap);
  if (useHtml) {
    const html = { get width() { return htmlCanvas.width; }, set width(value) { htmlCanvas.width = value; },
      get height() { return htmlCanvas.height; }, set height(value) { htmlCanvas.height = value; },
      getContext: htmlCanvas.getContext, toBlob };
    vi.stubGlobal('OffscreenCanvas', undefined);
    vi.stubGlobal('document', { createElement: vi.fn().mockReturnValue(html) });
  } else {
    vi.stubGlobal('OffscreenCanvas', MockCanvas);
  }
  return { bitmap, decodeBitmap, drawImage, context, canvases, htmlCanvas, toBlob, MockCanvas };
}

function file(bytes = decode(PNG), name = 'avatar.png', type = 'image/png'): File {
  return new File([bytes], name, { type });
}

describe('processPhoto', () => {
  it('processes real bytes despite a misleading extension/MIME and does not upscale', async () => {
    const mocks = mockCanvas();
    const result = await processPhoto(file(decode(PNG), 'fake.svg', 'image/svg+xml'));
    expect(() => validatePhotoAsset(result)).not.toThrow();
    expect(result).toMatchObject({ width: 1, height: 1, mimeType: 'image/webp' });
    const [blob, options] = mocks.decodeBitmap.mock.calls[0];
    expect(blob.type).toBe('image/png');
    expect(options).toEqual({ imageOrientation: 'from-image' });
    expect(mocks.drawImage).toHaveBeenCalledWith(mocks.bitmap, 0, 0, 1, 1, 0, 0, 1, 1);
    expect(mocks.bitmap.close).toHaveBeenCalledOnce();
    expect(mocks.canvases[1].width).toBe(0);
  });

  it('rejects large files before reading them and rejects invalid headers before pixel decoding', async () => {
    const mocks = mockCanvas();
    const arrayBuffer = vi.fn();
    await expect(processPhoto({ size: PHOTO_LIMITS.inputBytes + 1, arrayBuffer } as unknown as File)).rejects.toThrow(/10 MiB/);
    expect(arrayBuffer).not.toHaveBeenCalled();
    for (const bytes of [new Uint8Array(), ascii('<svg/>'), ascii('GIF89a'), pngHeader(5000, 4001), decode(PNG).slice(0, 32), riff(extended(1, 1, 2), vp8())]) {
      await expect(processPhoto(file(bytes))).rejects.toThrow();
    }
    expect(mocks.decodeBitmap).not.toHaveBeenCalled();
  });

  it('checks the actual read byte count even when file.size is forged', async () => {
    const mocks = mockCanvas();
    const fakeFile = { size: 1, arrayBuffer: async () => new ArrayBuffer(PHOTO_LIMITS.inputBytes + 1) } as File;
    await expect(processPhoto(fakeFile)).rejects.toThrow(/10 MiB/);
    expect(mocks.decodeBitmap).not.toHaveBeenCalled();
  });

  it.each([[1200, 800, 200, 0], [800, 1200, 0, 200]])('center-crops oriented %s×%s pixels at a maximum of 512', async (width, height, x, y) => {
    const mocks = mockCanvas(width, height);
    // Simulate EXIF orientation swapping the decoded width/height of the original header.
    const result = await processPhoto(file(pngHeader(1200, 800)));
    expect(result.width).toBe(512);
    expect(mocks.drawImage).toHaveBeenCalledWith(mocks.bitmap, x, y, 800, 800, 0, 0, 512, 512);
    expect(mocks.context.imageSmoothingQuality).toBe('high');
    expect(mocks.bitmap.close).toHaveBeenCalledOnce();
  });

  it('falls back to HTMLCanvasElement and requests WebP explicitly', async () => {
    const mocks = mockCanvas(1, 1, true);
    expect((await processPhoto(file())).width).toBe(1);
    expect(mocks.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.9);
    expect(mocks.bitmap.close).toHaveBeenCalledOnce();
  });

  it('reduces quality, then dimensions when necessary, and bounds the final bytes', async () => {
    const mocks = mockCanvas(600, 600);
    const attempts: { side: number; quality: number }[] = [];
    class LargeCanvas extends mocks.MockCanvas {
      override convertToBlob = vi.fn(async ({ quality }: { quality: number; type: string }) => {
        attempts.push({ side: this.width, quality });
        return this.width === 512 || quality > 0.55
          ? new Blob([new Uint8Array(PROJECT_LIMITS.assetBytes + 1)], { type: 'image/webp' })
          : new Blob([webpHeader(this.width, this.height)], { type: 'image/webp' });
      });
    }
    vi.stubGlobal('OffscreenCanvas', LargeCanvas);
    const result = await processPhoto(file(pngHeader(600, 600)));
    expect(result.width).toBe(384);
    expect(attempts).toEqual([
      ...[0.9, 0.75, 0.55, 0.35, 0.15].map((quality) => ({ side: 512, quality })),
      ...[0.9, 0.75, 0.55].map((quality) => ({ side: 384, quality })),
    ]);
    expect(() => validatePhotoAsset(result)).not.toThrow();
    expect(mocks.bitmap.close).toHaveBeenCalledOnce();
  });

  it('returns Chinese read/decode errors', async () => {
    const mocks = mockCanvas();
    await expect(processPhoto({ size: 1, arrayBuffer: async () => { throw new Error('read'); } } as unknown as File)).rejects.toThrow(/无法读取/);
    mocks.decodeBitmap.mockRejectedValue(new Error('bad pixels'));
    await expect(processPhoto(file())).rejects.toThrow(/解码失败/);
    expect(mocks.bitmap.close).not.toHaveBeenCalled();
  });

  it.each(['dimensions', 'context', 'draw', 'encode', 'mime', 'bytes', 'oversize'])('releases the bitmap on %s failures', async (failure) => {
    const mocks = mockCanvas();
    if (failure === 'dimensions') mocks.bitmap.width = 2;
    if (failure === 'draw') mocks.drawImage.mockImplementation(() => { throw new Error('draw failed'); });
    class FailingCanvas extends mocks.MockCanvas {
      override getContext = vi.fn().mockReturnValue(failure === 'context' ? null : mocks.context);
      override convertToBlob = vi.fn(async (): Promise<Blob> => {
        if (failure === 'encode') throw new Error('encode failed');
        if (failure === 'mime') return new Blob([decode(PNG)], { type: 'image/png' });
        if (failure === 'bytes') return new Blob([decode(PNG)], { type: 'image/webp' });
        if (failure === 'oversize') return new Blob([new Uint8Array(PROJECT_LIMITS.assetBytes + 1)], { type: 'image/webp' });
        return new Blob([decode(WEBP)], { type: 'image/webp' });
      });
    }
    vi.stubGlobal('OffscreenCanvas', FailingCanvas);
    await expect(processPhoto(file())).rejects.toThrow(/照片裁剪或 WebP 编码失败/);
    expect(mocks.bitmap.close).toHaveBeenCalledOnce();
    if (mocks.canvases.length > 1) expect(mocks.canvases[1].width).toBe(0);
  });

  it('handles a null HTML canvas encoding result without leaking the bitmap', async () => {
    const mocks = mockCanvas(1, 1, true);
    mocks.toBlob.mockImplementation((callback) => callback(null));
    await expect(processPhoto(file())).rejects.toThrow(/WebP 编码失败/);
    expect(mocks.bitmap.close).toHaveBeenCalledOnce();
  });
});
