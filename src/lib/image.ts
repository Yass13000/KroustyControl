// Préparation d'une image avant envoi, entièrement dans le navigateur :
// remise dans le bon sens (photos de téléphone), 3840 px maximum (mémoire des TV),
// conversion en JPEG (lu par tous les lecteurs, fichier léger).

const MAX_SIDE = 3840;

export interface PreparedImage {
  file: File;
  width: number;
  height: number;
}

export const isImageFile = (f: File) => /^image\/(jpeg|png|webp)$/.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name);

export async function prepareImage(source: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image illisible');
    // Fond noir sous les zones transparentes (PNG) : comme l'écran éteint autour.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.9));
    if (!blob) throw new Error('Image illisible');
    const name = `${source.name.replace(/\.[^.]+$/, '') || 'image'}.jpg`;
    return { file: new File([blob], name, { type: 'image/jpeg' }), width, height };
  } finally {
    bitmap.close();
  }
}

/** Miniature 320 × 180 (recadrée) d'une image locale ou accessible. */
export const imageThumbnail = (url: string): Promise<string> =>
  new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(''), 6000);
    img.onload = () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve('');
        const s = Math.max(320 / img.naturalWidth, 180 / img.naturalHeight);
        const w = img.naturalWidth * s;
        const h = img.naturalHeight * s;
        ctx.drawImage(img, (320 - w) / 2, (180 - h) / 2, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      } catch {
        resolve('');
      }
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve('');
    };
    img.src = url;
  });
