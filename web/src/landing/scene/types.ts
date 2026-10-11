// One shape for both scenes the landing page can draw: the real Velachery slice exported by
// pipeline/08_landing_scene.py, or the stylised city used until that file is present.
// Positions are metres in a local frame: x east, y north, origin at the south-west corner.

export interface Polylines {
  xy: Float32Array        // x0,y0,x1,y1,... metres
  off: Uint32Array        // point offsets, length = count + 1
}

export interface SceneData {
  kind: 'real' | 'stylised'
  size: number            // metres, the box is size x size
  n: number               // grid points per side
  cell: number            // metres between grid points
  ground: Float32Array    // n*n metres, row 0 = south
  frames: Float32Array[]  // water depth in metres on the same grid, early to peak (may be negative on dry ground)
  frameHours: number[]    // storm hour of each frame (1 = 6 PM in a replay)
  vex: number             // vertical exaggeration for drawing
  buildings: Polylines & { height: Float32Array }
  roads: Polylines & { cls: Uint8Array; bridge: Uint8Array }
  street: {
    line: Float32Array    // the street the story follows
    name: string
    peakCm: number | null
    t15Hour: number | null
    seriesCm: number[] | null
  }
  route: {
    dry: Float32Array
    usual: Float32Array | null
    parking: { x: number; y: number; name: string; kind: string }
    dryM: number | null
    usualM: number | null
  }
  run: { id: string; label: string; totalMm: number; wetShare: number | null } | null
}
