import { CHUNK_SIZE, Y_MIN, Y_MAX } from "./voxel_engine.js";
import { BLOCK } from "./block_registry.js";
import {
  placeSmallHouse,
  placeLargeHouse,
  placeFarmPlot,
  placeWell,
  placeBlacksmith,
  placeLonghouse,
  placeMarketStall,
  placeWatchtower,
} from "./structures.js";
import { PendingBlocks } from "./structures.js";
export const pendingBlocks = new PendingBlocks();
import { flushPendingForChunk, makeBlockWriter } from "./structures.js";
import { placeVegetationForChunk } from "./vegetations.js";

//this function has beeen generated with the help of copilot
/** -------------------- Seeded Perlin (2D/3D) -------------------- */
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
//this function has beeen generated with the help of copilot
function makePerlin(seed = 1337) {
  const rand = mulberry32(seed);
  const p = new Uint8Array(512);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = perm[i];
    perm[i] = perm[j];
    perm[j] = tmp;
  }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];

  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  const grad2 = (h, x, y) => (h & 1 ? -x : x) + (h & 2 ? -y : y);
  const grad3 = (h, x, y, z) =>
    (h & 1 ? -x : x) + (h & 2 ? -y : y) + (h & 4 ? -z : z);

  function perlin2(x, y, scale = 1) {
    x *= scale;
    y *= scale;
    const X = Math.floor(x) & 255,
      Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x),
      yf = y - Math.floor(y);
    const u = fade(xf),
      v = fade(yf);
    const aa = p[X + p[Y]],
      ab = p[X + p[Y + 1]];
    const ba = p[X + 1 + p[Y]],
      bb = p[X + 1 + p[Y + 1]];
    const x1 = lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u);
    const x2 = lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v); // ~[-1,1]
  }
  function perlin3(x, y, z, scale = 1) {
    x *= scale;
    y *= scale;
    z *= scale;
    const X = Math.floor(x) & 255,
      Y = Math.floor(y) & 255,
      Z = Math.floor(z) & 255;
    const xf = x - Math.floor(x),
      yf = y - Math.floor(y),
      zf = z - Math.floor(z);
    const u = fade(xf),
      v = fade(yf),
      w = fade(zf);
    const A = p[X] + Y,
      B = p[X + 1] + Y;
    const AA = p[A] + Z,
      AB = p[A + 1] + Z;
    const BA = p[B] + Z,
      BB = p[B + 1] + Z;

    const x1 = lerp(grad3(p[AA], xf, yf, zf), grad3(p[BA], xf - 1, yf, zf), u);
    const x2 = lerp(
      grad3(p[AB], xf, yf - 1, zf),
      grad3(p[BB], xf - 1, yf - 1, zf),
      u
    );
    const y1 = lerp(x1, x2, v);

    const x3 = lerp(
      grad3(p[AA + 1], xf, yf, zf - 1),
      grad3(p[BA + 1], xf - 1, yf, zf - 1),
      u
    );
    const x4 = lerp(
      grad3(p[AB + 1], xf, yf - 1, zf - 1),
      grad3(p[BB + 1], xf - 1, yf - 1, zf - 1),
      u
    );
    const y2 = lerp(x3, x4, v);

    return lerp(y1, y2, w); // ~[-1,1]
  }

  const fbm2 = (
    x,
    y,
    { octaves = 5, lacunarity = 2.0, gain = 0.5, scale = 1 } = {}
  ) => {
    let amp = 1,
      freq = 1,
      sum = 0,
      norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * perlin2(x, y, scale * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm; // [-1,1]
  };
  const fbm3 = (
    x,
    y,
    z,
    { octaves = 4, lacunarity = 2.0, gain = 0.5, scale = 1 } = {}
  ) => {
    let amp = 1,
      freq = 1,
      sum = 0,
      norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * perlin3(x, y, z, scale * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm; // [-1,1]
  };

  return { perlin2, perlin3, fbm2, fbm3 };
}

/** ------------------- Tunables ------------------- */
//these 4 variables have beeen generated with the help of copilot
const SEA_LEVEL = 62;
const BEACH_BAND = 2;
const DIRT_THICKNESS_MIN = 3;
const DIRT_THICKNESS_MAX = 5;

/** 🎚️ Global *regional* amplitude range (varies smoothly across the world)
 *  - Each column computes a local amplitude in [AMP_MIN, AMP_MAX]
 *  - Keeps chunk seams smooth because it’s based on world-space fBm
 */
//these 2 variables have beeen generated with the help of copilot
const AMP_MIN = 1.0; // flatter basins
const AMP_MAX = 1.0; // dramatic belts

/** ------------------- Helpers ------------------- */
//this function has beeen generated with the help of copilot
const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
//this variable has beeen generated with the help of copilot
const CH = Y_MAX - Y_MIN + 1;
//this function has beeen generated with the help of copilot
const idx3 = (x, y, z) => ((y - Y_MIN) * CHUNK_SIZE + z) * CHUNK_SIZE + x;

/** ------------------- Terrain shaping (generated with the help of copilot) ------------------- */
//this function has beeen generated with the help of copilot
function isBeach(yTop) {
  return yTop >= SEA_LEVEL - BEACH_BAND && yTop <= SEA_LEVEL + BEACH_BAND;
}
//this function has beeen generated with the help of copilot
function sandHere(noise, x, z, yTop) {
  const nearWater = isBeach(yTop) || yTop <= SEA_LEVEL + 1;
  const n = noise.fbm2(x - 5555, z + 5555, {
    scale: 1 / 45,
    octaves: 3,
    gain: 0.6,
  });
  return nearWater && n > -0.15;
}
//this function has beeen generated with the help of copilot
function gravelHere(noise, x, z, yTop) {
  const slopey =
    Math.abs(noise.fbm2(x, z, { scale: 1 / 22, octaves: 2 })) > 0.45;
  const high = yTop > SEA_LEVEL + 14;
  const n = noise.fbm2(x + 2222, z - 2222, { scale: 1 / 50, octaves: 3 });
  return (slopey || high) && n > 0.3;
}
//this function has beeen generated with the help of copilot
function riverMask(noise, x, z) {
  const base = noise.fbm2(x, z, { scale: 1 / 520, octaves: 3, gain: 0.5 });
  const warpX =
    noise.fbm2(x + 3000, z - 3000, { scale: 1 / 900, octaves: 2, gain: 0.6 }) *
    60;
  const warpZ =
    noise.fbm2(x - 3000, z + 3000, { scale: 1 / 900, octaves: 2, gain: 0.6 }) *
    60;
  const m =
    1.0 -
    Math.min(
      1,
      Math.abs(
        base +
          noise.fbm2(x + warpX, z + warpZ, { scale: 1 / 700, octaves: 2 }) * 0.6
      ) * 5.0
    );
  return m * m; // [0,1]
}
//this function has beeen generated with the help of copilot
function lakeDip(noise, x, z) {
  const b = Math.abs(
    noise.fbm2(x - 7777, z + 7777, { scale: 1 / 480, octaves: 4, gain: 0.55 })
  );
  return clamp(1 - b * 10, 0, 1) * 6;
}
//this function has beeen generated with the help of copilot
function mountainBoost(noise, x, z) {
  const m = noise.fbm2(x + 911, z - 911, {
    scale: 1 / 800, // tighter → more frequent mountain zones
    octaves: 5,
    gain: 0.55,
  });
  const t = clamp((m - 0.35) / (1 - 0.35), 0, 1);
  return Math.pow(t, 1.7) * 60;
}

/** 🌋 Regional amplitude field (smooth, tectonic-style)
 * Returns a multiplier in [AMP_MIN, AMP_MAX], coherent across chunk borders.
 */
//this function has beeen generated with the help of copilot
function localAmplitude(noise, x, z) {
  // Very low-frequency “tectonic” base – decides broad belts/basins
  const tect = noise.fbm2(x + 7000, z - 7000, {
    scale: 1 / 1800,
    octaves: 3,
    gain: 0.55,
  }); // [-1,1]

  // Ridged helper: encourages sharp alpine belts
  const ridged =
    1 -
    Math.abs(
      noise.fbm2(x - 12000, z + 12000, {
        scale: 1 / 1200,
        octaves: 2,
        gain: 0.6,
      })
    ); // [0,1]

  // Blend and bias a bit toward extremes for nicer contrasts
  let r = clamp(0.6 * (tect * 0.5 + 0.5) + 0.4 * ridged, 0, 1);
  r = Math.pow(r, 1.15); // push slightly toward high-amp regions

  return AMP_MIN + (AMP_MAX - AMP_MIN) * r;
}
//this function has beeen generated with the help of copilot
function sampleHeight(noise, x, z) {
  const base = 70;

  const continents =
    noise.fbm2(x, z, { scale: 1 / 650, octaves: 4, gain: 0.45 }) * 22;
  const hills1 =
    noise.fbm2(x + 913, z - 401, { scale: 1 / 220, octaves: 4, gain: 0.5 }) *
    12;
  const hills2 =
    noise.fbm2(x - 701, z + 807, { scale: 1 / 110, octaves: 3, gain: 0.55 }) *
    7;
  const detail =
    noise.fbm2(x * 1.3, z * 1.3, { scale: 1 / 42, octaves: 3, gain: 0.6 }) * 2;

  const river = riverMask(noise, x, z) * 11;
  const lake = lakeDip(noise, x, z);

  // Mountains appear mostly inland (modulate by continents’ sign)
  const mountain =
    mountainBoost(noise, x, z) * (0.6 + 0.4 * Math.max(0, continents / 22));

  // 🎚️ Apply smooth regional amplitude
  const amp = localAmplitude(noise, x, z);

  let h =
    base +
    (continents + hills1 + hills2 + detail + mountain - river - lake) * amp;

  // Gentler ocean flattening so cliffs & coastal mountains can show up
  const oceanGate = noise.fbm2(x - 3000, z + 2000, {
    scale: 1 / 900,
    octaves: 3,
    gain: 0.5,
  });
  if (oceanGate < -0.45) h = Math.min(h, SEA_LEVEL - 4 + oceanGate * 8);

  return Math.round(clamp(h, Y_MIN + 5, Y_MAX - 1));
}

/** -------------------- SIMPLE, PER-ORE PROBABILISTIC VEINS --------------------
 * Minimal knobs:
 *  SCALE, RIDGE_STRONG/WEAK, SEED_RATE, MAX_SIZE
 * Per-ore: id, y band, weight (rarity), expandP (BFS neighbor prob)
 */
//this variable has beeen generated with the help of copilot
const ORE_PARAMS = {
  SCALE: 1 / 28,
  RIDGE_STRONG: 0.865,
  RIDGE_WEAK: 0.82,
  SEED_RATE: 0.0025,
  MAX_SIZE: 34,
};
// Gold rarest, Coal most common, Iron in-between.
//this variable has beeen generated with the help of copilot
const ORES = [
  { id: BLOCK.COAL_ORE, yMin: 12, yMax: 128, weight: 1.0, expandP: 0.45 },
  { id: BLOCK.IRON_ORE, yMin: 8, yMax: 64, weight: 0.55, expandP: 0.36 },
  { id: BLOCK.GOLD_ORE, yMin: 5, yMax: 32, weight: 0.22, expandP: 0.26 },
];

// Ridged field in [0,1] (higher → more vein-like)
//this function has beeen generated with the help of copilot
function oreRidge(noise, wx, y, wz) {
  const v = noise.fbm3(wx, y, wz, {
    scale: ORE_PARAMS.SCALE,
    octaves: 3,
    gain: 0.5,
  });
  return 1 - Math.abs(v);
}
// Triangle depth preference (0 at band edges, 1 at middle)
//this function has beeen generated with the help of copilot
function depthWeight(y, yMin, yMax) {
  const t = (y - yMin) / Math.max(1, yMax - yMin);
  return Math.max(0, 1 - Math.abs(t * 2 - 1));
}
// Deterministic per-coordinate RNG
//this function has beeen generated with the help of copilot
function coordRand(x, y, z, seed) {
  let n =
    (x * 374761393) ^ (y * 668265263) ^ (z * 2147483647) ^ (seed * 1013904223);
  n = (n ^ (n >>> 13)) * 1274126177;
  n = n ^ (n >>> 16);
  return (n >>> 0) / 4294967296;
}
// Per-seed local RNG (stable regardless of gen order)
//this function has beeen generated with the help of copilot
function makeLocalRng(wx, y, wz, oreIdx, seed) {
  let s =
    (wx * 73856093) ^
    (y * 19349663) ^
    (wz * 83492791) ^
    (oreIdx * 2654435761) ^
    seed;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

//this function has beeen generated with the help of copilot
function carveOres(chunk, noise, cx, cz, tops, seed) {
  for (let oreIdx = 0; oreIdx < ORES.length; oreIdx++) {
    const ore = ORES[oreIdx];

    // A) pick seeds on strong ridge
    const seeds = [];
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = cx + x,
          wz = cz + z;
        const topY = tops[z * CHUNK_SIZE + x];
        const yMin = Math.max(Y_MIN + 2, ore.yMin);
        const yMax = Math.min(topY, ore.yMax);
        if (yMin > yMax) continue;

        for (let y = yMin; y <= yMax; y++) {
          if (chunk.getBlock(x, y, z) !== BLOCK.STONE) continue;
          const ridge = oreRidge(noise, wx, y, wz);
          if (ridge < ORE_PARAMS.RIDGE_STRONG) continue;

          const dep = depthWeight(y, ore.yMin, ore.yMax);
          const p = ORE_PARAMS.SEED_RATE * ore.weight * dep;
          if (coordRand(wx, y, wz, seed ^ oreIdx) < p) seeds.push([x, y, z]);
        }
      }
    }

    // B) BFS expand along weak ridge with per-ore expandP
    const seen = new Set();
    const key = (x, y, z) => (y << 20) | (z << 10) | x;

    for (const [sx, sy, sz] of seeds) {
      if (chunk.getBlock(sx, sy, sz) !== BLOCK.STONE) continue;

      const wx0 = cx + sx,
        wz0 = cz + sz;
      const rng = makeLocalRng(wx0, sy, wz0, oreIdx, seed);
      const q = [[sx, sy, sz]];
      seen.add(key(sx, sy, sz));
      let placed = 0;

      while (q.length && placed < ORE_PARAMS.MAX_SIZE) {
        const [qx, qy, qz] = q.shift();

        if (chunk.getBlock(qx, qy, qz) === BLOCK.STONE) {
          chunk.setBlock(qx, qy, qz, ore.id);
          placed++;
        }

        const nbrs = [
          [qx + 1, qy, qz],
          [qx - 1, qy, qz],
          [qx, qy + 1, qz],
          [qx, qy - 1, qz],
          [qx, qy, qz + 1],
          [qx, qy, qz - 1],
        ];
        for (const [nx, ny, nz] of nbrs) {
          if (nx < 0 || nz < 0 || nx >= CHUNK_SIZE || nz >= CHUNK_SIZE)
            continue;
          if (ny < ore.yMin || ny > ore.yMax) continue;
          const k = key(nx, ny, nz);
          if (seen.has(k)) continue;
          seen.add(k);
          if (chunk.getBlock(nx, ny, nz) !== BLOCK.STONE) continue;

          const wx = cx + nx,
            wz = cz + nz;
          const ridgeN = oreRidge(noise, wx, ny, wz);
          if (ridgeN < ORE_PARAMS.RIDGE_WEAK) continue;

          if (rng() < ore.expandP) q.push([nx, ny, nz]); // per-ore vein growth probability
        }
      }
    }
  }
}

/** -------------------- Simple Cave Generation (smooth & continuous) --------------------
 * Carves a continuous iso-surface band from a 3D noise field and dilates it by a small sphere.
 */
//this variable has beeen generated with the help of copilot
const CAVE = {
  SCALE: 1 / 55, // coarser => larger features; finer => tighter tunnels
  BAND: 0.085, // half-width around the target isosurface (bigger => more caves)
  RADIUS: 1.6, // spherical dilation radius (voxels) for smooth round cross-sections
  Y_MIN: Y_MIN + 6,
  Y_MAX: SEA_LEVEL - 10,
};

//this function has beeen generated with the help of copilot
// Helper: small sphere offsets for dilation (computed once)
function makeSphereOffsets(radius) {
  const R = Math.ceil(radius);
  const r2 = radius * radius;
  const out = [];
  for (let dz = -R; dz <= R; dz++) {
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy + dz * dz <= r2 + 1e-6) out.push([dx, dy, dz]);
      }
    }
  }
  return out;
}

const CAVE_SPHERE_OFFSETS = makeSphereOffsets(CAVE.RADIUS);

//this function has beeen generated with the help of copilot
function carveCaves(chunk, noise, cx, cz, seed) {
  const open = new Uint8Array(CHUNK_SIZE * (Y_MAX - Y_MIN + 1) * CHUNK_SIZE); // raw band
  const openDilated = new Uint8Array(open.length); // dilated band

  // Coherent scalar field for caves: f ~ [-1,1]
  // We bias with depth so caves prefer underground and avoid near-surface poke-throughs.
  function caveField(wx, y, wz) {
    const base = noise.fbm3(wx, y, wz, {
      scale: CAVE.SCALE,
      octaves: 3,
      gain: 0.5,
    });
    const warp =
      0.2 * noise.perlin3(wx * 0.75 + 5000, y * 0.55, wz * 0.75 - 5000, 1 / 32);
    // Depth bias: push values away from 0 near the surface, allow near 0 deeper down.
    const depthBias = (y - (SEA_LEVEL - 14)) * 0.02; // >0 near surface, <0 deeper
    return base + warp + depthBias;
  }

  // Pass 1: mark voxels whose field is within an isosurface band → continuous mask, no RNG
  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const wx = cx + x,
        wz = cz + z;
      for (let y = CAVE.Y_MIN; y <= CAVE.Y_MAX; y++) {
        const id = chunk.getBlock(x, y, z);
        // only consider solid terrain (don’t touch water/lava/bedrock/air)
        if (
          !id ||
          id === BLOCK.WATER ||
          id === BLOCK.LAVA ||
          id === BLOCK.BEDROCK
        )
          continue;

        const f = caveField(wx, y, wz);
        if (Math.abs(f) <= CAVE.BAND) {
          open[((y - Y_MIN) * CHUNK_SIZE + z) * CHUNK_SIZE + x] = 1;
        }
      }
    }
  }

  // Pass 2: dilate by a tiny sphere to make smooth round tunnels/chambers
  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let y = CAVE.Y_MIN; y <= CAVE.Y_MAX; y++) {
        const idx = ((y - Y_MIN) * CHUNK_SIZE + z) * CHUNK_SIZE + x;
        if (!open[idx]) continue;

        for (const [dx, dy, dz] of CAVE_SPHERE_OFFSETS) {
          const nx = x + dx,
            ny = y + dy,
            nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= CHUNK_SIZE || nz >= CHUNK_SIZE)
            continue;
          if (ny < CAVE.Y_MIN || ny > CAVE.Y_MAX) continue;
          const nidx = ((ny - Y_MIN) * CHUNK_SIZE + nz) * CHUNK_SIZE + nx;
          openDilated[nidx] = 1;
        }
      }
    }
  }

  // Pass 3: apply carve
  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let y = CAVE.Y_MIN; y <= CAVE.Y_MAX; y++) {
        const idx = ((y - Y_MIN) * CHUNK_SIZE + z) * CHUNK_SIZE + x;
        if (!openDilated[idx]) continue;

        const id = chunk.getBlock(x, y, z);
        if (
          id &&
          id !== BLOCK.BEDROCK &&
          id !== BLOCK.LAVA &&
          id !== BLOCK.WATER
        ) {
          chunk.setBlock(x, y, z, 0); // air
        }
      }
    }
  }
}

/** -------------------- Cave Entrances (occasional, natural) --------------------
 * Picks sloped surface columns, checks for a real cave pocket below, then
 * carves a tapered funnel connecting surface → cave.
 */
//this variable has beeen generated with the help of copilot
const ENTRANCE = {
  BASE_RATE: 0.001, // overall chance per eligible column
  MIN_SOLID: 3, // need at least this many solid layers before first air
  MIN_DEPTH: 8, // entrance must reach at least this depth
  MAX_DEPTH: 28, // at most this (keeps funnels reasonable)
  MOUTH_RADIUS: 2.2, // top radius (voxels)
};

//this function has beeen generated with the help of copilot
function carveCaveEntrances(chunk, noise, cx, cz, tops, seed) {
  const colIdx = (x, z) => z * CHUNK_SIZE + x;

  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const wx = cx + x,
        wz = cz + z;
      const topY = tops[colIdx(x, z)];
      if (topY <= SEA_LEVEL + 1) continue; // avoid underwater/waterline

      // Prefer steeper slopes & karst-y regions
      const hL = sampleHeight(noise, wx - 1, wz);
      const hR = sampleHeight(noise, wx + 1, wz);
      const hD = sampleHeight(noise, wx, wz - 1);
      const hU = sampleHeight(noise, wx, wz + 1);
      const slope = Math.max(
        Math.abs(topY - hL),
        Math.abs(topY - hR),
        Math.abs(topY - hD),
        Math.abs(topY - hU)
      );
      const slopeBias = Math.min(1, slope / 10); // 0..1
      const regionMask = noise.fbm2(wx + 12000, wz - 12000, {
        scale: 1 / 900,
        octaves: 3,
        gain: 0.55,
      });
      if (regionMask < 0.25) continue;

      const chance = ENTRANCE.BASE_RATE * (0.4 + 0.6 * slopeBias);
      if (coordRand(wx, topY, wz, seed ^ 0xe17e) >= chance) continue;

      // Find first underground air pocket (a cave) below at reasonable depth
      let solidCount = 0;
      let hitY = -1;
      const yMin = Math.max(Y_MIN + 4, topY - ENTRANCE.MAX_DEPTH);
      const yMax = Math.max(Y_MIN + 4, topY - ENTRANCE.MIN_DEPTH);

      for (let y = topY - 1; y >= yMin; y--) {
        const id = chunk.getBlock(x, y, z);
        if (id && id !== BLOCK.WATER && id !== BLOCK.LAVA) solidCount++;
        if (id === 0 && y <= CAVE.Y_MAX && y >= CAVE.Y_MIN) {
          if (solidCount >= ENTRANCE.MIN_SOLID && y <= yMax) {
            hitY = y;
            break;
          }
          // found air too soon or too shallow → skip
          break;
        }
      }
      if (hitY === -1) continue;

      // Carve tapered funnel from surface → cave hit
      const total = Math.max(1, topY - hitY);
      for (let y = hitY; y <= topY; y++) {
        const t = (y - hitY) / total; // 0 at cave, 1 at surface
        const rad = Math.max(
          1,
          Math.floor((1 - t) * 1.2 + t * ENTRANCE.MOUTH_RADIUS)
        ); // grows toward surface

        for (let dz = -rad - 1; dz <= rad + 1; dz++) {
          for (let dx = -rad - 1; dx <= rad + 1; dx++) {
            const nx = x + dx,
              nz = z + dz;
            if (nx < 0 || nz < 0 || nx >= CHUNK_SIZE || nz >= CHUNK_SIZE)
              continue;
            if (dx * dx + dz * dz > (rad + 0.15) * (rad + 0.15)) continue;

            const id2 = chunk.getBlock(nx, y, nz);
            if (!id2 || id2 === BLOCK.BEDROCK || id2 === BLOCK.LAVA) continue; // keep basement intact
            if (id2 === BLOCK.WATER && y <= SEA_LEVEL) continue; // avoid ocean holes

            chunk.setBlock(nx, y, nz, 0); // carve air
          }
        }
      }

      // Optional: gravel lip around the mouth for visual cue
      const rr = Math.ceil(ENTRANCE.MOUTH_RADIUS) + 1;
      for (let dz = -rr; dz <= rr; dz++) {
        for (let dx = -rr; dx <= rr; dx++) {
          const nx = x + dx,
            nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= CHUNK_SIZE || nz >= CHUNK_SIZE)
            continue;
          if (dx * dx + dz * dz > rr * rr) continue;
          // find first solid downward to place “loose” gravel
          for (let yy = topY + 1; yy >= topY - 2; yy--) {
            const id3 = chunk.getBlock(nx, yy, nz);
            if (id3 && id3 !== BLOCK.WATER && id3 !== BLOCK.LAVA) {
              if (coordRand(cx + nx, yy, cz + nz, seed ^ 0x6a6f) < 0.18) {
                if (id3 !== BLOCK.SAND)
                  chunk.setBlock(nx, yy, nz, BLOCK.GRAVEL);
              }
              break;
            }
          }
        }
      }
    }
  }
}

/** -------------------- Connected Lava Blobs -------------------- */
//these 4 variables have been generated with the help of copilot
const LAVA_Y_MAX = 18; // keep most lava deep
const LAVA_FIELD_SCALE = 1 / 28;
const LAVA_THRESH = 0.55;
const LAVA_MAX_SIZE = 100;

//this function has beeen generated with the help of copilot
function carveLavaBlobs(chunk, noise, cx, cz) {
  const visited = new Uint8Array(CHUNK_SIZE * CH * CHUNK_SIZE);

  function lavaField(wx, y, wz) {
    if (y > LAVA_Y_MAX) return -1;
    const base = noise.fbm3(wx, y, wz, {
      scale: LAVA_FIELD_SCALE,
      octaves: 4,
      gain: 0.5,
    });
    const warp =
      noise.perlin3(wx * 0.5 + 1000, y * 0.5, wz * 0.5 - 1000, 1 / 18) * 0.15;
    return base + warp; // ~[-1.15,1.15]
  }

  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let y = Y_MIN + 2; y <= Math.min(SEA_LEVEL - 8, LAVA_Y_MAX); y++) {
        if (chunk.getBlock(x, y, z) !== BLOCK.STONE) continue;
        const wx = cx + x,
          wz = cz + z;
        if (lavaField(wx, y, wz) <= LAVA_THRESH) continue;

        const startIndex = idx3(x, y, z);
        if (visited[startIndex]) continue;

        const q = [[x, y, z]];
        visited[startIndex] = 1;
        let filled = 0;

        while (q.length && filled < LAVA_MAX_SIZE) {
          const [qx, qy, qz] = q.shift();
          if (chunk.getBlock(qx, qy, qz) === BLOCK.STONE) {
            chunk.setBlock(qx, qy, qz, BLOCK.LAVA);
            filled++;
          }
          const nbrs = [
            [qx + 1, qy, qz],
            [qx - 1, qy, qz],
            [qx, qy + 1, qz],
            [qx, qy - 1, qz],
            [qx, qy, qz + 1],
            [qx, qy, qz - 1],
          ];
          for (const [nx, ny, nz] of nbrs) {
            if (nx < 0 || nz < 0 || nx >= CHUNK_SIZE || nz >= CHUNK_SIZE)
              continue;
            if (ny < Y_MIN + 2 || ny > Math.min(SEA_LEVEL - 8, LAVA_Y_MAX))
              continue;
            const nIndex = idx3(nx, ny, nz);
            if (visited[nIndex]) continue;
            visited[nIndex] = 1;
            if (chunk.getBlock(nx, ny, nz) !== BLOCK.STONE) continue;
            if (lavaField(cx + nx, ny, cz + nz) > LAVA_THRESH)
              q.push([nx, ny, nz]);
          }
        }
      }
    }
  }
}

/** ------------------- Public: one chunk ------------------- */
//this function has beeen generated with the help of copilot
export function generateTerrainForChunk(chunk, seed = 1337) {
  const noise = makePerlin(seed);
  const cx = chunk.chunkX * CHUNK_SIZE;
  const cz = chunk.chunkZ * CHUNK_SIZE;

  const tops = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);

  // Pass 1: height + bulk fill (stone + bedrock)
  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const wx = cx + x,
        wz = cz + z;
      const topY = sampleHeight(noise, wx, wz);
      tops[z * CHUNK_SIZE + x] = topY;

      chunk.setBlock(x, Y_MIN, z, BLOCK.BEDROCK);
      chunk.setBlock(x, Y_MIN + 1, z, BLOCK.BEDROCK);
      for (let y = Y_MIN + 2; y <= topY; y++)
        chunk.setBlock(x, y, z, BLOCK.STONE);
    }
  }

  // Pass 2: surface (sand/gravel/grass + slope-aware dirt thickness) + water fill
  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const wx = cx + x,
        wz = cz + z;
      const topY = tops[z * CHUNK_SIZE + x];

      // slope-aware dirt thickness
      const hL = sampleHeight(noise, wx - 1, wz);
      const hR = sampleHeight(noise, wx + 1, wz);
      const hD = sampleHeight(noise, wx, wz - 1);
      const hU = sampleHeight(noise, wx, wz + 1);
      const slope = Math.max(
        Math.abs(topY - hL),
        Math.abs(topY - hR),
        Math.abs(topY - hD),
        Math.abs(topY - hU)
      );
      const thicknessBase =
        DIRT_THICKNESS_MIN +
        Math.floor(
          noise.fbm2(wx + 1234, wz - 9876, { scale: 1 / 70, octaves: 3 }) *
            1.5 +
            1.5
        );
      const dirtThickness = clamp(
        thicknessBase - Math.floor(slope / 4),
        DIRT_THICKNESS_MIN,
        DIRT_THICKNESS_MAX
      );

      if (topY <= SEA_LEVEL) {
        const underSand = sandHere(noise, wx, wz, topY);
        chunk.setBlock(x, topY, z, underSand ? BLOCK.SAND : BLOCK.GRAVEL);
      } else if (isBeach(topY) && sandHere(noise, wx, wz, topY)) {
        chunk.setBlock(x, topY, z, BLOCK.SAND);
        for (let d = 1; d <= dirtThickness; d++) {
          const yy = topY - d;
          if (yy <= Y_MIN + 1) break;
          chunk.setBlock(x, yy, z, BLOCK.SAND);
        }
      } else if (gravelHere(noise, wx, wz, topY)) {
        chunk.setBlock(x, topY, z, BLOCK.GRAVEL);
        for (let d = 1; d <= dirtThickness; d++) {
          const yy = topY - d;
          if (yy <= Y_MIN + 1) break;
          chunk.setBlock(x, yy, z, BLOCK.STONE);
        }
      } else {
        chunk.setBlock(x, topY, z, BLOCK.GRASS_BLOCK);
        for (let d = 1; d <= dirtThickness; d++) {
          const yy = topY - d;
          if (yy <= Y_MIN + 1) break;
          chunk.setBlock(x, yy, z, BLOCK.DIRT);
        }
      }

      // water fill to sea level → rivers/lakes/oceans
      for (let y = topY + 1; y <= SEA_LEVEL; y++)
        chunk.setBlock(x, y, z, BLOCK.WATER);
    }
  }

  // Pass 3: CAVES (carve after water so caves stay “dry”)
  carveCaves(chunk, noise, cx, cz, seed);

  // Pass 4: natural cave entrances (rare, on slopes, connect to real caves)
  carveCaveEntrances(chunk, noise, cx, cz, tops, seed);

  // Pass 5: ORES — per-ore expand probabilities (connected veins)
  carveOres(chunk, noise, cx, cz, tops, seed);

  // Pass 6: connected lava blobs
  carveLavaBlobs(chunk, noise, cx, cz);

  const writer = makeBlockWriter(chunk, pendingBlocks);

  // Pass 7: village placement
  placeVillages(chunk, noise, cx, cz, tops, seed, writer);

  // Pass 8: tree placement
  placeTrees(chunk, noise, cx, cz, tops, seed);

  // Pass 9: vegetation placement
  placeVegetationForChunk(chunk, seed);
}

/**
 * Self-contained oak tree placement:
 * - ~30% of world-space macro cells allow trees (connected "forests")
 * - Density fades near cell edges to avoid hard borders
 * - Skips waterlines, beaches, gravel/sand, and steep slopes
 * - Enforces local spacing to prevent carpets of trees
 * - Spawns simple Minecraft-style oak (4–6 log trunk, round canopy)
 *
 * Call AFTER terrain + water fill (and before/after caves both work).
 * Signature matches your pipeline: (chunk, noise, cx, cz, tops, seed)
 */
//this function has been generated with the help of copilot
function placeTrees(chunk, noise, cx, cz, tops, seed) {
  // ------------------------ Tunables (simple, robust) ------------------------
  const CELL = 128; // world-space macro cell size (larger ⇒ larger connected forests)
  const KEEP = 0.5; // fraction of macro cells that are forest-enabled (~30% as requested)
  const BASE_DENSE = 0.15; // per-column chance *inside* a forest cell center (kept small)
  const EDGE_FADE = 1.0; // 0..0.5 — how much of the half-cell fades to 0 near borders
  const MIN_SPACING = 3; // blocks of spacing around a planted tree (radius in XZ)
  const MAX_HEIGHT = 8; // oak trunk will be 4..MAX_HEIGHT
  const NEAR_WATER_FALLOFF = 0.6; // multiplies chance when near water (smaller ⇒ fewer trees near water)
  const SLOPE_LIMIT = 2; // max allowed slope in any 4-neighborhood to plant

  // ------------------------ Local helpers (private to this fn) ---------------
  // world-space -> macro cell coords
  function cellCoords(wx, wz) {
    return [Math.floor(wx / CELL), Math.floor(wz / CELL)];
  }

  // deterministic: is this macro cell forest-enabled?
  function cellKeepsTrees(cellX, cellZ) {
    // Valid hex seed mix (no invalid hex chars)
    return coordRand(cellX, 0, cellZ, seed ^ 0xf0f0) < KEEP;
  }

  // 0..1 soft fade near macro-cell edges so forests taper naturally
  function edgeFade(wx, wz) {
    const cellX = Math.floor(wx / CELL);
    const cellZ = Math.floor(wz / CELL);
    const lx = wx - cellX * CELL; // 0..CELL-1 even for negatives (because floor)
    const lz = wz - cellZ * CELL;

    const dx = Math.min(lx, CELL - 1 - lx);
    const dz = Math.min(lz, CELL - 1 - lz);
    const d = Math.min(dx, dz);

    const half = (CELL - 1) * 0.5;
    const fadeStart = half * (1 - EDGE_FADE);
    const t = Math.max(0, Math.min(1, (d - fadeStart) / (half - fadeStart)));
    // smoothstep
    return t * t * (3 - 2 * t);
  }

  // quick near-water check using local surface heights: true if this column
  // or any 1-ring neighbor is close to sea or below it.
  function nearWaterOrBeach(topY, getTop) {
    if (topY <= SEA_LEVEL + 1) return true;
    const neighbors = [
      getTop(-1, 0),
      getTop(1, 0),
      getTop(0, -1),
      getTop(0, 1),
    ];
    for (const h of neighbors) {
      if (h <= SEA_LEVEL + 1) return true;
    }
    return false;
  }

  // local slope (max of 4-neighborhood)
  function localSlope(topY, getTop) {
    const hL = getTop(-1, 0);
    const hR = getTop(1, 0);
    const hD = getTop(0, -1);
    const hU = getTop(0, 1);
    return Math.max(
      Math.abs(topY - hL),
      Math.abs(topY - hR),
      Math.abs(topY - hD),
      Math.abs(topY - hU)
    );
  }

  // ensure no recently-placed tree (logs/leaves) nearby to keep spacing sane
  function clearAround(x, y, z, r) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const bid = chunk.getBlock(x + dx, y, z + dz);
        if (bid === BLOCK.WOOD || bid === BLOCK.LEAVES) return false;
      }
    }
    return true;
  }

  // Try to build a simple oak at (x, y, z) where y is first air above ground.
  // Returns true if placed.
  function spawnOak(x, y, z) {
    // trunk height 4..MAX_HEIGHT (deterministic per-column)
    const r = coordRand(cx + x, y, cz + z, seed ^ 0x5ca1ab1e);
    const height = 4 + Math.floor(r * (MAX_HEIGHT - 3)); // 4..6 typically
    const leafRadius = 2;

    // Make sure trunk space is clear (don’t punch through solids)
    for (let dy = 0; dy < height; dy++) {
      const id = chunk.getBlock(x, y + dy, z);
      if (id !== BLOCK.AIR && id !== BLOCK.WATER) return false;
    }

    // Place trunk (replace air/water only)
    for (let dy = 0; dy < height; dy++) {
      const id = chunk.getBlock(x, y + dy, z);
      if (id === BLOCK.AIR || id === BLOCK.WATER) {
        chunk.setBlock(x, y + dy, z, BLOCK.WOOD);
      }
    }

    // Rounded canopy centered near top
    const topY = y + height - 1;
    for (let dx = -leafRadius; dx <= leafRadius; dx++) {
      for (let dy = -leafRadius; dy <= leafRadius; dy++) {
        for (let dz = -leafRadius; dz <= leafRadius; dz++) {
          if (dx * dx + dy * dy + dz * dz > leafRadius * leafRadius + 1)
            continue;
          const lx = x + dx,
            ly = topY - 1 + dy,
            lz = z + dz;
          const id = chunk.getBlock(lx, ly, lz);
          if (id === BLOCK.AIR || id === BLOCK.WATER) {
            chunk.setBlock(lx, ly, lz, BLOCK.LEAVES);
          }
        }
      }
    }
    return true;
  }

  // ------------------------ Main loop over columns ---------------------------
  const colIdx = (x, z) => z * CHUNK_SIZE + x;

  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const wx = cx + x;
      const wz = cz + z;
      const topY = tops[colIdx(x, z)];
      if (topY <= SEA_LEVEL) continue; // never underwater

      // must be on grass
      const ground = chunk.getBlock(x, topY, z);
      if (ground !== BLOCK.GRASS_BLOCK) continue;

      // macro gating — only ~30% of cells allow trees at all
      const [cellX, cellZ] = cellCoords(wx, wz);
      if (!cellKeepsTrees(cellX, cellZ)) continue;

      // slope + water filtering
      const getTop = (dx, dz) => {
        const ix = Math.max(0, Math.min(CHUNK_SIZE - 1, x + dx));
        const iz = Math.max(0, Math.min(CHUNK_SIZE - 1, z + dz));
        return tops[colIdx(ix, iz)];
      };
      if (localSlope(topY, getTop) > SLOPE_LIMIT) continue;

      // avoid near water/beaches
      const nearWater = nearWaterOrBeach(topY, getTop);
      const waterMul = nearWater ? NEAR_WATER_FALLOFF : 1.0;

      // edge fade in macro cell (soften borders)
      const fade = edgeFade(wx, wz);

      // micro variation so it doesn’t look like a grid
      const micro =
        (noise.fbm2(wx + 137, wz - 911, {
          scale: 1 / 120,
          octaves: 3,
          gain: 0.6,
        }) +
          1) *
        0.5;
      // final per-column probability (kept low; multiplied by fade & water)
      const p = BASE_DENSE * fade * waterMul * (0.6 + 0.8 * micro);

      if (p <= 0) continue;
      if (coordRand(wx, topY, wz, seed ^ 0x7734) < p) {
        // enforce spacing and place
        if (!clearAround(x, topY, z, MIN_SPACING)) continue;
        // y for trunk base is the first air above ground
        const baseY = topY + 1;
        const LEAF_RADIUS = 2; // keep in sync with spawnOak
        const EDGE_MARGIN = LEAF_RADIUS + 1; // 3 cells is safe for 2-radius leaves
        if (x < EDGE_MARGIN || x >= CHUNK_SIZE - EDGE_MARGIN) continue;
        if (z < EDGE_MARGIN || z >= CHUNK_SIZE - EDGE_MARGIN) continue;
        spawnOak(x, baseY, z);
      }
    }
  }
}

//this function has been generated with the help of copilot
function placeVillages(chunk, noise, cx, cz, tops, seed, writer) {
  // ------------------- Config (small, meaningful set) -------------------
  const CELL = 64; // macro-cell size for siting villages
  const KEEP = 0.1; // ~% of macro cells that contain a village
  const RADIUS = 128; // village influence radius from center (world blocks)
  const POI_MIN = 6; // min building plots per village
  const POI_MAX = 12; // max building plots per village
  const PLOT_MINDIST = 20; // blue-noise spacing between plots
  const PLOT_MAX_TILT = 5; // reject plots whose corners vary more than this (blocks)
  const ROAD_WIDTH = 3; // odd width looks best (1,3,5)
  const ROAD_MAX_STEP = 2; // skip road cell if vertical jump vs previous > this
  const CLEAR_EXTRA = 1; // extra 1-block clear ring around footprints
  const SEA_LEVEL = 62; // must match your terrain

  // ------------------- Local helpers (self-contained) -------------------
  function coordRand(x, y, z, seedLocal) {
    let n =
      (x * 374761393) ^
      (y * 668265263) ^
      (z * 2147483647) ^
      (seedLocal * 1013904223);
    n = (n ^ (n >>> 13)) * 1274126177;
    n = n ^ (n >>> 16);
    return (n >>> 0) / 4294967296;
  }

  const wx0 = cx,
    wz0 = cz;
  const wx1 = cx + CHUNK_SIZE - 1,
    wz1 = cz + CHUNK_SIZE - 1;

  function colIdx(x, z) {
    return z * CHUNK_SIZE + x;
  }

  function topFromTopsOrSample(wx, wz) {
    // If inside this chunk, use precomputed tops; else sample deterministic height
    if (wx >= wx0 && wx <= wx1 && wz >= wz0 && wz <= wz1) {
      const lx = (wx - cx) | 0;
      const lz = (wz - cz) | 0;
      return tops[colIdx(lx, lz)];
    }
    return sampleHeight(noise, wx, wz);
  }

  function inChunk(wx, wz) {
    return wx >= wx0 && wx <= wx1 && wz >= wz0 && wz <= wz1;
  }
  function toLocal(wx, wz) {
    return [wx - cx, wz - cz];
  }

  function getBlockWorldLocal(wx, y, wz) {
    if (!inChunk(wx, wz) || y < Y_MIN || y > Y_MAX) return BLOCK.AIR;
    const [lx, lz] = toLocal(wx, wz);
    return chunk.getBlock(lx, y, lz);
  }
  function setBlockWorldLocal(wx, y, wz, id) {
    if (!inChunk(wx, wz) || y < Y_MIN || y > Y_MAX) return;
    const [lx, lz] = toLocal(wx, wz);
    chunk.setBlock(lx, y, lz, id);
  }

  // Village centers for macro cells intersecting this chunk's AABB + radius
  function getVillageCentersTouchingChunk() {
    const minCellX = Math.floor((wx0 - RADIUS) / CELL);
    const maxCellX = Math.floor((wx1 + RADIUS) / CELL);
    const minCellZ = Math.floor((wz0 - RADIUS) / CELL);
    const maxCellZ = Math.floor((wz1 + RADIUS) / CELL);
    const centers = [];

    for (let gx = minCellX; gx <= maxCellX; gx++) {
      for (let gz = minCellZ; gz <= maxCellZ; gz++) {
        if (coordRand(gx, 0, gz, seed ^ 0xc0ffee) >= KEEP) continue;

        const pad = 64;
        const jx =
          Math.floor(coordRand(gx, 1, gz, seed ^ 0xbeef) * (CELL - 2 * pad)) +
          pad;
        const jz =
          Math.floor(coordRand(gx, 2, gz, seed ^ 0xcafe) * (CELL - 2 * pad)) +
          pad;
        const wx = gx * CELL + jx;
        const wz = gz * CELL + jz;

        // Quick overlap test with chunk bounds + radius
        if (wx + RADIUS < wx0 || wx - RADIUS > wx1) continue;
        if (wz + RADIUS < wz0 || wz - RADIUS > wz1) continue;

        centers.push({ wx, wz });
      }
    }
    return centers;
  }

  function localSlopeAt(wx, wz) {
    const h = topFromTopsOrSample(wx, wz);
    const hL = topFromTopsOrSample(wx - 1, wz);
    const hR = topFromTopsOrSample(wx + 1, wz);
    const hD = topFromTopsOrSample(wx, wz - 1);
    const hU = topFromTopsOrSample(wx, wz + 1);
    return Math.max(
      Math.abs(h - hL),
      Math.abs(h - hR),
      Math.abs(h - hD),
      Math.abs(h - hU)
    );
  }

  function bresenhamXZ(ax, az, bx, bz) {
    const pts = [];
    let x0 = ax,
      z0 = az,
      x1 = bx,
      z1 = bz;
    const dx = Math.abs(x1 - x0),
      dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1,
      sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;
    while (true) {
      pts.push([x0, z0]);
      if (x0 === x1 && z0 === z1) break;
      const e2 = 2 * err;
      if (e2 > -dz) {
        err -= dz;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        z0 += sz;
      }
    }
    return pts;
  }

  function buildMST(points) {
    const n = points.length;
    if (n === 0) return [];
    const used = new Array(n).fill(false);
    const dist = new Array(n).fill(Infinity);
    const parent = new Array(n).fill(-1);
    dist[0] = 0;
    for (let it = 0; it < n; it++) {
      let u = -1,
        best = Infinity;
      for (let i = 0; i < n; i++)
        if (!used[i] && dist[i] < best) {
          best = dist[i];
          u = i;
        }
      if (u === -1) break;
      used[u] = true;
      for (let v = 0; v < n; v++)
        if (!used[v]) {
          const dx = points[u].wx - points[v].wx,
            dz = points[u].wz - points[v].wz;
          const d2 = dx * dx + dz * dz;
          if (d2 < dist[v]) {
            dist[v] = d2;
            parent[v] = u;
          }
        }
    }
    const edges = [];
    for (let v = 1; v < n; v++)
      if (parent[v] !== -1) edges.push([points[v], points[parent[v]]]);
    return edges;
  }

  function scatterPlots(center, count, minDist, rngSeed) {
    const pts = [];
    let tries = 0,
      i = 0;
    while (i < count && tries < count * 60) {
      tries++;
      const r = 10 + Math.floor(coordRand(i, 0, tries, rngSeed) * 70);
      const a = coordRand(i, 1, tries, rngSeed ^ 0x77) * Math.PI * 2;
      const wx = Math.floor(center.wx + Math.cos(a) * r);
      const wz = Math.floor(center.wz + Math.sin(a) * r);
      let ok = true;
      for (const p of pts) {
        const dx = p.wx - wx,
          dz = p.wz - wz;
        if (dx * dx + dz * dz < minDist * minDist) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      pts.push({ wx, wz });
      i++;
    }
    return pts;
  }

  function rasterizeRoad(a, b) {
    const cells = bresenhamXZ(a.wx, a.wz, b.wx, b.wz);
    const half = (ROAD_WIDTH - 1) / 2;
    let lastY = null;

    for (const [wx, wz] of cells) {
      const topY = topFromTopsOrSample(wx, wz);
      if (topY <= SEA_LEVEL) {
        lastY = topY;
        continue;
      } // skip underwater
      if (lastY !== null && Math.abs(topY - lastY) > ROAD_MAX_STEP) {
        lastY = topY;
        continue;
      }
      lastY = topY;

      for (let ox = -half; ox <= half; ox++) {
        for (let oz = -half; oz <= half; oz++) {
          const px = wx + ox,
            pz = wz + oz;
          if (!inChunk(px, pz)) continue;
          const py = topFromTopsOrSample(px, pz);
          const idTop = getBlockWorldLocal(px, py, pz);
          if (
            idTop === BLOCK.WATER ||
            idTop === BLOCK.LAVA ||
            idTop === BLOCK.BEDROCK
          )
            continue;

          // Replace common ground blocks with gravel as path
          if (
            idTop === BLOCK.GRASS_BLOCK ||
            idTop === BLOCK.DIRT ||
            idTop === BLOCK.SAND ||
            idTop === BLOCK.GRAVEL
          ) {
            setBlockWorldLocal(px, py, pz, BLOCK.GRAVEL);
            // clear low foliage above
            const above = getBlockWorldLocal(px, py + 1, pz);
            if (above === BLOCK.LEAVES)
              setBlockWorldLocal(px, py + 1, pz, BLOCK.AIR);
          }
        }
      }
    }
  }

  // ------------------- Main: generate for centers touching this chunk -------------------
  const centers = getVillageCentersTouchingChunk();
  for (const center of centers) {
    // Site suitability near center
    const cy = topFromTopsOrSample(center.wx, center.wz);
    if (cy <= SEA_LEVEL + 1) continue; // avoid underwater/coasts
    if (localSlopeAt(center.wx, center.wz) > 3) continue; // too steep core

    // Choose POI count
    const rCount = coordRand(center.wx, 3, center.wz, seed ^ 0xface);
    const count = POI_MIN + Math.floor(rCount * (POI_MAX - POI_MIN + 1));

    // Scatter plots, include center as POI 0
    const plots = scatterPlots(center, count, PLOT_MINDIST, seed ^ 0x1234);
    const pois = [{ wx: center.wx, wz: center.wz }, ...plots];

    // Build MST road skeleton and rasterize gravel roads
    const edges = buildMST(pois);
    for (const [a, b] of edges) rasterizeRoad(a, b);

    function bboxCollides(a, b) {
      return !(a.x1 < b.x0 || b.x1 < a.x0 || a.z1 < b.z0 || b.z1 < a.z0);
    }
    const placed = [];
    // Place structures randomly with collision check
    for (let i = 0; i < pois.length; i++) {
      const p = pois[i];
      const topY = topFromTopsOrSample(p.wx, p.wz);
      if (topY <= SEA_LEVEL) continue;

      const rot = Math.floor(coordRand(p.wx, topY, p.wz, seed ^ 0xabcd) * 4);
      const r = coordRand(p.wx, p.wz, seed ^ 0xfeed);
      const y0 = topY + 1;

      // choose the structure
      let result;
      if (r < 0.1) result = placeWell(writer, p.wx, y0, p.wz, rot);
      else if (r < 0.25) result = placeFarmPlot(writer, p.wx, y0, p.wz, rot);
      else if (r < 0.45) result = placeSmallHouse(writer, p.wx, y0, p.wz, rot);
      else if (r < 0.65) result = placeLargeHouse(writer, p.wx, y0, p.wz, rot);
      else if (r < 0.8) result = placeBlacksmith(writer, p.wx, y0, p.wz, rot);
      else if (r < 0.92) result = placeLonghouse(writer, p.wx, y0, p.wz, rot);
      else if (r < 0.98) result = placeWatchtower(writer, p.wx, y0, p.wz, rot);
      else result = placeMarketStall(writer, p.wx, y0, p.wz, rot);

      if (!result || !result.bbox) continue;

      // collision check
      const overlaps = placed.some((b) => bboxCollides(b.bbox, result.bbox));
      if (overlaps) continue; // skip overlapping buildings

      // record this building
      placed.push(result);
    }
  }
}
