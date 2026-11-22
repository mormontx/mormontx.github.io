import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

/**
 * One voice event feeding the interference field. `firedAt` is a monotonic
 * `performance.now()` timestamp in milliseconds; a negative value marks an
 * empty slot.
 */
export interface VoiceEvent {
  x: number;
  z: number;
  firedAt: number;
}

export interface InterferenceFieldProps {
  /** Fixed-size (8) ring buffer, mutated in place by the parent. */
  emitters: { current: VoiceEvent[] | null };
}

/** Ring-buffer length; must match the `uEmitters[8]` declaration in the shader. */
const EMITTER_COUNT = 8;
const FIELD_SIZE = 14;
const FIELD_Y = 0.012;

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vWorldXZ;

  void main() {
    // The plane lives in world space; modelMatrix already folds in the flat
    // XZ orientation, so worldPosition.xz is the paper coordinate we shade.
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldXZ = worldPosition.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;    // seconds since the field mounted
  uniform float uOpacity; // global fade hook (kept at 1.0)
  uniform vec3 uEmitters[8]; // xy = paper XZ, z = seconds since that emitter fired

  varying vec2 vWorldXZ;

  // Interference parameters (see component notes).
  const float WAVE_K = 7.0;
  const float WAVE_SPEED = 1.5;
  const float EMITTER_MAX_AGE = 14.0;

  void main() {
    float amp = 0.0;
    float energy = 0.0;
    for (int i = 0; i < 8; i += 1) {
      vec3 e = uEmitters[i];
      if (e.z >= 0.0 && e.z <= EMITTER_MAX_AGE) {
        float r = distance(vWorldXZ, e.xy);
        float wave = sin(WAVE_K * (r - WAVE_SPEED * e.z));
        float att = exp(-r * 0.16) * exp(-e.z * 0.22);
        amp += wave * att;
        energy += att;
      }
    }

    // Only shade where waves are actually present. Without this gate a silent
    // field (amp === 0 everywhere) would read as a full nodal line and paint
    // the whole floor, and the far field beyond every emitter would do the
    // same.
    float presence = smoothstep(0.0, 0.06, energy);

    // Anti-aliased hairlines: the contour is one screen-space derivative wide,
    // so it stays ~1–2 px regardless of camera angle or zoom.
    float w = max(fwidth(amp), 1e-4);
    float nodal = presence * (1.0 - smoothstep(0.0, 1.6 * w, abs(amp)));

    // Reinforcement: only genuine constructive peaks, not the broad shoulder.
    float reinforce = smoothstep(0.6, 1.0, abs(amp));

    // Radial edge fade so the 14x14 quad never shows as a rectangle. Cap the
    // visible radius a little tighter so the field never crowds the page edge.
    float edge = 1.0 - smoothstep(3.4, 6.0, length(vWorldXZ));
    float fade = edge * uOpacity * smoothstep(0.0, 0.9, uTime);

    // sRGB ink #1A1A1A and warm grey #8A6A5E, expressed in linear light because
    // the renderer's sRGB output transform runs after this shader.
    vec3 ink = vec3(0.010329823026364548);
    vec3 warmGrey = vec3(0.2541520943200296, 0.14412847084818123, 0.11193242782769693);

    float alphaReinforce = reinforce * 0.025 * fade;
    float alphaNodal = nodal * 0.10 * fade;

    // Premultiplied "over" compositing (reinforcement under nodal ink), then
    // un-premultiply so NormalBlending receives straight alpha.
    vec3 premul = warmGrey * alphaReinforce;
    float alpha = alphaReinforce;
    premul = ink * alphaNodal + premul * (1.0 - alphaNodal);
    alpha = alphaNodal + alpha * (1.0 - alphaNodal);

    vec3 color = alpha > 0.0 ? premul / alpha : vec3(0.0);
    gl_FragColor = vec4(color, alpha);
  }
`;

/**
 * A floor-anchored "interference floor": overlapping voice waves leave a
 * persistent nodal pattern on the paper. Each emitter fires an expanding,
 * decaying wave; where two or more waves cancel, ink nodal lines appear, and
 * where they reinforce, a faint warm-grey wash. The plane is parented outside
 * the rotating ring so the marks stay glued to the paper rather than orbiting
 * with the mirrors.
 */
export default function InterferenceField({ emitters }: InterferenceFieldProps) {
  const data = useMemo(() => new Float32Array(EMITTER_COUNT * 3), []);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uEmitters: { value: data },
    }),
    [data],
  );

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        name: 'InterferenceField',
        uniforms,
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.NormalBlending,
      }),
    [uniforms],
  );

  const mountedAt = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useFrame(() => {
    const now = performance.now();
    if (mountedAt.current == null) mountedAt.current = now;
    uniforms.uTime.value = (now - mountedAt.current) / 1000;

    const list = emitters.current;
    if (!list) return;

    // Update the vec3[8] payload in place (no per-frame allocations). The
    // shader skips inactive emitters via a negative age.
    for (let i = 0; i < EMITTER_COUNT; i += 1) {
      const emitter = list[i];
      const offset = i * 3;
      data[offset] = emitter.x;
      data[offset + 1] = emitter.z;
      data[offset + 2] =
        emitter.firedAt < 0 ? -1 : (now - emitter.firedAt) / 1000;
    }
  });

  return (
    <mesh
      rotation-x={-Math.PI / 2}
      position={[0, FIELD_Y, 0]}
      renderOrder={2}
    >
      <planeGeometry args={[FIELD_SIZE, FIELD_SIZE]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}
