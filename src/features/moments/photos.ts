import { Directory, File, Paths } from 'expo-file-system';

/**
 * Moment photos live in <documentDirectory>/moments/<momentId>.jpg; the DB
 * stores only the filename because the iOS container path changes between
 * installs.
 */

const MOMENTS_DIR = 'moments';

export function momentPhotoUri(photo: string): string {
  return new File(Paths.document, MOMENTS_DIR, photo).uri;
}

/** move a freshly captured photo (cache uri) into app storage */
export function storeMomentPhoto(photoUri: string, photo: string) {
  const dir = new Directory(Paths.document, MOMENTS_DIR);
  dir.create({ idempotent: true, intermediates: true });
  new File(photoUri).move(new File(dir, photo));
}

export function deleteMomentPhoto(photo: string) {
  try {
    const file = new File(Paths.document, MOMENTS_DIR, photo);
    if (file.exists) file.delete();
  } catch {
    // orphaned file is harmless; never block the DB delete on disk cleanup
  }
}
