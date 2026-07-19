import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/**
 * Moment photos live in <documentDirectory>/moments/<momentId>.jpg; the DB
 * stores only the filename because the iOS container path changes between
 * installs.
 *
 * Phase 2 (photo precision → memory): captures are processed at save time —
 * the stored original is capped at MAX_EDGE_PX (≈2–8 MP instead of 48 MP)
 * and a THUMB_EDGE_PX thumbnail is written alongside as <name>.thumb.jpg.
 * Every in-app surface renders the thumb; the processed original stays on
 * disk for a future full-screen viewer/export. migrateMomentPhotos() heals
 * photos captured before this existed, one at a time (bounded memory).
 */

const MOMENTS_DIR = 'moments';
const MAX_EDGE_PX = 2560;
const THUMB_EDGE_PX = 512;

function momentsDir(): Directory {
  const dir = new Directory(Paths.document, MOMENTS_DIR);
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

const thumbName = (photo: string) => photo.replace(/\.jpg$/i, '.thumb.jpg');

export function momentPhotoUri(photo: string): string {
  return new File(Paths.document, MOMENTS_DIR, photo).uri;
}

/** thumbnail uri when it exists (post-Phase-2), original as fallback */
export function momentThumbUri(photo: string): string {
  const thumb = new File(Paths.document, MOMENTS_DIR, thumbName(photo));
  return thumb.exists ? thumb.uri : momentPhotoUri(photo);
}

async function renderResized(sourceUri: string, widthPx: number, compress: number): Promise<string> {
  const ctx = ImageManipulator.manipulate(sourceUri);
  ctx.resize({ width: widthPx });
  const image = await ctx.renderAsync();
  const result = await image.saveAsync({ compress, format: SaveFormat.JPEG });
  return result.uri;
}

/** process a freshly captured photo into app storage: capped original + thumb */
export async function storeMomentPhoto(photoUri: string, photo: string): Promise<void> {
  const dir = momentsDir();
  const resizedUri = await renderResized(photoUri, MAX_EDGE_PX, 0.8);
  new File(resizedUri).move(new File(dir, photo));
  const thumbUri = await renderResized(momentPhotoUri(photo), THUMB_EDGE_PX, 0.7);
  new File(thumbUri).move(new File(dir, thumbName(photo)));
  // the raw capture in the camera cache is no longer needed
  try {
    const raw = new File(photoUri);
    if (raw.exists) raw.delete();
  } catch {
    // cache file cleanup is best-effort
  }
}

/**
 * Heal photos captured before Phase 2: shrink 48 MP originals in place and
 * write their thumbs. Strictly sequential — one decode at a time keeps the
 * migration itself from spiking memory. File existence is the progress
 * marker, so it resumes safely after any interruption.
 */
export async function migrateMomentPhotos(photos: string[]): Promise<void> {
  for (const photo of photos) {
    try {
      const original = new File(Paths.document, MOMENTS_DIR, photo);
      if (!original.exists) continue;
      const thumb = new File(Paths.document, MOMENTS_DIR, thumbName(photo));
      if (thumb.exists) continue; // already migrated

      // shrink the original in place first (48 MP -> capped), then thumb
      const resizedUri = await renderResized(original.uri, MAX_EDGE_PX, 0.8);
      original.delete();
      new File(resizedUri).move(original);
      const thumbUri = await renderResized(original.uri, THUMB_EDGE_PX, 0.7);
      new File(thumbUri).move(thumb);
    } catch {
      // skip a bad file; the next launch retries it (thumb still missing)
    }
  }
}

export function deleteMomentPhoto(photo: string) {
  try {
    const file = new File(Paths.document, MOMENTS_DIR, photo);
    if (file.exists) file.delete();
    const thumb = new File(Paths.document, MOMENTS_DIR, thumbName(photo));
    if (thumb.exists) thumb.delete();
  } catch {
    // orphaned file is harmless; never block the DB delete on disk cleanup
  }
}
