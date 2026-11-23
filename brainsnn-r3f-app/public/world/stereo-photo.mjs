// Inspect encoded dimensions before decoding and reject orientation changes that invalidate pixel calibration.
export const MAX_STEREO_PHOTO_BYTES = 16 * 1024 * 1024;
const MAX_ORIGINAL_PIXELS = 16_000_000;
const PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10];
const TIFF_LE = 0x4949;
const TIFF_BE = 0x4d4d;
const JPEG_SIZE_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function checkOrientation(view, begin, end) {
  const tag = begin + 2 <= end ? view.getUint16(begin) : 0;
  const little = tag === TIFF_LE;
  if (begin + 8 > end || !little && tag !== TIFF_BE || view.getUint16(begin + 2, little) !== 42) {
    throw Error('This photo has unreadable orientation metadata. Export it as an upright PNG.');
  }
  const directory = begin + view.getUint32(begin + 4, little);
  if (directory + 2 > end) throw Error('This photo has incomplete orientation metadata. Export it as an upright PNG.');
  const entries = view.getUint16(directory, little);
  if (directory + 2 + entries * 12 > end) throw Error('This photo has incomplete orientation metadata. Export it as an upright PNG.');
  for (let index = 0; index < entries; index++) {
    const item = directory + 2 + index * 12;
    if (view.getUint16(item, little) !== 0x0112) continue;
    if (view.getUint16(item + 2, little) !== 3 || view.getUint32(item + 4, little) !== 1 ||
        view.getUint16(item + 8, little) !== 1) {
      throw Error('This photo has a rotation or mirror flag. Export upright rectified files and use the calibration for the exported pixels.');
    }
  }
}

function pngSize(view) {
  let width = 0, height = 0;
  for (let at = 8; at + 12 <= view.byteLength;) {
    const length = view.getUint32(at), type = view.getUint32(at + 4);
    const data = at + 8, end = data + length;
    if (end + 4 > view.byteLength) throw Error('This PNG is truncated.');
    if (type === 0x49484452 && at === 8 && length === 13) { // IHDR
      width = view.getUint32(data);
      height = view.getUint32(data + 4);
    }
    if (type === 0x6163544c) throw Error('Choose a single still image instead of an animated PNG.'); // acTL
    if (type === 0x65584966) checkOrientation(view, data, end); // eXIf
    if (type === 0x49454e44) return {width, height}; // IEND
    at = end + 4;
  }
  throw Error('This PNG is truncated.');
}

function jpegSize(view) {
  let width = 0, height = 0;
  for (let at = 2; at + 1 < view.byteLength;) {
    if (view.getUint8(at++) !== 0xff) throw Error('This JPEG has a malformed header.');
    while (at < view.byteLength && view.getUint8(at) === 0xff) at++;
    if (at >= view.byteLength) break;
    const marker = view.getUint8(at++);
    if (marker === 0xda || marker === 0xd9) break; // Start of scan or end of image
    if (at + 2 > view.byteLength) throw Error('This JPEG header is truncated.');
    const size = view.getUint16(at), begin = at + 2, end = at + size;
    if (size < 2 || end > view.byteLength) throw Error('This JPEG header is truncated.');
    if (JPEG_SIZE_MARKERS.has(marker) && size >= 8) {
      if (width || height) throw Error('Choose a single-frame JPEG with one image size.');
      height = view.getUint16(begin + 1);
      width = view.getUint16(begin + 3);
    }
    if (marker === 0xe1 && size >= 8 && view.getUint32(begin) === 0x45786966 && view.getUint16(begin + 4) === 0) {
      checkOrientation(view, begin + 6, end); // Exif\0\0
    }
    at = end;
  }
  return {width, height};
}

export async function inspectStereoPhoto(file) {
  if (!file?.size || file.size > MAX_STEREO_PHOTO_BYTES) throw Error('Choose a still JPEG or PNG up to 16 MiB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const png = PNG_MAGIC.every((value, index) => bytes[index] === value);
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!png && !jpeg) throw Error('Use PNG or JPEG files exported from your rectification step.');
  const {width, height} = png ? pngSize(view) : jpegSize(view);
  if (width < 32 || height < 24 || width * height > MAX_ORIGINAL_PIXELS || width > 8192 || height > 8192) {
    throw Error('Use photos at least 32 × 24 pixels and no larger than 16 megapixels.');
  }
  return {width, height};
}

export async function stereoImageData(file, original, width, height) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    if (bitmap.width !== original.width || bitmap.height !== original.height) {
      throw Error('The browser changed the decoded size. Export upright rectified PNGs with matching calibration.');
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', {willReadFrequently:true});
    if (!context) throw Error('This browser could not start a photo preview.');
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
  } finally {
    bitmap?.close();
  }
}
