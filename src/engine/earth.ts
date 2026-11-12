import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  ClampToEdgeWrapping,
  DataTexture,
  DirectionalLight,
  FrontSide,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  UnsignedByteType,
  Vector3,
} from 'three';
import { getRenderer, requestRender } from './renderer';

export interface EarthBundle {
  group: Group;
  sun: DirectionalLight;
  ambient: AmbientLight;
  dispose: () => void;
}

const vertex = /* glsl */ `
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
`;

const finish = /* glsl */ `
  #ifdef TONE_MAPPING
    color = toneMapping(color);
  #endif
  gl_FragColor = linearToOutputTexel(vec4(color, alpha));
`;

const surfaceFragment = /* glsl */ `
  uniform sampler2D uDayLo;
  uniform sampler2D uDayHi;
  uniform sampler2D uNightLo;
  uniform sampler2D uNightHi;
  uniform sampler2D uCloudsLo;
  uniform sampler2D uCloudsHi;
  uniform float uMix;
  uniform vec3 uSunDir;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying vec2 vUv;

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 L = normalize(uSunDir);
    vec3 V = normalize(cameraPosition - vWorld);
    float NdotL = dot(N, L);
    float day = smoothstep(-0.10, 0.20, NdotL);
    float light = clamp((NdotL + 0.12) / 1.12, 0.0, 1.0);
    float twilight = smoothstep(-0.18, 0.0, NdotL) * (1.0 - smoothstep(0.0, 0.28, NdotL));

    vec3 dayCol = mix(texture2D(uDayLo, vUv).rgb, texture2D(uDayHi, vUv).rgb, uMix);
    float cloudHere = mix(texture2D(uCloudsLo, vUv).r, texture2D(uCloudsHi, vUv).r, uMix);
    vec3 up = abs(N.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 east = normalize(cross(up, N));
    vec3 north = normalize(cross(N, east));
    vec2 sunOffsetUV = vec2(dot(L, east), dot(L, north));
    vec2 shadowUv = vUv + sunOffsetUV * 0.0015;
    float cloudShadow = mix(texture2D(uCloudsLo, shadowUv).r, texture2D(uCloudsHi, shadowUv).r, uMix);
    dayCol *= 1.0 - 0.28 * cloudShadow * day;

    float water = smoothstep(0.04, 0.14, dayCol.b - max(dayCol.r, dayCol.g));
    vec3 H = normalize(L + V);
    float ndh = max(dot(N, H), 0.0);
    float spec = pow(ndh, 80.0) * water * day * 0.55;
    spec += pow(ndh, 12.0) * water * day * 0.08;

    vec3 surface = dayCol * light * 1.05 + spec * vec3(1.0, 0.96, 0.88);
    surface = mix(surface, surface * vec3(1.0, 0.78, 0.6), twilight * 0.5);

    vec3 nightCol = mix(texture2D(uNightLo, vUv).rgb, texture2D(uNightHi, vUv).rgb, uMix);
    vec3 nightGlow = mix(texture2D(uNightLo, vUv, 4.0).rgb, texture2D(uNightHi, vUv, 4.0).rgb, uMix);
    vec3 lights = (nightCol * 1.6 + nightGlow * 0.9) * vec3(1.0, 0.85, 0.6) * (1.0 - day) * (1.0 - 0.75 * cloudHere);

    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.5);
    float haze = fres * 0.55 * smoothstep(-0.2, 0.4, NdotL);
    vec3 color = mix(surface, vec3(0.42, 0.62, 1.0), haze) + lights;
    float alpha = 1.0;
    ${finish}
  }
`;

const cloudFragment = /* glsl */ `
  uniform sampler2D uCloudsLo;
  uniform sampler2D uCloudsHi;
  uniform float uMix;
  uniform vec3 uSunDir;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying vec2 vUv;

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 L = normalize(uSunDir);
    vec3 V = normalize(cameraPosition - vWorld);
    float NdotL = dot(N, L);
    float day = smoothstep(-0.10, 0.20, NdotL);
    float light = clamp((NdotL + 0.12) / 1.12, 0.0, 1.0);
    float twilight = smoothstep(-0.18, 0.0, NdotL) * (1.0 - smoothstep(0.0, 0.28, NdotL));
    float cloudHere = mix(texture2D(uCloudsLo, vUv).r, texture2D(uCloudsHi, vUv).r, uMix);
    vec3 color = vec3(1.0) * (0.06 + 0.94 * light);
    color = mix(color, color * vec3(1.0, 0.86, 0.72), twilight);
    color = mix(vec3(0.22, 0.28, 0.40) * 0.04, color, day);
    float alpha = cloudHere * 0.92;
    if (alpha < 0.004) discard;
    ${finish}
  }
`;

const limbFragment = /* glsl */ `
  uniform vec3 uSunDir;
  varying vec3 vWorld;
  varying vec3 vNormalW;

  vec3 srgb(vec3 c) {
    return pow(c, vec3(2.2));
  }

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 L = normalize(uSunDir);
    vec3 V = normalize(cameraPosition - vWorld);
    float NdotL = dot(N, L);
    float day = smoothstep(-0.10, 0.20, NdotL);
    float twilight = smoothstep(-0.18, 0.0, NdotL) * (1.0 - smoothstep(0.0, 0.28, NdotL));
    vec3 nightC = srgb(vec3(0.043, 0.086, 0.200));
    vec3 twiC = srgb(vec3(1.0, 0.604, 0.353));
    vec3 dayC = srgb(vec3(0.353, 0.663, 1.0));
    vec3 tint = mix(mix(nightC, dayC, day), twiC, twilight);
    float rim = pow(1.0 - abs(dot(N, V)), 3.0);
    float inten = rim * (0.25 + 1.4 * day + 0.9 * twilight);
    inten += pow(max(dot(V, -L), 0.0), 6.0) * 1.2 * rim;
    vec3 color = tint * inten;
    float alpha = 1.0;
    ${finish}
  }
`;

const hazeFragment = /* glsl */ `
  uniform vec3 uSunDir;
  varying vec3 vWorld;
  varying vec3 vNormalW;

  vec3 srgb(vec3 c) {
    return pow(c, vec3(2.2));
  }

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 L = normalize(uSunDir);
    vec3 V = normalize(cameraPosition - vWorld);
    float NdotL = dot(N, L);
    float day = smoothstep(-0.10, 0.20, NdotL);
    float twilight = smoothstep(-0.18, 0.0, NdotL) * (1.0 - smoothstep(0.0, 0.28, NdotL));
    vec3 nightC = srgb(vec3(0.043, 0.086, 0.200));
    vec3 twiC = srgb(vec3(1.0, 0.604, 0.353));
    vec3 dayC = srgb(vec3(0.353, 0.663, 1.0));
    vec3 color = mix(mix(nightC, dayC, day), twiC, twilight);
    float rim = pow(1.0 - abs(dot(N, V)), 3.0);
    float alpha = rim * 0.12;
    if (alpha < 0.004) discard;
    ${finish}
  }
`;

function blank(rgb: [number, number, number], srgb: boolean): DataTexture {
  const data = new Uint8Array([rgb[0], rgb[1], rgb[2], 255]);
  const tex = new DataTexture(data, 1, 1, RGBAFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function anisotropy(): number {
  try {
    return getRenderer().capabilities.getMaxAnisotropy();
  } catch {
    return 1;
  }
}

function prepare(tex: Texture, srgb: boolean): Texture {
  tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  tex.anisotropy = anisotropy();
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

function hiResNames(mobile: boolean): { day: string[]; clouds: string[]; night: string[] } {
  let high = false;
  if (!mobile) {
    try {
      const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
      high = getRenderer().capabilities.maxTextureSize >= 8192 && (mem === undefined || mem >= 8);
    } catch {
      high = false;
    }
  }
  if (mobile) {
    return {
      day: ['earth_day_4k.jpg', 'earth_day_2k.jpg'],
      clouds: ['earth_clouds_2k.jpg'],
      night: ['earth_night_2k.jpg'],
    };
  }
  if (high) {
    return {
      day: ['earth_day_8k.jpg', 'earth_day_4k.jpg', 'earth_day_2k.jpg'],
      clouds: ['earth_clouds_4k.jpg', 'earth_clouds_2k.jpg'],
      night: ['earth_night_4k.jpg', 'earth_night_2k.jpg'],
    };
  }
  return {
    day: ['earth_day_4k.jpg', 'earth_day_2k.jpg'],
    clouds: ['earth_clouds_4k.jpg', 'earth_clouds_2k.jpg'],
    night: ['earth_night_4k.jpg', 'earth_night_2k.jpg'],
  };
}

function loadFirst(urls: string[], srgb: boolean, onLoad: (tex: Texture) => void, onFail: () => void): void {
  const loader = new TextureLoader();
  const base = import.meta.env.BASE_URL;
  const attempt = (index: number) => {
    if (index >= urls.length) {
      onFail();
      return;
    }
    loader.load(
      `${base}textures/${urls[index]}`,
      (tex) => onLoad(prepare(tex, srgb)),
      undefined,
      () => attempt(index + 1),
    );
  };
  attempt(0);
}

export function createEarth(mobile: boolean): EarthBundle {
  const group = new Group();
  const geo = new SphereGeometry(1, mobile ? 96 : 128, mobile ? 64 : 96);
  const sunDir = { value: new Vector3(1, 0, 0) };
  const mix = { value: 0 };

  const dayLo = blank([12, 32, 64], true);
  const nightLo = blank([0, 0, 0], true);
  const cloudsLo = blank([0, 0, 0], false);
  const dayHi = blank([12, 32, 64], true);
  const nightHi = blank([0, 0, 0], true);
  const cloudsHi = blank([0, 0, 0], false);

  const surface = new ShaderMaterial({
    uniforms: {
      uDayLo: { value: dayLo },
      uDayHi: { value: dayHi },
      uNightLo: { value: nightLo },
      uNightHi: { value: nightHi },
      uCloudsLo: { value: cloudsLo },
      uCloudsHi: { value: cloudsHi },
      uMix: mix,
      uSunDir: sunDir,
    },
    vertexShader: vertex,
    fragmentShader: surfaceFragment,
  });
  group.add(new Mesh(geo, surface));

  const clouds = new ShaderMaterial({
    uniforms: {
      uCloudsLo: { value: cloudsLo },
      uCloudsHi: { value: cloudsHi },
      uMix: mix,
      uSunDir: sunDir,
    },
    vertexShader: vertex,
    fragmentShader: cloudFragment,
    transparent: true,
    depthWrite: false,
    side: FrontSide,
  });
  const cloudMesh = new Mesh(geo, clouds);
  cloudMesh.scale.setScalar(1.006);
  cloudMesh.renderOrder = 1;
  group.add(cloudMesh);

  const haze = new ShaderMaterial({
    uniforms: { uSunDir: sunDir },
    vertexShader: vertex,
    fragmentShader: hazeFragment,
    transparent: true,
    depthWrite: false,
    side: FrontSide,
  });
  const hazeMesh = new Mesh(geo, haze);
  hazeMesh.scale.setScalar(1.012);
  hazeMesh.renderOrder = 2;
  group.add(hazeMesh);

  const limb = new ShaderMaterial({
    uniforms: { uSunDir: sunDir },
    vertexShader: vertex,
    fragmentShader: limbFragment,
    transparent: true,
    depthWrite: false,
    side: BackSide,
    blending: AdditiveBlending,
  });
  const limbMesh = new Mesh(geo, limb);
  limbMesh.scale.setScalar(1.028);
  limbMesh.renderOrder = 3;
  group.add(limbMesh);

  const owned = new Set<Texture>([dayLo, nightLo, cloudsLo, dayHi, nightHi, cloudsHi]);
  const thumbs = new Map<string, Texture>();
  const hi = new Map<string, Texture>();
  let fading = false;
  let fadeDone = false;

  const bind = (slot: 'Lo' | 'Hi', key: 'Day' | 'Night' | 'Clouds', tex: Texture) => {
    const name = `u${key}${slot}`;
    surface.uniforms[name]!.value = tex;
    if (key === 'Clouds') clouds.uniforms[name]!.value = tex;
    owned.add(tex);
  };

  const startFade = () => {
    if (fading || fadeDone || hi.size < 3) return;
    fading = true;
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / 300);
      mix.value = t;
      requestRender();
      if (t < 1) {
        requestAnimationFrame(step);
        return;
      }
      fadeDone = true;
      for (const key of ['Day', 'Night', 'Clouds'] as const) {
        const tex = hi.get(key);
        if (!tex) continue;
        bind('Lo', key, tex);
      }
      for (const tex of thumbs.values()) {
        if ([...hi.values()].includes(tex)) continue;
        owned.delete(tex);
        tex.dispose();
      }
      thumbs.clear();
    };
    requestAnimationFrame(step);
  };

  const base = import.meta.env.BASE_URL;
  const loader = new TextureLoader();
  const thumbName = {
    Day: 'earth_day_1k.jpg',
    Night: 'earth_night_1k.jpg',
    Clouds: 'earth_clouds_1k.jpg',
  } as const;

  (['Day', 'Night', 'Clouds'] as const).forEach((key) => {
    const srgb = key !== 'Clouds';
    loader.load(`${base}textures/${thumbName[key]}`, (tex) => {
      prepare(tex, srgb);
      thumbs.set(key, tex);
      bind('Lo', key, tex);
      if (!hi.has(key)) bind('Hi', key, tex);
      requestRender();
    });
  });

  const names = hiResNames(mobile);
  const chains = { Day: names.day, Night: names.night, Clouds: names.clouds } as const;
  (['Day', 'Night', 'Clouds'] as const).forEach((key) => {
    loadFirst(
      chains[key],
      key !== 'Clouds',
      (tex) => {
        hi.set(key, tex);
        bind('Hi', key, tex);
        requestRender();
        startFade();
      },
      () => {
        const thumb = thumbs.get(key);
        if (thumb) {
          hi.set(key, thumb);
          startFade();
        }
      },
    );
  });

  const sun = new DirectionalLight(0xffffff, 1.15);
  sun.position.set(10, 0, 0);
  const ambient = new AmbientLight(0xffffff, 0.02);

  return {
    group,
    sun,
    ambient,
    dispose() {
      geo.dispose();
      surface.dispose();
      clouds.dispose();
      haze.dispose();
      limb.dispose();
      for (const tex of owned) tex.dispose();
    },
  };
}
