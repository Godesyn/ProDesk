// Lightweight, dependency-free helpers so callers can decide whether a file is
// annotatable (and label it) without pulling pdfjs/pdf-lib into their bundle.
// The heavy <FileAnnotator/> editor is imported lazily where it is actually used.

export function extOf(name: string): string {
  return (name.split('?')[0].split('.').pop() ?? '').toLowerCase();
}

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

/** PDFs and raster images can be marked up; documents (docx/pptx) and notes cannot. */
export function isAnnotatable(name: string | null | undefined, type?: 'text' | 'document' | 'image'): boolean {
  if (type === 'text') return false;
  if (type === 'image') return true;
  const e = extOf(name ?? '');
  return e === 'pdf' || IMAGE_EXT.includes(e);
}

export function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}
