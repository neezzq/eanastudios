import { getBayerMatrix } from './bayer';

function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

export function processDither(
  imageData: ImageData,
  matrixSize: number,
  brightness: number, // -100 to 100
  contrast: number, // -100 to 100
  darkColorHex: string,
  lightColorHex: string
) {
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;

  const bayer = getBayerMatrix(matrixSize);
  const darkRgb = hexToRgb(darkColorHex);
  const lightRgb = hexToRgb(lightColorHex);

  const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      
      let r = data[idx];
      let g = data[idx + 1];
      let b = data[idx + 2];

      // Apply brightness
      r += brightness;
      g += brightness;
      b += brightness;

      // Apply contrast
      r = contrastFactor * (r - 128) + 128;
      g = contrastFactor * (g - 128) + 128;
      b = contrastFactor * (b - 128) + 128;

      // Clamp
      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));

      // Grayscale (luminance)
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      // Dither threshold
      const threshold = ((bayer[y % matrixSize][x % matrixSize] + 0.5) / (matrixSize * matrixSize)) * 255;

      if (lum > threshold) {
        data[idx] = lightRgb.r;
        data[idx + 1] = lightRgb.g;
        data[idx + 2] = lightRgb.b;
      } else {
        data[idx] = darkRgb.r;
        data[idx + 1] = darkRgb.g;
        data[idx + 2] = darkRgb.b;
      }
      // Alpha remains unchanged
    }
  }
  return imageData;
}
