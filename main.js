// CS559 2025 Workbook

import { GrWorld } from "../libs/framework/GrWorld.js";
import * as T from "../libs/threeJS/build/three.module.js";

import {
  CHUNK_SIZE,
  VoxelWorld,
  VoxelChunk,
  GrVoxelChunk,
  VoxelWorldTicker,
} from "./voxel_engine.js";

import { BLOCK } from "./block_registry.js";
import {
  generateTerrainForChunk,
  pendingBlocks,
} from "./terrain_generation.js";
import { flushPendingForChunk } from "./structures.js";

import { GrCreeper, GrPig, GrPlayer, GrSheep } from "./entities.js";
import { GrCloud } from "./clouds.js";
import { GrSunAndMoon } from "./sun_and_moon.js";
import { GrRain } from "./rain.js";
import { createWaterMaterial, GrWaterEnvProbe } from "./water_material.js";
import { atlasTexture } from "./block_factory.js";
import { BlockPicker } from "./ui.js";

// Need GrObject for GrChunkManager
import { GrObject } from "../libs/framework/GrObject.js";

// -------------------------------------------------------
// Loading screen helpers
// -------------------------------------------------------

let totalSteps = 0;
let completedSteps = 0;

//this function has been generated with the help of copilot
function initLoadingSteps(n) {
  totalSteps = n;
  completedSteps = 0;
  updateLoadingUI(0);
}
//this function has been generated with the help of copilot
function stepDone() {
  completedSteps++;
  const pct =
    totalSteps > 0 ? Math.floor((completedSteps / totalSteps) * 100) : 100;
  updateLoadingUI(pct);
  if (pct >= 100) finishLoadingScreen();
}
//this function has been generated with the help of copilot
function updateLoadingUI(pct) {
  const bar = document.getElementById("loading-bar");
  if (bar) bar.style.width = pct + "%";
}
//this function has been generated with the help of copilot
function setPhase(text) {
  const txt = document.getElementById("loading-text");
  if (txt) txt.innerText = text;
}
//this function has been generated with the help of copilot
function showLoadingScreen() {
  const scr = document.getElementById("loading-screen");
  if (scr) {
    scr.style.display = "flex";
    scr.style.opacity = "1";
  }
}
//this function has been generated with the help of copilot
function finishLoadingScreen() {
  const scr = document.getElementById("loading-screen");
  if (!scr) return;
  scr.style.opacity = "0";
  setTimeout(() => (scr.style.display = "none"), 600);
}

// -------------------------------------------------------
// Globals
// -------------------------------------------------------

let world = null;
let player = null;
let chunkManager = null;

let worldSeed = 205;
let viewRadiusChunks = 5;
let fieldOfView = 80;
//this function has been generated with the help of copilot
function applyFovToCamera() {
  if (!world || !player) return;

  const cams = [];
  if (world.camera) cams.push(world.camera);
  if (world.active_camera && world.active_camera !== world.camera) {
    cams.push(world.active_camera);
  }
  player.baseFov = fieldOfView;
  player.sprintFov = player.baseFov + 10;
  player.sneakFov = player.baseFov - 5;
}

// -------------------------------------------------------
// Chunk + Mob streaming manager
// -------------------------------------------------------
//this class has been generated with the help of copilot
class GrChunkManager extends GrObject {
  constructor(grWorld, voxelWorld, player, options = {}) {
    const group = new T.Group();
    super("ChunkManager", group);

    this.grWorld = grWorld;
    this.voxelWorld = voxelWorld;
    this.player = player;

    this.viewRadius = options.viewRadius ?? 5;
    this.seed = options.seed ?? 205;

    this.loadedChunkKeys = new Set(); // `${cx},${cz}` currently rendered
    this.savedMobsByChunk = new Map(); // key -> [ snapshots ]

    this.updateInterval = 0.4; // seconds between streaming checks
    this._accum = 0;

    this._lastBaseCx = null;
    this._lastBaseCz = null;
  }

  setViewRadius(r) {
    this.viewRadius = Math.max(1, r | 0);
  }

  // ---------- Helpers ----------

  _getPlayerPos() {
    if (this.player && this.player.pos) return this.player.pos;
    if (this.player && this.player.objects && this.player.objects[0]) {
      return this.player.objects[0].position;
    }
    return this.player?.position ?? { x: 0, y: 0, z: 0 };
  }

  _getObjectPos(obj) {
    if (obj.pos) return obj.pos;
    if (obj.objects && obj.objects[0]) return obj.objects[0].position;
    return obj.position ?? { x: 0, y: 0, z: 0 };
  }

  _chunkKey(cx, cz) {
    return `${cx},${cz}`;
  }

  _parseChunkKey(key) {
    const [cxStr, czStr] = key.split(",");
    return { cx: Number(cxStr), cz: Number(czStr) };
  }

  _inferMobType(mob) {
    if (mob instanceof GrPig) return "pig";
    if (mob instanceof GrSheep) return "sheep";
    if (mob instanceof GrCreeper) return "creeper";
    return mob.entityType || mob._type || "unknown";
  }

  _snapshotMob(mob) {
    const pos = this._getObjectPos(mob);
    const type = this._inferMobType(mob);

    const snapshot = {
      type,
      x: pos.x,
      y: pos.y,
      z: pos.z,
    };

    const health = mob.health ?? mob.hp ?? mob._health;
    if (health !== undefined) {
      snapshot.health = health;
    }

    return snapshot;
  }

  _restoreMobSnapshot(snapshot) {
    if (!snapshot.type || snapshot.type === "unknown") return;

    const mob = this.voxelWorld.spawnMobAt(
      snapshot.type,
      snapshot.x,
      snapshot.y,
      snapshot.z
    );
    if (!mob) return;

    if (snapshot.health !== undefined) {
      if ("health" in mob) mob.health = snapshot.health;
      else if ("hp" in mob) mob.hp = snapshot.health;
      else if ("_health" in mob) mob._health = snapshot.health;
    }
  }

  // ---------- Chunk ensure/unload ----------

  _ensureChunkVoxel(cx, cz) {
    let chunk = this.voxelWorld.getChunk(cx, cz);
    if (!chunk) {
      chunk = new VoxelChunk(cx, cz);
      generateTerrainForChunk(chunk, this.seed);
      this.voxelWorld.setChunk(cx, cz, chunk);
    }
    // ✅ Always flush pending for this chunk, even if it already existed
    flushPendingForChunk(pendingBlocks, chunk);
    return chunk;
  }

  _ensureChunkAndRender(cx, cz) {
    const key = this.voxelWorld.key(cx, cz);

    // 1) Ensure voxel data
    const chunk = this._ensureChunkVoxel(cx, cz);

    // 2) Ensure render chunk
    let renderChunk = this.voxelWorld.renderChunks.get(key);
    if (!renderChunk) {
      renderChunk = new GrVoxelChunk(this.voxelWorld, chunk);
      this.grWorld.add(renderChunk);
    }

    // 3) Restore any mobs saved for this chunk
    this._restoreMobsForChunk(cx, cz);

    this.loadedChunkKeys.add(key);
  }

  _unloadMobsInChunk(cx, cz) {
    const key = this._chunkKey(cx, cz);
    const snapshots = this.savedMobsByChunk.get(key) || [];

    const mobs = this.voxelWorld.mobs.slice();
    for (const mob of mobs) {
      if (
        !(mob instanceof GrPig) &&
        !(mob instanceof GrSheep) &&
        !(mob instanceof GrCreeper)
      ) {
        continue;
      }

      const pos = this._getObjectPos(mob);
      const mcx = Math.floor(pos.x / CHUNK_SIZE);
      const mcz = Math.floor(pos.z / CHUNK_SIZE);
      if (mcx !== cx || mcz !== cz) continue;

      const snap = this._snapshotMob(mob);
      snapshots.push(snap);
      this.voxelWorld.despawnMob(mob);
    }

    if (snapshots.length > 0) {
      this.savedMobsByChunk.set(key, snapshots);
    }
  }

  _restoreMobsForChunk(cx, cz) {
    const key = this._chunkKey(cx, cz);
    const arr = this.savedMobsByChunk.get(key);
    if (!arr || arr.length === 0) return;

    const leftover = [];
    for (const snap of arr) {
      this._restoreMobSnapshot(snap);
    }

    if (leftover.length > 0) this.savedMobsByChunk.set(key, leftover);
    else this.savedMobsByChunk.delete(key);
  }

  _unloadChunkByKey(key) {
    const { cx, cz } = this._parseChunkKey(key);

    // 1) Save / despawn mobs in this chunk
    this._unloadMobsInChunk(cx, cz);

    // 2) Remove render chunk
    const renderChunk = this.voxelWorld.renderChunks.get(key);
    if (renderChunk) {
      this.grWorld.remove(renderChunk);
      this.voxelWorld.renderChunks.delete(key);
    }

    this.loadedChunkKeys.delete(key);
  }

  // ---------- Initial region generation (with loading bar) ----------

  async initialLoad() {
    const playerPos = this._getPlayerPos();
    const baseCx = Math.floor(playerPos.x / CHUNK_SIZE);
    const baseCz = Math.floor(playerPos.z / CHUNK_SIZE);

    const needed = [];
    for (let dz = -this.viewRadius; dz <= this.viewRadius; dz++) {
      for (let dx = -this.viewRadius; dx <= this.viewRadius; dx++) {
        if (dx * dx + dz * dz > this.viewRadius * this.viewRadius) continue;
        needed.push({ cx: baseCx + dx, cz: baseCz + dz });
      }
    }

    initLoadingSteps(needed.length);
    setPhase("Generating world chunks...");

    for (const { cx, cz } of needed) {
      this._ensureChunkAndRender(cx, cz);
      stepDone();
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // ---------- Streaming during gameplay ----------

  _updateStreaming() {
    const pos = this._getPlayerPos();
    const baseCx = Math.floor(pos.x / CHUNK_SIZE);
    const baseCz = Math.floor(pos.z / CHUNK_SIZE);

    // ✅ If still in same chunk, no need to recompute streaming
    if (baseCx === this._lastBaseCx && baseCz === this._lastBaseCz) return;
    this._lastBaseCx = baseCx;
    this._lastBaseCz = baseCz;

    const targetKeys = new Set();

    // Load needed chunks
    for (let dz = -this.viewRadius; dz <= this.viewRadius; dz++) {
      for (let dx = -this.viewRadius; dx <= this.viewRadius; dx++) {
        if (dx * dx + dz * dz > this.viewRadius * this.viewRadius) continue;
        const cx = baseCx + dx;
        const cz = baseCz + dz;
        const key = this.voxelWorld.key(cx, cz);
        targetKeys.add(key);
        if (!this.loadedChunkKeys.has(key)) {
          this._ensureChunkAndRender(cx, cz);
        }
      }
    }

    const toUnload = [];
    for (const key of this.loadedChunkKeys) {
      if (!targetKeys.has(key)) toUnload.push(key);
    }
    for (const key of toUnload) {
      this._unloadChunkByKey(key);
    }
  }

  stepWorld(delta) {
    const dt = delta / 1000;
    this._accum += dt;
    if (this._accum < this.updateInterval) return;
    this._accum = 0;
    this._updateStreaming();
  }
}

// -------------------------------------------------------
// Game setup / regeneration
// -------------------------------------------------------
//this function has been generated with the help of copilot
async function startGameFromUI() {
  const seedInput = document.getElementById("seed-input");
  const radiusSlider = document.getElementById("radius-slider");
  const fovSlider = document.getElementById("fov-slider");

  if (seedInput) {
    const val = Number(seedInput.value);
    if (!Number.isNaN(val)) worldSeed = val;
  }
  if (radiusSlider) {
    const val = Number(radiusSlider.value);
    if (!Number.isNaN(val)) viewRadiusChunks = val;
  }
  if (fovSlider) {
    const val = Number(fovSlider.value);
    if (!Number.isNaN(val)) fieldOfView = val;
  }

  await regenerateWorldInternal(worldSeed, viewRadiusChunks);

  // Sync sliders in both menus after world is ready
  syncViewDistanceUI(viewRadiusChunks);
  syncFovUI(fieldOfView);
}
//this function has been generated with the help of copilot
async function regenerateWorldInternal(seed, radiusChunks) {
  showLoadingScreen();
  setPhase("Preparing world...");

  // 🔄 Reset per-world state
  pendingBlocks.clear();

  world.scene.clear();
  world.objects = [];

  // Soft sky + basic ambient light
  world.scene.background = new T.Color(0x87ceeb);
  world.scene.add(new T.AmbientLight("white", 0.1));

  // --- Create voxel world & environment ---

  const rainSystem = new GrRain(world);
  world.add(rainSystem);

  const vw = new VoxelWorld(world, rainSystem);
  voxelWorldInstance = vw;

  const envProbe = new GrWaterEnvProbe(world, vw);
  world.add(envProbe);

  vw.waterMaterial = createWaterMaterial(
    envProbe.renderTarget.texture,
    atlasTexture
  );

  // Sun & moon
  world.add(new GrSunAndMoon(world, vw));

  // Clouds
  world.add(
    new GrCloud({
      areaSize: 1000,
      height: 120,
      blockSize: 4,
      threshold: 0.62,
      scale: 0.05,
      world,
    })
  );

  // Voxel world ticker (fluids, mobs, rain)
  world.add(new VoxelWorldTicker(vw));

  // --- Player & camera ---

  const playerCam = new T.PerspectiveCamera(
    fieldOfView,
    window.innerWidth / window.innerHeight,
    0.01,
    1000
  );
  world.active_camera = playerCam;
  world.camera = playerCam;
  // ensure FOV is applied & projection updated
  applyFovToCamera();

  const waterTintEl = document.getElementById("water-tint");

  player = new GrPlayer(
    "models/minecraft-player/source/MinecraftPlayer/Player.fbx",
    vw,
    world.scene,
    {
      x: 0,
      y: 80,
      z: 0,
      camera: playerCam,
      domElement: world.renderer.domElement,
      mouseLook: true,
      viewMode: "third",
      waterTintEl,
    }
  );
  world.add(player);
  vw.player = player;

  // --- Block picker ---

  const allBlockIds = Object.values(BLOCK).filter((id) => id !== BLOCK.AIR);

  world.blockPicker = new BlockPicker(
    world.renderer,
    [null, ...allBlockIds],
    (blockId) => {
      player.setHeldItem(blockId);
    },
    {
      domElement: world.renderer.domElement,
      iconsPerRow: 9,
      rowsVisible: 5,
    }
  );

  // --- Chunk & mob streaming manager ---

  chunkManager = new GrChunkManager(world, vw, player, {
    viewRadius: radiusChunks,
    seed,
  });
  world.add(chunkManager);

  // --- Initial region generation with progress bar ---

  await chunkManager.initialLoad();

  finishLoadingScreen();
}

// -------------------------------------------------------
// View distance UI sync (main menu + options)
// -------------------------------------------------------
//this function has been generated with the help of copilot
function syncViewDistanceUI(value) {
  const radiusSlider = document.getElementById("radius-slider");
  const radiusValue = document.getElementById("radius-value");
  const optSlider = document.getElementById("options-radius-slider");
  const optValue = document.getElementById("options-radius-value");

  const vStr = String(value);

  if (radiusSlider) radiusSlider.value = vStr;
  if (radiusValue) radiusValue.innerText = vStr;
  if (optSlider) optSlider.value = vStr;
  if (optValue) optValue.innerText = vStr;
}
//this function has been generated with the help of copilot
function syncFovUI(value) {
  const fovSlider = document.getElementById("fov-slider");
  const fovValue = document.getElementById("fov-value");
  const optFovSlider = document.getElementById("options-fov-slider");
  const optFovValue = document.getElementById("options-fov-value");

  const label = `${value}°`;

  if (fovSlider) fovSlider.value = String(value);
  if (fovValue) fovValue.innerText = label;
  if (optFovSlider) optFovSlider.value = String(value);
  if (optFovValue) optFovValue.innerText = label;

  applyFovToCamera();
}

// -------------------------------------------------------
// Build UI + start world
// -------------------------------------------------------
//this function has been generated with the help of copilot
const main = async () => {
  // Create GrWorld once
  world = new GrWorld({
    width: window.innerWidth,
    height: window.innerHeight,
    groundplane: false,
    lights: [],
    where: document.getElementById("screenDiv"),
    renderparams: {
      autoClear: false,
    },
  });

  // ===== UI hooks =====
  window.onload = () => {
    const mainMenu = document.getElementById("world-controls");
    const regenBtn = document.getElementById("regen-btn");
    const radiusSlider = document.getElementById("radius-slider");
    const radiusValue = document.getElementById("radius-value");

    const optionsMenu = document.getElementById("options-menu");
    const optSlider = document.getElementById("options-radius-slider");
    const optValue = document.getElementById("options-radius-value");
    const optResumeBtn = document.getElementById("options-resume-btn");
    const optMainMenuBtn = document.getElementById("options-mainmenu-btn");

    const fovSlider = document.getElementById("fov-slider");
    const fovValue = document.getElementById("fov-value");
    const optFovSlider = document.getElementById("options-fov-slider");
    const optFovValue = document.getElementById("options-fov-value");

    // --- Main menu: Create/Regenerate world ---
    if (regenBtn) {
      regenBtn.addEventListener("click", () => {
        if (mainMenu) mainMenu.classList.add("hidden");
        startGameFromUI();
      });
    }

    // --- Main menu view radius slider ---
    if (radiusSlider && radiusValue) {
      radiusValue.innerText = radiusSlider.value;
      radiusSlider.addEventListener("input", (e) => {
        const val = Number(e.target.value) || 5;
        viewRadiusChunks = val;
        radiusValue.innerText = String(val);
        syncViewDistanceUI(val);
        if (chunkManager) {
          chunkManager.setViewRadius(val);
        }
      });
    }

    // --- Main menu FOV slider ---
    if (fovSlider && fovValue) {
      fovValue.innerText = `${fovSlider.value}°`;
      fovSlider.addEventListener("input", (e) => {
        const val = Number(e.target.value) || 80;
        fieldOfView = val;
        syncFovUI(val);
      });
    }

    // Helpers for options menu
    const showOptionsMenu = () => {
      if (!optionsMenu) return;
      syncViewDistanceUI(viewRadiusChunks);
      syncFovUI(fieldOfView);
      optionsMenu.classList.remove("hidden");

      if (document.pointerLockElement === world.renderer.domElement) {
        document.exitPointerLock();
      }
    };

    const hideOptionsMenu = () => {
      if (!optionsMenu) return;
      optionsMenu.classList.add("hidden");
    };

    // --- Options menu slider ---
    if (optSlider && optValue) {
      optSlider.addEventListener("input", (e) => {
        const val = Number(e.target.value) || 5;
        viewRadiusChunks = val;
        optValue.innerText = String(val);
        syncViewDistanceUI(val);
        if (chunkManager) {
          chunkManager.setViewRadius(val);
        }
      });
    }

    // --- Options menu FOV slider ---
    if (optFovSlider && optFovValue) {
      optFovValue.innerText = `${optFovSlider.value}°`;
      optFovSlider.addEventListener("input", (e) => {
        const val = Number(e.target.value) || 80;
        fieldOfView = val;
        syncFovUI(val);
      });
    }

    // --- Options menu buttons ---
    if (optResumeBtn) {
      optResumeBtn.addEventListener("click", () => {
        hideOptionsMenu();
      });
    }

    if (optMainMenuBtn) {
      optMainMenuBtn.addEventListener("click", () => {
        hideOptionsMenu();
        if (mainMenu) {
          mainMenu.classList.remove("hidden");
        }
      });
    }

    // --- ESC key toggles options menu ---
    document.addEventListener("keydown", (e) => {
      if (e.code === "Escape") {
        if (!optionsMenu) return;
        const isHidden = optionsMenu.classList.contains("hidden");
        if (isHidden) showOptionsMenu();
        else hideOptionsMenu();
      }
    });
  };

  // Crosshair / pointer lock
  const crosshairEl = document.getElementById("crosshair");
  const canvas = world.renderer.domElement;

  if (crosshairEl && canvas) {
    document.addEventListener("pointerlockchange", () => {
      const locked = document.pointerLockElement === canvas;
      crosshairEl.style.display = locked ? "block" : "none";
    });

    // Start hidden until click / pointer lock
    crosshairEl.style.display = "none";
  }

  // Start render loop (scene will be populated after "Create World")
  world.go();
};

main();
