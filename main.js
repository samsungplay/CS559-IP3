/**
 * Graphics Town Framework - "Main" File
 *
 * This is the main file - it creates the world, populates it with
 * objects and behaviors, and starts things running
 *
 * The initial distributed version has a pretty empty world.
 * There are a few simple objects thrown in as examples.
 *
 * It is the students job to extend this by defining new object types
 * (in other files), then loading those files as modules, and using this
 * file to instantiate those objects in the world.
 */

import { GrWorld } from "../libs/framework/GrWorld.js";
import * as T from "../libs/threeJS/build/three.module.js";
import {
  CHUNK_SIZE,
  VoxelWorld,
  WORLD_HEIGHT,
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
/**m
 * The Graphics Town Main -
 * This builds up the world and makes it go...
 */

let totalSteps = 0;
let completedSteps = 0;

// Called once before world generation begins
// this function has been generated with the help of copilot
function initLoadingSteps(n) {
  totalSteps = n;
  completedSteps = 0;
  updateLoadingUI(0);
}

// Called for each completed chunk operation
// this function has been generated with the help of copilot
function stepDone() {
  completedSteps++;
  const pct = Math.floor((completedSteps / totalSteps) * 100);
  updateLoadingUI(pct);

  // When finished, fade out loading screen
  if (pct >= 100) finishLoadingScreen();
}

// this function has been generated with the help of copilot
function updateLoadingUI(pct) {
  const bar = document.getElementById("loading-bar");
  if (bar) bar.style.width = pct + "%";
}

// this function has been generated with the help of copilot
function setPhase(text) {
  const txt = document.getElementById("loading-text");
  if (txt) txt.innerText = text;
}

// this function has been generated with the help of copilot
function finishLoadingScreen() {
  const scr = document.getElementById("loading-screen");
  if (!scr) return;

  scr.style.opacity = "0";
  setTimeout(() => (scr.style.display = "none"), 600);
}

// make the world
let world = new GrWorld({
  width: window.innerWidth,
  height: window.innerHeight,
  groundplane: false, //no need for ground - I shall make it myself
  lights: [new T.AmbientLight("white", 0.1)],
  where: document.getElementById("screenDiv"),
  renderparams: {
    autoClear: false,
  },
});

let voxelWorldInstance;

// while making your objects, be sure to identify some of them as "highlighted"
function highlight(obName) {
  const toHighlight = world.objects.find((ob) => ob.name === obName);
  if (toHighlight) {
    toHighlight.highlighted = true;
  } else {
    throw `no object named ${obName} for highlighting!`;
  }
}

// this function has been generated with the help of copilot
async function generateWorld(world, seed = 205, radius = 5) {
  // Soft sky
  world.scene.background = new T.Color(0x87ceeb);

  const rainSystem = new GrRain(world);
  world.add(rainSystem);

  // Create world containers
  const vw = new VoxelWorld(world, rainSystem);

  // Water
  const envProbe = new GrWaterEnvProbe(world, vw);
  world.add(envProbe);

  vw.waterMaterial = createWaterMaterial(
    envProbe.renderTarget.texture,
    atlasTexture
  );

  // -----------------------------------
  // CHUNK COUNT + INITIALIZE PROGRESS
  // -----------------------------------
  const chunkCount = (radius * 2 + 1) ** 2;

  // Total: Pass1 + Pass2 + Pass3
  initLoadingSteps(chunkCount * 3);

  // Yield to draw loading screen first
  await new Promise((r) => setTimeout(r, 0));

  // -----------------------------------
  // PHASE 1 — TERRAIN GENERATION
  // -----------------------------------
  setPhase("Generating terrain...");
  for (let cz = -radius; cz <= radius; cz++) {
    for (let cx = -radius; cx <= radius; cx++) {
      const chunk = new VoxelChunk(cx, cz);
      generateTerrainForChunk(chunk, seed);
      vw.setChunk(cx, cz, chunk);

      stepDone();
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // -----------------------------------
  // PHASE 2 — STRUCTURES, TREES, VEGETATION
  // -----------------------------------
  setPhase("Placing structures and vegetation...");
  for (let cz = -radius; cz <= radius; cz++) {
    for (let cx = -radius; cx <= radius; cx++) {
      const chunk = vw.getChunk(cx, cz);
      flushPendingForChunk(pendingBlocks, chunk);

      stepDone();
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // -----------------------------------
  // PHASE 3 — BUILD GEOMETRY
  // -----------------------------------
  setPhase("Building chunk meshes...");
  for (let cz = -radius; cz <= radius; cz++) {
    for (let cx = -radius; cx <= radius; cx++) {
      const chunk = vw.getChunk(cx, cz);

      // Creating THREE.js meshes for this chunk
      const meshObj = new GrVoxelChunk(vw, chunk);
      world.add(meshObj);

      stepDone();
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // -----------------------------------
  // FINALIZATION
  // -----------------------------------
  setPhase("Finalizing world...");

  world.add(new VoxelWorldTicker(vw));
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

  world.add(new GrSunAndMoon(world, vw));

  const playerCam = new T.PerspectiveCamera(
    80,
    window.innerWidth / window.innerHeight,
    0.01,
    1000
  );
  world.active_camera = playerCam;
  world.camera = playerCam;

  const waterTintEl = document.getElementById("water-tint");

  const player = new GrPlayer(
    "models/minecraft-player/source/MinecraftPlayer/Player.fbx",
    vw,
    {
      x: 0,
      y: 80,
      z: 0,
      camera: playerCam, // your THREE.PerspectiveCamera
      domElement: world.renderer.domElement,
      mouseLook: true, // set true if you later add pointer-lock,
      viewMode: "third",
      waterTintEl,
    }
  );

  world.add(player);

  return [vw, player];
}

// this function has been generated with the help of copilot
async function regenerateWorld() {
  // const container = document.getElementById("screenDiv");
  // container.innerHTML = "";
  // Show loading screen again
  const scr = document.getElementById("loading-screen");
  scr.style.display = "flex";
  scr.style.opacity = "1";

  // Get user settings
  const seed = Number(document.getElementById("seed-input").value);
  const radius = Number(document.getElementById("radius-slider").value);

  // Remove previous world objects
  if (world) {
    world.scene.clear(); // Remove all children
    world.objects = []; // Clear GrObjects tracking
  }

  let player = null;

  // Pass seed + radius into main()
  [voxelWorldInstance, player] = await generateWorld(world, seed, radius);

  const allBlockIds = Object.values(BLOCK).filter((id) => id !== BLOCK.AIR);

  world.blockPicker = new BlockPicker(
    world.renderer,
    allBlockIds,
    (blockId) => {
      player.setHeldItem(blockId);
    },
    {
      domElement: world.renderer.domElement,
      iconsPerRow: 9,
      rowsVisible: 5,
    }
  );
}

///////////////////////////////////////////////////////////////
// build and run the UI
// only after all the objects exist can we build the UI

// now make it go!
// this function has been generated with the help of copilot
const main = async () => {
  window.onload = () => {
    document
      .getElementById("regen-btn")
      .addEventListener("click", regenerateWorld);
    document.getElementById("radius-slider").addEventListener("input", (e) => {
      document.getElementById("radius-value").innerText = e.target.value;
    });
  };
  await regenerateWorld();

  const crosshairEl = document.getElementById("crosshair");
  const canvas = world.renderer.domElement; // assuming you already have this

  document.addEventListener("pointerlockchange", () => {
    const locked = document.pointerLockElement === canvas;
    crosshairEl.style.display = locked ? "block" : "none";
  });

  // Start with hidden crosshair until we click into the game
  crosshairEl.style.display = "none";

  world.go();
};

main();

// CS559 2025 Workbook
