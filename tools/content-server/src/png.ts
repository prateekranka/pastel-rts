import { inflateSync } from 'node:zlib';
import { MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS } from '@pastel-rts/content-schema';

export const MAX_PNG_BYTES = 8 * 1024 * 1024;
export const MAX_DECODED_PNG_BYTES = MAX_IMAGE_PIXELS * 4;

export type DecodedPng = {
  width: number;
  height: number;
  rgba: Buffer;
};

type PngHeader = {
  width: number;
  height: number;
  bitDepth: number;
  colorType: 0 | 2 | 3 | 4 | 6;
  interlace: number;
};

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Decode and validate a PNG. Header-only checks are not enough for uploaded
 * content: this verifies chunk bounds/CRCs, zlib data, scanline filters, and
 * produces decoded RGBA pixels before the file can be stored.
 *
 * Interlaced PNGs are rejected deliberately. The authoring contract uses
 * non-interlaced sheets, and refusing an unsupported encoding is safer than
 * accepting a file that was not decoded.
 */
export function decodePng(input: Uint8Array): DecodedPng {
  const bytes = Buffer.from(input);
  if (bytes.length > MAX_PNG_BYTES) {
    throw new Error(`PNG exceeds the ${String(MAX_PNG_BYTES)} byte limit`);
  }
  if (bytes.length < SIGNATURE.length || !bytes.subarray(0, SIGNATURE.length).equals(SIGNATURE)) {
    throw new Error('Uploaded file is not a PNG');
  }

  let offset = SIGNATURE.length;
  let header: PngHeader | undefined;
  let palette: Buffer | undefined;
  let transparency: Buffer | undefined;
  const idat: Buffer[] = [];
  let sawIend = false;

  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) {
      throw new Error('PNG chunk is truncated');
    }
    const length = bytes.readUInt32BE(offset);
    offset += 4;
    if (length > bytes.length - offset - 8) {
      throw new Error('PNG chunk exceeds file bounds');
    }
    const typeBytes = bytes.subarray(offset, offset + 4);
    const type = typeBytes.toString('ascii');
    offset += 4;
    const data = bytes.subarray(offset, offset + length);
    offset += length;
    const expectedCrc = bytes.readUInt32BE(offset);
    offset += 4;
    if (crc32(Buffer.concat([typeBytes, data])) !== expectedCrc) {
      throw new Error(`PNG ${type} CRC is invalid`);
    }

    if (header === undefined && type !== 'IHDR') {
      throw new Error('PNG must begin with IHDR');
    }
    switch (type) {
      case 'IHDR':
        if (header !== undefined || data.length !== 13) {
          throw new Error('PNG IHDR is invalid');
        }
        header = parseHeader(data);
        break;
      case 'PLTE':
        if (palette !== undefined || data.length === 0 || data.length % 3 !== 0 || data.length > 256 * 3) {
          throw new Error('PNG palette is invalid');
        }
        palette = Buffer.from(data);
        break;
      case 'tRNS':
        if (transparency !== undefined) {
          throw new Error('PNG transparency chunk is duplicated');
        }
        transparency = Buffer.from(data);
        break;
      case 'IDAT':
        if (header === undefined || sawIend) {
          throw new Error('PNG IDAT is out of order');
        }
        idat.push(Buffer.from(data));
        break;
      case 'IEND':
        if (sawIend || data.length !== 0) {
          throw new Error('PNG IEND is invalid');
        }
        sawIend = true;
        if (offset !== bytes.length) {
          throw new Error('PNG has data after IEND');
        }
        break;
      default:
        if (isCriticalChunk(type)) {
          throw new Error(`Unsupported critical PNG chunk: ${type}`);
        }
        break;
    }
    if (sawIend) {
      break;
    }
  }

  if (header === undefined || !sawIend || idat.length === 0) {
    throw new Error('PNG is incomplete');
  }
  if (header.colorType === 3 && palette === undefined) {
    throw new Error('Indexed PNG is missing PLTE');
  }
  if (transparency !== undefined) {
    validateTransparencyChunk(header, transparency);
  }
  if (header.interlace !== 0) {
    throw new Error('Interlaced PNGs are not supported');
  }

  const channels = channelsForColorType(header.colorType);
  const bitsPerPixel = channels * header.bitDepth;
  const decodedRgbaBytes = header.width * header.height * 4;
  if (!Number.isSafeInteger(decodedRgbaBytes) || decodedRgbaBytes > MAX_DECODED_PNG_BYTES) {
    throw new Error('PNG decoded pixels exceed limits');
  }
  const rowBytes = Math.ceil((header.width * bitsPerPixel) / 8);
  const expectedDecodedBytes = (rowBytes + 1) * header.height;
  if (!Number.isSafeInteger(expectedDecodedBytes) || expectedDecodedBytes > MAX_DECODED_PNG_BYTES + header.height) {
    throw new Error('PNG decoded data exceeds limits');
  }

  let filtered: Buffer;
  try {
    filtered = inflateSync(Buffer.concat(idat), { maxOutputLength: expectedDecodedBytes });
  } catch {
    throw new Error('PNG image data is corrupt');
  }
  if (filtered.length !== expectedDecodedBytes) {
    throw new Error('PNG decoded scanline length is invalid');
  }

  const rgba = Buffer.alloc(header.width * header.height * 4);
  const bytesPerFilterPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const previous = Buffer.alloc(rowBytes);
  let sourceOffset = 0;
  for (let y = 0; y < header.height; y += 1) {
    const filterType = filtered[sourceOffset] ?? 255;
    sourceOffset += 1;
    const raw = filtered.subarray(sourceOffset, sourceOffset + rowBytes);
    sourceOffset += rowBytes;
    const row = Buffer.alloc(rowBytes);
    unfilterRow(filterType, raw, row, previous, bytesPerFilterPixel);
    decodeRow(row, rgba, y, header, palette, transparency);
    row.copy(previous);
  }
  return { width: header.width, height: header.height, rgba };
}

function parseHeader(data: Buffer): PngHeader {
  const width = data.readUInt32BE(0);
  const height = data.readUInt32BE(4);
  const bitDepth = data[8] ?? 0;
  const colorTypeValue = data[9] ?? -1;
  const compression = data[10] ?? -1;
  const filter = data[11] ?? -1;
  const interlace = data[12] ?? -1;
  if (
    width <= 0 ||
    height <= 0 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS ||
    compression !== 0 ||
    filter !== 0 ||
    interlace < 0 ||
    interlace > 1
  ) {
    throw new Error('PNG dimensions or encoding are invalid');
  }
  if (colorTypeValue !== 0 && colorTypeValue !== 2 && colorTypeValue !== 3 && colorTypeValue !== 4 && colorTypeValue !== 6) {
    throw new Error('PNG color type is unsupported');
  }
  const colorType = colorTypeValue as PngHeader['colorType'];
  if (!validBitDepth(colorType, bitDepth)) {
    throw new Error('PNG bit depth is unsupported');
  }
  if (interlace !== 0) {
    return { width, height, bitDepth, colorType, interlace };
  }
  return { width, height, bitDepth, colorType, interlace };
}

function validBitDepth(colorType: PngHeader['colorType'], bitDepth: number): boolean {
  if (colorType === 0 || colorType === 3) {
    return bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8 || (colorType === 0 && bitDepth === 16);
  }
  return bitDepth === 8 || bitDepth === 16;
}

function channelsForColorType(colorType: PngHeader['colorType']): number {
  switch (colorType) {
    case 0:
      return 1;
    case 2:
      return 3;
    case 3:
      return 1;
    case 4:
      return 2;
    case 6:
      return 4;
  }
}

function validateTransparencyChunk(header: PngHeader, transparency: Buffer): void {
  if (header.colorType === 0 && transparency.length !== 2) {
    throw new Error('PNG grayscale transparency is invalid');
  }
  if (header.colorType === 2 && transparency.length !== 6) {
    throw new Error('PNG truecolor transparency is invalid');
  }
  if (header.colorType === 3 && transparency.length > 256) {
    throw new Error('PNG palette transparency is invalid');
  }
  if (header.colorType === 4 || header.colorType === 6) {
    throw new Error('PNG alpha color type cannot have tRNS');
  }
}

function unfilterRow(filterType: number, raw: Buffer, row: Buffer, previous: Buffer, bytesPerPixel: number): void {
  if (filterType < 0 || filterType > 4) {
    throw new Error('PNG filter type is invalid');
  }
  for (let x = 0; x < raw.length; x += 1) {
    const value = raw[x] ?? 0;
    const left = x >= bytesPerPixel ? row[x - bytesPerPixel] ?? 0 : 0;
    const up = previous[x] ?? 0;
    const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] ?? 0 : 0;
    let result = 0;
    switch (filterType) {
      case 0:
        result = value;
        break;
      case 1:
        result = value + left;
        break;
      case 2:
        result = value + up;
        break;
      case 3:
        result = value + Math.floor((left + up) / 2);
        break;
      case 4:
        result = value + paeth(left, up, upperLeft);
        break;
    }
    row[x] = result & 0xff;
  }
}

function paeth(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  if (upDistance <= upperLeftDistance) {
    return up;
  }
  return upperLeft;
}

function decodeRow(
  row: Buffer,
  rgba: Buffer,
  y: number,
  header: PngHeader,
  palette: Buffer | undefined,
  transparency: Buffer | undefined,
): void {
  for (let x = 0; x < header.width; x += 1) {
    const output = (y * header.width + x) * 4;
    switch (header.colorType) {
      case 0: {
        const sampleValue = sample(row, x, 0, 1, header.bitDepth);
        const gray = scaleSample(sampleValue, header.bitDepth);
        const transparent = transparency !== undefined && sample16(row, x, 0, 1, header.bitDepth) === transparency.readUInt16BE(0);
        rgba[output] = gray;
        rgba[output + 1] = gray;
        rgba[output + 2] = gray;
        rgba[output + 3] = transparent ? 0 : 255;
        break;
      }
      case 2: {
        const red = sample(row, x, 0, 3, header.bitDepth);
        const green = sample(row, x, 1, 3, header.bitDepth);
        const blue = sample(row, x, 2, 3, header.bitDepth);
        const transparent =
          transparency !== undefined &&
          sample16(row, x, 0, 3, header.bitDepth) === transparency.readUInt16BE(0) &&
          sample16(row, x, 1, 3, header.bitDepth) === transparency.readUInt16BE(2) &&
          sample16(row, x, 2, 3, header.bitDepth) === transparency.readUInt16BE(4);
        rgba[output] = scaleSample(red, header.bitDepth);
        rgba[output + 1] = scaleSample(green, header.bitDepth);
        rgba[output + 2] = scaleSample(blue, header.bitDepth);
        rgba[output + 3] = transparent ? 0 : 255;
        break;
      }
      case 3: {
        const index = sample(row, x, 0, 1, header.bitDepth);
        const paletteOffset = index * 3;
        if (palette === undefined || paletteOffset + 2 >= palette.length) {
          throw new Error('PNG palette index is out of range');
        }
        rgba[output] = palette[paletteOffset] ?? 0;
        rgba[output + 1] = palette[paletteOffset + 1] ?? 0;
        rgba[output + 2] = palette[paletteOffset + 2] ?? 0;
        rgba[output + 3] = transparency?.[index] ?? 255;
        break;
      }
      case 4: {
        const gray = sample(row, x, 0, 2, header.bitDepth);
        const alpha = sample(row, x, 1, 2, header.bitDepth);
        rgba[output] = scaleSample(gray, header.bitDepth);
        rgba[output + 1] = scaleSample(gray, header.bitDepth);
        rgba[output + 2] = scaleSample(gray, header.bitDepth);
        rgba[output + 3] = scaleSample(alpha, header.bitDepth);
        break;
      }
      case 6:
        rgba[output] = scaleSample(sample(row, x, 0, 4, header.bitDepth), header.bitDepth);
        rgba[output + 1] = scaleSample(sample(row, x, 1, 4, header.bitDepth), header.bitDepth);
        rgba[output + 2] = scaleSample(sample(row, x, 2, 4, header.bitDepth), header.bitDepth);
        rgba[output + 3] = scaleSample(sample(row, x, 3, 4, header.bitDepth), header.bitDepth);
        break;
    }
  }
}

function sample(row: Buffer, pixel: number, channel: number, channels: number, bitDepth: number): number {
  if (bitDepth === 16) {
    return row.readUInt16BE((pixel * channels + channel) * 2);
  }
  if (bitDepth === 8) {
    return row[pixel * channels + channel] ?? 0;
  }
  const bitOffset = (pixel * channels + channel) * bitDepth;
  const byte = row[Math.floor(bitOffset / 8)] ?? 0;
  const shift = 8 - bitDepth - (bitOffset % 8);
  return (byte >> shift) & ((1 << bitDepth) - 1);
}

function sample16(row: Buffer, pixel: number, channel: number, channels: number, bitDepth: number): number {
  if (bitDepth === 16) {
    return sample(row, pixel, channel, channels, bitDepth);
  }
  return sample(row, pixel, channel, channels, bitDepth);
}

function scaleSample(value: number, bitDepth: number): number {
  if (bitDepth === 8) {
    return value;
  }
  if (bitDepth === 16) {
    return value >>> 8;
  }
  return Math.round((value * 255) / ((1 << bitDepth) - 1));
}

function isCriticalChunk(type: string): boolean {
  const first = type.charCodeAt(0);
  return (first & 0x20) === 0;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
