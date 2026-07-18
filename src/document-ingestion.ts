import { readFile } from 'node:fs/promises';
import { basename, extname, join, parse } from 'node:path';
import sharp, { type Metadata } from 'sharp';
import { z } from 'zod';
import type { VisionClient } from './ai/transcriber.js';
import { extractJsonObject } from './ai/transcriber.js';
import type { MediaType } from './importer.js';

export interface DocumentRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CroppedDocument {
  path: string;
  filename: string;
  region: DocumentRegion;
}

export interface DocumentTypeClassifier {
  classify(images: Buffer[]): Promise<MediaType[]>;
}

export class DocumentIngestionError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 422,
  ) {
    super(message);
    this.name = 'DocumentIngestionError';
  }
}

interface AnalysisImage {
  data: Buffer;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}

interface AnalysisBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const CLASSIFIABLE_TYPES = z.enum(['photo', 'letter', 'article', 'pdf']);
const ClassificationSchema = z.object({
  items: z.array(z.object({
    index: z.number().int().positive(),
    mediaType: CLASSIFIABLE_TYPES,
  })),
});

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.floor(values.length * fraction))]!;
}

function median(values: number[]): number {
  return percentile(values, 0.5);
}

function orientedDimensions(metadata: Metadata): { width: number; height: number } {
  if (!metadata.width || !metadata.height) {
    throw new DocumentIngestionError('The uploaded file does not contain a readable image.');
  }
  const swapsAxes = metadata.orientation !== undefined
    && metadata.orientation >= 5
    && metadata.orientation <= 8;
  return swapsAxes
    ? { width: metadata.height, height: metadata.width }
    : { width: metadata.width, height: metadata.height };
}

async function loadAnalysisImage(sourcePath: string, maxDimension: number): Promise<AnalysisImage> {
  let metadata: Metadata;
  try {
    metadata = await sharp(sourcePath).metadata();
  } catch {
    throw new DocumentIngestionError('The uploaded file is not a supported image.');
  }
  const original = orientedDimensions(metadata);
  if (original.width < 300 || original.height < 300) {
    throw new DocumentIngestionError('The document sheet image is too small to split reliably.');
  }

  try {
    const { data, info } = await sharp(sourcePath)
      .rotate()
      .resize({
        width: maxDimension,
        height: maxDimension,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .blur(1)
      .raw()
      .toBuffer({ resolveWithObject: true });
    return {
      data,
      width: info.width,
      height: info.height,
      originalWidth: original.width,
      originalHeight: original.height,
    };
  } catch {
    throw new DocumentIngestionError('The uploaded file is not a supported image.');
  }
}

function estimateBackground(image: AnalysisImage): [number, number, number] {
  const { data, width, height } = image;
  const border = Math.max(2, Math.round(Math.min(width, height) * 0.018));
  const channels: [number[], number[], number[]] = [[], [], []];
  const step = Math.max(1, Math.floor(Math.max(width, height) / 700));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (x >= border && x < width - border && y >= border && y < height - border) continue;
      const offset = (y * width + x) * 3;
      channels[0].push(data[offset]!);
      channels[1].push(data[offset + 1]!);
      channels[2].push(data[offset + 2]!);
    }
  }
  return [median(channels[0]), median(channels[1]), median(channels[2])];
}

function colourDistance(data: Buffer, offset: number, background: [number, number, number]): number {
  const dr = data[offset]! - background[0];
  const dg = data[offset + 1]! - background[1];
  const db = data[offset + 2]! - background[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function buildForegroundMask(image: AnalysisImage): Uint8Array {
  const background = estimateBackground(image);
  const { data, width, height } = image;
  const border = Math.max(2, Math.round(Math.min(width, height) * 0.018));
  const borderDistances: number[] = [];
  const sampleStep = Math.max(1, Math.floor(Math.max(width, height) / 700));
  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      if (x >= border && x < width - border && y >= border && y < height - border) continue;
      borderDistances.push(colourDistance(data, (y * width + x) * 3, background));
    }
  }
  // The border models the table/backdrop. A noise-aware threshold tolerates
  // wood grain and lighting falloff while retaining paper/photo boundaries.
  const threshold = Math.min(110, Math.max(24, percentile(borderDistances, 0.98) + 14));
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    if (colourDistance(data, i * 3, background) >= threshold) mask[i] = 1;
  }
  return mask;
}

function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const horizontal = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) {
      const added = x + radius;
      const removed = x - radius - 1;
      if (added < width) count += mask[y * width + added]!;
      if (removed >= 0) count -= mask[y * width + removed]!;
      if (count > 0) horizontal[y * width + x] = 1;
    }
  }

  const output = new Uint8Array(mask.length);
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y < height; y++) {
      const added = y + radius;
      const removed = y - radius - 1;
      if (added < height) count += horizontal[added * width + x]!;
      if (removed >= 0) count -= horizontal[removed * width + x]!;
      if (count > 0) output[y * width + x] = 1;
    }
  }
  return output;
}

function connectedComponentBoxes(mask: Uint8Array, width: number, height: number): AnalysisBox[] {
  const seen = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const minPixels = Math.max(60, Math.round(width * height * 0.0015));
  const boxes: AnalysisBox[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    let pixels = 0;
    let left = width;
    let right = 0;
    let top = height;
    let bottom = 0;
    while (head < tail) {
      const index = queue[head++]!;
      const y = Math.floor(index / width);
      const x = index - y * width;
      pixels++;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const next = ny * width + nx;
          if (mask[next] && !seen[next]) {
            seen[next] = 1;
            queue[tail++] = next;
          }
        }
      }
    }
    if (pixels >= minPixels) boxes.push({ left, right, top, bottom });
  }
  return boxes;
}

function gap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  if (aEnd >= bStart && bEnd >= aStart) return 0;
  return aEnd < bStart ? bStart - aEnd : aStart - bEnd;
}

function overlapFraction(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const overlap = Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart) + 1);
  return overlap / Math.max(1, Math.min(aEnd - aStart + 1, bEnd - bStart + 1));
}

function mergeNearbyBoxes(boxes: AnalysisBox[], width: number, height: number): AnalysisBox[] {
  const maxGap = Math.max(4, Math.round(Math.min(width, height) * 0.018));
  const merged = [...boxes];
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        const a = merged[i]!;
        const b = merged[j]!;
        const horizontalGap = gap(a.left, a.right, b.left, b.right);
        const verticalGap = gap(a.top, a.bottom, b.top, b.bottom);
        const sameColumn = overlapFraction(a.left, a.right, b.left, b.right) >= 0.45;
        const sameRow = overlapFraction(a.top, a.bottom, b.top, b.bottom) >= 0.45;
        if ((sameColumn && verticalGap <= maxGap) || (sameRow && horizontalGap <= maxGap)) {
          merged[i] = {
            left: Math.min(a.left, b.left),
            right: Math.max(a.right, b.right),
            top: Math.min(a.top, b.top),
            bottom: Math.max(a.bottom, b.bottom),
          };
          merged.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }
  return merged;
}

function sortReadingOrder(a: AnalysisBox, b: AnalysisBox): number {
  const rowTolerance = Math.min(a.bottom - a.top, b.bottom - b.top) * 0.35;
  if (Math.abs(a.top - b.top) <= rowTolerance) return a.left - b.left;
  return a.top - b.top;
}

export async function detectDocumentRegions(
  sourcePath: string,
  opts: { analysisMaxDimension?: number; maxDocuments?: number } = {},
): Promise<DocumentRegion[]> {
  const image = await loadAnalysisImage(sourcePath, opts.analysisMaxDimension ?? 1400);
  const radius = Math.max(2, Math.round(Math.min(image.width, image.height) * 0.004));
  const mask = dilate(buildForegroundMask(image), image.width, image.height, radius);
  const candidateBoxes = mergeNearbyBoxes(
    connectedComponentBoxes(mask, image.width, image.height),
    image.width,
    image.height,
  );
  const minimumBoxArea = image.width * image.height * 0.006;
  const minimumSide = Math.min(image.width, image.height) * 0.045;
  const padding = Math.max(3, Math.round(Math.min(image.width, image.height) * 0.008));
  const boxes = candidateBoxes
    .filter((box) => {
      const boxWidth = box.right - box.left + 1;
      const boxHeight = box.bottom - box.top + 1;
      return boxWidth * boxHeight >= minimumBoxArea
        && boxWidth >= minimumSide
        && boxHeight >= minimumSide;
    })
    .map((box) => ({
      left: Math.max(0, box.left - padding),
      top: Math.max(0, box.top - padding),
      right: Math.min(image.width - 1, box.right + padding),
      bottom: Math.min(image.height - 1, box.bottom + padding),
    }))
    .sort(sortReadingOrder);

  if (boxes.length === 0) {
    throw new DocumentIngestionError(
      'No separate documents were detected. Photograph the items on a plain, contrasting background with visible gaps between them.',
    );
  }
  const maxDocuments = opts.maxDocuments ?? 50;
  if (boxes.length > maxDocuments) {
    throw new DocumentIngestionError(
      `Detected ${boxes.length} regions, which exceeds the ${maxDocuments}-document limit. Use a cleaner background or split the photograph into smaller batches.`,
    );
  }

  const scaleX = image.originalWidth / image.width;
  const scaleY = image.originalHeight / image.height;
  return boxes.map((box) => {
    const left = Math.max(0, Math.floor(box.left * scaleX));
    const top = Math.max(0, Math.floor(box.top * scaleY));
    const right = Math.min(image.originalWidth, Math.ceil((box.right + 1) * scaleX));
    const bottom = Math.min(image.originalHeight, Math.ceil((box.bottom + 1) * scaleY));
    return { left, top, width: right - left, height: bottom - top };
  });
}

export async function splitDocumentImage(
  sourcePath: string,
  outputDir: string,
  originalFilename: string,
): Promise<CroppedDocument[]> {
  const regions = await detectDocumentRegions(sourcePath);
  const stem = parse(basename(originalFilename)).name.replace(/[^a-zA-Z0-9._-]+/g, '-') || 'sheet';
  const digits = Math.max(2, String(regions.length).length);
  const crops: CroppedDocument[] = [];
  for (let index = 0; index < regions.length; index++) {
    const region = regions[index]!;
    const filename = `${stem}-document-${String(index + 1).padStart(digits, '0')}.jpg`;
    const outputPath = join(outputDir, filename);
    await sharp(sourcePath)
      .rotate()
      .extract(region)
      .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
      .toFile(outputPath);
    crops.push({ path: outputPath, filename, region });
  }
  return crops;
}

export async function inferDocumentTypeLocally(image: Buffer): Promise<MediaType> {
  const { data, info } = await sharp(image)
    .resize({ width: 180, height: 180, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  let colourful = 0;
  let paperLike = 0;
  let luminanceSum = 0;
  let luminanceSquared = 0;
  const pixels = info.width * info.height;
  for (let i = 0; i < pixels; i++) {
    const r = data[i * 3]!;
    const g = data[i * 3 + 1]!;
    const b = data[i * 3 + 2]!;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (saturation > 0.22 && max - min > 28) colourful++;
    if (luminance > 165 && saturation < 0.22) paperLike++;
    luminanceSum += luminance;
    luminanceSquared += luminance * luminance;
  }
  const mean = luminanceSum / pixels;
  const deviation = Math.sqrt(Math.max(0, luminanceSquared / pixels - mean * mean));
  return colourful / pixels > 0.07 || (paperLike / pixels < 0.42 && deviation > 38)
    ? 'photo'
    : 'pdf';
}

export async function classifyDocumentCropsLocally(crops: CroppedDocument[]): Promise<MediaType[]> {
  return Promise.all(crops.map(async (crop) => inferDocumentTypeLocally(await readFile(crop.path))));
}

function classificationPrompt(count: number): string {
  return `Classify each of the ${count} archival images, in the exact order supplied, for KinTrace processing.
Choose exactly one mediaType per image:
- photo: a photograph or picture; incidental captions do not make it a document
- letter: personal correspondence, typed or handwritten
- article: a newspaper or magazine clipping/article
- pdf: certificates, diplomas, forms, official records, envelopes, receipts, and all other text-bearing documents

Document purpose controls the choice, not whether its writing is printed or cursive. Audio and video are impossible here.
Respond with ONLY JSON: {"items":[{"index":1,"mediaType":"photo|letter|article|pdf"}]}`;
}

export function createVisionDocumentTypeClassifier(client: VisionClient): DocumentTypeClassifier {
  return {
    async classify(images) {
      const output: MediaType[] = [];
      const batchSize = 10;
      for (let offset = 0; offset < images.length; offset += batchSize) {
        const batch = images.slice(offset, offset + batchSize);
        const response = await client.analyzeImages(batch, classificationPrompt(batch.length));
        const parsed = ClassificationSchema.parse(extractJsonObject(response));
        const byIndex = new Map(parsed.items.map((item) => [item.index, item.mediaType]));
        if (byIndex.size !== batch.length) {
          throw new Error(`AI returned ${byIndex.size} classifications for ${batch.length} images`);
        }
        for (let index = 1; index <= batch.length; index++) {
          const mediaType = byIndex.get(index);
          if (!mediaType) throw new Error(`AI omitted classification ${index}`);
          output.push(mediaType);
        }
      }
      return output;
    },
  };
}

export function isSupportedDocumentSheetFilename(filename: string): boolean {
  return ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp'].includes(extname(filename).toLowerCase());
}
