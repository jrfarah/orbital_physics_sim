import { CircleGeometry, Mesh, ShaderMaterial } from 'three';

/**
 * Far-field satellite field. Part A compiles it during warm-up.
 * The Thermal scene does not draw it until the constellation view lands.
 */
export const constellationMaterial = new ShaderMaterial({
  uniforms: {
    uN: { value: 1 },
    uRadius: { value: 1 },
  },
  depthWrite: false,
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uN;
    uniform float uRadius;
    varying vec2 vUv;
    void main() {
      if (uN < 0.0 || uRadius < 0.0) discard;
      gl_FragColor = vec4(0.0);
    }
  `,
});

export function createConstellationMesh(): Mesh {
  const mesh = new Mesh(new CircleGeometry(1, 48), constellationMaterial);
  mesh.frustumCulled = false;
  mesh.name = 'constellation';
  mesh.visible = false;
  return mesh;
}
