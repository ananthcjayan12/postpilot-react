const MAX_EDGE = 1280;
const MAX_BYTES = 400 * 1024;

/** Prepare a lightweight reference without cropping or enlarging it. */
export async function prepareReferenceImage(file: File): Promise<File> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a JPG, PNG, or WebP reference image.');
  }
  if (file.size > 40 * 1024 * 1024) throw new Error('Choose a reference image smaller than 40 MB.');
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('This reference image could not be read. Try another JPG, PNG, or WebP.'));
      img.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('This reference image has no readable dimensions.');
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    // Already small references keep their original bytes and sharpness.
    if (scale === 1 && file.size <= MAX_BYTES) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image resizing is unavailable in this browser.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    for (let attempt = 0; attempt < 6; attempt++) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.86, 0.76, 0.66]) {
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not compress this reference image.')), 'image/webp', quality);
        });
        if (blob.size <= MAX_BYTES) {
          const extension = blob.type === 'image/webp' ? 'webp' : 'png';
          return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}-reference.${extension}`, { type: blob.type });
        }
      }
      canvas.width = Math.max(1, Math.round(canvas.width * 0.8));
      canvas.height = Math.max(1, Math.round(canvas.height * 0.8));
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
    }
    throw new Error('Could not make this reference small enough. Try a simpler or smaller image.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
