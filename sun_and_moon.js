import * as T from "../libs/threeJS/build/three.module.js";
import { GrObject } from "../libs/framework/GrObject.js";

// =======================
//  SUN SHADERS (Unchanged - unused in prototype)
// =======================
//this shader has been generated with the help of copilot
const SUN_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
//this shader has been generated with the help of copilot
const SUN_FRAGMENT_SHADER = `
uniform float uTime;
uniform float uIntensity;
varying vec2 vUv;

void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    float square = step(max(abs(uv.x), abs(uv.y)), 0.5);
    float border = max(abs(uv.x), abs(uv.y));
    float glow = 1.0 - smoothstep(0.5, 1.2, border);
    float waves = sin(border * 20.0 - uTime * 1.5) * 0.1;
    vec3 coreColor = vec3(1.2, 1.0, 0.55);
    vec3 glowColor = vec3(1.0, 0.7, 0.2);
    vec3 col = coreColor * square;
    col += glowColor * glow * (0.6 + waves);
    col *= uIntensity;
    float alpha = square + glow * 0.8;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha);
}
`;

// =======================
//  MOON SHADERS
// =======================
//this shader has been generated with the help of copilot
const MOON_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
//this shader has been generated with the help of copilot
const MOON_FRAGMENT_SHADER = `
uniform float uTime;
uniform float uIntensity;
varying vec2 vUv;
float rand(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233))) * 43758.5453); }
void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    float square = step(max(abs(uv.x), abs(uv.y)), 0.5);
    float border = max(abs(uv.x), abs(uv.y));
    float glow = 1.0 - smoothstep(0.5, 1.3, border);
    float pulse = 0.9 + 0.1 * sin(uTime * 0.3);
    float grain = rand(vUv + uTime * 0.1) * 0.05;
    vec3 col = vec3(0.95, 0.96, 1.0) * square * pulse;
    col += vec3(0.4, 0.5, 1.0) * glow * 0.5;
    col += grain;
    col *= uIntensity;
    float alpha = square + glow * 0.7;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha);
}
`;

// =======================
//  SKY / STARS SHADERS
// =======================
//this shader has been generated with the help of copilot
const SKY_FRAGMENT_SHADER = `
uniform vec3 uSkyColor;
void main() {
  gl_FragColor = vec4(uSkyColor, 1.0);
}
`;
//this shader has been generated with the help of copilot
const SKY_VERTEX_SHADER = `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
//this shader has been generated with the help of copilot
const STARS_VERTEX_SHADER = `
attribute float aPhase;
uniform float uTime;
uniform float uNightFactor;
varying float vAlpha;
void main() {
  float tw = 0.5 + 2.0 * sin(uTime * 0.4 + aPhase * 6.2831);
  float base = mix(0.7, 1.0, tw);
  vAlpha = base * uNightFactor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = 1.8;
}
`;
//this shader has been generated with the help of copilot
const STARS_FRAGMENT_SHADER = `
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  if (dot(c, c) > 1.0) discard;
  gl_FragColor = vec4(vec3(1.0), vAlpha);
}
`;

//this class has been generated with the help of copilot
export class GrSunAndMoon extends GrObject {
  constructor(
    world,
    voxelWorld,
    {
      radius = 500,
      sunSize = 90,
      moonSize = 90,
      sunBase = 1.5,
      moonBase = 0.5,
    } = {}
  ) {
    const group = new T.Group();
    super("GrSunAndMoon", group);

    this.world = world;
    this.radius = radius;
    this.sunSize = sunSize;
    this.moonSize = moonSize;
    this.sunBase = sunBase;
    this.moonBase = moonBase;
    this.voxelWorld = voxelWorld;

    // -----------------------------
    // Lights (No changes needed for prototype)
    // -----------------------------
    this.sunLight = new T.DirectionalLight(0xffffff, 1);
    group.add(this.sunLight);

    this.moonLight = new T.DirectionalLight(0x9bb0ff, 0);
    group.add(this.moonLight);

    // -----------------------------
    // Sun mesh (Switch to BasicMaterial in Prototype)
    // -----------------------------
    const sunGeom = new T.PlaneGeometry(sunSize, sunSize);

    // ⭐ PATCH: Material Selection
    if (window.prototype) {
      this.sunMat = new T.MeshBasicMaterial({
        color: 0xffff00, // Simple yellow sun
        transparent: true,
        opacity: 1.0,
        depthWrite: false,
        side: T.FrontSide, // Plane faces camera
      });
    } else {
      this.sunMat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uIntensity: { value: 0 },
        },
        vertexShader: SUN_VERTEX_SHADER,
        fragmentShader: SUN_FRAGMENT_SHADER,
      });
    }
    this.sunMesh = new T.Mesh(sunGeom, this.sunMat);

    // -----------------------------
    // Moon mesh (Switch to BasicMaterial in Prototype)
    // -----------------------------
    const moonGeom = new T.PlaneGeometry(moonSize, moonSize);

    // ⭐ PATCH: Material Selection
    if (window.prototype) {
      this.moonMat = new T.MeshBasicMaterial({
        color: 0xdddddd, // Grey/White moon
        transparent: true,
        opacity: 1.0,
        depthWrite: false,
        side: T.FrontSide,
      });
    } else {
      this.moonMat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uIntensity: { value: 0 },
        },
        vertexShader: MOON_VERTEX_SHADER,
        fragmentShader: MOON_FRAGMENT_SHADER,
      });
    }
    this.moonMesh = new T.Mesh(moonGeom, this.moonMat);

    // -----------------------------
    // Stars as points geometry
    // -----------------------------
    const starCount = 2000;
    const starGeom = new T.BufferGeometry();
    const positions = new Float32Array(starCount * 3);
    const phases = new Float32Array(starCount);

    for (let i = 0; i < starCount; i++) {
      let x, y, z, len2;
      do {
        x = Math.random() * 2 - 1;
        y = Math.random() * 2 - 1;
        z = Math.random() * 2 - 1;
        len2 = x * x + y * y + z * z;
      } while (len2 < 0.2 || len2 > 1.0);

      const len = Math.sqrt(len2);
      x /= len;
      y /= len;
      z /= len;

      const r = this.radius * 0.95;
      positions[i * 3 + 0] = x * r;
      positions[i * 3 + 1] = y * r;
      positions[i * 3 + 2] = z * r;

      phases[i] = Math.random();
    }

    starGeom.setAttribute("position", new T.BufferAttribute(positions, 3));
    starGeom.setAttribute("aPhase", new T.BufferAttribute(phases, 1));

    // ⭐ PATCH: Material Selection for Stars
    if (window.prototype) {
      this.starMat = new T.PointsMaterial({
        color: 0xffffff,
        size: 2.5,
        sizeAttenuation: false, // matches gl_PointSize behavior roughly
        transparent: true,
        opacity: 0,
      });
    } else {
      this.starMat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uNightFactor: { value: 0 },
        },
        vertexShader: STARS_VERTEX_SHADER,
        fragmentShader: STARS_FRAGMENT_SHADER,
      });
    }

    this.starPoints = new T.Points(starGeom, this.starMat);

    // -----------------------------
    // Sky dome with stars
    // -----------------------------
    const skyGeom = new T.SphereGeometry(radius * 0.98, 32, 16);

    // ⭐ PATCH: Sky Material
    if (window.prototype) {
      this.skyMat = new T.MeshBasicMaterial({
        color: 0x000000,
        side: T.BackSide,
        depthWrite: false,
      });
    } else {
      this.skyMat = new T.ShaderMaterial({
        side: T.BackSide,
        transparent: false,
        uniforms: {
          uSkyColor: { value: new T.Color("#000000") },
          uTime: { value: 0 },
          uNightFactor: { value: 0 },
        },
        fragmentShader: SKY_FRAGMENT_SHADER,
        vertexShader: SKY_VERTEX_SHADER,
        depthWrite: false,
      });
    }

    this.skyMesh = new T.Mesh(skyGeom, this.skyMat);
    this.skyMesh.add(this.moonMesh);
    this.skyMesh.add(this.sunMesh);
    this.skyMesh.add(this.starPoints);
    group.add(this.skyMesh);

    // -----------------------------
    // Sky colors
    // -----------------------------
    this.colors = {
      sunrise: new T.Color("#f8c89d"),
      noon: new T.Color("#87CEEB"),
      sunset: new T.Color("#ff9a5c"),
      night: new T.Color("#02030b"),
    };
  }

  smoothStepEdge(a, b, t) {
    const x = T.MathUtils.clamp((t - a) / (b - a), 0, 1);
    return x * x * (3 - 2 * x);
  }

  computeSkyColor(time) {
    time = ((time % 24) + 24) % 24;
    const { sunrise, noon, sunset, night } = this.colors;
    let c;
    if (time < 4 || time >= 20) {
      c = night.clone();
    } else if (time < 6) {
      const t = this.smoothStepEdge(4, 6, time);
      c = night.clone().lerp(sunrise, t);
    } else if (time < 8) {
      const t = this.smoothStepEdge(6, 8, time);
      c = sunrise.clone().lerp(noon, t);
    } else if (time < 16) {
      c = noon.clone();
    } else if (time < 18) {
      const t = this.smoothStepEdge(16, 18, time);
      c = noon.clone().lerp(sunset, t);
    } else {
      const t = this.smoothStepEdge(18, 20, time);
      c = sunset.clone().lerp(night, t);
    }
    return c;
  }

  computeSunStrength(time) {
    return Math.max(0, 0.5 + 0.5 * Math.cos(((time - 12) * Math.PI) / 12));
  }

  computeMoonStrength(time) {
    return Math.max(0, 0.5 + 0.5 * Math.cos((time * Math.PI) / 12));
  }

  stepWorld(delta, timeOfDay) {
    if (timeOfDay < 0) timeOfDay = 0;
    if (timeOfDay >= 24) timeOfDay = timeOfDay % 24;

    const angle = ((timeOfDay - 6) / 24) * Math.PI * 2.0;
    const R = this.radius;

    // Positions (orbit)
    this.sunMesh.position.set(Math.cos(angle) * R, Math.sin(angle) * R, 0);
    this.sunLight.position.copy(this.sunMesh.position);

    this.moonMesh.position.set(
      Math.cos(angle + Math.PI) * R,
      Math.sin(angle + Math.PI) * R,
      0
    );
    this.moonLight.position.copy(this.moonMesh.position);

    // Sky dome follows camera
    const cam = this.world.camera;
    this.skyMesh.position.copy(cam.position);

    // Billboards
    this.sunMesh.lookAt(cam.position);
    this.moonMesh.lookAt(cam.position);

    // Intensities
    const sunP = this.computeSunStrength(timeOfDay);
    const moonP = this.computeMoonStrength(timeOfDay);

    this.sunLight.intensity = sunP * this.sunBase;
    this.moonLight.intensity = moonP * this.moonBase;

    // Shader uniforms OR Basic Material Props
    const dt = delta / 1000;
    const skyColor = this.computeSkyColor(timeOfDay);
    this.world.scene.background = skyColor;

    // Night factor for stars
    const nightFactor = Math.pow(this.computeMoonStrength(timeOfDay), 0.8);

    // ⭐ PATCH: Update Materials based on Mode
    if (window.prototype) {
      // Simple property updates
      this.skyMat.color.copy(skyColor);

      // Fade sun/moon/stars using opacity
      this.sunMat.opacity = sunP;
      this.moonMat.opacity = moonP;
      this.starMat.opacity = nightFactor;

      // Toggle visibility if opacity is near zero to save draw calls
      this.sunMesh.visible = sunP > 0.01;
      this.moonMesh.visible = moonP > 0.01;
      this.starPoints.visible = nightFactor > 0.01;
    } else {
      // Standard Shader Uniform Updates
      this.sunMat.uniforms.uTime.value += dt;
      this.moonMat.uniforms.uTime.value += dt;
      this.skyMat.uniforms.uTime.value += dt;

      this.sunMat.uniforms.uIntensity.value = sunP;
      this.moonMat.uniforms.uIntensity.value = moonP;

      this.skyMat.uniforms.uSkyColor.value.copy(skyColor);
      this.skyMat.uniforms.uNightFactor.value = nightFactor;

      this.starMat.uniforms.uTime.value += dt;
      this.starMat.uniforms.uNightFactor.value = nightFactor;

      this.sunMesh.visible = this.sunMesh.position.y > 0;
      this.moonMesh.visible = this.moonMesh.position.y > 0;
    }

    if (this.world.scene.fog) {
      this.world.scene.fog.color = skyColor.clone().multiplyScalar(0.9);
    }

    if (this.voxelWorld.isRaining) {
      skyColor.multiplyScalar(0.6);
      this.sunLight.intensity *= 0.6;
      this.moonLight.intensity *= 0.8;
    }
  }
}
