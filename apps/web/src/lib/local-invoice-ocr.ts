import { createWorker, OEM, type LoggerMessage } from "tesseract.js";
import workerUrl from "tesseract.js/dist/worker.min.js?url";
import coreUrl from "tesseract.js-core/tesseract-core-lstm.wasm.js?url";
import englishDataUrl from "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url";

const MAX_OCR_CHARACTERS = 500_000;

export type LocalOcrInput = { id: string; file: File };
export type LocalOcrProgress = { status: string; progress: number };
export type LocalOcrResult = {
  id: string;
  text: string;
  confidence: number;
  pageCount: number;
  pagesProcessed: number;
  truncated: boolean;
};

export async function recognizeLocalInvoices(
  inputs: LocalOcrInput[],
  onProgress?: (id: string, progress: LocalOcrProgress) => void,
): Promise<LocalOcrResult[]> {
  if (!inputs.length) return [];
  const languageAssetUrl = new URL(englishDataUrl, window.location.href);
  const languagePath = new URL(".", languageAssetUrl).href;
  let activeId = inputs[0]!.id;
  const logger = (message: LoggerMessage) => onProgress?.(activeId, { status: humanOcrStatus(message.status), progress: clampProgress(message.progress) });
  const worker = await createWorker("eng", OEM.LSTM_ONLY, {
    workerPath: workerUrl,
    corePath: coreUrl,
    langPath: languagePath,
    gzip: true,
    workerBlobURL: false,
    logger,
  });

  try {
    const results: LocalOcrResult[] = [];
    for (const input of inputs) {
      activeId = input.id;
      onProgress?.(activeId, { status: "Preparing document", progress: 0 });
      const prepared = await prepareImages(input.file);
      const text: string[] = [];
      const confidence: number[] = [];
      let characters = 0;
      let truncated = prepared.truncated;

      for (let index = 0; index < prepared.images.length && characters < MAX_OCR_CHARACTERS; index += 1) {
        onProgress?.(activeId, { status: `Reading page ${index + 1} of ${prepared.images.length}`, progress: index / prepared.images.length });
        const image = prepared.images[index]!;
        const recognized = await worker.recognize(image);
        const remaining = MAX_OCR_CHARACTERS - characters;
        const pageText = recognized.data.text.replace(/\s+\n/g, "\n").trim();
        text.push(pageText.slice(0, remaining));
        characters += Math.min(pageText.length, remaining);
        confidence.push(recognized.data.confidence);
        if (pageText.length > remaining) truncated = true;

        const supplementalText: string[] = [];
        if (index === 0 && needsInvoiceHeaderPass(pageText)) {
          onProgress?.(activeId, { status: "Checking invoice header…", progress: Math.min(0.92, (index + 0.7) / prepared.images.length) });
          const header = await cropImageForOcr(image, { top: 0, height: 0.36 });
          const headerResult = await worker.recognize(header);
          supplementalText.push(headerResult.data.text);
          confidence.push(headerResult.data.confidence);
          if (needsInvoiceHeaderPass(`${pageText}\n${headerResult.data.text}`)) {
            const dateRow = await cropImageForOcr(image, { left: 0.39, width: 0.39, top: 0.04, height: 0.15, scale: 3 });
            const dateResult = await worker.recognize(dateRow);
            supplementalText.push(dateResult.data.text);
            confidence.push(dateResult.data.confidence);
          }
        }
        if (index === prepared.images.length - 1 && needsInvoiceTotalPass([...text, ...supplementalText].join("\n"))) {
          onProgress?.(activeId, { status: "Checking invoice totals…", progress: 0.94 });
          const totals = await cropImageForOcr(image, { top: 0.36, height: 0.38 });
          const totalsResult = await worker.recognize(totals);
          supplementalText.push(totalsResult.data.text);
          confidence.push(totalsResult.data.confidence);
        }
        for (const supplemental of supplementalText) {
          const cleaned = supplemental.replace(/\s+\n/g, "\n").trim();
          const available = MAX_OCR_CHARACTERS - characters;
          if (available <= 0) {
            truncated = true;
            break;
          }
          text.push(cleaned.slice(0, available));
          characters += Math.min(cleaned.length, available);
          if (cleaned.length > available) truncated = true;
        }
      }

      const combinedText = text.filter(Boolean).join("\n\n");
      results.push({
        id: input.id,
        text: combinedText,
        confidence: confidence.length ? confidence.reduce((sum, value) => sum + value, 0) / confidence.length : 0,
        pageCount: prepared.pageCount,
        pagesProcessed: prepared.images.length,
        truncated,
      });
      onProgress?.(activeId, { status: "Finished", progress: 1 });
    }
    return results;
  } finally {
    await worker.terminate();
  }
}

export function needsInvoiceHeaderPass(text: string) {
  const candidates = [
    ...text.matchAll(/\b\d{1,2}[/.\-]\d{1,2}[/.\-](?:\d{2}|\d{4})\b/g),
    ...text.matchAll(/\b\d{1,2}[\s\-](?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[\s\-](?:\d{2}|\d{4})\b/gi),
  ];
  return !candidates.some(match => isValidInvoiceDateToken(match[0]));
}

function isValidInvoiceDateToken(value: string) {
  const numeric = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  const named = value.match(/^(\d{1,2})[\s-]([A-Za-z]+)[\s-](\d{2}|\d{4})$/);
  const day = Number(numeric?.[1] ?? named?.[1]);
  const month = numeric ? Number(numeric[2]) : ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(named?.[2]?.slice(0, 3).toLowerCase() ?? "") + 1;
  let year = Number(numeric?.[3] ?? named?.[3]);
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function needsInvoiceTotalPass(text: string) {
  return !text.split(/\r?\n/).some(line => {
    if (/\btotal\s+(?:for\s+)?material\b|\btotal\s+tax\b/i.test(line)) return false;
    return /\b(?:grand\s+total|invoice\s+total|net\s+(?:amount|payable)|amount\s+payable|total)\b[^\d\n]{0,16}\d[\d,]*(?:\.\d{1,3})?/i.test(line);
  });
}

async function cropImageForOcr(source: File | Blob, region: { top: number; height: number; left?: number; width?: number; scale?: number }): Promise<Blob> {
  const image = await createImageBitmap(source);
  const sourceLeft = Math.max(0, Math.round(image.width * (region.left ?? 0)));
  const sourceWidth = Math.max(1, Math.min(image.width - sourceLeft, Math.round(image.width * (region.width ?? 1))));
  const sourceTop = Math.max(0, Math.round(image.height * region.top));
  const sourceHeight = Math.max(1, Math.min(image.height - sourceTop, Math.round(image.height * region.height)));
  const scale = Math.max(1, Math.min(3, region.scale ?? 1));
  const canvas = window.document.createElement("canvas");
  canvas.width = Math.round(sourceWidth * scale);
  canvas.height = Math.round(sourceHeight * scale);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    image.close();
    throw new Error("The invoice image could not be checked.");
  }
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, sourceLeft, sourceTop, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  image.close();
  const cropped = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("The invoice image could not be checked.")), "image/png"));
  canvas.width = 1;
  canvas.height = 1;
  return cropped;
}

async function prepareImages(file: File): Promise<{ images: Array<File | Blob>; pageCount: number; truncated: boolean }> {
  if (!isPdf(file)) return { images: [await resizeImageForOcr(file)], pageCount: 1, truncated: false };
  const { renderLocalPdfForOcr } = await import("./local-pdf-text");
  const rendered = await renderLocalPdfForOcr(file);
  return { images: rendered.images, pageCount: rendered.pageCount, truncated: rendered.truncated };
}

const MAX_IMAGE_PIXELS = 4_000_000;

async function resizeImageForOcr(file: File): Promise<Blob> {
  const image = await createImageBitmap(file);
  const scale = Math.min(1, Math.sqrt(MAX_IMAGE_PIXELS / (image.width * image.height)));
  if (scale === 1) {
    image.close();
    return file;
  }

  const canvas = window.document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    image.close();
    throw new Error("The invoice image could not be prepared.");
  }
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  const resized = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("The invoice image could not be prepared.")), "image/jpeg", 0.9));
  canvas.width = 1;
  canvas.height = 1;
  return resized;
}

function isPdf(file: File) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function clampProgress(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function humanOcrStatus(status: string) {
  if (status.includes("recognizing")) return "Reading invoice…";
  return "Getting invoice ready…";
}
