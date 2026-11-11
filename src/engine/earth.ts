import {
  AdditiveBlending,
  BackSide,
  DataTexture,
  DirectionalLight,
  Group,
  LinearFilter,
  Mesh,
  RGBAFormat,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  UnsignedByteType,
  AmbientLight,
} from 'three';
import { requestRender } from './renderer';

export interface EarthBundle {
  group: Group;
  sun: DirectionalLight;
  ambient: AmbientLight;
  dispose: () => void;
}

const earthShader = {
  vertex: /* glsl */ `
    varying vec3 vWorld;
    varying vec3 vNormalW;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      vNormalW = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragment: /* glsl */ `
    uniform sampler2D uDay;
    uniform sampler2D uNight;
    uniform float uGraticule;
    uniform float uHasNight;
    varying vec3 vWorld;
    varying vec3 vNormalW;
    varying vec2 vUv;
    void main() {
      vec3 n = normalize(vNormalW);
      vec3 sunDir = vec3(1.0, 0.0, 0.0);
      float ndotl = dot(n, sunDir);
      float day = smoothstep(-0.08, 0.18, ndotl);
      vec3 dayCol = texture2D(uDay, vUv).rgb;
      vec3 nightCol = texture2D(uNight, vUv).rgb;
      vec3 color = dayCol * (0.04 + 0.96 * day * pow(max(ndotl, 0.0), 0.6));
      color += nightCol * vec3(1.0, 0.82, 0.55) * 1.4 * (1.0 - day) * uHasNight;
      float water = smoothstep(0.05, 0.15, dayCol.b - max(dayCol.r, dayCol.g));
      vec3 viewDir = normalize(cameraPosition - vWorld);
      vec3 halfVec = normalize(sunDir + viewDir);
      float spec = pow(max(dot(n, halfVec), 0.0), 60.0) * 0.35 * water * step(0.0, ndotl);
      color += vec3(spec);
      vec3 p = normalize(vWorld);
      float lat = asin(clamp(p.y, -1.0, 1.0));
      float lon = atan(p.z, p.x);
      float latF = abs(fract((lat + 1.5707963) / (3.14159265 / 12.0)) - 0.5);
      float lonF = abs(fract((lon + 3.14159265) / (6.2831853 / 24.0)) - 0.5);
      float line = 1.0 - smoothstep(0.0, 0.02, min(latF, lonF));
      color = mix(color, vec3(0.29, 0.75, 1.0), line * uGraticule);
      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

function blankTexture(rgb: [number, number, number]): DataTexture {
  const data = new Uint8Array([rgb[0], rgb[1], rgb[2], 255]);
  const tex = new DataTexture(data, 1, 1, RGBAFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createEarth(mobile: boolean): EarthBundle {
  const group = new Group();
  const geo = new SphereGeometry(1, mobile ? 64 : 96, mobile ? 48 : 64);
  const graticule = { value: 0.15 };
  const hasNight = { value: 0 };
  const dayTex = blankTexture([8, 14, 24]);
  const nightTex = blankTexture([0, 0, 0]);
  const mat = new ShaderMaterial({
    uniforms: {
      uDay: { value: dayTex },
      uNight: { value: nightTex },
      uGraticule: graticule,
      uHasNight: hasNight,
    },
    vertexShader: earthShader.vertex,
    fragmentShader: earthShader.fragment,
  });
  const mesh = new Mesh(geo, mat);
  group.add(mesh);

  const atmoGeo = new SphereGeometry(1.015, mobile ? 64 : 96, mobile ? 48 : 64);
  const atmoMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: BackSide,
    blending: AdditiveBlending,
    uniforms: {},
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vW;
      void main() {
        vec3 n = normalize(vN);
        vec3 viewDir = normalize(cameraPosition - vW);
        float ndotl = dot(n, vec3(1.0, 0.0, 0.0));
        float day = smoothstep(-0.08, 0.18, ndotl);
        float fres = pow(1.0 - abs(dot(n, viewDir)), 2.6);
        float term = exp(-pow(ndotl / 0.07, 2.0));
        vec3 cool = vec3(0.290, 0.659, 1.0);
        vec3 warm = vec3(1.0, 0.62, 0.32);
        vec3 col = mix(cool, warm, clamp(term, 0.0, 1.0));
        float a = fres * mix(0.18, 1.0, day);
        gl_FragColor = vec4(col, a);
      }
    `,
  });
  group.add(new Mesh(atmoGeo, atmoMat));

  const sun = new DirectionalLight(0xffffff, 1.15);
  sun.position.set(10, 0, 0);
  const ambient = new AmbientLight(0xffffff, 0.02);
  const loaded: Texture[] = [];

  const fadeOut = () => {
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / 400);
      graticule.value = 0.15 * (1 - t);
      requestRender();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const loader = new TextureLoader();
  const base = import.meta.env.BASE_URL;
  loader.load(`${base}textures/${mobile ? 'earth_day_1k.jpg' : 'earth_day_2k.jpg'}`, (tex) => {
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    mat.uniforms.uDay.value = tex;
    loaded.push(tex);
    fadeOut();
  });
  loader.load(
    `${base}textures/${mobile ? 'earth_night_1k.jpg' : 'earth_night_2k.jpg'}`,
    (tex) => {
      tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = 4;
      mat.uniforms.uNight.value = tex;
      hasNight.value = 1;
      loaded.push(tex);
      requestRender();
    },
    undefined,
    () => {
      hasNight.value = 0;
    },
  );

  return {
    group,
    sun,
    ambient,
    dispose() {
      geo.dispose();
      atmoGeo.dispose();
      mat.dispose();
      atmoMat.dispose();
      dayTex.dispose();
      nightTex.dispose();
      for (const tex of loaded) tex.dispose();
    },
  };
}
