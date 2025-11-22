import { BLOCK } from "./block_registry.js";
import { CHUNK_SIZE, Y_MIN, Y_MAX } from "./voxel_engine.js";

/**
 * Deterministic hash → [0,1)
 * Keeps results stable across runs for a given seed and position.
 */
//this function has been generated with the help of copilot
function rand01(x, y, z, seed) {
  // 32-bit mix (mul/rot/xor style), fast and repeatable
  let h = (seed | 0) ^ (x * 374761393 + y * 668265263 + z * 362437);
  h = (h ^ (h >>> 13)) * 1274126177;
  h ^= h >>> 16;
  // >>> 0 to keep as uint, then /2^32 to [0,1)
  return (h >>> 0) / 4294967296;
}

/**
 * Find the topmost non-AIR Y for a column (x,z) in this chunk.
 * Returns -Infinity if the column is all air.
 */
//this function has been generated with the help of copilot
function findTopY(chunk, x, z) {
  for (let y = Y_MAX; y >= Y_MIN; y--) {
    const id = chunk.getBlock(x, y, z);
    if (id !== BLOCK.AIR) return y;
  }
  return -Infinity;
}

/**
 * Quick "is this column gentle enough" test using neighbor tops.
 */
//this function has been generated with the help of copilot
function isGentleSlope(topMap, x, z, maxDelta = 2) {
  const self = topMap[x][z];
  const deltas = [];
  if (x > 0) deltas.push(Math.abs(self - topMap[x - 1][z]));
  if (x + 1 < CHUNK_SIZE) deltas.push(Math.abs(self - topMap[x + 1][z]));
  if (z > 0) deltas.push(Math.abs(self - topMap[x][z - 1]));
  if (z + 1 < CHUNK_SIZE) deltas.push(Math.abs(self - topMap[x][z + 1]));
  return deltas.length ? Math.max(...deltas) <= maxDelta : true;
}

/**
 * Cluster helper: makes natural-looking patches by grouping 8×8 world tiles.
 */
//this function has been generated with the help of copilot
function clusterFactor(wx, wz, seed) {
  const cellX = Math.floor(wx / 8);
  const cellZ = Math.floor(wz / 8);
  const r = rand01(cellX, 0, cellZ, seed ^ 0x49f3ac21);
  // 30% rich patches, 40% medium, 30% sparse
  return r < 0.3 ? 1.6 : r < 0.7 ? 0.9 : 0.4;
}

/**
 * Places: GRASS (tall grass), ROSE, DANDELION on gentle grassy ground,
 * and RED_MUSHROOM/BROWN_MUSHROOM in darker/underground pockets.
 *
 * Call this AFTER terrain (and ideally after villages/trees), per chunk.
 *
 * @param {VoxelChunk} chunk
 * @param {number} seed - world seed
 * @param {object} [opts]
 *   - forbid(wx, wz): optional predicate to skip (e.g., village footprint)
 *   - grassRate, flowerRate, mushroomRate: base probabilities
 */
//this function has been generated with the help of copilot
export function placeVegetationForChunk(chunk, seed, opts = {}) {
  const forbid = opts.forbid || (() => false);

  // Base probabilities per suitable tile (tuned for ~16×16 chunks)
  const grassRate = opts.grassRate ?? 0.05; // tall grass
  const flowerRate = opts.flowerRate ?? 0.01; // split into rose / dandelion
  const mushroomRate = opts.mushroomRate ?? 0.1;

  const wx0 = chunk.chunkX * CHUNK_SIZE;
  const wz0 = chunk.chunkZ * CHUNK_SIZE;

  // Precompute tops for slope + quick access
  const topMap = Array.from({ length: CHUNK_SIZE }, () =>
    new Array(CHUNK_SIZE).fill(-Infinity)
  );
  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      topMap[x][z] = findTopY(chunk, x, z);
    }
  }

  let placedGrass = 0,
    placedFlowers = 0,
    placedMush = 0;

  // -------- Surface plants (GRASS / ROSE / DANDELION) --------
  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const wy = topMap[x][z];
      if (!Number.isFinite(wy)) continue;
      if (wy + 1 > Y_MAX) continue;

      const ground = chunk.getBlock(x, wy, z);
      const above = chunk.getBlock(x, wy + 1, z);

      // Only on grassy ground, empty above, not on tree tops/leaves/sand/gravel/water
      if (ground !== BLOCK.GRASS_BLOCK || above !== BLOCK.AIR) {
        continue;
      }

      // avoid steep slopes; skip columns topped with leaves (tree canopies)
      if (!isGentleSlope(topMap, x, z, 2)) continue;

      const wx = wx0 + x;
      const wz = wz0 + z;
      if (forbid(wx, wz)) continue;

      // Clustered density
      const patch = clusterFactor(wx, wz, seed);

      // Choose what to place
      const r = rand01(wx, wy + 1, wz, seed ^ 0x8d2f3b77);

      // Slightly higher chance for grass than flowers
      if (r < grassRate * patch) {
        chunk.setBlock(x, wy + 1, z, BLOCK.GRASS);
        placedGrass++;
      } else if (r < (grassRate + flowerRate) * patch) {
        const r2 = rand01(wx, wy + 2, wz, seed ^ 0x2153a1c9);
        chunk.setBlock(x, wy + 1, z, r2 < 0.5 ? BLOCK.ROSE : BLOCK.DANDELION);
        placedFlowers++;
      }
    }
  }

  // -------- Underground mushrooms --------
  // For each column, probe a small vertical band below the surface looking for
  // a "dark-ish" pocket: solid floor, air above, not clearly open to sky.
  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const topY = topMap[x][z];
      if (!Number.isFinite(topY)) continue;

      // Only bother if there’s some depth to play with.
      const yStart = Math.max(Y_MIN + 2, topY - 14);
      const yEnd = Math.max(Y_MIN + 1, topY - 3);

      const wx = wx0 + x;
      const wz = wz0 + z;

      // low probability per column → prevents overpopulation
      if (rand01(wx, topY, wz, seed ^ 0x5c11b007) >= mushroomRate) continue;

      // scan down a bit for a dark pocket
      for (let y = yEnd; y >= yStart; y--) {
        const here = chunk.getBlock(x, y, z);
        const above = chunk.getBlock(x, y + 1, z);
        if (above !== BLOCK.AIR) continue;

        // solid-ish floor (avoid liquids and air)
        if (here === BLOCK.AIR || here === BLOCK.WATER || here === BLOCK.LAVA) {
          continue;
        }

        // quick sky-occlusion test: if the next ~8 blocks above are all AIR,
        // treat as "too bright"; otherwise "dark enough".
        let skyOpen = true;
        const cap = Math.min(Y_MAX, y + 8);
        for (let yy = y + 2; yy <= cap; yy++) {
          if (chunk.getBlock(x, yy, z) !== BLOCK.AIR) {
            skyOpen = false;
            break;
          }
        }
        if (skyOpen) continue; // likely outdoors → skip mushrooms

        // place one mushroom and stop scanning this column
        const pick =
          rand01(wx, y, wz, seed ^ 0x0db19f2a) < 0.5
            ? BLOCK.RED_MUSHROOM
            : BLOCK.BROWN_MUSHROOM;
        chunk.setBlock(x, y + 1, z, pick);
        placedMush++;
        break;
      }
    }
  }

  return { grass: placedGrass, flowers: placedFlowers, mushrooms: placedMush };
}
