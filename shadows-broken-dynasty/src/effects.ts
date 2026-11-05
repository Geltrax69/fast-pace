// Visual effects: sword trail ribbon, burst particles (sparks / blood / dust),
// floating damage numbers are DOM-free sprites via Points. Slow-mo + shake live here.
import * as THREE from 'three'

interface Burst { points: THREE.Points; vel: Float32Array; life: number; maxLife: number; gravity: number }

export class Effects {
  private scene: THREE.Scene
  private bursts: Burst[] = []
  private trailMesh: THREE.Mesh
  private trailPos: THREE.BufferAttribute
  private trailPts: THREE.Vector3[] = []
  private trailActive = false
  shakeAmp = 0
  timeScale = 1
  private slowTimer = 0
  private slowScale = 1

  constructor(scene: THREE.Scene) {
    this.scene = scene
    // Trail ribbon: 24 segments x 2 verts, updated from weapon tip/base each frame.
    const geo = new THREE.BufferGeometry()
    const N = 24
    const pos = new Float32Array(N * 2 * 3)
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const idx: number[] = []
    for (let i = 0; i < N - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3
      idx.push(a, b, c, b, d, c)
    }
    geo.setIndex(idx)
    const mat = new THREE.MeshBasicMaterial({
      color: 0xbfe6ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
    this.trailMesh = new THREE.Mesh(geo, mat)
    this.trailMesh.frustumCulled = false
    this.trailMesh.visible = false
    scene.add(this.trailMesh)
    this.trailPos = geo.getAttribute('position') as THREE.BufferAttribute
  }

  trailBegin() { this.trailActive = true; this.trailPts = []; this.trailMesh.visible = true }
  trailEnd() { this.trailActive = false; this.trailMesh.visible = false }
  trailPush(tip: THREE.Vector3, base: THREE.Vector3) {
    if (!this.trailActive) return
    this.trailPts.push(tip.clone(), base.clone())
    if (this.trailPts.length > 48) this.trailPts.splice(0, this.trailPts.length - 48)
    const n = this.trailPts.length / 2
    for (let i = 0; i < 24; i++) {
      const src = this.trailPts[Math.min(i, Math.max(0, n - 1)) * 2]
      const src2 = this.trailPts[Math.min(i, Math.max(0, n - 1)) * 2 + 1]
      if (!src || !src2) continue
      // Fade older segments toward the base point so the ribbon tapers.
      const fade = n > 1 ? i / Math.max(1, n - 1) : 1
      const p = src.clone().lerp(src2, 1 - fade)
      this.trailPos.setXYZ(i * 2, src.x, src.y, src.z)
      this.trailPos.setXYZ(i * 2 + 1, p.x, p.y, p.z)
    }
    this.trailPos.needsUpdate = true
    ;(this.trailMesh.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.4 * Math.min(1, n / 10)
  }

  burst(pos: THREE.Vector3, opts: { count?: number; color?: number; speed?: number; life?: number; gravity?: number; size?: number } = {}) {
    const count = opts.count ?? 24
    const positions = new Float32Array(count * 3)
    const vel = new Float32Array(count * 3)
    const speed = opts.speed ?? 4
    for (let i = 0; i < count; i++) {
      positions[i * 3] = pos.x; positions[i * 3 + 1] = pos.y; positions[i * 3 + 2] = pos.z
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1)
      const s = speed * (0.4 + Math.random() * 0.8)
      vel[i * 3] = Math.sin(ph) * Math.cos(th) * s
      vel[i * 3 + 1] = Math.cos(ph) * s * 0.8 + speed * 0.25
      vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * s
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const mat = new THREE.PointsMaterial({
      color: opts.color ?? 0xffd27a, size: opts.size ?? 0.07, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    })
    const points = new THREE.Points(geo, mat)
    points.frustumCulled = false
    this.scene.add(points)
    const life = opts.life ?? 0.5
    this.bursts.push({ points, vel, life, maxLife: life, gravity: opts.gravity ?? 9 })
  }
  sparks(p: THREE.Vector3) { this.burst(p, { count: 30, color: 0xffe9a8, speed: 6, life: 0.45, size: 0.06 }) }
  blood(p: THREE.Vector3) { this.burst(p, { count: 26, color: 0x8f1111, speed: 3.2, life: 0.6, size: 0.09 }) }
  dust(p: THREE.Vector3) { this.burst(p, { count: 16, color: 0x9a8f7a, speed: 1.6, life: 0.8, size: 0.14, gravity: 1 }) }
  soul(p: THREE.Vector3) { this.burst(p, { count: 40, color: 0x7fb2ff, speed: 2.2, life: 1.1, size: 0.08, gravity: -2 }) }

  shake(amount: number) { this.shakeAmp = Math.max(this.shakeAmp, amount) }
  slowMo(scale: number, seconds: number) { this.slowScale = scale; this.slowTimer = seconds }
  hitStop(seconds: number) { this.slowScale = 0.02; this.slowTimer = Math.max(this.slowTimer, seconds) }

  update(dt: number, dtReal = dt) {
    // Time dilation: slowTimer counts REAL seconds so slow-mo expires on
    // schedule even when the frame rate is low (dt is clamped to 0.05).
    if (this.slowTimer > 0) {
      this.slowTimer -= dtReal
      this.timeScale = this.slowScale
      if (this.slowTimer <= 0) { this.timeScale = 1; this.slowScale = 1 }
    } else this.timeScale = 1
    this.shakeAmp = Math.max(0, this.shakeAmp - dt * 1.6)
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]
      b.life -= dt
      if (b.life <= 0) {
        this.scene.remove(b.points)
        b.points.geometry.dispose(); (b.points.material as THREE.Material).dispose()
        this.bursts.splice(i, 1); continue
      }
      const attr = b.points.geometry.getAttribute('position') as THREE.BufferAttribute
      for (let j = 0; j < attr.count; j++) {
        b.vel[j * 3 + 1] -= b.gravity * dt
        attr.setXYZ(j, attr.getX(j) + b.vel[j * 3] * dt, attr.getY(j) + b.vel[j * 3 + 1] * dt, attr.getZ(j) + b.vel[j * 3 + 2] * dt)
      }
      attr.needsUpdate = true
      ;(b.points.material as THREE.PointsMaterial).opacity = b.life / b.maxLife
    }
  }
  shakeOffset(out: THREE.Vector3) {
    if (this.shakeAmp <= 0) { out.set(0, 0, 0); return out }
    out.set((Math.random() - 0.5) * this.shakeAmp * 0.12, (Math.random() - 0.5) * this.shakeAmp * 0.12, 0)
    return out
  }
}
