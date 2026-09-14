import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MAX_PAGES_TO_READ = 50;
const MAX_TEXT_CHARACTERS = 500_000;
const MAX_OCR_PDF_PAGES = 5;
const MAX_RENDER_PIXELS = 3_000_000;

export type LocalPdfTextResult = {
  text: string;
  pageCount: number;
  pagesRead: number;
  characterCount: number;
  truncated: boolean;
};

export type LocalPdfImagesResult = {
  images: Blob[];
  pageCount: number;
  truncated: boolean;
};

export async function extractLocalPdfText(file: File): Promise<LocalPdfTextResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = getDocument({
    data: bytes,
    useSystemFonts: true,
  });
  let document: Awaited<typeof loadingTask.promise> | null = null;

  try {
    document = await loadingTask.promise;
    const pagesRead = Math.min(document.numPages, MAX_PAGES_TO_READ);
    const pageText: string[] = [];
    let characters = 0;
    let truncated = document.numPages > pagesRead;

    for (let pageNumber = 1; pageNumber <= pagesRead && characters < MAX_TEXT_CHARACTERS; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map(item => typeof item === "object" && item !== null && "str" in item ? String(item.str) : "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      const remaining = MAX_TEXT_CHARACTERS - characters;
      pageText.push(text.slice(0, remaining));
      characters += Math.min(text.length, remaining);
      if (text.length > remaining) truncated = true;
    }

    const text = pageText.filter(Boolean).join("\n\n");
    return {
      text,
      pageCount: document.numPages,
      pagesRead,
      characterCount: text.length,
      truncated,
    };
  } finally {
    if (document) await document.destroy();
    else await loadingTask.destroy();
  }
}

export async function renderLocalPdfForOcr(file: File): Promise<LocalPdfImagesResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = getDocument({ data: bytes, useSystemFonts: true });
  let document: Awaited<typeof loadingTask.promise> | null = null;

  try {
    document = await loadingTask.promise;
    const pagesToRender = Math.min(document.numPages, MAX_OCR_PDF_PAGES);
    const images: Blob[] = [];

    for (let pageNumber = 1; pageNumber <= pagesToRender; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const desiredScale = 2.5;
      const pixelLimitedScale = Math.sqrt(MAX_RENDER_PIXELS / (baseViewport.width * baseViewport.height));
      const viewport = page.getViewport({ scale: Math.min(desiredScale, pixelLimitedScale) });
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      await page.render({ canvas, viewport, background: "rgb(255,255,255)" }).promise;
      const image = await canvasToBlob(canvas);
      canvas.width = 1;
      canvas.height = 1;
      images.push(image);
    }

    return { images, pageCount: document.numPages, truncated: document.numPages > pagesToRender };
  } finally {
    if (document) await document.destroy();
    else await loadingTask.destroy();
  }
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PDF page rendering failed.")), "image/png"));
}
