import * as T from "../libs/threeJS/build/three.module.js";
import { GrObject } from "../libs/framework/GrObject.js";
import { mergeGeometries } from "../libs/threeJS/examples/jsm/utils/BufferGeometryUtils.js";
import { GrTickingObject } from "./base.js";

// this class has been generated with the help of copilot
class Perlin {
  constructor() {
    this.p = new Uint8Array(512);
    for (let i = 0; i < 256; ++i) this.p[i] = i;
    for (let i = 0; i < 256; ++i) {
      const j = Math.floor(Math.random() * (256 - i)) + i;
      [this.p[i], this.p[j]] = [this.p[j], this.p[i]];
      this.p[i + 256] = this.p[i];
    }
  }
  fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  lerp(t, a, b) {
    return a + t * (b - a);
  }
  grad(hash, x, y) {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return (h & 1 ? -u : u) + (h & 2 ? -2 * v : 2 * v);
  }
  noise(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = this.fade(x),
      v = this.fade(y);
    const A = this.p[X] + Y,
      B = this.p[X + 1] + Y;
    return (
      this.lerp(
        v,
        this.lerp(
          u,
          this.grad(this.p[A], x, y),
          this.grad(this.p[B], x - 1, y)
        ),
        this.lerp(
          u,
          this.grad(this.p[A + 1], x, y - 1),
          this.grad(this.p[B + 1], x - 1, y - 1)
        )
      ) *
        0.5 +
      0.5
    );
  }
}

let cloudCounter = 0;
// this class has been generated with the help of copilot
export class GrCloud extends GrTickingObject {
  constructor({
    areaSize = 500,
    height = 140,
    scale = 0.03,
    threshold = 0.55,
    blockSize = 4,
    speed = 0.2, // cloud speed in world units/sec
    world,
  } = {}) {
    const group = new T.Group();
    super(`GrCloud-${cloudCounter++}`, group);

    this.group = group;
    this.areaSize = areaSize;
    this.height = height;
    this.scale = scale;
    this.threshold = threshold;
    this.blockSize = blockSize;
    this.speed = speed;
    this.world = world;

    this.noise = new Perlin();
    this.windOffset = 0;

    // Generate geometry once
    this.cloudMesh = this.generateClouds(0);
    group.add(this.cloudMesh);
    this.regenAccumulator = 0;
    this.regenInterval = 1.0; // update clouds every 0.15s (≈6 fps)
    this.rideable = group;
  }

  generateClouds(offsetX) {
    const size = this.areaSize;
    const bs = this.blockSize;

    const cols = Math.floor(size / bs);
    const rows = Math.floor(size / bs);
    const height = 1; // single cloud layer (y = 0)

    // 3D voxel grid: vox[y][z][x]
    const vox = [];
    for (let y = 0; y < height; y++) {
      const layer = [];
      for (let z = 0; z < rows; z++) {
        const row = new Array(cols).fill(false);
        layer.push(row);
      }
      vox.push(layer);
    }

    // Fill grid using noise
    for (let z = 0; z < rows; z++) {
      for (let x = 0; x < cols; x++) {
        const wx = x * bs;
        const wz = z * bs;

        const nx = wx * this.scale + offsetX;
        const nz = wz * this.scale;

        const n = this.noise.noise(nx, nz);
        if (n > this.threshold) {
          vox[0][z][x] = true;
        }
      }
    }

    // Face definitions (same pattern as typical chunk mesher)
    const faces = [
      // +X
      {
        dir: [1, 0, 0],
        corners: [
          [1, 0, 0],
          [1, 0, 1],
          [1, 1, 1],
          [1, 1, 0],
        ],
      },
      // -X
      {
        dir: [-1, 0, 0],
        corners: [
          [0, 0, 1],
          [0, 0, 0],
          [0, 1, 0],
          [0, 1, 1],
        ],
      },
      // +Y (top)
      {
        dir: [0, 1, 0],
        corners: [
          [0, 1, 1],
          [1, 1, 1],
          [1, 1, 0],
          [0, 1, 0],
        ],
      },
      // -Y (bottom)
      {
        dir: [0, -1, 0],
        corners: [
          [0, 0, 0],
          [1, 0, 0],
          [1, 0, 1],
          [0, 0, 1],
        ],
      },
      // +Z
      {
        dir: [0, 0, 1],
        corners: [
          [0, 0, 1],
          [1, 0, 1],
          [1, 1, 1],
          [0, 1, 1],
        ],
      },
      // -Z
      {
        dir: [0, 0, -1],
        corners: [
          [1, 0, 0],
          [0, 0, 0],
          [0, 1, 0],
          [1, 1, 0],
        ],
      },
    ];

    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    let indexOffset = 0;

    const pushVertex = (vx, vy, vz, nx, ny, nz) => {
      positions.push(vx, vy, vz);
      normals.push(nx, ny, nz);
      // simple UVs (tile per block); can be anything for now
      uvs.push(0, 0);
    };

    const isSolid = (x, y, z) => {
      if (y < 0 || y >= height) return false;
      if (z < 0 || z >= rows) return false;
      if (x < 0 || x >= cols) return false;
      return vox[y][z][x];
    };

    // Build faces
    for (let y = 0; y < height; y++) {
      for (let z = 0; z < rows; z++) {
        for (let x = 0; x < cols; x++) {
          if (!vox[y][z][x]) continue;

          const wx = x * bs - size / 2;
          const wy = this.height; // fixed layer height
          const wz = z * bs - size / 2;

          for (const face of faces) {
            const [dx, dy, dz] = face.dir;
            const nx = x + dx;
            const ny = y + dy;
            const nz = z + dz;

            // only add face if neighbor is empty (air)
            if (isSolid(nx, ny, nz)) continue;

            const baseIndex = indexOffset;

            for (const c of face.corners) {
              const cx = c[0];
              const cy = c[1];
              const cz = c[2];

              const vx = wx + cx * bs;
              const vy = wy + cy * bs;
              const vz = wz + cz * bs;

              pushVertex(vx, vy, vz, dx, dy, dz);
            }

            // two triangles per face (0,1,2) (0,2,3)
            indices.push(
              baseIndex,
              baseIndex + 1,
              baseIndex + 2,
              baseIndex,
              baseIndex + 2,
              baseIndex + 3
            );

            indexOffset += 4;
          }
        }
      }
    }

    const geom = new T.BufferGeometry();
    geom.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
    geom.setAttribute("normal", new T.Float32BufferAttribute(normals, 3));
    geom.setAttribute("uv", new T.Float32BufferAttribute(uvs, 2));
    geom.setIndex(indices);

    geom.computeBoundingSphere();

    const mat = new T.MeshLambertMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      flatShading: true,
    });

    const mesh = new T.Mesh(geom, mat);
    mesh.frustumCulled = false;

    return mesh;
  }

  stepTick(delta) {
    const dt = delta / 1000; // convert ms → seconds
    this.windOffset += dt * this.speed;

    // accumulate time
    this.regenAccumulator += dt;

    const cam = this.world.camera;

    // ✅ LOCK CLOUDS TO CAMERA HORIZONTALLY
    this.group.position.x = cam.position.x;
    this.group.position.z = cam.position.z;
    this.group.position.y = this.height; // keep height constant

    // regenerate only when enough time passes
    if (this.regenAccumulator >= this.regenInterval) {
      this.regenAccumulator = 0;

      // remove old cloud mesh
      this.group.remove(this.cloudMesh);
      this.cloudMesh.geometry.dispose();

      // rebuild with new offset
      this.cloudMesh = this.generateClouds(this.windOffset);
      this.group.add(this.cloudMesh);
    }
  }
}
