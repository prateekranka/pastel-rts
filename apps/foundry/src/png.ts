export function loadImageFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return loadImageUrl(url, () => URL.revokeObjectURL(url));
}

export function loadImageDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return loadImageUrl(dataUrl);
}

export function imageToPngDataUrl(image: HTMLImageElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D context unavailable');
  }
  ctx.drawImage(image, 0, 0);
  return canvas.toDataURL('image/png');
}

export function imageToImageData(image: HTMLImageElement): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D context unavailable');
  }
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function fileToPngDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not read PNG'));
      }
    };
    reader.onerror = () => reject(new Error('Could not read PNG'));
    reader.readAsDataURL(file);
  });
}

function loadImageUrl(url: string, cleanup?: () => void): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup?.();
      callback();
    };
    image.onload = () => finish(() => resolve(image));
    image.onerror = () => finish(() => reject(new Error('Could not decode PNG')));
    image.src = url;
  });
}
