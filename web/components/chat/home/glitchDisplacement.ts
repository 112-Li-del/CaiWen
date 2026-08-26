export const DISPLACEMENT_ZERO_BYTE = 128;
export const DISPLACEMENT_DECODE_SCALE = 255;

export type CanvasBitmapSize = {
  width: number;
  height: number;
};

export function resolveCanvasBitmapSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): CanvasBitmapSize | null {
  if (cssWidth <= 0 || cssHeight <= 0) {
    return null;
  }

  const ratio = Math.min(Math.max(devicePixelRatio, 1), 2);

  return {
    width: Math.max(1, Math.floor(cssWidth * ratio)),
    height: Math.max(1, Math.floor(cssHeight * ratio)),
  };
}

export function canvasBitmapMatchesTarget(
  currentWidth: number,
  currentHeight: number,
  target: CanvasBitmapSize,
) {
  return currentWidth === target.width && currentHeight === target.height;
}

export function packDisplacement(value: number) {
  return Math.max(
    0,
    Math.min(255, Math.round(DISPLACEMENT_ZERO_BYTE + value)),
  );
}

export function decodeDisplacement(byte: number) {
  return byte - DISPLACEMENT_ZERO_BYTE;
}
