import { memo, useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { Edges } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { SCENE, type Vec3 } from '../../data/scene';
import { useReducedMotion } from '../../lib/useReducedMotion';
import { damp } from '../../lib/useScrollProgress';
import { fitCamera, fitCameraByRadius } from '../../lib/cameraFit';

/**
 * Studio lights: cool-white hemisphere fill plus key/fill/rim directionals.
 * Key light casts 2048px soft shadows.
 */
export const StudioLights = memo(function StudioLights() {
  const { hemisphere, key, fill, rim } = SCENE.lights;
  return (
    <>
      <hemisphereLight
        args={[hemisphere.sky, hemisphere.ground, hemisphere.intensity]}
      />
      <directionalLight
        position={key.position}
        intensity={key.intensity}
        castShadow
        shadow-mapSize={[key.mapSize, key.mapSize]}
        shadow-camera-near={0.5}
        shadow-camera-far={40}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-bias={-0.0002}
        shadow-normalBias={0.02}
      />
      <directionalLight position={fill.position} intensity={fill.intensity} />
      <directionalLight position={rim.position} intensity={rim.intensity} />
    </>
  );
});

let gridTexture: THREE.CanvasTexture | null = null;
let shadowTexture: THREE.CanvasTexture | null = null;

function makeGridTexture(): THREE.CanvasTexture | null {
  if (gridTexture) return gridTexture;

  const px = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, px, px);

  const cells = SCENE.ground.gridSize / SCENE.ground.gridCell;
  const cellPx = px / cells;

  // Hairline drafting grid drawn at full ink, then faded radially below.
  ctx.strokeStyle = SCENE.palette.ink;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  for (let i = 0; i <= cells; i += 1) {
    const p = Math.round(i * cellPx) + 0.5;
    ctx.moveTo(p, 0);
    ctx.lineTo(p, px);
    ctx.moveTo(0, p);
    ctx.lineTo(px, p);
  }
  ctx.stroke();

  // Radial alpha mask: full strength at the centre, dissolved by the edges.
  ctx.globalCompositeOperation = 'destination-in';
  const gradient = ctx.createRadialGradient(
    px / 2,
    px / 2,
    px * 0.06,
    px / 2,
    px / 2,
    px * 0.52,
  );
  gradient.addColorStop(0, 'rgba(0,0,0,1)');
  gradient.addColorStop(0.5, 'rgba(0,0,0,0.78)');
  gradient.addColorStop(0.8, 'rgba(0,0,0,0.26)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, px, px);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  gridTexture = texture;
  return texture;
}

function makeShadowTexture(): THREE.CanvasTexture | null {
  if (shadowTexture) return shadowTexture;

  const px = 512;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, px, px);

  const gradient = ctx.createRadialGradient(
    px / 2,
    px / 2,
    0,
    px / 2,
    px / 2,
    px / 2,
  );
  gradient.addColorStop(0, 'rgba(26,26,26,0.30)');
  gradient.addColorStop(0.45, 'rgba(26,26,26,0.12)');
  gradient.addColorStop(1, 'rgba(26,26,26,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, px, px);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  shadowTexture = texture;
  return texture;
}

/**
 * Faint drafting grid rendered on a transparent plane. The radial alpha mask
 * dissolves the hairlines toward the plane edges, and the material opacity is
 * kept at or below 5% ink so the grid never competes with the masses.
 */
export const GridPlane = memo(function GridPlane() {
  const texture = makeGridTexture();
  if (!texture) return null;

  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.012, 0]}>
      <planeGeometry args={[SCENE.ground.gridSize, SCENE.ground.gridSize]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={SCENE.ground.gridOpacity}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
});

export interface ContactShadowProps {
  position?: Vec3;
  /** World-space radius of the soft pool. */
  radius?: number;
  /** Optional elliptical squash, e.g. [1.25, 0.8, 1]. */
  scale?: Vec3;
  opacity?: number;
}

/**
 * Large soft contact-shadow / ambient-occlusion pool. Weights the masses onto
 * the drafting table without hard cast-shadow edges.
 */
export const ContactShadow = memo(function ContactShadow({
  position = [0, 0, 0],
  radius = 3.2,
  scale = [1, 1, 1],
  opacity = 0.9,
}: ContactShadowProps) {
  const texture = makeShadowTexture();
  if (!texture) return null;

  return (
    <mesh
      rotation-x={-Math.PI / 2}
      position={[position[0], 0.018, position[2]]}
      scale={[scale[0] * radius * 2, scale[1] * radius * 2, 1]}
    >
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={opacity}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
});

/**
 * Paper-white ground plane (shadow receiver) plus the soft drafting grid.
 */
export const PaperGround = memo(function PaperGround() {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[SCENE.ground.size, SCENE.ground.size]} />
        <meshStandardMaterial
          color={SCENE.palette.paper}
          roughness={1}
          metalness={0}
        />
      </mesh>
      <GridPlane />
    </group>
  );
});

export interface MassProps {
  size?: Vec3;
  position?: Vec3;
  rotation?: Vec3;
  castShadow?: boolean;
  receiveShadow?: boolean;
  edgeColor?: string;
}

/**
 * A single matte plaster mass with hairline ink edges.
 */
export const Mass = memo(function Mass({
  size = [1, 2, 1],
  position = [0, 1, 0],
  rotation = [0, 0, 0],
  castShadow = true,
  receiveShadow = true,
  edgeColor = SCENE.palette.ink,
}: MassProps) {
  return (
    <mesh
      position={position}
      rotation={rotation}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    >
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={SCENE.palette.plaster}
        roughness={0.92}
        metalness={0}
      />
      <Edges threshold={20} color={edgeColor} />
    </mesh>
  );
});

/**
 * Paper-colored fog so distant masses dissolve into the room.
 */
export const SceneFog = memo(function SceneFog() {
  return (
    <fog attach="fog" args={[SCENE.fog.color, SCENE.fog.near, SCENE.fog.far]} />
  );
});

export interface PointerParallaxProps {
  strength?: number;
}

/**
 * Tiny pointer-driven camera offset (max ~0.15 world units), damped per frame.
 * Disabled under reduced motion.
 */
export const PointerParallax = memo(function PointerParallax({
  strength = 0.15,
}: PointerParallaxProps) {
  const reducedMotion = useReducedMotion();
  const { camera } = useThree();
  const base = useRef<{ x: number; y: number } | null>(null);

  useFrame((state, delta) => {
    if (reducedMotion) return;

    if (!base.current) {
      base.current = { x: camera.position.x, y: camera.position.y };
    }

    const targetX = base.current.x + state.pointer.x * strength;
    const targetY = base.current.y + state.pointer.y * strength;
    const lambda = 1 - Math.exp(-8 * delta);

    camera.position.x = damp(camera.position.x, targetX, lambda);
    camera.position.y = damp(camera.position.y, targetY, lambda);
    camera.lookAt(
      SCENE.camera.lookAt[0],
      SCENE.camera.lookAt[1],
      SCENE.camera.lookAt[2],
    );
  });

  return null;
});

export interface FitCameraProps {
  /** Half-height of the scene around `lookAt`. */
  verticalExtent?: number;
  /** Half-width of the scene around `lookAt`. */
  horizontalExtent?: number;
  /** Pre-resolved effective radius; takes precedence over extents. */
  boundRadius?: number;
  fitRatio?: number;
  downAngleDeg?: number;
  azimuthDeg?: number;
  lookAt?: Vec3;
}

/**
 * Fits a perspective camera so the given extents stay fully inside the frame
 * for the current canvas aspect ratio. Re-fits on resize.
 */
export const FitCamera = memo(function FitCamera({
  verticalExtent = 2,
  horizontalExtent = 2,
  boundRadius,
  fitRatio = 0.78,
  downAngleDeg = 9,
  azimuthDeg = 0,
  lookAt = [0, 1.2, 0],
}: FitCameraProps) {
  const camera = useThree(
    (state) => state.camera,
  ) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);
  const aspect = size.width / Math.max(1, size.height);
  const lx = lookAt[0];
  const ly = lookAt[1];
  const lz = lookAt[2];

  useLayoutEffect(() => {
    const result =
      boundRadius != null
        ? fitCameraByRadius({
            fov: camera.fov,
            boundRadius,
            fitRatio,
            downAngleDeg,
            azimuthDeg,
            lookAt,
          })
        : fitCamera({
            aspect,
            fov: camera.fov,
            verticalExtent,
            horizontalExtent,
            fitRatio,
            downAngleDeg,
            azimuthDeg,
            lookAt,
          });

    camera.position.set(
      result.position[0],
      result.position[1],
      result.position[2],
    );
    camera.lookAt(lx, ly, lz);
  }, [
    aspect,
    azimuthDeg,
    boundRadius,
    camera,
    downAngleDeg,
    fitRatio,
    horizontalExtent,
    lx,
    ly,
    lz,
    verticalExtent,
  ]);

  return null;
});
