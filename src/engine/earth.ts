import {
  AmbientLight,
  BackSide,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { requestRender } from './renderer';

export interface EarthBundle {
  group: Group;
  sun: DirectionalLight;
  ambient: AmbientLight;
  dispose: () => void;
}

export function createEarth(mobile: boolean): EarthBundle {
  const group = new Group();
  const geo = new SphereGeometry(1, mobile ? 64 : 96, mobile ? 48 : 64);
  const graticule = { value: 1 };
  const mat = new MeshStandardMaterial({
    color: new Color('#0c1422'),
    roughness: 0.9,
    metalness: 0,
  });
  mat.customProgramCacheKey = () => 'earth-graticule-v1';
  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uGraticule = graticule;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocalPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocalPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uGraticule;\nvarying vec3 vLocalPos;',
      )
      .replace(
        '#include <opaque_fragment>',
        `if (uGraticule > 0.5) {
  vec3 p = normalize(vLocalPos);
  float lat = asin(clamp(p.y, -1.0, 1.0));
  float lon = atan(p.z, p.x);
  float latF = abs(fract((lat + 1.5707963) / (3.14159265 / 12.0)) - 0.5);
  float lonF = abs(fract((lon + 3.14159265) / (6.2831853 / 24.0)) - 0.5);
  float line = 1.0 - smoothstep(0.0, 0.045, min(latF, lonF));
  outgoingLight = mix(outgoingLight, vec3(0.25, 0.78, 1.0), line * 0.8);
}
#include <opaque_fragment>`,
      );
  };
  const mesh = new Mesh(geo, mat);
  group.add(mesh);

  const atmoGeo = new SphereGeometry(1.015, mobile ? 64 : 96, mobile ? 48 : 64);
  const atmoMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: BackSide,
    blending: 2,
    uniforms: { uSun: { value: { x: 1, y: 0, z: 0 } } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vW;
      void main() {
        vN = normalize(normalMatrix * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vW;
      void main() {
        vec3 n = normalize(vN);
        vec3 viewDir = normalize(cameraPosition - vW);
        float fres = pow(1.0 - abs(dot(n, viewDir)), 2.4);
        float sun = pow(max(dot(n, vec3(1.0, 0.0, 0.0)), 0.0), 0.55);
        float a = fres * (0.25 + 0.75 * sun);
        gl_FragColor = vec4(0.290, 0.659, 1.0, a);
      }
    `,
  });
  const atmo = new Mesh(atmoGeo, atmoMat);
  group.add(atmo);

  const sun = new DirectionalLight(0xffffff, 2.2);
  sun.position.set(10, 0, 0);
  const ambient = new AmbientLight(0xffffff, 0.06);

  const url = `${import.meta.env.BASE_URL}textures/${mobile ? 'earth_day_1k.jpg' : 'earth_day_2k.jpg'}`;
  new TextureLoader().load(
    url,
    (tex) => {
      tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = 4;
      mat.map = tex;
      mat.color.set('#ffffff');
      graticule.value = 0;
      mat.needsUpdate = true;
      requestRender();
    },
    undefined,
    () => {
      graticule.value = 1;
    },
  );

  return {
    group,
    sun,
    ambient,
    dispose() {
      geo.dispose();
      atmoGeo.dispose();
      mat.map?.dispose();
      mat.dispose();
      atmoMat.dispose();
    },
  };
}
