// PDF → une image par page, entièrement dans le navigateur (rien n'est envoyé pour la conversion).
// Les TV affichent ensuite chaque page comme une image (20 s), sans mise à jour du lecteur.
// pdf.js n'est chargé qu'à l'import d'un PDF.

import type { PreparedImage } from './image';

export const isPdfFile = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

/** Au-delà, un PDF n'est probablement pas fait pour un affichage en boucle. */
export const PDF_MAX_PAGES = 30;

/**
 * Cadrage d'une page :
 * - whole : la page entière sur un fond noir 16:9 (rien n'est coupé) ;
 * - fill  : la page telle quelle, l'écran la remplit (haut et bas coupés si elle est verticale).
 */
export type PdfFit = 'whole' | 'fill';

const MAX_SIDE = 3840;
const FRAME = { width: 3840, height: 2160 };

export async function pdfPageCount(file: File): Promise<number> {
  const task = await openPdf(file);
  try {
    return (await task.promise).numPages;
  } finally {
    await task.destroy();
  }
}

async function openPdf(file: File) {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  return pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
}

export async function pdfToImages(file: File, fit: PdfFit, onPage?: (done: number, total: number) => void): Promise<PreparedImage[]> {
  const task = await openPdf(file);
  const pdf = await task.promise;
  const base = file.name.replace(/\.pdf$/i, '') || 'document';
  const total = Math.min(pdf.numPages, PDF_MAX_PAGES);
  const out: PreparedImage[] = [];
  try {
    for (let n = 1; n <= total; n++) {
      const page = await pdf.getPage(n);
      const unit = page.getViewport({ scale: 1 });
      // Rendu net : le grand côté de la page à 3840 px.
      const scale = MAX_SIDE / Math.max(unit.width, unit.height);
      const viewport = page.getViewport({ scale });
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = Math.round(viewport.width);
      pageCanvas.height = Math.round(viewport.height);
      const pctx = pageCanvas.getContext('2d');
      if (!pctx) throw new Error('PDF illisible');
      // Fond blanc : les PDF sont pensés sur papier blanc.
      pctx.fillStyle = '#fff';
      pctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      await page.render({ canvasContext: pctx, canvas: pageCanvas, viewport }).promise;
      page.cleanup();

      let canvas = pageCanvas;
      if (fit === 'whole') {
        // Page entière, centrée sur un fond noir 16:9.
        canvas = document.createElement('canvas');
        canvas.width = FRAME.width;
        canvas.height = FRAME.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('PDF illisible');
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, FRAME.width, FRAME.height);
        const s = Math.min(FRAME.width / pageCanvas.width, FRAME.height / pageCanvas.height);
        const w = pageCanvas.width * s;
        const h = pageCanvas.height * s;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(pageCanvas, (FRAME.width - w) / 2, (FRAME.height - h) / 2, w, h);
      }

      const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.9));
      if (!blob) throw new Error('PDF illisible');
      out.push({
        file: new File([blob], `${base}-page-${n}.jpg`, { type: 'image/jpeg' }),
        width: canvas.width,
        height: canvas.height,
      });
      onPage?.(n, total);
    }
  } finally {
    await task.destroy();
  }
  return out;
}
