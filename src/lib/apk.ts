// Lecture d'un fichier APK directement dans le navigateur (rien n'est envoyé pour l'analyse) :
// identifiant de l'app, code et nom de version, empreinte SHA-256.
// Un APK est une archive ZIP ; le manifeste Android y est stocké en « XML binaire ».

export interface ApkInfo {
  packageName: string;
  versionCode: number;
  versionName: string;
  sha256: string;
  size: number;
}

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

/** Extrait un fichier de l'archive ZIP (stocké tel quel ou compressé « deflate »). */
async function readZipEntry(buf: ArrayBuffer, wanted: string): Promise<Uint8Array> {
  const v = new DataView(buf);
  // Fin du répertoire central : on la cherche en partant de la fin.
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) {
    if (u32(v, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Fichier APK illisible');
  const count = u16(v, eocd + 10);
  let p = u32(v, eocd + 16);
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (u32(v, p) !== 0x02014b50) break;
    const method = u16(v, p + 10);
    const compSize = u32(v, p + 20);
    const nameLen = u16(v, p + 28);
    const extraLen = u16(v, p + 30);
    const commentLen = u16(v, p + 32);
    const localOffset = u32(v, p + 42);
    const name = decoder.decode(new Uint8Array(buf, p + 46, nameLen));
    if (name === wanted) {
      const lNameLen = u16(v, localOffset + 26);
      const lExtraLen = u16(v, localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const data = new Uint8Array(buf, start, compSize);
      if (method === 0) return data;
      if (method === 8) {
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      }
      throw new Error('Compression APK non gérée');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('Manifeste Android introuvable : ce fichier n’est pas un APK');
}

/** Lit le XML binaire Android et renvoie les attributs de la balise <manifest>. */
function parseManifest(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const strings: string[] = [];
  let p = 8; // en-tête du document
  while (p < bytes.byteLength) {
    const type = u16(v, p);
    const headerSize = u16(v, p + 2);
    const size = u32(v, p + 4);
    if (type === 0x0001) {
      // Table des chaînes
      const count = u32(v, p + 8);
      const flags = u32(v, p + 16);
      const stringsStart = u32(v, p + 20);
      const utf8 = (flags & 0x100) !== 0;
      for (let i = 0; i < count; i++) {
        const off = p + stringsStart + u32(v, p + headerSize + i * 4);
        if (utf8) {
          let o = off;
          o += bytes[o] & 0x80 ? 2 : 1; // longueur en caractères
          let len = bytes[o];
          if (len & 0x80) {
            len = ((len & 0x7f) << 8) | bytes[o + 1];
            o += 2;
          } else o += 1;
          strings.push(new TextDecoder().decode(bytes.subarray(o, o + len)));
        } else {
          let len = u16(v, off);
          let o = off + 2;
          if (len & 0x8000) {
            len = ((len & 0x7fff) << 16) | u16(v, off + 2);
            o += 2;
          }
          let s = '';
          for (let k = 0; k < len; k++) s += String.fromCharCode(u16(v, o + k * 2));
          strings.push(s);
        }
      }
    } else if (type === 0x0102) {
      // Début d'élément
      const name = strings[u32(v, p + 20)];
      if (name === 'manifest') {
        const attrStart = u16(v, p + 24);
        const attrSize = u16(v, p + 26);
        const attrCount = u16(v, p + 28);
        const attrs: Record<string, string | number> = {};
        for (let i = 0; i < attrCount; i++) {
          const a = p + 16 + attrStart + i * attrSize;
          const attrName = strings[u32(v, a + 4)];
          const raw = u32(v, a + 8);
          const dataType = bytes[a + 15];
          const data = u32(v, a + 16);
          attrs[attrName] = dataType === 0x03 ? strings[data] : raw !== 0xffffffff ? strings[raw] : data;
        }
        return attrs;
      }
    }
    if (size <= 0) break;
    p += size;
  }
  throw new Error('Version introuvable dans l’APK');
}

export async function readApk(file: File): Promise<ApkInfo> {
  const buf = await file.arrayBuffer();
  const manifest = parseManifest(await readZipEntry(buf, 'AndroidManifest.xml'));
  const hash = await crypto.subtle.digest('SHA-256', buf);
  const sha256 = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  return {
    packageName: String(manifest.package || ''),
    versionCode: Number(manifest.versionCode) || 0,
    versionName: String(manifest.versionName || ''),
    sha256,
    size: file.size,
  };
}

/** Identifiant Android du lecteur SYNK (doit correspondre pour accepter un APK). */
export const PLAYER_PACKAGE = 'com.example.menuboard';
