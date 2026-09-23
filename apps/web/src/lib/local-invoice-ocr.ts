import { createWorker, OEM, type LoggerMessage } from "tesseract.js";
import { simd } from "wasm-feature-detect";
import workerUrl from "tesseract.js/dist/worker.min.js?url";
import coreUrl from "tesseract.js-core/tesseract-core-lstm.wasm.js?url";
import simdCoreUrl from "tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url";
import englishDataUrl from "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url";

const MAX_OCR_CHARACTERS = 500_000;
const WORKER_START_TIMEOUT_MS = 45_000;
const RECOGNITION_TIMEOUT_MS = 45_000;
const INVOICE_TIMEOUT_MS = 75_000;
const LANGUAGE_CACHE_PATH = "fuelnerve-ocr-v1";
const OCR_RUNTIME_VERSION = "csp-v2";

type OcrWorker = Awaited<ReturnType<typeof createWorker>>;
let workerPromise: Promise<OcrWorker> | null = null;
let workerProgress: ((message: LoggerMessage) => void) | null = null;
let workerQueue: Promise<void> = Promise.resolve();

export type LocalOcrInput = { id: string; file: File; signal?: AbortSignal };
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
  return enqueueWorkerTask(async () => {
    const results: LocalOcrResult[] = [];
    for (const input of inputs) {
      const deadline = createDeadlineSignal(input.signal);
      try {
      throwIfAborted(deadline.signal);
      workerProgress = message => onProgress?.(input.id, { status: humanOcrStatus(message.status), progress: clampProgress(message.progress) });
      onProgress?.(input.id, { status: workerPromise ? "Preparing document…" : "Starting document reader…", progress: 0 });
      const [worker, prepared] = await Promise.all([
        getWorker(deadline.signal),
        prepareImages(input.file),
      ]);
      const text: string[] = [];
      const confidence: number[] = [];
      let characters = 0;
      let truncated = prepared.truncated;

      for (let index = 0; index < prepared.images.length && characters < MAX_OCR_CHARACTERS; index += 1) {
        throwIfAborted(deadline.signal);
        const image = prepared.images[index]!;
        const firstPassText: string[] = [];
        onProgress?.(input.id, { status: `Reading invoice header · page ${index + 1} of ${prepared.images.length}`, progress: index / prepared.images.length });
        const header = await cropImageForOcr(image, { top: 0, height: 0.38 });
        const headerResult = await recognizeWithLimit(worker, header, deadline.signal);
        firstPassText.push(headerResult.data.text);
        confidence.push(headerResult.data.confidence);

        onProgress?.(input.id, { status: `Reading products and totals · page ${index + 1} of ${prepared.images.length}`, progress: Math.min(0.78, (index + 0.55) / prepared.images.length) });
        const body = await cropImageForOcr(image, { top: 0.3, height: 0.52 });
        const bodyResult = await recognizeWithLimit(worker, body, deadline.signal);
        firstPassText.push(bodyResult.data.text);
        confidence.push(bodyResult.data.confidence);

        let pageText = firstPassText.join("\n");
        if (needsFullPagePass(pageText)) {
          onProgress?.(input.id, { status: `Checking the full page · ${index + 1} of ${prepared.images.length}`, progress: Math.min(0.88, (index + 0.75) / prepared.images.length) });
          const recognized = await recognizeWithLimit(worker, image, deadline.signal);
          pageText = `${pageText}\n${recognized.data.text}`;
          confidence.push(recognized.data.confidence);
        }
        const remaining = MAX_OCR_CHARACTERS - characters;
        const cleanedPageText = pageText.replace(/\s+\n/g, "\n").trim();
        text.push(cleanedPageText.slice(0, remaining));
        characters += Math.min(cleanedPageText.length, remaining);
        if (cleanedPageText.length > remaining) truncated = true;

        const supplementalText: string[] = [];
        if (index === 0 && needsInvoiceHeaderPass(pageText)) {
          onProgress?.(input.id, { status: "Checking invoice date…", progress: 0.91 });
          const dateRow = await cropImageForOcr(image, { left: 0.36, width: 0.44, top: 0.03, height: 0.18, scale: 2 });
          const dateResult = await recognizeWithLimit(worker, dateRow, deadline.signal);
          supplementalText.push(dateResult.data.text);
          confidence.push(dateResult.data.confidence);
        }
        if (index === prepared.images.length - 1 && needsInvoiceTotalPass([...text, ...supplementalText].join("\n"))) {
          onProgress?.(input.id, { status: "Checking invoice total…", progress: 0.95 });
          const totals = await cropImageForOcr(image, { top: 0.52, height: 0.3, scale: 1.5 });
          const totalsResult = await recognizeWithLimit(worker, totals, deadline.signal);
          supplementalText.push(totalsResult.data.text);
          confidence.push(totalsResult.data.confidence);
          if (needsInvoiceTotalPass([...text, ...supplementalText].join("\n")) && /\btotal\s+for\s+material\b/i.test(pageText)) {
            // On multi-material IOCL invoices the right-column grand total is
            // small and often lost among two blocks of tax rows. Read it alone.
            const finalRow = await cropImageForOcr(image, { left: 0.46, width: 0.54, top: 0.66, height: 0.14, scale: 2 });
            const finalResult = await recognizeWithLimit(worker, finalRow, deadline.signal);
            supplementalText.push(finalResult.data.text);
            confidence.push(finalResult.data.confidence);
          }
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
      onProgress?.(input.id, { status: "Finished", progress: 1 });
      } finally {
        deadline.dispose();
      }
    }
    return results;
  });
}

export function needsFullPagePass(text: string) {
  const hasInvoiceIdentity = /\b(?:tax\s+)?invoice\b/i.test(text) && /\b[A-Z0-9][A-Z0-9/.-]{7,}\b/.test(text);
  const hasFuelProduct = /\b(?:HSD|MS|PETROL|DIESEL|XP\s*95|XP\s*100|POWER|SPEED)\b/i.test(text);
  const hasQuantityOrAmount = /\b\d+(?:[.,]\d+)?\s*(?:KL|LTR|LITRE|LITER|L)\b/i.test(text) || /\b\d[\d,]{4,}(?:\.\d{1,3})?\b/.test(text);
  return text.replace(/\s/g, "").length < 240 || !hasInvoiceIdentity || !hasFuelProduct || !hasQuantityOrAmount;
}

async function getWorker(signal?: AbortSignal) {
  throwIfAborted(signal);
  if (!workerPromise) {
    const languageAssetUrl = new URL(englishDataUrl, window.location.href);
    const languagePath = new URL(".", languageAssetUrl).href;
    const versionRuntimeUrl = (assetUrl: string) => {
      const url = new URL(assetUrl, window.location.href);
      url.searchParams.set("runtime", OCR_RUNTIME_VERSION);
      return url.href;
    };
    const creation = simd().then(supportsSimd => createWorker("eng", OEM.LSTM_ONLY, {
      // These assets are immutable in production. Version their URLs so a security-header
      // update cannot leave Chrome running a worker cached with an obsolete CSP response.
      workerPath: versionRuntimeUrl(workerUrl),
      corePath: versionRuntimeUrl(supportsSimd ? simdCoreUrl : coreUrl),
      langPath: languagePath,
      cachePath: LANGUAGE_CACHE_PATH,
      gzip: true,
      workerBlobURL: false,
      logger: message => workerProgress?.(message),
    }));
    workerPromise = withLimit(creation, WORKER_START_TIMEOUT_MS, signal, "The document reader took too long to start.");
    workerPromise.catch(() => {
      if (workerPromise) workerPromise = null;
      void creation.then(worker => worker.terminate()).catch(() => undefined);
    });
  }
  return withLimit(workerPromise, WORKER_START_TIMEOUT_MS, signal, "The document reader took too long to start.");
}

async function recognizeWithLimit(worker: OcrWorker, image: File | Blob, signal?: AbortSignal) {
  try {
    return await withLimit(worker.recognize(image), RECOGNITION_TIMEOUT_MS, signal, "This page took too long to read.");
  } catch (error) {
    await discardWorker(worker);
    throw error;
  }
}

async function discardWorker(worker: OcrWorker) {
  workerPromise = null;
  await worker.terminate().catch(() => undefined);
}

async function enqueueWorkerTask<T>(task: () => Promise<T>) {
  const previous = workerQueue;
  let release: () => void = () => {};
  workerQueue = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try { return await task(); }
  finally { workerProgress = null; release(); }
}

function withLimit<T>(promise: Promise<T>, timeoutMs: number, signal: AbortSignal | undefined, message: string) {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => { if (settled) return; settled = true; window.clearTimeout(timer); signal?.removeEventListener("abort", abort); action(); };
    const abort = () => finish(() => reject(signal?.reason instanceof Error ? signal.reason : new DOMException("The document check was cancelled.", "AbortError")));
    const timer = window.setTimeout(() => finish(() => reject(new Error(message))), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) return abort();
    promise.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
  });
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("The document check was cancelled.", "AbortError");
}

function createDeadlineSignal(source?: AbortSignal) {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(source?.reason);
  source?.addEventListener("abort", forwardAbort, { once: true });
  if (source?.aborted) forwardAbort();
  const timer = window.setTimeout(() => controller.abort(new Error("This invoice took too long to read.")), INVOICE_TIMEOUT_MS);
  return {
    signal: controller.signal,
    dispose: () => {
      window.clearTimeout(timer);
      source?.removeEventListener("abort", forwardAbort);
    },
  };
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
  if (status.includes("loading tesseract core")) return "Loading document reader…";
  if (status.includes("loading language traineddata")) return "Loading English text model…";
  if (status.includes("initializing")) return "Starting document reader…";
  if (status.includes("recognizing")) return "Reading invoice…";
  return "Preparing invoice…";
}
