import { inspectPhoto, PHOTO_LIMITS } from '../shared/photo';
import { PROJECT_LIMITS, type PhotoAsset } from '../shared/project';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function encode(canvas: OffscreenCanvas | HTMLCanvasElement, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/webp', quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('WebP 编码失败')), 'image/webp', quality);
  });
}

export async function processPhoto(file: File): Promise<PhotoAsset> {
  if (file.size > PHOTO_LIMITS.inputBytes) throw new Error('原始照片不能超过 10 MiB');
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = new Uint8Array(await file.arrayBuffer()); } catch { throw new Error('无法读取照片文件'); }
  // Inspect the complete file before any pixel decoding. Do not trust its extension or MIME.
  const info = inspectPhoto(bytes);
  const mimeType = info.type === 'jpg' ? 'image/jpeg' : `image/${info.type}`;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }), { imageOrientation: 'from-image' });
  } catch {
    throw new Error('照片解码失败，文件可能已损坏');
  }

  let canvas: OffscreenCanvas | HTMLCanvasElement | undefined;
  try {
    // The browser applies EXIF rotation/reflection before cropping. Do not rotate a second time.
    const { width, height } = bitmap;
    if (!((width === info.width && height === info.height) || (width === info.height && height === info.width))) {
      throw new Error('照片解码后的尺寸与文件声明不一致');
    }
    const cropSide = Math.min(width, height);
    let side = Math.min(PROJECT_LIMITS.photoSide, cropSide);
    canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(side, side) : document.createElement('canvas');
    const context = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!context) throw new Error('无法创建照片绘图画布');
    for (;;) {
      canvas.width = canvas.height = side;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, (width - cropSide) / 2, (height - cropSide) / 2, cropSide, cropSide, 0, 0, side, side);
      for (const quality of [0.9, 0.75, 0.55, 0.35, 0.15]) {
        // Re-encode pixels, not source metadata: EXIF is never copied into the asset.
        const blob = await encode(canvas, quality);
        if (blob.type !== 'image/webp') throw new Error('当前环境不支持 WebP 编码');
        if (blob.size > PROJECT_LIMITS.assetBytes) continue;
        const output = new Uint8Array(await blob.arrayBuffer());
        const result = inspectPhoto(output, true);
        if (result.width !== side || result.height !== side) throw new Error('照片编码后的尺寸不正确');
        return {
          id: crypto.randomUUID(), mimeType: 'image/webp', width: side, height: side,
          dataBase64: toBase64(output),
        };
      }
      if (side === 1) throw new Error('照片无法压缩到 256 KiB 以内');
      side = Math.max(1, Math.floor(side * 0.75));
    }
  } catch {
    throw new Error('照片裁剪或 WebP 编码失败，请确认图片完整且当前环境支持 WebP');
  } finally {
    bitmap.close();
    if (canvas) canvas.width = canvas.height = 0;
  }
}
