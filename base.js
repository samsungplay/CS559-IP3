import { GrObject } from "../libs/framework/GrObject.js";

// this class has been generated with the help of copilot
export class GrTickingObject extends GrObject {
  constructor(name, threeObject) {
    super(name, threeObject);

    // Tick accumulator
    this._acc = 0;

    // 20Hz fixed timestep: 50ms per tick
    this._TICK = 1 / 20;
  }

  // The STOCK CS559 engine calls stepWorld(deltaMs)
  stepWorld(deltaMs) {
    const dt = deltaMs / 1000; // convert ms → seconds
    this._acc += dt;

    // Run fixed ticks
    while (this._acc >= this._TICK) {
      this.stepTick(this._TICK * 1000);
      this._acc -= this._TICK;
    }
  }

  // Subclasses override this
  stepTick(_dt) {
    // Default: do nothing
  }
}
