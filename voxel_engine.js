import * as T from "../libs/threeJS/build/three.module.js";
import { GrObject } from "../libs/framework/GrObject.js";
import { atlasTexture, getBlockData } from "./block_factory.js";
import { BLOCK } from "./block_registry.js";
import { GrPig, GrCreeper, GrSheep } from "./entities.js";
//define some configurations
export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 128;
export const WORLD_DEPTH = 0;

//these 3 variables has been generated with the help of copilot
export const Y_MIN = -WORLD_DEPTH;
export const Y_MAX = WORLD_HEIGHT - 1;
export const Y_COUNT = WORLD_HEIGHT + WORLD_DEPTH; // total vertical cells

//this function has been generated with the help of copilot
/** Helper to pack (x,y,z) → linear index inside a chunk */
function idx(x, y, z) {
  // offset y so that Y_MIN maps to 0
  const yy = y - Y_MIN; // e.g., y=-64 → 0, y=0 → WORLD_DEPTH
  return yy * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
}

//this class has been geneerated with the help of copilot
/** ====== Chunk data container ====== */
export class VoxelChunk {
  constructor(chunkX, chunkZ) {
    this.chunkX = chunkX; // chunk coords (not world coords)
    this.chunkZ = chunkZ;
    this.blocks = new Uint8Array(CHUNK_SIZE * Y_COUNT * CHUNK_SIZE);
    this.metadata = new Uint8Array(CHUNK_SIZE * Y_COUNT * CHUNK_SIZE);
  }
  getBlock(x, y, z) {
    if (
      x < 0 ||
      x >= CHUNK_SIZE ||
      y < Y_MIN ||
      y > Y_MAX ||
      z < 0 ||
      z >= CHUNK_SIZE
    )
      return BLOCK.AIR;
    return this.blocks[idx(x, y, z)];
  }
  setBlock(x, y, z, id) {
    if (
      x < 0 ||
      x >= CHUNK_SIZE ||
      y < Y_MIN ||
      y > Y_MAX ||
      z < 0 ||
      z >= CHUNK_SIZE
    )
      return;
    this.blocks[idx(x, y, z)] = id;
  }

  getMeta(x, y, z) {
    if (
      x < 0 ||
      x >= CHUNK_SIZE ||
      y < Y_MIN ||
      y > Y_MAX ||
      z < 0 ||
      z >= CHUNK_SIZE
    )
      return null;
    return this.metadata[idx(x, y, z)];
  }

  setMeta(x, y, z, value) {
    if (
      x < 0 ||
      x >= CHUNK_SIZE ||
      y < Y_MIN ||
      y > Y_MAX ||
      z < 0 ||
      z >= CHUNK_SIZE
    )
      return null;
    this.metadata[idx(x, y, z)] = value;
  }
}

export class VoxelWorldTicker extends GrObject {
  constructor(voxelWorld) {
    const group = new T.Group();
    super("VoxelWorldTicker", group);

    this.voxelWorld = voxelWorld;
  }

  stepWorld(delta) {
    this.voxelWorld.stepWorld(delta);
  }
}
//this class has been geneerated with the help of copilot
/** ====== World map of chunks ====== */
export class VoxelWorld {
  constructor(renderWorld, rainSystem) {
    /** key: `${cx},${cz}` → VoxelChunk */
    this.chunks = new Map();
    this.renderChunks = new Map();
    this.renderWorld = renderWorld;
    this.rainSystem = rainSystem;

    // --- Mob management (global) ---
    this.mobs = []; // all mobs in the world
    this.maxMobs = 30; // #1 global cap

    this._mobSpawnTimer = 0; // time until next spawn attempt
    this._resetMobSpawnInterval(); // randomize initial interval

    // --- Rain ---
    this.isRaining = false;
    this.rainSystem.setVisible(false);
    this._rainTimer = 0;
    this._rainNextToggle = this._randomRainInterval();

    // --- Fluid simulation state ---
    this._fluidQueue = []; // ring-buffer queue of cells
    this._fluidHead = 0; // index of first valid element
    this._fluidSeen = new Set(); // per-wave dedup

    // Tunables: how far each fluid can spread horizontally
    this._waterMaxLevel = 4; // roughly like Minecraft
    this._lavaMaxLevel = 3;

    // Allow waterfalls to fall deeper than horizontal radius
    this._waterFallDepth = 64;
    this._lavaFallDepth = 16;

    // Fluid tick pacing
    this._fluidStepInterval = 0.15; // seconds between fluid waves
    this._fluidAccum = 0;

    // 🔗 NEW: explicit parent/child graph for retraction
    this._fluidParents = new Map(); // key -> parentKey | null
    this._fluidChildren = new Map(); // key -> Set(childKey)

    // 🌀 pending gradual retraction
    this._retractPending = new Set(); // set of fluid node keys to retract gradually
  }

  // Blocks that fluids are allowed to overwrite
  isReplaceableByFluid(id) {
    // air always replaceable
    if (id === BLOCK.AIR) return true;

    // non-solid “cross” blocks like flowers/grass/torch
    if (this.isPlantId(id)) return true;

    return false;
  }

  _applySponge(wx, wy, wz, radius = 6) {
    const r2 = radius * radius;

    const doBatch = !this._batchChunks;
    if (doBatch) this.beginBatch();

    for (let y = wy - radius; y <= wy + radius; y++) {
      if (y < Y_MIN || y > Y_MAX) continue;
      for (let z = wz - radius; z <= wz + radius; z++) {
        for (let x = wx - radius; x <= wx + radius; x++) {
          const dx = x - wx;
          const dy = y - wy;
          const dz = z - wz;
          if (dx * dx + dy * dy + dz * dz > r2) continue; // spherical-ish

          const id = this.getBlockWorld(x, y, z);
          if (!this.isLiquidId(id)) continue;

          // Immediately dry this block
          this._setBlockRaw(x, y, z, BLOCK.AIR);

          // Start retraction wave from this node's descendants
          this._scheduleRetractionFromRemovedFluid(x, y, z, id);
        }
      }
    }

    if (doBatch) this.endBatch();
  }

  // ============================================================
  // Basic helpers
  // ============================================================

  key(cx, cz) {
    return `${cx},${cz}`;
  }

  isWaterId(id) {
    return id === BLOCK.WATER;
  }

  isLavaId(id) {
    return id === BLOCK.LAVA;
  }

  isLiquidId(id) {
    return this.isWaterId(id) || this.isLavaId(id);
  }

  isLavaAt(wx, wy, wz) {
    const id = this.getBlockWorld(wx, wy, wz);
    return id === BLOCK.LAVA;
  }

  isWaterAt(wx, wy, wz) {
    const id = this.getBlockWorld(wx, wy, wz);
    return id === BLOCK.WATER;
  }

  isLiquidAt(wx, wy, wz) {
    const id = this.getBlockWorld(wx, wy, wz);
    return this.isLiquidId(id);
  }

  isPlantId(id) {
    return (
      id === BLOCK.GRASS ||
      id === BLOCK.DANDELION ||
      id === BLOCK.ROSE ||
      id === BLOCK.RED_MUSHROOM ||
      id === BLOCK.BROWN_MUSHROOM ||
      id === BLOCK.TORCH
    );
  }

  /**
   * Returns whether the block at (wx, wy, wz) is walkable.
   * (Not air or liquid, and below has solid ground)
   */
  isWalkable(wx, wy, wz) {
    const id = this.getBlockWorld(wx, wy, wz);
    const below = this.getBlockWorld(wx, wy - 1, wz);
    const solid =
      id === BLOCK.AIR &&
      below !== BLOCK.AIR &&
      below !== BLOCK.WATER &&
      below !== BLOCK.LAVA;
    return solid;
  }

  _randomRainInterval() {
    // Rain can start/stop every 20–60 seconds
    return 20 + Math.random() * 40;
  }

  // Randomize the delay between spawn attempts: 2-5 seconds
  _resetMobSpawnInterval() {
    this._mobSpawnInterval = 2 + Math.random() * 3;
  }

  // ============================================================
  // Mob / rain logic (unchanged in behavior)
  // ============================================================

  // Register mob globally and in its render chunk's entities list
  _registerMob(mob, wx, wz) {}

  despawnMob(mob) {
    // 1) Remove from global mob list
    const i = this.mobs.indexOf(mob);
    if (i !== -1) {
      this.mobs.splice(i, 1);
    }

    // 2) Remove from the chunk's entities list if present
    const chunk = mob._currentChunk;
    if (chunk && Array.isArray(chunk.entities)) {
      const idx = chunk.entities.indexOf(mob);
      if (idx !== -1) {
        chunk.entities.splice(idx, 1);
      }
    }

    // 3) Remove from render world / scene graph
    if (this.renderWorld && typeof this.renderWorld.remove === "function") {
      this.renderWorld.remove(mob);
    } else if (this.renderWorld && this.renderWorld.scene) {
      // fallback if your GrWorld exposes scene explicitly
      this.renderWorld.scene.remove(mob.objects ? mob.objects[0] : mob);
    }
  }

  // Pick a random chunk that exists (for even spatial distribution)
  _getRandomChunkForSpawning() {
    const entries = Array.from(this.renderChunks.entries());
    if (entries.length === 0) return null;

    const [key, chunk] = entries[(Math.random() * entries.length) | 0];
    return { key, chunk };
  }

  // Surface animal spawn check (world space)
  _canSpawnAnimalAtWorld(wx, wy, wz) {
    const below = this.getBlockWorld(wx, wy - 1, wz);
    if (below !== BLOCK.GRASS_BLOCK) return false;

    if (this.getBlockWorld(wx, wy, wz) !== BLOCK.AIR) return false;
    if (this.getBlockWorld(wx, wy + 1, wz) !== BLOCK.AIR) return false;

    if (this.isLiquidAt(wx, wy, wz)) return false;

    const surface = this.sampleSurfaceHeight(wx, wz);
    if (!isFinite(surface)) return false;

    // must be exactly one block above surface
    if (Math.abs(wy - (surface + 1)) > 0.01) return false;

    return true;
  }

  // Underground creeper spawn check (world space)
  _canSpawnCreeperAtWorld(wx, wy, wz, surfaceY) {
    // Keep within world bounds
    if (wy <= Y_MIN + 1 || wy >= surfaceY - 2) return false;

    // no liquid at body
    if (this.isLiquidAt(wx, wy, wz)) return false;

    // solid ground under feet
    if (this.getBlockWorld(wx, wy - 1, wz) === BLOCK.AIR) return false;

    // 2-block headroom of air
    if (this.getBlockWorld(wx, wy, wz) !== BLOCK.AIR) return false;
    if (this.getBlockWorld(wx, wy + 1, wz) !== BLOCK.AIR) return false;

    // significantly below surface (at least 6 blocks down)
    if (wy > surfaceY - 6) return false;

    // ensure no “open-to-sky” shaft:
    // from head upwards to surface, must NOT pass through air or liquid
    for (let y = wy + 2; y <= surfaceY; y++) {
      const id = this.getBlockWorld(wx, y, wz);
      if (id === BLOCK.AIR || this.isLiquidId(id)) {
        return false;
      }
    }

    // require at least one solid neighbor (feels like a cave wall)
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    let solidNeighbors = 0;
    for (const [dx, dz] of dirs) {
      const id = this.getBlockWorld(wx + dx, wy, wz + dz);
      if (id !== BLOCK.AIR && !this.isLiquidId(id)) solidNeighbors++;
    }
    if (solidNeighbors < 1) return false;

    return true;
  }

  // Tunable helper: what counts as "stone-like" cave floor?
  _isStoneLike(id) {
    return (
      id === BLOCK.STONE ||
      id === BLOCK.COBBLESTONE ||
      id === BLOCK.DEEPSLATE || // if you have these
      id === BLOCK.ANDESITE ||
      id === BLOCK.DIORITE ||
      id === BLOCK.GRANITE
    );
  }

  findCreeperCaveSpawnY(wx, wz, maxDepth = 64) {
    wx = Math.floor(wx);
    wz = Math.floor(wz);

    const surfaceY = this.sampleSurfaceHeight(wx, wz);
    if (!Number.isFinite(surfaceY)) return null;

    // We only care below the surface
    const startY = surfaceY - 3; // avoid right under grass/dirt
    const minY = Math.max(Y_MIN + 2, surfaceY - maxDepth);

    for (let y = startY; y >= minY; y--) {
      const floorId = this.getBlockWorld(wx, y, wz);
      const headId = this.getBlockWorld(wx, y + 1, wz);
      const upperId = this.getBlockWorld(wx, y + 2, wz);

      // Floor must be stone-like, above two blocks must be air
      if (!this._isStoneLike(floorId)) continue;
      if (headId !== BLOCK.AIR || upperId !== BLOCK.AIR) continue;

      // Optional: require a "roof" somewhere above (so it's actually a cave, not a vertical shaft)
      let hasRoof = false;
      for (let ry = y + 3; ry <= surfaceY; ry++) {
        const rid = this.getBlockWorld(wx, ry, wz);
        if (rid !== BLOCK.AIR && !this.isLiquidId(rid)) {
          hasRoof = true;
          break;
        }
      }
      if (!hasRoof) continue;

      // Also avoid spawning in liquid
      if (this.isLiquidAt(wx, y + 1, wz)) continue;

      // Looks like a cave floor: spawn creeper with feet on y+1
      return y + 1;
    }

    return null;
  }

  // Global mob spawn attempt (call from world step)
  _trySpawnMobGlobal(dt) {
    // #1 Global cap
    if (this.mobs.length >= this.maxMobs) return;

    // Timer
    this._mobSpawnTimer -= dt;
    if (this._mobSpawnTimer > 0) return;

    // Reset timer for next spawn
    this._resetMobSpawnInterval();
    this._mobSpawnTimer = this._mobSpawnInterval;

    // Pick a random loaded chunk
    const pick = this._getRandomChunkForSpawning();
    if (!pick) return;
    const { key } = pick;

    const cx = Number(key.split(",")[0]);
    const cz = Number(key.split(",")[1]);

    // Random local position inside this chunk
    const lx = (Math.random() * CHUNK_SIZE) | 0;
    const lz = (Math.random() * CHUNK_SIZE) | 0;

    // Convert to world coords (center of block)
    const wx = cx * CHUNK_SIZE + lx + 0.5;
    const wz = cz * CHUNK_SIZE + lz + 0.5;

    const surfaceY = this.sampleSurfaceHeight(wx, wz);
    if (!Number.isFinite(surfaceY)) return;

    // Random spawning preference: sometimes try creeper first
    const preferCreeper = Math.random() < 0.35;
    const modes = preferCreeper ? ["creeper", "animal"] : ["animal", "creeper"];

    for (const mode of modes) {
      if (mode === "animal") {
        // Surface animals spawn Y
        const sy = surfaceY + 1;
        const test = this._canSpawnAnimalAtWorld(wx, sy, wz);

        if (test) {
          // Random surface mob type
          const type = Math.random() < 0.5 ? "pig" : "sheep";

          const mob = this.spawnMobAt(type, wx, sy, wz);
          if (mob) {
            return;
          }
        }
      } else {
        // --- Cave creeper: use geometric cave scanning ---
        const caveY = this.findCreeperCaveSpawnY(wx, wz, 64);
        if (caveY !== null) {
          const mob = this.spawnMobAt("creeper", wx, caveY, wz);
          if (mob) {
            return;
          }
        }
      }
    }
  }

  spawnMobAt(type, x, y, z) {
    console.log("spawning! ", type, x, y, z);
    let mob;
    if (type === "pig") {
      mob = new GrPig(
        "models/minecraft-pig/source/MinecraftPig/Pig.fbx",
        this,
        { x, y, z }
      );
    } else if (type === "sheep") {
      mob = new GrSheep(
        "models/minecraft-sheep/source/MinecraftSheep/Sheep.fbx",
        this,
        { x, y, z }
      );
    } else if (type === "creeper") {
      mob = new GrCreeper(
        "models/minecraft-creeper/source/MinecraftCreeper/Creeper.fbx",
        this,
        { x, y, z }
      );
    }

    if (!mob) return null;

    this.renderWorld.add(mob);

    // 🔹 NEW: every active mob in loaded world is tracked here
    this.mobs.push(mob);

    // (optional) keep this for future per-chunk entity lists if you want
    this._registerMob(mob, x, y, z);

    return mob;
  }

  /**
   * Called once from GrVoxelChunk constructor so the world
   * can find the render wrapper when a block changes.
   */
  registerRenderChunk(cx, cz, renderChunk) {
    this.renderChunks.set(this.key(cx, cz), renderChunk);
  }

  getChunk(cx, cz) {
    return this.chunks.get(this.key(cx, cz)) ?? null;
  }

  setChunk(cx, cz, chunk) {
    this.chunks.set(this.key(cx, cz), chunk);
  }

  /** World-space block query with cross-chunk support */
  getBlockWorld(wx, wy, wz) {
    if (wy < Y_MIN || wy > Y_MAX) return BLOCK.AIR;
    wx = Math.floor(wx);
    wy = Math.floor(wy);
    wz = Math.floor(wz);
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return BLOCK.AIR;
    return chunk.getBlock(lx, wy, lz);
  }

  beginBatch() {
    this._batchChunks = new Set();
  }

  endBatch() {
    if (!this._batchChunks) return;

    for (const key of this._batchChunks) {
      const renderChunk = this.renderChunks.get(key);
      if (renderChunk && typeof renderChunk.rebuildGeometry === "function") {
        renderChunk.rebuildGeometry();
      }
    }

    this._batchChunks.clear();
    this._batchChunks = null;
  }

  // ============================================================
  // Chunk + meta helpers used by fluids
  // ============================================================

  _getChunkAndLocal(wx, wy, wz) {
    wx = Math.floor(wx);
    wy = Math.floor(wy);
    wz = Math.floor(wz);
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return null;
    return { chunk, cx, cz, lx, ly: wy, lz };
  }

  _getFluidLevel(wx, wy, wz) {
    const info = this._getChunkAndLocal(wx, wy, wz);
    if (!info) return null;
    const { chunk, lx, ly, lz } = info;
    if (!chunk.getMeta) return null;
    const meta = chunk.getMeta(lx, ly, lz);
    if (meta == null) return null;
    return meta;
  }

  _setFluidLevel(wx, wy, wz, type, level) {
    const info = this._getChunkAndLocal(wx, wy, wz);
    if (!info) return;
    const { chunk, lx, ly, lz } = info;

    const id = chunk.getBlock(lx, ly, lz);
    if (id !== type) return;

    if (chunk.setMeta) {
      chunk.setMeta(lx, ly, lz, level);
    }
  }

  // ============================================================
  // Fluid queue (ring-buffer)
  // ============================================================

  _fluidKey(type, x, y, z) {
    return `${type}:${x},${y},${z}`;
  }

  _decodeFluidKey(key) {
    // key format: `${type}:${x},${y},${z}`
    const [typeStr, coordStr] = key.split(":");
    const [xStr, yStr, zStr] = coordStr.split(",");
    return {
      type: Number(typeStr),
      x: Number(xStr),
      y: Number(yStr),
      z: Number(zStr),
    };
  }

  _enqueueFluidCell(x, y, z, type) {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);

    this._fluidQueue.push({ x, y, z, type });
  }

  _dequeueFluid() {
    if (this._fluidHead >= this._fluidQueue.length) return null;
    const node = this._fluidQueue[this._fluidHead++];
    // compact occasionally so array doesn’t grow forever
    if (
      this._fluidHead > 1024 &&
      this._fluidHead * 2 > this._fluidQueue.length
    ) {
      this._fluidQueue = this._fluidQueue.slice(this._fluidHead);
      this._fluidHead = 0;
    }
    return node;
  }

  _getFluidQueueSize() {
    return this._fluidQueue.length - this._fluidHead;
  }

  // ============================================================
  // Block setters (with batching + fluid hooks)
  // ============================================================

  /**
   * World-space setter with cross-chunk support.
   * - Does nothing if target chunk does not exist.
   * - Calls rebuildGeometry() on the corresponding GrVoxelChunk, if registered.
   */
  setBlockWorld(wx, wy, wz, id, doUpdate = true) {
    if (wy < Y_MIN || wy > Y_MAX) return;

    // World → integer
    wx = Math.floor(wx);
    wy = Math.floor(wy);
    wz = Math.floor(wz);

    // World → chunk + local coords
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

    const chunk = this.getChunk(cx, cz);
    if (!chunk) return;

    const oldId = chunk.getBlock(lx, wy, lz);
    if (oldId === id) return;

    // Update voxel data
    chunk.setBlock(lx, wy, lz, id);

    // ---- schedule chunk rebuilds ----
    const affected = [[cx, cz]];
    if (lx === 0) affected.push([cx - 1, cz]);
    if (lx === CHUNK_SIZE - 1) affected.push([cx + 1, cz]);
    if (lz === 0) affected.push([cx, cz - 1]);
    if (lz === CHUNK_SIZE - 1) affected.push([cx, cz + 1]);

    for (const [rcx, rcz] of affected) {
      const key = this.key(rcx, rcz);
      if (this._batchChunks) {
        this._batchChunks.add(key);
      } else {
        const renderChunk = this.renderChunks.get(key);
        if (renderChunk && typeof renderChunk.rebuildGeometry === "function") {
          renderChunk.rebuildGeometry();
        }
      }
    }

    // --- Sponge logic: when a sponge is placed, clear nearby fluids ---
    if (id === BLOCK.SPONGE) {
      this._applySponge(wx, wy, wz, 6); // tweak radius as you like
    }

    const wasFluid = this.isLiquidId(oldId);
    const isFluid = this.isLiquidId(id);

    // 💧 New fluid block: treat as a source node for the sim
    if (isFluid && !wasFluid) {
      this._enqueueFluidCell(wx, wy, wz, id);
      const key = this._fluidKey(id, wx, wy, wz);
      this._fluidParents.set(key, null); // root
    }

    // ❌ Fluid removed: start gradual retraction from this node
    if (wasFluid && !isFluid) {
      this._scheduleRetractionFromRemovedFluid(wx, wy, wz, oldId);
    }

    // 🧱 If this block just became AIR, nearby fluids might flow into it
    if (id === BLOCK.AIR) {
      const dirs6 = [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ];

      for (const [dx, dy, dz] of dirs6) {
        const nx = wx + dx;
        const ny = wy + dy;
        const nz = wz + dz;
        const nid = this.getBlockWorld(nx, ny, nz);
        if (this.isLiquidId(nid)) {
          this._enqueueFluidCell(nx, ny, nz, nid);
        }
      }
    }
  }

  setBlockWorldWithMeta(wx, wy, wz, id, meta) {
    if (wy < Y_MIN || wy > Y_MAX) return;

    // World → integer
    wx = Math.floor(wx);
    wy = Math.floor(wy);
    wz = Math.floor(wz);

    // World → chunk + local coords
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

    const chunk = this.getChunk(cx, cz);
    if (!chunk) return;

    const oldId = chunk.getBlock(lx, wy, lz);
    const oldMeta = chunk.getMeta ? chunk.getMeta(lx, wy, lz) : 0;

    if (oldId === id && oldMeta === meta) return; // no change

    chunk.setBlock(lx, wy, lz, id);
    if (chunk.setMeta) {
      chunk.setMeta(lx, wy, lz, meta);
    }

    // ---- Collect all affected chunk coords ----
    const affected = [[cx, cz]];
    if (lx === 0) affected.push([cx - 1, cz]);
    if (lx === CHUNK_SIZE - 1) affected.push([cx + 1, cz]);
    if (lz === 0) affected.push([cx, cz - 1]);
    if (lz === CHUNK_SIZE - 1) affected.push([cx, cz + 1]);

    // ---- Rebuild render chunks (respect batching) ----
    for (const [rcx, rcz] of affected) {
      const key = this.key(rcx, rcz);
      if (this._batchChunks) {
        this._batchChunks.add(key);
      } else {
        const renderChunk = this.renderChunks.get(key);
        if (renderChunk && typeof renderChunk.rebuildGeometry === "function") {
          renderChunk.rebuildGeometry();
        }
      }
    }
  }

  // ============================================================
  // Surface / solidity helpers
  // ============================================================

  /**
   * Returns the highest solid block Y coordinate at (wx, wz)
   * Useful for entities to walk on the surface.
   */
  sampleSurfaceHeight(wx, wz, seaLevel = 62) {
    // Get corresponding chunk
    wx = Math.floor(wx);
    wz = Math.floor(wz);
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return seaLevel;

    // Local coordinates
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

    // Scan downward from the top
    for (let y = Y_MAX; y >= Y_MIN; y--) {
      const id = chunk.getBlock(lx, y, lz);
      if (!!id && !this.isLiquidId(id) && !this.isPlantId(id)) {
        return y;
      }
    }
    // fallback if all air (e.g., ocean)
    return -Infinity;
  }

  isSolidAt(wx, wy, wz) {
    const id = this.getBlockWorld(wx, wy, wz);
    return !!id && !this.isLiquidId(id) && !this.isPlantId(id);
  }

  // ============================================================
  // Fluid logic
  // ============================================================

  _canFluidEnter(type, targetId, wx, wy, wz) {
    const other =
      type === BLOCK.WATER ? BLOCK.LAVA : type === BLOCK.LAVA ? BLOCK.WATER : 0;

    // ✅ Any “replaceable” block (air, plants, etc.) can be overwritten by fluid
    if (this.isReplaceableByFluid(targetId)) {
      return true;
    }

    // 💥 Water <-> Lava reaction → cobblestone
    if (targetId === other) {
      this.setBlockWorld(wx, wy, wz, BLOCK.COBBLESTONE);
      return false;
    }

    // 🧱 True solids (dirt, stone, etc.) block fluid
    return false;
  }

  _placeFluidWithLevel(wx, wy, wz, type, level, parentKey = null) {
    const other =
      type === BLOCK.WATER ? BLOCK.LAVA : type === BLOCK.LAVA ? BLOCK.WATER : 0;

    const existing = this.getBlockWorld(wx, wy, wz);
    const key = this._fluidKey(type, wx, wy, wz);

    // Direct reaction → cobblestone
    if (existing === other) {
      const otherKey = this._fluidKey(existing, wx, wy, wz);
      this._fluidParents.delete(otherKey);
      this._fluidChildren.delete(otherKey);

      this.setBlockWorld(wx, wy, wz, BLOCK.COBBLESTONE);
      return;
    }

    // If it's already same fluid with a better (smaller) level, don't overwrite
    if (existing === type) {
      const curLevel = this._getFluidLevel(wx, wy, wz);
      if (curLevel != null && curLevel <= level) return;
    }

    // Place block + meta
    this.setBlockWorldWithMeta(wx, wy, wz, type, level);

    // ----- parent graph tracking -----
    const oldParent = this._fluidParents.get(key);
    if (oldParent && oldParent !== parentKey) {
      const kids = this._fluidChildren.get(oldParent);
      if (kids) kids.delete(key);
    }

    if (parentKey) {
      this._fluidParents.set(key, parentKey);
      let kids = this._fluidChildren.get(parentKey);
      if (!kids) {
        kids = new Set();
        this._fluidChildren.set(parentKey, kids);
      }
      kids.add(key);
    } else {
      this._fluidParents.set(key, null);
    }

    this._enqueueFluidCell(wx, wy, wz, type);
  }

  _scheduleRetractionFromRemovedFluid(wx, wy, wz, type) {
    const rootKey = this._fluidKey(type, wx, wy, wz);

    // 🌊 Start retraction at this node only.
    // Children will be enqueued gradually in _processRetractionKey().
    this._retractPending.add(rootKey);
  }

  _takeOneRetractPending() {
    for (const key of this._retractPending) {
      this._retractPending.delete(key);
      return key;
    }
    return null;
  }
  _processRetractionKey(key) {
    const { type, x, y, z } = this._decodeFluidKey(key);

    const id = this.getBlockWorld(x, y, z);
    if (id === type) {
      // Use raw setter to avoid re-triggering logic
      this._setBlockRaw(x, y, z, BLOCK.AIR);
    }

    // Wavefront: now schedule its children for later ticks
    const children = this._fluidChildren.get(key);
    if (children) {
      for (const ck of children) {
        this._retractPending.add(ck);
      }
      this._fluidChildren.delete(key);
    }

    // Detach from parent
    const parentKey = this._fluidParents.get(key);
    if (parentKey) {
      const s = this._fluidChildren.get(parentKey);
      if (s) s.delete(key);
    }
    this._fluidParents.delete(key);
  }

  _processFluidCell(node) {
    const { x, y, z, type } = node;
    const idHere = this.getBlockWorld(x, y, z);
    if (idHere !== type) return;

    const isWater = type === BLOCK.WATER;
    const maxLevel = isWater ? this._waterMaxLevel : this._lavaMaxLevel;

    let level = this._getFluidLevel(x, y, z);
    if (level == null) level = 0; // default to source if unknown

    const belowId = this.getBlockWorld(x, y - 1, z);
    if (this._canFluidEnter(type, belowId, x, y - 1, z)) {
      // ✅ downhill / vertical flow acts as a fresh local source (level 0)
      const parentKey = this._fluidKey(type, x, y, z);
      this._placeFluidWithLevel(x, y - 1, z, type, 0, parentKey);
      return; // gravity dominates
    }

    if (level < maxLevel) {
      const nextLevel = level + 1;
      const parentKey = this._fluidKey(type, x, y, z);

      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];

      for (const [dx, dz] of dirs) {
        const nx = x + dx;
        const nz = z + dz;

        const targetId = this.getBlockWorld(nx, y, nz);
        if (!this._canFluidEnter(type, targetId, nx, y, nz)) continue;

        this._placeFluidWithLevel(nx, y, nz, type, nextLevel, parentKey);
      }
    }
  }

  _setBlockRaw(wx, wy, wz, id) {
    if (wy < Y_MIN || wy > Y_MAX) return;

    wx = Math.floor(wx);
    wy = Math.floor(wy);
    wz = Math.floor(wz);

    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

    const chunk = this.getChunk(cx, cz);
    if (!chunk) return;

    const oldId = chunk.getBlock(lx, wy, lz);
    if (oldId === id) return;

    chunk.setBlock(lx, wy, lz, id);

    const affected = [[cx, cz]];
    if (lx === 0) affected.push([cx - 1, cz]);
    if (lx === CHUNK_SIZE - 1) affected.push([cx + 1, cz]);
    if (lz === 0) affected.push([cx, cz - 1]);
    if (lz === CHUNK_SIZE - 1) affected.push([cx, cz + 1]);

    for (const [rcx, rcz] of affected) {
      const key = this.key(rcx, rcz);
      if (this._batchChunks) {
        this._batchChunks.add(key);
      } else {
        const renderChunk = this.renderChunks.get(key);
        if (renderChunk && typeof renderChunk.rebuildGeometry === "function") {
          renderChunk.rebuildGeometry();
        }
      }
    }
  }

  _stepFluids(dt) {
    // 1️⃣ Active fluid spreading
    const size = this._getFluidQueueSize();
    if (size > 0) {
      const MAX_PER_TICK = 128; // spreading
      const count = Math.min(MAX_PER_TICK, size);

      const doBatch = !this._batchChunks;
      if (doBatch) this.beginBatch();

      for (let i = 0; i < count; i++) {
        const node = this._dequeueFluid();
        if (!node) break;
        this._processFluidCell(node);
      }

      if (doBatch) this.endBatch();
    }

    // 2️⃣ Gradual retraction waves
    if (this._retractPending.size > 0) {
      const MAX_RETRACT_PER_TICK = 3; // 👈 make this small so it feels gradual
      const doBatch = !this._batchChunks;
      if (doBatch) this.beginBatch();

      for (let i = 0; i < MAX_RETRACT_PER_TICK; i++) {
        const key = this._takeOneRetractPending();
        if (!key) break;
        this._processRetractionKey(key);
      }

      if (doBatch) this.endBatch();
    }
  }

  // Optional: neighbor reaction scan (currently not strictly needed,
  // since direct contact is handled by _canFluidEnter/_placeFluidWithLevel)
  _handleFluidReaction(type, wx, wy, wz) {
    const other =
      type === BLOCK.WATER ? BLOCK.LAVA : type === BLOCK.LAVA ? BLOCK.WATER : 0;
    if (!other) return;

    const dirs6 = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];

    for (const [dx, dy, dz] of dirs6) {
      const nx = wx + dx;
      const ny = wy + dy;
      const nz = wz + dz;

      const nid = this.getBlockWorld(nx, ny, nz);
      if (nid === other) {
        this.setBlockWorld(nx, ny, nz, BLOCK.COBBLESTONE);
      }
    }
  }

  // ============================================================
  // World step
  // ============================================================

  stepWorld(delta) {
    let dt = delta / 1000;

    // Gradual spawning: at most one mob per interval
    this._trySpawnMobGlobal(dt);

    // -----------------------
    // Rain global controller
    // -----------------------
    this._rainTimer += dt;

    if (this._rainTimer >= this._rainNextToggle) {
      this._rainTimer = 0;
      this._rainNextToggle = this._randomRainInterval();

      // 50% chance to toggle state
      this.isRaining = !this.isRaining;

      console.log("Rain toggled:", this.isRaining);

      // if you have a GrRain object:
      this.rainSystem.setVisible(this.isRaining);
    }

    // 💧 fluid tick pacing
    this._fluidAccum += dt;
    while (this._fluidAccum >= this._fluidStepInterval) {
      this._fluidAccum -= this._fluidStepInterval;
      this._stepFluids(this._fluidStepInterval);
    }
  }
}

// this variable has been generated with the help of copilot
// ---- helper: per-face UV corner order that matches your face vertex order ----
// For a rect {u0,v0,u1,v1}, these are the 4 corners placed to the 4 face verts.
const UV_ORDER = {
  PX: (r) => [r.u1, r.v1, r.u1, r.v0, r.u0, r.v0, r.u0, r.v1], // +X (right)
  NX: (r) => [r.u0, r.v1, r.u0, r.v0, r.u1, r.v0, r.u1, r.v1], // -X (left)
  PY: (r) => [r.u0, r.v0, r.u1, r.v0, r.u1, r.v1, r.u0, r.v1], // +Y (top)
  NY: (r) => [r.u0, r.v1, r.u1, r.v1, r.u1, r.v0, r.u0, r.v0], // -Y (bottom)
  PZ: (r) => [r.u1, r.v1, r.u0, r.v1, r.u0, r.v0, r.u1, r.v0], // +Z (front/south)
  NZ: (r) => [r.u0, r.v1, r.u1, r.v1, r.u1, r.v0, r.u0, r.v0], // -Z (back/north)
};

// this function has been generated with the help of copilot
// rotate UVs in 90° steps (0/90/180/270) if a face needs it.
function rotUV4(uvArr, quarterTurns = 0) {
  // uvArr is 8 numbers: [u0,v0, u1,v1, u2,v2, u3,v3]
  let steps = ((quarterTurns % 4) + 4) % 4;
  while (steps--) {
    // rotate corners: 0->1->2->3->0
    const tmpU = uvArr[0],
      tmpV = uvArr[1];
    uvArr[0] = uvArr[2];
    uvArr[1] = uvArr[3];
    uvArr[2] = uvArr[4];
    uvArr[3] = uvArr[5];
    uvArr[4] = uvArr[6];
    uvArr[5] = uvArr[7];
    uvArr[6] = tmpU;
    uvArr[7] = tmpV;
  }
  return uvArr;
}

//this function has been generated with the help of copilot
function neighborOccludes(neighborId, sourceId) {
  if (neighborId === BLOCK.AIR) return false;

  const nbd = getBlockData(neighborId);
  const sbd = getBlockData(sourceId);
  if (!nbd || !sbd) return false;

  // Same block type (e.g., water vs water) -> no face
  if (neighborId === sourceId) return true;

  // If neighbor is transparent but not the same type,
  // e.g. water next to glass or lava, don't occlude either
  if (nbd.transparentRendering || sbd.transparentRendering) return false;

  // Otherwise, standard occlusion logic
  return nbd.occludesFaces;
}

//this function has been geneerated with the help of copilot
/** ====== Mesher: builds ONE mesh per chunk (visible faces only) for performance ====== */
function buildChunkGeometry(chunk, world) {
  const emissiveGroup = new T.Group();

  const solid = {
    positions: [],
    normals: [],
    uvs: [],
    colors: [],
    indices: [],
    vertCount: 0,
  };
  const transparent = {
    positions: [],
    normals: [],
    uvs: [],
    colors: [],
    indices: [],
    vertCount: 0,
  };
  const water = {
    positions: [],
    normals: [],
    uvs: [],
    colors: [],
    indices: [],
    vertCount: 0,
  };

  // Extra overlay just for "bright" blocks (e.g., glowstone faces)
  const glowOverlay = {
    positions: [],
    normals: [],
    uvs: [],
    colors: [],
    indices: [],
    vertCount: 0,
  };

  const faces = [
    {
      key: "PX",
      n: [1, 0, 0],
      v: [
        [1, 0, 0],
        [1, 1, 0],
        [1, 1, 1],
        [1, 0, 1],
      ],
      step: [1, 0, 0],
    },
    {
      key: "NX",
      n: [-1, 0, 0],
      v: [
        [0, 0, 1],
        [0, 1, 1],
        [0, 1, 0],
        [0, 0, 0],
      ],
      step: [-1, 0, 0],
    },
    {
      key: "PY",
      n: [0, 1, 0],
      v: [
        [0, 1, 1],
        [1, 1, 1],
        [1, 1, 0],
        [0, 1, 0],
      ],
      step: [0, 1, 0],
    },
    {
      key: "NY",
      n: [0, -1, 0],
      v: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, 1],
        [0, 0, 1],
      ],
      step: [0, -1, 0],
    },
    {
      key: "PZ",
      n: [0, 0, 1],
      v: [
        [0, 0, 1],
        [1, 0, 1],
        [1, 1, 1],
        [0, 1, 1],
      ],
      step: [0, 0, 1],
    },
    {
      key: "NZ",
      n: [0, 0, -1],
      v: [
        [1, 0, 0],
        [0, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
      ],
      step: [0, 0, -1],
    },
  ];

  const crossGroup = new T.Group();

  function pushFace(bd, arr, wx, wy, wz, f, rect, tint) {
    for (let i = 0; i < 4; i++) {
      const vx = wx + f.v[i][0];
      const vy = wy + f.v[i][1];
      const vz = wz + f.v[i][2];
      arr.positions.push(vx, vy, vz);
      arr.normals.push(f.n[0], f.n[1], f.n[2]);
    }

    // base UVs from atlas rect
    let uv4 = UV_ORDER[f.key](rect);
    if (bd.rot && bd.rot[f.key]) {
      uv4 = rotUV4([...uv4], bd.rot[f.key]);
    }
    arr.uvs.push(...uv4);

    // If prototype mode, ignore the specific face tint and use the Block's ID color
    const colorHex = window.prototype ? bd.protoColor : tint;

    const c = new T.Color(colorHex);
    for (let i = 0; i < 4; i++) {
      arr.colors.push(c.r, c.g, c.b);
    }

    arr.indices.push(
      arr.vertCount + 0,
      arr.vertCount + 1,
      arr.vertCount + 2,
      arr.vertCount + 0,
      arr.vertCount + 2,
      arr.vertCount + 3
    );
    arr.vertCount += 4;
  }

  for (let y = Y_MIN; y <= Y_MAX; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const id = chunk.getBlock(x, y, z);
        if (id === BLOCK.AIR) continue;

        const bd = getBlockData(id);
        if (!bd) continue;

        const wx = chunk.chunkX * CHUNK_SIZE + x;
        const wy = y;
        const wz = chunk.chunkZ * CHUNK_SIZE + z;

        // ---------- CROSS-SHAPED BLOCKS (plants, torches, etc.) ----------
        if (bd.kind === "cross") {
          const isTorch = id === BLOCK.TORCH;

          // Base (textured) cross using original material
          const baseMat = bd.material;
          const a = new T.Mesh(bd.geometry, baseMat);
          const b = new T.Mesh(
            bd.geometry,
            baseMat.clone ? baseMat.clone() : baseMat
          );
          b.rotation.y = Math.PI / 2;

          const g = new T.Group();
          g.add(a, b);
          g.position.set(wx + 0.5, wy, wz + 0.5);

          if (window.prototype) {
            // Just add the basic geometry, skip the complex glow overlay logic below
            const g = new T.Group();
            g.add(a, b);
            g.position.set(wx + 0.5, wy, wz + 0.5);
            // Apply rotation logic...
            crossGroup.add(g);
            continue;
          }

          if (isTorch) {
            // Orient torch for wall / floor, as before
            const meta = chunk.getMeta ? chunk.getMeta(x, y, z) : 0;
            switch (meta) {
              case 0:
                // floor torch
                break;
              case 1: // north
                g.rotation.x = Math.PI / 4;
                g.position.z -= 0.52;
                g.position.y += 0.35;
                break;
              case 2: // south
                g.rotation.x = -Math.PI / 4;
                g.position.z += 0.52;
                g.position.y += 0.35;
                break;
              case 3: // east
                g.rotation.z = Math.PI / 4;
                g.position.x += 0.52;
                g.position.y += 0.35;
                break;
              case 4: // west
                g.rotation.z = -Math.PI / 4;
                g.position.x -= 0.52;
                g.position.y += 0.35;
                break;
            }

            // --- Torch glow overlay (same geometry, additive, unlit) ---
            const glowColor = bd.glowTint || 0xffffcc;
            const glowMat = new T.MeshBasicMaterial({
              map: atlasTexture,
              transparent: true,
              alphaTest: 0.5,
              depthWrite: false,
              blending: T.AdditiveBlending,
              color: glowColor,
              side: T.DoubleSide,
              polygonOffset: true,
              polygonOffsetFactor: -1,
              polygonOffsetUnits: -1,
            });

            const glowA = new T.Mesh(bd.geometry, glowMat);
            const glowB = new T.Mesh(
              bd.geometry,
              glowMat.clone ? glowMat.clone() : glowMat
            );
            glowB.rotation.y = Math.PI / 2;

            const glowGroup = new T.Group();
            glowGroup.add(glowA, glowB);
            // Slightly scale up so glow extends a bit past the base torch
            glowGroup.scale.set(1.03, 1.03, 1.03);

            // Attach overlay to same group so it inherits position/rotation
            g.add(glowGroup);

            // --- Torch point light ---
            const lightColor = bd.emissiveColor || 0xffddaa;
            const lightIntensity =
              bd.lightIntensity !== undefined ? bd.lightIntensity : 0.9;
            const lightDistance =
              bd.lightDistance !== undefined ? bd.lightDistance : 8;

            const torchLight = new T.PointLight(
              lightColor,
              lightIntensity,
              lightDistance
            );
            torchLight.position.set(0, 0.7, 0); // near flame
            g.add(torchLight);

            // Torches live in emissiveGroup (so rebuild cleans them up)
            emissiveGroup.add(g);
          } else {
            // Non-torch plants / flowers
            crossGroup.add(g);
          }

          continue;
        }

        // ---------- REGULAR CUBE FACES ----------
        let target = null;
        if (id === BLOCK.WATER) {
          target = water;
        } else if (bd.transparentRendering) {
          target = transparent;
        } else {
          target = solid;
        }

        const isGlowstone = id === BLOCK.GLOWSTONE;

        for (const f of faces) {
          const nx = wx + f.step[0];
          const ny = wy + f.step[1];
          const nz = wz + f.step[2];
          const neighbor = world.getBlockWorld(nx, ny, nz);
          if (!neighborOccludes(neighbor, id)) {
            const rect = bd.faces[f.key];
            const tint = bd.tints?.[f.key] ?? 0xffffff;

            // normal block face (lambert, lit by lights)
            pushFace(bd, target, wx, wy, wz, f, rect, tint);

            // glowstone overlay face (same UVs, brighter + additive)
            if (isGlowstone) {
              const glowTint = bd.glowTint || 0xffffaa;
              pushFace(bd, glowOverlay, wx, wy, wz, f, rect, glowTint);
            }
          }
        }

        // Glowstone: point light at block center
        if (isGlowstone) {
          const lightColor = bd.emissiveColor || 0xffe6aa;
          const lightIntensity =
            bd.lightIntensity !== undefined ? bd.lightIntensity : 0.9;
          const lightDistance =
            bd.lightDistance !== undefined ? bd.lightDistance : 12;

          const glowLight = new T.PointLight(
            lightColor,
            lightIntensity,
            lightDistance
          );
          glowLight.position.set(wx + 0.5, wy + 0.5, wz + 0.5);
          emissiveGroup.add(glowLight);
        }
      }
    }
  }

  // ---------- Geometry builders ----------
  function makeMesh(arr, matOpts) {
    if (arr.positions.length === 0) return null;

    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(arr.positions, 3));
    g.setAttribute("normal", new T.Float32BufferAttribute(arr.normals, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(arr.uvs, 2));
    g.setAttribute("color", new T.Float32BufferAttribute(arr.colors, 3));
    g.setIndex(arr.indices);

    let mat;
    if (window.prototype) {
      // PROTOTYPE: Basic material, vertex colors enabled
      mat = new T.MeshBasicMaterial({
        vertexColors: true,
        side: T.FrontSide,
      });

      // If it's transparent (glass/water), reduce opacity
      if (matOpts && matOpts.transparent) {
        mat.transparent = true;
        mat.opacity = 0.6;
      }
    } else {
      // NORMAL: Lambert with Atlas
      mat =
        matOpts instanceof T.ShaderMaterial
          ? matOpts
          : new T.MeshLambertMaterial({
              map: atlasTexture,
              vertexColors: true,
              alphaTest: 0.5,
              side: T.FrontSide,
              ...matOpts,
            });
    }

    return new T.Mesh(g, mat);
  }

  // separate builder for glow overlay (uses additive, unlit material)
  function makeGlowMesh(arr) {
    if (arr.positions.length === 0) return null;

    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(arr.positions, 3));
    g.setAttribute("normal", new T.Float32BufferAttribute(arr.normals, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(arr.uvs, 2));
    g.setAttribute("color", new T.Float32BufferAttribute(arr.colors, 3));
    g.setIndex(arr.indices);

    const mat = new T.MeshBasicMaterial({
      map: atlasTexture,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending, // this makes it "brighten" the underlying texture
      side: T.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    return new T.Mesh(g, mat);
  }

  const solidMesh = makeMesh(solid, null);
  const transparentMesh = makeMesh(transparent, {
    transparent: true,
    opacity: 0.7,
    depthWrite: true,
  });
  const waterMesh = makeMesh(water, world.waterMaterial);
  const glowMesh = makeGlowMesh(glowOverlay);

  const group = new T.Group();
  if (solidMesh) group.add(solidMesh);
  if (transparentMesh) group.add(transparentMesh);
  if (waterMesh) group.add(waterMesh);
  if (glowMesh) emissiveGroup.add(glowMesh);

  group.add(crossGroup);

  return { chunkMesh: group, crossGroup, waterMesh, emissiveGroup };
}

//this class been generated with the help of copilot
/** ====== Renderable chunk wrapper ====== */
export class GrVoxelChunk extends GrObject {
  constructor(voxelWorld, chunk) {
    const group = new T.Group();
    super(`Chunk_${chunk.chunkX}_${chunk.chunkZ}`, group);
    this._world = voxelWorld;
    this._chunk = chunk;

    // Build once
    const { chunkMesh, crossGroup, waterMesh, emissiveGroup } =
      buildChunkGeometry(chunk, voxelWorld);
    this._chunkMesh = chunkMesh;
    this._emissiveGroup = emissiveGroup;
    this._crossGroup = crossGroup;
    this._waterMesh = waterMesh;

    if (chunkMesh) group.add(chunkMesh);
    if (crossGroup) group.add(crossGroup);
    if (waterMesh) group.add(waterMesh);
    if (emissiveGroup) group.add(emissiveGroup);
    this._world.registerRenderChunk(chunk.chunkX, chunk.chunkZ, this);

    // --- Grass regrowth random tick state ---
    this._grassTickTimer = 0;
    this._grassTickInterval = 0.75; // seconds between ticks (tweak)
    this._grassTrialsPerTick = 4; // how many random spots per tick
    this._waterTime = 0;
  }

  /**
   * Rebuild the chunk's mesh after voxel data changes.
   * Safely disposes old geometry/materials to avoid memory leaks.
   */
  rebuildGeometry() {
    const group = this.objects[0];

    // ---- 1. Remove + safely dispose old solid mesh ----
    if (this._chunkMesh) {
      group.remove(this._chunkMesh);

      // It may be a Group (if empty) or a Mesh
      if (this._chunkMesh.geometry) {
        this._chunkMesh.geometry.dispose();
      }
      if (this._chunkMesh.material) {
        if (Array.isArray(this._chunkMesh.material)) {
          this._chunkMesh.material.forEach((m) => m.dispose());
        } else {
          this._chunkMesh.material.dispose();
        }
      }
    }

    // ---- 2. Remove + safely dispose old crossGroup ----
    if (this._crossGroup) {
      group.remove(this._crossGroup);

      // crossGroup may contain meshes that need disposal
      this._crossGroup.traverse((obj) => {
        if (obj.isMesh) {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) obj.material.dispose();
        }
      });
    }

    if (this._waterMesh) {
      group.remove(this._waterMesh);
      this._waterMesh.traverse((obj) => {
        if (obj.isMesh) {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) obj.material.dispose();
        }
      });
    }

    if (this._emissiveGroup) {
      group.remove(this._emissiveGroup);
      this._emissiveGroup.traverse((obj) => {
        if (obj.isMesh) {
          obj.geometry.dispose();
          obj.material.dispose();
        }
      });
    }

    // ---- 3. Rebuild the new meshes ----
    const { chunkMesh, crossGroup, waterMesh, emissiveGroup } =
      buildChunkGeometry(this._chunk, this._world);
    this._chunkMesh = chunkMesh;
    this._crossGroup = crossGroup;
    this._waterMesh = waterMesh;
    this._emissiveGroup = emissiveGroup;

    // ---- 4. Add them back (null-safe) ----
    if (chunkMesh) group.add(chunkMesh);
    if (crossGroup) group.add(crossGroup);
    if (waterMesh) group.add(waterMesh);
    if (emissiveGroup) group.add(emissiveGroup);
  }

  _randomGrassRegrowth() {
    const world = this._world;
    const chunk = this._chunk;
    const cx = chunk.chunkX;
    const cz = chunk.chunkZ;

    for (let i = 0; i < this._grassTrialsPerTick; i++) {
      // Pick a random local (lx,lz) in this chunk
      const lx = (Math.random() * CHUNK_SIZE) | 0;
      const lz = (Math.random() * CHUNK_SIZE) | 0;

      // Convert to world coords
      const wx = cx * CHUNK_SIZE + lx;
      const wz = cz * CHUNK_SIZE + lz;

      // Find the top solid block at this column
      const yTop = world.sampleSurfaceHeight(wx, wz);
      if (!isFinite(yTop)) continue;

      const id = world.getBlockWorld(wx, yTop, wz);

      // Only turn DIRT back into GRASS_BLOCK
      if (id !== BLOCK.DIRT) continue;

      // Require air above (no block sitting on top)
      const above = world.getBlockWorld(wx, yTop + 1, wz);
      if (above !== BLOCK.AIR) continue;

      // Optional: don't regrow underwater
      if (world.isLiquidAt(wx, yTop + 1, wz)) continue;

      // Require at least one neighboring grass_block on the same level
      let hasGrassNeighbor = false;
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];

      for (const [dx, dz] of dirs) {
        const nid = world.getBlockWorld(wx + dx, yTop, wz + dz);
        if (nid === BLOCK.GRASS_BLOCK) {
          hasGrassNeighbor = true;
          break;
        }
      }

      if (!hasGrassNeighbor) continue;

      // Finally: regrow this dirt into grass_block
      world.setBlockWorld(wx, yTop, wz, BLOCK.GRASS_BLOCK);
    }
  }
  stepWorld(delta) {
    // Convert delta from ms → seconds if needed (like in your entities)
    let dt = delta / 1000;

    this._grassTickTimer += dt;
    if (this._grassTickTimer >= this._grassTickInterval) {
      this._grassTickTimer = 0;
      this._randomGrassRegrowth();
    }

    if (this._waterMesh && this._waterMesh.material.uniforms) {
      this._waterTime += dt;
      this._waterMesh.material.uniforms.uTime.value = this._waterTime;
    }
  }
}
