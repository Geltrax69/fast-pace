// Weapon definitions + socket follow.
//
// WHY SOCKET FOLLOW INSTEAD OF BONE PARENTING:
// The Quaternius armature node carries scale=100 (bone translations are in
// cm-scale units). Parenting a metre-scale weapon GLB under Wrist.R would
// inherit that 100x scale and blow the blade up to ~150 m. Instead the
// weapon lives in world space and each frame copies the wrist bone's world
// position/quaternion, then applies a fixed hold rotation/offset in metres.
// Sheathed weapons follow the character root (predictable back position).
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

export interface WeaponDef {
  id: string; name: string; file: string
  damage: number; speed: number; range: number; heavyDamage: number
  length: number; // blade length in metres (from GLB bounds, measured)
  holdRot: [number, number, number]; // holder euler applied after wrist quat
  holdOffset: [number, number, number]; // metres, in wrist space
  twoHanded?: boolean
  /** 0..1 along the rendered height where the hand grips (1 = top/handle end). */
  gripFrac?: number
  /** +1 if the blade/head end is at +Y in GLB space (spear), -1 if at -Y (swords). */
  bladeDir?: number
  /** Distance from grip to blade tip, computed at load (overwrites `length`). */
  tipDist?: number
  /** Render scale applied about the grip (pack blades are oversized: katana renders 1.84 m). */
  scale?: number
}

export const WEAPONS: Record<string, WeaponDef> = {
  katana: {
    id: 'katana', name: '曲刀 · KATANA', file: 'assets/weapons/katana.glb',
    damage: 12, speed: 1.15, range: 2.3, heavyDamage: 24, length: 1.5,
    holdRot: [Math.PI, 0, 0], holdOffset: [0, 0.03, 0], scale: 0.62,
  },
  greatsword: {
    id: 'greatsword', name: '大劍 · GREATSWORD', file: 'assets/weapons/greatsword.glb',
    damage: 20, speed: 0.75, range: 2.7, heavyDamage: 38, length: 1.5,
    holdRot: [Math.PI, 0, 0], holdOffset: [0, 0.03, 0], twoHanded: true, scale: 0.58,
  },
  spear: {
    id: 'spear', name: '槍 · SPEAR', file: 'assets/weapons/spear.glb',
    damage: 14, speed: 0.95, range: 3.4, heavyDamage: 26, length: 1.85,
    holdRot: [0, 0, 0], holdOffset: [0, 0.0, 0], twoHanded: true,
    gripFrac: 0.55, bladeDir: 1, scale: 0.9,
  },
  daggers: {
    id: 'daggers', name: '雙匕 · TWIN DAGGERS', file: 'assets/weapons/dagger.glb',
    damage: 8, speed: 1.5, range: 1.9, heavyDamage: 16, length: 0.63,
    holdRot: [Math.PI, 0, 0], holdOffset: [0, 0.02, 0], scale: 1,
  },
  bossSword: {
    id: 'bossSword', name: '水晶 · CRYSTAL BLADE', file: 'assets/weapons/boss-sword.glb',
    damage: 18, speed: 0.9, range: 2.6, heavyDamage: 32, length: 1.34,
    holdRot: [Math.PI, 0, 0], holdOffset: [0, 0.03, 0], scale: 0.8,
  },
  enemySword: {
    id: 'enemySword', name: 'ENEMY BLADE', file: 'assets/weapons/enemy-sword.glb',
    damage: 10, speed: 1.0, range: 2.2, heavyDamage: 20, length: 1.2,
    holdRot: [Math.PI, 0, 0], holdOffset: [0, 0.03, 0], scale: 0.7,
  },
}

const loader = new GLTFLoader()
const cache = new Map<string, THREE.Group>()

export async function loadWeaponMesh(def: WeaponDef): Promise<THREE.Group> {
  const cached = cache.get(def.file)
  if (cached) return cached.clone(true)
  const gltf = await loader.loadAsync(def.file)
  const g = gltf.scene
  // RECENTRE: the supplied GLBs do NOT have their origin at the handle — e.g.
  // CurvKatana's node sits at translation (-0.94, +1.43, -0.01) with scale 1.21,
  // so the rendered blade is ~1.4 m away from the GLB origin. Measure the
  // rendered bounding box and shift the mesh so the grip sits at the origin
  // (the holder / palm), with the blade along local Y.
  const box = new THREE.Box3().setFromObject(g)
  const size = new THREE.Vector3(); box.getSize(size)
  const gripFrac = def.gripFrac ?? 1
  const grip = new THREE.Vector3(
    (box.min.x + box.max.x) / 2,
    box.min.y + gripFrac * size.y,
    (box.min.z + box.max.z) / 2,
  )
  g.position.sub(grip)
  const bladeDir = def.bladeDir ?? -1
  def.tipDist = bladeDir > 0 ? box.max.y - grip.y : grip.y - box.min.y
  // Pack blades render oversized (katana 1.84 m). Scale about the grip so the
  // grip stays in the palm and the blade becomes a believable length.
  const s = def.scale ?? 1
  g.scale.setScalar(s)
  def.tipDist *= s
  def.length = def.tipDist
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true } })
  cache.set(def.file, g)
  return g.clone(true)
}

/** A world-space holder that follows a bone (hand) or the character root (back). */
export class WeaponSocket {
  holder = new THREE.Group()
  mesh: THREE.Group | null = null
  private bone: THREE.Object3D | null = null
  private root: THREE.Object3D | null = null
  private def: WeaponDef
  private mode: 'hand' | 'back' = 'hand'
  private handBone: THREE.Object3D | null = null
  private holdQuat = new THREE.Quaternion()
  private holdOff = new THREE.Vector3()
  private tmpV = new THREE.Vector3()
  private tmpQ = new THREE.Quaternion()
  private tmpV2 = new THREE.Vector3()

  constructor(scene: THREE.Scene, def: WeaponDef) {
    this.def = def
    scene.add(this.holder)
  }
  async init() {
    this.mesh = await loadWeaponMesh(this.def)
    this.holder.add(this.mesh)
    this.holdQuat.setFromEuler(new THREE.Euler(...this.def.holdRot))
    this.holdOff.set(...this.def.holdOffset)
  }
  attachHand(bone: THREE.Object3D) { this.handBone = bone; this.bone = bone; this.mode = 'hand'; this.holder.visible = true }
  attachBack(root: THREE.Object3D) { this.root = root; this.mode = 'back'; this.holder.visible = true }
  hide() { this.holder.visible = false }
  show() { this.holder.visible = true }
  get visible() { return this.holder.visible }

  update() {
    if (!this.holder.visible) return
    if (this.mode === 'hand' && this.bone) {
      this.bone.getWorldPosition(this.tmpV)
      this.bone.getWorldQuaternion(this.tmpQ)
      this.holder.position.copy(this.tmpV).add(this.tmpV2.copy(this.holdOff).applyQuaternion(this.tmpQ))
      this.holder.quaternion.copy(this.tmpQ).multiply(this.holdQuat)
    } else if (this.mode === 'back' && this.root) {
      // Blade down the back: holder behind the chest, aligned to character facing.
      this.root.getWorldPosition(this.tmpV)
      this.root.getWorldQuaternion(this.tmpQ)
      // Back offset: -Z is behind a +Z-facing character.
      this.tmpV2.set(0, 1.15, -0.24).applyQuaternion(this.tmpQ)
      this.holder.position.copy(this.tmpV).add(this.tmpV2)
      // Sheath rotation: blade (-Y) should point down the back, i.e. world -Y.
      // Character quat * Rx(PI) flips blade to +Y in root space, then tilt.
      this.holder.quaternion.copy(this.tmpQ).multiply(this.tmpQ2())
    }
  }
  private _q2 = new THREE.Quaternion()
  private tmpQ2() {
    // Blade pointing down-back: rotate so weapon -Y maps to root -Y, slight diagonal.
    this._q2.setFromEuler(new THREE.Euler(0.35, 0, 0.5))
    return this._q2
  }
  /** World position of the blade tip (for trail + debug). */
  tip(out: THREE.Vector3): THREE.Vector3 {
    const dir = this.def.bladeDir ?? -1
    const dist = this.def.tipDist ?? this.def.length
    out.set(0, dir * dist, 0)
    return this.holder.localToWorld(out)
  }
  base(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0)
    return this.holder.localToWorld(out)
  }
  handPos(out: THREE.Vector3): THREE.Vector3 {
    if (this.bone) return this.bone.getWorldPosition(out)
    return out.set(0, 0, 0)
  }
}
