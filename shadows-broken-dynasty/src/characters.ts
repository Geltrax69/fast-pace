// Rigged character: GLB loading, bone lookup, animation mixer + crossfades,
// and a procedural swing layer that gives the single Sword_Slash clip three
// distinct arcs (horizontal / reverse / overhead) without extra clips.
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

export type SwingArc = 'horizontal' | 'reverse' | 'overhead' | 'spin' | 'none'

export class RiggedCharacter {
  root = new THREE.Group()
  model: THREE.Group | null = null
  mixer: THREE.AnimationMixer | null = null
  clips = new Map<string, THREE.AnimationClip>()
  private current: THREE.AnimationAction | null = null
  private currentName = ''
  bones = new Map<string, THREE.Object3D>()
  // Procedural swing overlay, applied AFTER mixer.update() each frame.
  swingArc: SwingArc = 'none'
  swingPhase = 0 // 0..1 through the attack
  swingWeight = 0

  async load(url: string, scene: THREE.Scene) {
    const loader = new GLTFLoader()
    const gltf = await loader.loadAsync(url)
    this.model = gltf.scene
    this.model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = false }
      // GLTFLoader strips '.' from node names (Wrist.R -> WristR), so store
      // normalised keys and normalise lookups the same way.
      if (o.name) this.bones.set(o.name.replace(/\./g, ''), o)
    })
    for (const c of gltf.animations) {
      const short = c.name.includes('|') ? c.name.split('|')[1] : c.name
      this.clips.set(short, c)
    }
    this.mixer = new THREE.AnimationMixer(this.model)
    this.root.add(this.model)
    scene.add(this.root)
    return this
  }

  bone(name: string): THREE.Object3D | undefined { return this.bones.get(name.replace(/\./g, '')) }
  hasClip(name: string) { return this.clips.has(name) }

  play(name: string, opts: { fade?: number; loop?: Parameters<THREE.AnimationAction['setLoop']>[0]; rate?: number; clamp?: boolean } = {}) {
    if (!this.mixer) return
    const clip = this.clips.get(name)
    if (!clip) return
    if (this.currentName === name && this.current) { this.current.setEffectiveTimeScale(opts.rate ?? 1); return }
    const action = this.mixer.clipAction(clip)
    action.reset()
    action.setLoop(opts.loop ?? THREE.LoopRepeat, Infinity)
    action.setEffectiveTimeScale(opts.rate ?? 1)
    if (opts.clamp) action.clampWhenFinished = true
    const fade = opts.fade ?? 0.15
    if (this.current) this.current.crossFadeTo(action, fade, false)
    else action.play()
    // crossFadeTo starts the target; ensure it is playing
    action.play()
    this.current = action
    this.currentName = name
  }
  playOnce(name: string, rate = 1) {
    this.play(name, { fade: 0.08, loop: THREE.LoopOnce, rate, clamp: true })
  }
  get currentClip() { return this.currentName }
  get clipTime(): number { return this.current?.time ?? 0 }
  get clipDuration(): number { return this.current?.getClip().duration ?? 0 }

  /** Set the procedural swing overlay. Call each frame during an attack. */
  setSwing(arc: SwingArc, phase: number, weight = 1) {
    this.swingArc = arc; this.swingPhase = THREE.MathUtils.clamp(phase, 0, 1); this.swingWeight = weight
  }
  clearSwing() { this.swingArc = 'none'; this.swingWeight = 0 }

  update(dt: number) {
    this.mixer?.update(dt)
    if (this.swingWeight > 0 && this.swingArc !== 'none') this.applySwing()
  }

  private applySwing() {
    const p = this.swingPhase
    // Attack envelope: wind up (0-0.3), strike (0.3-0.6), recover (0.6-1).
    const strike = Math.sin(Math.min(1, Math.max(0, (p - 0.25) / 0.45)) * Math.PI)
    const wind = Math.sin(Math.min(1, p / 0.3) * Math.PI * 0.5)
    const w = this.swingWeight
    const chest = this.bones.get('Chest')
    const shoulderR = this.bones.get('Shoulder.R')
    const upperR = this.bones.get('UpperArm.R')
    const shoulderL = this.bones.get('Shoulder.L')
    if (chest) {
      if (this.swingArc === 'horizontal') chest.rotateY((wind * -0.5 + strike * 0.9) * w)
      else if (this.swingArc === 'reverse') chest.rotateY((wind * 0.5 - strike * 0.9) * w)
      else if (this.swingArc === 'overhead') chest.rotateX((wind * -0.25 + strike * 0.45) * w)
      else if (this.swingArc === 'spin') chest.rotateY(strike * 2.2 * w)
    }
    if (upperR) {
      if (this.swingArc === 'horizontal') upperR.rotateZ(strike * 0.7 * w)
      else if (this.swingArc === 'reverse') upperR.rotateZ(-strike * 0.7 * w)
      else if (this.swingArc === 'overhead') upperR.rotateX(-strike * 0.9 * w)
      else if (this.swingArc === 'spin') upperR.rotateZ(strike * 0.5 * w)
    }
    if (shoulderR && this.swingArc === 'overhead') shoulderR.rotateX(-wind * 0.4 * w)
    if (shoulderL && this.swingArc === 'spin') shoulderL.rotateZ(-strike * 0.4 * w)
  }

  setPosition(x: number, y: number, z: number) { this.root.position.set(x, y, z) }
  get position() { return this.root.position }
  setFacing(angle: number) { this.root.rotation.y = angle }
  get facing() { return this.root.rotation.y }
  forward(out: THREE.Vector3): THREE.Vector3 {
    out.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y))
    return out
  }
}
