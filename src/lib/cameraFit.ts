import type { Vec3 } from '../data/scene';

export interface FitCameraResult {
  position: Vec3;
  distance: number;
}

export interface FitCameraOptions {
  /**
   * Viewport aspect ratio (width / height). Used to decide whether the
   * vertical or horizontal extent is the binding constraint.
   */
  aspect: number;
  /** Vertical field of view in degrees. */
  fov: number;
  /**
   * Half-height of the scene around `lookAt` (max distance above or below it)
   * in world units.
   */
  verticalExtent: number;
  /**
   * Half-width of the scene around `lookAt` (max distance left or right) in
   * world units.
   */
  horizontalExtent: number;
  /** Fraction of the half-view the scene may occupy (0..1). Smaller = farther, more breathing room. */
  fitRatio?: number;
  /** Camera elevation above `lookAt`, in degrees. */
  downAngleDeg?: number;
  /** Camera azimuth around Y, degrees (0 = camera on the +Z side). */
  azimuthDeg?: number;
  lookAt?: Vec3;
}

export interface FitCameraByRadiusOptions {
  fov: number;
  /** Effective scene radius already resolved for the viewport aspect. */
  boundRadius: number;
  fitRatio?: number;
  downAngleDeg?: number;
  azimuthDeg?: number;
  lookAt?: Vec3;
}

const RAD = Math.PI / 180;

/**
 * Derive a camera distance that keeps a scene fully inside the frame.
 *
 * The binding constraint is the larger of the vertical extent and the
 * horizontal extent divided by the aspect ratio (the horizontal half-view is
 * the vertical half-view multiplied by aspect). This is an exact box fit —
 * not the over-conservative bounding-sphere fit — so a long, low composition
 * stays close to the lens without clipping.
 */
export function fitCamera(options: FitCameraOptions): FitCameraResult {
  const {
    aspect,
    fov,
    verticalExtent,
    horizontalExtent,
    fitRatio = 0.72,
    downAngleDeg = 9,
    azimuthDeg = 0,
    lookAt = [0, 1.2, 0],
  } = options;

  const boundRadius = Math.max(
    verticalExtent,
    horizontalExtent / Math.max(aspect, 0.0001),
  );

  return fitCameraByRadius({
    fov,
    boundRadius,
    fitRatio,
    downAngleDeg,
    azimuthDeg,
    lookAt,
  });
}

/**
 * Lower-level fit from an already-resolved bound radius.
 * `distance = boundRadius / (tan(fov / 2) * fitRatio)`.
 */
export function fitCameraByRadius(
  options: FitCameraByRadiusOptions,
): FitCameraResult {
  const {
    fov,
    boundRadius,
    fitRatio = 0.72,
    downAngleDeg = 9,
    azimuthDeg = 0,
    lookAt = [0, 1.2, 0],
  } = options;

  const halfFov = (fov * RAD) / 2;
  const distance = boundRadius / (Math.tan(halfFov) * fitRatio);

  const down = downAngleDeg * RAD;
  const azimuth = azimuthDeg * RAD;
  const horizontal = distance * Math.cos(down);
  const vertical = distance * Math.sin(down);

  const position: Vec3 = [
    lookAt[0] + horizontal * Math.sin(azimuth),
    lookAt[1] + vertical,
    lookAt[2] + horizontal * Math.cos(azimuth),
  ];

  return { position, distance };
}
