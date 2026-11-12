import {
  AdditiveBlending,
  CircleGeometry,
  CubeCamera,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  WebGLCubeRenderTarget,
  WebGLRenderTarget,
  Color,
  type WebGLRenderer,
} from 'three';
import { getRenderer, requestRender } from '../../engine/renderer';
import { R_E } from '../../physics/constants';
import {
  edgeOnNormal,
  localFrame,
  positionHat,
  radiator,
} from '../../physics/radiator';

export type FishMode = 'camera' | 'heat';

export interface FishFace {
  normal: Vector3;
  zenith: Vector3;
  north: Vector3;
  canvas: HTMLCanvasElement;
}

const FISHEYE = /* glsl */ `
  uniform samplerCube uCube;
  uniform vec3 uN;
  uniform vec3 uT;
  uniform vec3 uB;
  uniform float uMode;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 1.0) {
      gl_FragColor = vec4(0.0);
      return;
    }
    float r = sqrt(r2);
    vec3 dir;
    if (uMode < 0.5) {
      float theta = r * 1.57079632679;
      float scale = r < 1e-4 ? 0.0 : sin(theta) / r;
      dir = cos(theta) * uN + (p.x * uT + p.y * uB) * scale;
    } else {
      dir = p.x * uT + p.y * uB + sqrt(max(0.0, 1.0 - r2)) * uN;
    }
    gl_FragColor = vec4(textureCube(uCube, normalize(dir)).rgb, 1.0);
  }
`;

function basis(normal: Vector3, zenith: Vector3, north: Vector3): { t: Vector3; b: Vector3 } {
  const b = zenith.clone().addScaledVector(normal, -zenith.dot(normal));
  if (b.lengthSq() < 1e-8) b.copy(north).addScaledVector(normal, -north.dot(normal));
  if (b.lengthSq() < 1e-8) b.set(0, 1, 0);
  b.normalize();
  const t = new Vector3().crossVectors(normal, b).normalize();
  return { t, b };
}

function srgbByte(byte: number): number {
  const x = byte / 255;
  const y = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(y * 255)));
}

class FisheyePass {
  readonly size: number;
  readonly cubeTarget: WebGLCubeRenderTarget;
  readonly cube: CubeCamera;
  readonly target: WebGLRenderTarget;
  readonly quadScene = new Scene();
  readonly quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 2);
  readonly material: ShaderMaterial;

  constructor(size: number) {
    this.size = size;
    this.cubeTarget = new WebGLCubeRenderTarget(size, { generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter });
    this.cube = new CubeCamera(0.01, 200, this.cubeTarget);
    this.target = new WebGLRenderTarget(256, 256, { minFilter: LinearFilter, magFilter: LinearFilter, format: RGBAFormat });
    this.material = new ShaderMaterial({
      uniforms: {
        uCube: { value: this.cubeTarget.texture },
        uN: { value: new Vector3(0, 1, 0) },
        uT: { value: new Vector3(1, 0, 0) },
        uB: { value: new Vector3(0, 0, 1) },
        uMode: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: FISHEYE,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    this.quadScene.add(quad);
    this.quadCamera.position.set(0, 0, 1);
    this.cube.layers.enable(3);
  }

  async shoot(renderer: WebGLRenderer, scene: Scene, origin: Vector3, face: FishFace, mode: FishMode): Promise<Uint8Array> {
    this.cube.position.copy(origin);
    this.cube.update(renderer, scene);
    const { t, b } = basis(face.normal, face.zenith, face.north);
    (this.material.uniforms.uN.value as Vector3).copy(face.normal);
    (this.material.uniforms.uT.value as Vector3).copy(t);
    (this.material.uniforms.uB.value as Vector3).copy(b);
    this.material.uniforms.uMode.value = mode === 'heat' ? 1 : 0;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.quadScene, this.quadCamera);
    const pixels = new Uint8Array(256 * 256 * 4);
    const reader = renderer as WebGLRenderer & {
      readRenderTargetPixelsAsync?: (t: WebGLRenderTarget, x: number, y: number, w: number, h: number, b: Uint8Array) => Promise<Uint8Array>;
    };
    if (reader.readRenderTargetPixelsAsync) await reader.readRenderTargetPixelsAsync(this.target, 0, 0, 256, 256, pixels);
    else renderer.readRenderTargetPixels(this.target, 0, 0, 256, 256, pixels);
    renderer.setRenderTarget(prev);
    return pixels;
  }

  dispose(): void {
    this.cubeTarget.dispose();
    this.target.dispose();
    this.material.dispose();
    const quad = this.quadScene.children[0] as Mesh;
    quad.geometry.dispose();
  }
}

function paint(canvas: HTMLCanvasElement, pixels: Uint8Array): void {
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const image = ctx.createImageData(256, 256);
  for (let y = 0; y < 256; y++) {
    const srcRow = (255 - y) * 256 * 4;
    const dstRow = y * 256 * 4;
    for (let x = 0; x < 256; x++) {
      const s = srcRow + x * 4;
      const d = dstRow + x * 4;
      image.data[d] = srgbByte(pixels[s]);
      image.data[d + 1] = srgbByte(pixels[s + 1]);
      image.data[d + 2] = srgbByte(pixels[s + 2]);
      image.data[d + 3] = pixels[s + 3];
    }
  }
  ctx.putImageData(image, 0, 0);
}

export function whiteFraction(pixels: Uint8Array): number {
  let disk = 0;
  let white = 0;
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const px = ((x + 0.5) / 256) * 2 - 1;
      const py = ((y + 0.5) / 256) * 2 - 1;
      if (px * px + py * py > 1) continue;
      disk++;
      const i = (y * 256 + x) * 4;
      if (pixels[i] > 200 && pixels[i + 1] > 200 && pixels[i + 2] > 200) white++;
    }
  }
  return disk === 0 ? 0 : white / disk;
}

export function createLiveFisheye(scene: Scene, mobile: boolean): {
  request: (origin: Vector3, faces: FishFace[], mode: FishMode) => void;
  dispose: () => void;
} {
  const pass = new FisheyePass(mobile ? 128 : 256);
  const sunDir = new Vector3(1, 0, 0);
  const dist = 50;
  const disc = new Mesh(
    new CircleGeometry(dist * Math.tan((1.5 * Math.PI) / 180), 48),
    new MeshBasicMaterial({ color: 0xfff6df, toneMapped: false, depthWrite: false }),
  );
  const glare = new Sprite(
    new SpriteMaterial({
      color: 0xffe2a8,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    }),
  );
  const glareScale = 2 * dist * Math.tan((6 * Math.PI) / 180);
  glare.scale.set(glareScale, glareScale, 1);
  disc.layers.set(3);
  glare.layers.set(3);
  scene.add(disc, glare);

  let timer = 0;
  let last = 0;
  let pending: { origin: Vector3; faces: FishFace[]; mode: FishMode } | null = null;
  let busy = false;
  const clear = new Color();

  const placeSun = (origin: Vector3) => {
    disc.position.copy(origin).addScaledVector(sunDir, dist);
    disc.lookAt(origin.clone().addScaledVector(sunDir, dist + 1));
    glare.position.copy(disc.position);
  };

  const run = async (job: { origin: Vector3; faces: FishFace[]; mode: FishMode }) => {
    if (busy) {
      pending = job;
      return;
    }
    busy = true;
    try {
      const renderer = getRenderer();
      renderer.getClearColor(clear);
      const alpha = renderer.getClearAlpha();
      placeSun(job.origin);
      for (const face of job.faces) {
        if (pending) break;
        const pixels = await pass.shoot(renderer, scene, job.origin, face, job.mode);
        if (pending) break;
        paint(face.canvas, pixels);
      }
      renderer.setClearColor(clear, alpha);
      requestRender();
    } finally {
      busy = false;
      if (pending) {
        const next = pending;
        pending = null;
        void run(next);
      }
    }
  };

  return {
    request(origin, faces, mode) {
      pending = { origin: origin.clone(), faces, mode };
      const now = performance.now();
      const since = now - last;
      if (since >= 100 && !busy) {
        last = now;
        const job = pending;
        pending = null;
        void run(job);
        return;
      }
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        last = performance.now();
        const job = pending;
        pending = null;
        if (job) void run(job);
      }, Math.max(0, 100 - since));
    },
    dispose() {
      window.clearTimeout(timer);
      pass.dispose();
      disc.geometry.dispose();
      (disc.material as MeshBasicMaterial).dispose();
      glare.material.dispose();
      scene.remove(disc, glare);
    },
  };
}

const DEG = Math.PI / 180;

export async function measureViewFactors(): Promise<{ name: string; face: 'A' | 'B'; got: number; expected: number }[]> {
  const pass = new FisheyePass(256);
  const scene = new Scene();
  const earth = new Mesh(new SphereGeometry(1, 192, 128), new MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  scene.add(earth);
  scene.background = null;
  const renderer = getRenderer();
  renderer.setClearColor(0x000000, 1);
  const cases: { name: string; hKm: number; phi: number; edge: boolean }[] = [
    { name: 'edge-500', hKm: 500, phi: 90, edge: true },
    { name: 'zenith-term', hKm: 500, phi: 90, edge: false },
    { name: 'noon', hKm: 500, phi: 0, edge: false },
    { name: 'edge-2000', hKm: 2000, phi: 90, edge: true },
  ];
  const out: { name: string; face: 'A' | 'B'; got: number; expected: number }[] = [];
  const canvas = document.createElement('canvas');
  try {
    for (const item of cases) {
      const rHat = positionHat(0, item.phi * DEG);
      const frame = localFrame(rHat);
      const nHat = item.edge ? edgeOnNormal(rHat) : frame.up;
      const result = radiator(item.hKm, rHat, nHat);
      const origin = new Vector3(rHat[0], rHat[1], rHat[2]).multiplyScalar(1 + item.hKm / R_E);
      const zenith = new Vector3(rHat[0], rHat[1], rHat[2]);
      const north = new Vector3(frame.north[0], frame.north[1], frame.north[2]);
      const normal = new Vector3(nHat[0], nHat[1], nHat[2]);
      for (const face of ['A', 'B'] as const) {
        const n = face === 'A' ? normal : normal.clone().multiplyScalar(-1);
        const pixels = await pass.shoot(renderer, scene, origin, { normal: n, zenith, north, canvas }, 'heat');
        const expected = face === 'A' ? result.A.F : result.B.F;
        out.push({ name: item.name, face, got: whiteFraction(pixels), expected });
      }
    }
  } finally {
    pass.dispose();
    earth.geometry.dispose();
    (earth.material as MeshBasicMaterial).dispose();
    renderer.setClearColor(0x05070c, 1);
  }
  return out;
}
