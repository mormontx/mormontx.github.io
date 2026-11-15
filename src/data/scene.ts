export type Vec3 = [number, number, number];

export interface ScenePalette {
  /** Page background. */
  paper: string;
  /** Matte plaster mass body. */
  plaster: string;
  /** Hairline edges and annotation ink. */
  ink: string;
  /** Ash-pink accent, used sparingly. */
  accent: string;
  /** Warm neutral used for soft shadow tinting. */
  shadow: string;
}

export interface SceneCamera {
  fov: number;
  position: Vec3;
  /** Wider framing used on narrow viewports so all masses stay in frame. */
  compactPosition: Vec3;
  lookAt: Vec3;
  near: number;
  far: number;
}

export interface SceneLights {
  hemisphere: { sky: string; ground: string; intensity: number };
  key: { position: Vec3; intensity: number; mapSize: number };
  fill: { position: Vec3; intensity: number };
  rim: { position: Vec3; intensity: number };
}

export interface SceneGround {
  size: number;
  gridSize: number;
  gridCell: number;
  gridOpacity: number;
}

export interface SceneConstants {
  palette: ScenePalette;
  camera: SceneCamera;
  lights: SceneLights;
  fog: { color: string; near: number; far: number };
  ground: SceneGround;
  /** Renderer-level settings. */
  render: { toneMappingExposure: number };
}

/**
 * Single source of truth for the 3D scene. Nothing else hard-codes palette,
 * camera, or light values.
 */
export const SCENE: SceneConstants = {
  palette: {
    paper: '#F9F8F6',
    plaster: '#E8E4DC',
    ink: '#1A1A1A',
    accent: '#A85D6B',
    shadow: '#B7AFA1',
  },
  camera: {
    fov: 32,
    position: [0, 2.4, 9.5],
    compactPosition: [0, 2.8, 17],
    lookAt: [0, 1.2, 0],
    near: 0.1,
    far: 100,
  },
  lights: {
    hemisphere: { sky: '#FFFFFF', ground: '#D8D2C8', intensity: 0.5 },
    key: { position: [6, 9, 4], intensity: 1.6, mapSize: 2048 },
    fill: { position: [-6, 3, 2], intensity: 0.16 },
    rim: { position: [0, 2, -8], intensity: 0.5 },
  },
  fog: { color: '#F9F8F6', near: 14, far: 42 },
  ground: {
    size: 120,
    gridSize: 40,
    gridCell: 1,
    /** Kept at or below 5% ink so the drafting grid reads as a faint datum. */
    gridOpacity: 0.045,
  },
  render: {
    // three's energy-conserving Lambert BRDF divides by PI, so the specified
    // light intensities (~1.5 key) read ~3x darker than naive expectations.
    // Exposure compensates so paper reads as paper and plaster as plaster.
    toneMappingExposure: 3.0,
  },
};
