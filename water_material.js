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
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 wpos = wp.xyz;

  float k1 = 0.08; float k2 = 0.05; float amp = 0.0; 
  float s1 = 0.8; float s2 = 0.6;
  float t1 = wpos.x * k1 + uTime * s1;
  float t2 = wpos.z * k2 + uTime * s2;
  float waveX = sin(t1); float waveZ = cos(t2);
  float h = (waveX + waveZ) * amp;
  wpos.y += h;

  float dhdx = amp * k1 * cos(t1);
  float dhdz = -amp * k2 * sin(t2);
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
  float ndv = max(dot(N, V), 0.0);
  float fres = pow(1.0 - ndv, 4.0);
  fres = clamp(fres, 0.0, 1.0);
  float baseReflect = 0.35;
  float reflectFactor = clamp(baseReflect + fres * 0.75, 0.0, 1.0);
  vec3 baseColor = uTint * 1.4;
  vec3 R = reflect(-V, N);
  vec2 distort = sin(vWorldPos.xz * 0.3 + vUv * 20.0) * 0.05;
  R.xy += distort;
  vec3 env = textureCube(uEnvMap, R).rgb;
  vec3 color = mix(baseColor, env, reflectFactor * uEnvStrength);
  vec3 L = normalize(vec3(0.2, 1.0, 0.1));
  vec3 H = normalize(V + L);
  float spec = pow(max(dot(N, H), 0.0), 80.0);
  color += spec * 0.55;
  gl_FragColor = vec4(color, 0.85);
}
`;

//this function has been generated with the help of copilot
export function createWaterMaterial(envMap, atlasTexture) {
  // ⭐ PATCH 1: Simple Material for Prototype Mode
  if (window.prototype) {
    return new T.MeshBasicMaterial({
      color: 0x3a76ff, // Standard water blue
      transparent: true,
      opacity: 0.6, // See-through
      side: T.FrontSide, // Or DoubleSide if you prefer
      depthWrite: false, // Important for transparent objects
    });
  }

  // Normal Mode: Fancy Shader
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

    // ⭐ PATCH 2: Disable Probe Creation in Prototype Mode
    if (window.prototype) {
      return; // Don't create cameras or render targets
    }

    this.renderTarget = new T.WebGLCubeRenderTarget(256, {
      format: T.RGBAFormat,
      generateMipmaps: true,
      minFilter: T.LinearMipmapLinearFilter,
    });

    this.cubeCamera = new T.CubeCamera(1, 2000, this.renderTarget);
    this.world.scene.add(this.cubeCamera);
  }

  stepTick(delta) {
    // ⭐ PATCH 3: Disable Updates in Prototype Mode
    if (window.prototype) return;

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
