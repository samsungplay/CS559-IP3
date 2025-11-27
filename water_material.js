import { GrObject } from "../libs/framework/GrObject.js";
import * as T from "../libs/threeJS/build/three.module.js";
import { GrTickingObject } from "./base.js";

//this shader has been generated with the help of copilot
const WATER_VERTEX_SHADER = `
uniform float uTime;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;

void main() {
  vUv = uv;

  // Start from world-space position so waves are continuous across chunks
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 wpos = wp.xyz;

  // Wave parameters
  float k1 = 0.08;      // spatial frequency X
  float k2 = 0.05;      // spatial frequency Z
  float amp = 0.0;      // amplitude (height of waves)
  float s1 = 0.8;       // speed 1
  float s2 = 0.6;       // speed 2

  float t1 = wpos.x * k1 + uTime * s1;
  float t2 = wpos.z * k2 + uTime * s2;

  float waveX = sin(t1);
  float waveZ = cos(t2);

  // height offset
  float h = (waveX + waveZ) * amp;
  wpos.y += h;

  // approximate gradient of the height field
  float dhdx = amp * k1 * cos(t1);
  float dhdz = -amp * k2 * sin(t2);

  // normal from gradient (slope in x/z)
  vec3 N = normalize(vec3(-dhdx, 1.0, -dhdz));

  vNormal = N;
  vWorldPos = wpos;

  gl_Position = projectionMatrix * viewMatrix * vec4(wpos, 1.0);
}
`;
//this shader has been generated with the help of copilot
const WATER_FRAGMENT_SHADER = `
uniform samplerCube uEnvMap;
uniform vec3 uTint;
uniform float uEnvStrength;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);

  // Fresnel, but we won't rely only on it
  float ndv = max(dot(N, V), 0.0);
  float fres = pow(1.0 - ndv, 4.0);     // boost edges
  fres = clamp(fres, 0.0, 1.0);

  // Always some reflection, even straight-on
  float baseReflect = 0.35;             // constant reflection
  float reflectFactor = clamp(baseReflect + fres * 0.75, 0.0, 1.0);

  // Base water color
  vec3 baseColor = uTint * 1.4;         // brighten a bit

  // Reflection vector, distorted by waves / UV
  vec3 R = reflect(-V, N);

  // small distortion based on UV (tile-wise) and world position
  vec2 distort = sin(vWorldPos.xz * 0.3 + vUv * 20.0) * 0.05;
  R.xy += distort;

  vec3 env = textureCube(uEnvMap, R).rgb;

  // Mix in env map using boosted reflection factor and uniform env strength
  vec3 color = mix(baseColor, env, reflectFactor * uEnvStrength);

  // Strong sun glint for extra "fancy"
  vec3 L = normalize(vec3(0.2, 1.0, 0.1));   // sun direction
  vec3 H = normalize(V + L);
  float spec = pow(max(dot(N, H), 0.0), 80.0);
  color += spec * 0.55;                      // tweak strength as you like

  gl_FragColor = vec4(color, 0.85);
}
`;

//this function has been generated with the help of copilot
export function createWaterMaterial(envMap, atlasTexture) {
  return new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uEnvMap: { value: envMap },
      uAtlas: { value: atlasTexture },
      uTint: { value: new T.Color(0x3a76ff) },
      uEnvStrength: { value: 0.8 },
    },
    vertexShader: WATER_VERTEX_SHADER,
    fragmentShader: WATER_FRAGMENT_SHADER,
  });
}

//this class has been generated with the help of copilot
export class GrWaterEnvProbe extends GrTickingObject {
  constructor(world, voxelWorld) {
    const group = new T.Group();
    super("WaterEnvProbe", group);

    this.world = world;
    this.voxelWorld = voxelWorld;

    this.renderTarget = new T.WebGLCubeRenderTarget(256, {
      format: T.RGBAFormat,
      generateMipmaps: true,
      minFilter: T.LinearMipmapLinearFilter,
    });

    this.cubeCamera = new T.CubeCamera(1, 2000, this.renderTarget);
    this.world.scene.add(this.cubeCamera);
  }

  stepTick(delta) {
    const renderer = this.world.renderer;
    const scene = this.world.scene;
    const mainCam = this.world.camera;

    // place probe at player/camera height (or average water level)
    this.cubeCamera.position.copy(mainCam.position);

    // hide water meshes to avoid "hall of mirrors" reflections
    const hidden = [];
    this.voxelWorld.renderChunks.forEach((renderChunk) => {
      if (renderChunk._waterMesh) {
        hidden.push(renderChunk._waterMesh);
        renderChunk._waterMesh.visible = false;
      }
    });

    this.cubeCamera.update(renderer, scene);

    // restore water visibility
    hidden.forEach((m) => (m.visible = true));
  }
}
