export const PHOTO_UPLOAD_ACCEPT = 'image/*,.heic,.heif';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']);

function getFileExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split('.');
  return parts.length > 1 ? parts.at(-1) ?? '' : '';
}

export function isSupportedPhotoFile(file: Pick<File, 'name' | 'type'>): boolean {
  if (file.type.startsWith('image/')) {
    return true;
  }

  return IMAGE_EXTENSIONS.has(getFileExtension(file.name));
}
