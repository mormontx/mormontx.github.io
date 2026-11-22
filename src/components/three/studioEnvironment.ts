import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const cache = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();

/**
 * A neutral studio environment for mirror-like materials, prefiltered once per
 * renderer. The Dialectic Room's monoliths carry it on their own materials, so
 * they reflect the same light in every scene; the hero also lights its whole
 * scene with it.
 */
export function getStudioEnvironment(gl: THREE.WebGLRenderer): THREE.Texture {
  let texture = cache.get(gl);
  if (!texture) {
    const pmrem = new THREE.PMREMGenerator(gl);
    texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    cache.set(gl, texture);
  }
  return texture;
}
