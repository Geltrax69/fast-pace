// Shadows of the Broken Dynasty — orchestrator.
// Phases 1-10 in one vertical slice: movement/camera, combos, parry, enemy AI,
// weapons, boss, finishers, environment, audio, HUD.
import * as THREE from 'three'
import { RiggedCharacter, type SwingArc } from './characters'
import { WeaponSocket, WEAPONS, type WeaponDef } from './weapons'
import { Enemy, type EnemyKind } from './enemies'
import { Environment } from './environment'
import { Effects } from './effects'
import { Sfx } from './audio'

type GamePhase = 'menu' | 'playing' | 'paused' | 'dead' | 'victory'

const $ = (id: string) => document.getElementById(id)!

export class Game {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private clock = new THREE.Clock()
  private player = new RiggedCharacter()
  private socket: WeaponSocket | null = null
  private socketL: WeaponSocket | null = null // left dagger
  private env: Environment
  private fx: Effects
  private sfx = new Sfx()
  private enemies: Enemy[] = []
  private boss: Enemy | null = null
  private phase: GamePhase = 'menu'
  private keys = new Set<string>()
  private camYaw = 0
  private camPitch = 0.32
  private camDist = 4.4
  private vel = new THREE.Vector3()
  private vy = 0
  private grounded = true
  private jumps = 0
  private rolling = false
  private rollTimer = 0
  private rollDir = new THREE.Vector3()
  private dodging = false
  private dodgeTimer = 0
  private lockOn: Enemy | null = null
  private weaponId = 'katana'
  private weaponDef: WeaponDef = WEAPONS.katana
  private drawn = true
  private hp = 100; private maxHp = 100
  private stamina = 100
  private qi = 0
  private combo = 0
  private comboTimer = 0
  private attackState: 'idle' | 'light' | 'heavy' | 'special' = 'idle'
  private attackTimer = 0
  private attackDur = 0.5
  private attackHitDone = false
  private attackIndex = 0
  private buffered: 'light' | 'heavy' | null = null
  private parryTimer = 0
  private parryPerfectUntil = 0
  private parrying = false
  private invulnTimer = 0
  private elapsed = 0
  private dtReal = 0.016
  private wave = 0
  private waveClearTimer = 0
  private bossSpawned = false
  private finisherSlow = false
  private tmp = new THREE.Vector3()
  private tmp2 = new THREE.Vector3()
  private tmp3 = new THREE.Vector3()
  private debugMode = new URLSearchParams(location.search).has('debug')
  private dbgHand: THREE.Mesh | null = null
  private dbgTip: THREE.Mesh | null = null
  private dbgBase: THREE.Mesh | null = null
  private autoStart = new URLSearchParams(location.search).has('autostart')
  private stepTimer = 0
  private frameCount = 0
  private fps = 0
  private fpsWallStart = performance.now()
  private fpsFrames = 0

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(innerWidth, innerHeight)
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    $('app').appendChild(this.renderer.domElement)
    this.camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 300)
    this.scene.fog = new THREE.FogExp2(0x0d0f18, 0.016)
    this.scene.background = new THREE.Color(0x0d0f18)
    // Moon + cold ambient + warm lantern fill
    const moon = new THREE.DirectionalLight(0x8fa8d8, 1.6)
    moon.position.set(-18, 30, -12); moon.castShadow = true
    moon.shadow.mapSize.set(2048, 2048)
    moon.shadow.camera.left = -35; moon.shadow.camera.right = 35
    moon.shadow.camera.top = 35; moon.shadow.camera.bottom = -35
    this.scene.add(moon)
    this.scene.add(new THREE.HemisphereLight(0x2a3450, 0x1a120c, 0.7))
    const warm = new THREE.PointLight(0xff8a3c, 20, 25, 1.6)
    warm.position.set(0, 6, -18); this.scene.add(warm)
    this.env = new Environment(this.scene)
    this.fx = new Effects(this.scene)
    if (this.debugMode) {
      $('debug').classList.remove('hidden')
      // Debug markers: green = hand bone, red = blade tip, blue = blade base
      const mk = (color: number) => {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color }))
        this.scene.add(m); return m
      }
      this.dbgHand = mk(0x00ff00); this.dbgTip = mk(0xff0000); this.dbgBase = mk(0x0000ff)
    }
    this.bindInput()
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(innerWidth, innerHeight)
    })
  }

  async init() {
    $('loading').textContent = 'Loading blades and bones…'
    await this.player.load('assets/characters/player-adventurer.glb', this.scene)
    this.player.setPosition(0, 0, 14)
    this.player.setFacing(Math.PI) // face the temple (north, -Z)
    this.player.play('Idle_Sword')
    await this.equipWeapon('katana')
    $('loading').textContent = 'Ready.'
    $('start-btn').addEventListener('click', () => this.start())
    $('restart-btn').addEventListener('click', () => location.reload())
    if (this.autoStart) this.start()
    this.renderer.setAnimationLoop(() => this.frame())
    ;(window as unknown as { __game: unknown }).__game = this.debugApi()
  }

  // ---------- weapons ----------
  private async equipWeapon(id: string) {
    this.weaponId = id
    this.weaponDef = WEAPONS[id]
    if (this.socket) { this.scene.remove(this.socket.holder); this.socket = null }
    if (this.socketL) { this.scene.remove(this.socketL.holder); this.socketL = null }
    this.socket = new WeaponSocket(this.scene, this.weaponDef)
    await this.socket.init()
    const wristR = this.player.bone('Wrist.R')
    if (wristR) this.socket.attachHand(wristR)
    if (id === 'daggers') {
      this.socketL = new WeaponSocket(this.scene, this.weaponDef)
      await this.socketL.init()
      const wristL = this.player.bone('Wrist.L')
      if (wristL) this.socketL.attachHand(wristL)
    }
    if (!this.drawn && this.socket) this.socket.attachBack(this.player.root)
    $('weapon-name').textContent = this.weaponDef.name
    this.sfx.draw()
  }
  private async toggleSheathe() {
    this.drawn = !this.drawn
    if (!this.socket) return
    if (this.drawn) {
      const wristR = this.player.bone('Wrist.R')
      if (wristR) this.socket.attachHand(wristR)
      if (this.socketL) { const w = this.player.bone('Wrist.L'); if (w) this.socketL.attachHand(w) }
      this.player.play('Idle_Sword', { fade: 0.2 })
    } else {
      this.socket.attachBack(this.player.root)
      if (this.socketL) this.socketL.hide()
      this.player.play('Idle', { fade: 0.2 })
    }
    this.sfx.draw()
  }

  // ---------- input ----------
  private bindInput() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return
      this.keys.add(e.code)
      if (this.phase !== 'playing') return
      if (e.code === 'KeyJ') this.queueAttack('light')
      if (e.code === 'KeyK') this.queueAttack('heavy')
      if (e.code === 'KeyL') this.special()
      if (e.code === 'KeyF') this.startParry()
      if (e.code === 'Space') { e.preventDefault(); this.jump() }
      if (e.code === 'KeyC') this.roll()
      if (e.code === 'KeyQ' || e.code === 'Tab') { e.preventDefault(); this.toggleLockOn() }
      if (e.code === 'KeyR') void this.toggleSheathe()
      if (e.code === 'Digit1') void this.equipWeapon('katana')
      if (e.code === 'Digit2') void this.equipWeapon('greatsword')
      if (e.code === 'Digit3') void this.equipWeapon('spear')
      if (e.code === 'Digit4') void this.equipWeapon('daggers')
      if (e.code === 'KeyP' || e.code === 'Escape') this.pause()
    })
    addEventListener('keyup', (e) => this.keys.delete(e.code))
    addEventListener('mousedown', (e) => {
      if (this.phase !== 'playing') return
      if (document.pointerLockElement !== this.renderer.domElement) {
        this.renderer.domElement.requestPointerLock()
        return
      }
      if (e.button === 0) this.queueAttack('light')
      if (e.button === 2) this.queueAttack('heavy')
    })
    addEventListener('contextmenu', (e) => e.preventDefault())
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.renderer.domElement) return
      this.camYaw -= e.movementX * 0.0026
      this.camPitch = THREE.MathUtils.clamp(this.camPitch + e.movementY * 0.0022, -0.15, 0.9)
    })
    this.renderer.domElement.addEventListener('click', () => {
      if (this.phase === 'playing' && document.pointerLockElement !== this.renderer.domElement)
        this.renderer.domElement.requestPointerLock()
    })
  }

  private start() {
    this.sfx.ensure()
    this.phase = 'playing'
    $('menu').classList.add('hidden')
    $('hud').classList.remove('hidden')
    this.sfx.startMusic(false)
    this.nextWave()
    this.banner('WAVE I — THE SHADOWS COME')
  }
  private pause() {
    if (this.phase === 'playing') {
      this.phase = 'paused'; document.exitPointerLock?.()
      $('center-msg').textContent = '— PAUSED —  press P to resume'
    } else if (this.phase === 'paused') { this.phase = 'playing'; $('center-msg').textContent = '' }
  }
  private die() {
    this.phase = 'dead'
    this.player.playOnce('Death')
    this.sfx.stopMusic(); this.sfx.death()
    document.exitPointerLock?.()
    $('end-title').textContent = 'YOU DIED'
    $('end-sub').textContent = 'The fortress keeps its silence. The blade falls — for now.'
    $('end-screen').classList.remove('hidden')
  }
  private victory() {
    this.phase = 'victory'
    this.sfx.stopMusic()
    this.fx.slowMo(0.25, 1.6)
    document.exitPointerLock?.()
    $('end-title').textContent = 'THE DYNASTY FALLS'
    $('end-sub').textContent = 'The Fallen King is broken. Dawn rises over the mountain fortress.'
    $('end-screen').classList.remove('hidden')
  }
  private banner(text: string) {
    const el = $('wave-banner')
    el.textContent = text; el.style.opacity = '1'
    setTimeout(() => { el.style.opacity = '0' }, 2600)
  }

  // ---------- waves / boss ----------
  private async spawn(kind: EnemyKind, x: number, z: number) {
    const e = new Enemy(kind, this.scene)
    await e.load(this.scene)
    e.pos.set(x, 0, z)
    this.enemies.push(e)
    return e
  }
  private async nextWave() {
    this.wave++
    if (this.wave === 1) {
      await this.spawn('assassin', -10, -6); await this.spawn('assassin', 10, -6); await this.spawn('assassin', 0, -16)
    } else if (this.wave === 2) {
      this.banner('WAVE II — IRON AND TWIN BLADES')
      await this.spawn('heavy', -12, -10); await this.spawn('dual', 12, -10)
      await this.spawn('assassin', -6, -20); await this.spawn('assassin', 8, -18)
    } else if (this.wave === 3) {
      this.banner('WAVE III — THE KING AWAKENS')
      await this.spawnBoss()
    }
  }
  private async spawnBoss() {
    this.bossSpawned = true
    this.boss = await this.spawn('boss', 0, -18)
    this.sfx.stopMusic(); this.sfx.startMusic(true); this.sfx.roar()
    $('boss-bar').classList.remove('hidden')
    this.fx.shake(1)
  }

  // ---------- movement ----------
  private jump() {
    if (this.rolling || this.attackState !== 'idle') return
    if (this.grounded) { this.vy = 8.2; this.grounded = false; this.jumps = 1; this.sfx.jump() }
    else if (this.jumps < 2) { this.vy = 7.4; this.jumps = 2; this.sfx.jump(); this.fx.dust(this.player.position) }
  }
  private roll() {
    if (this.rolling || this.stamina < 20) return
    this.stamina -= 20
    this.rolling = true; this.rollTimer = 0.55
    this.dodging = true; this.dodgeTimer = 0.55
    this.rollDir.copy(this.vel).setY(0)
    if (this.rollDir.lengthSq() < 0.01) this.player.forward(this.rollDir)
    this.rollDir.normalize()
    this.player.playOnce('Roll', 1.25)
    this.sfx.roll()
  }
  private toggleLockOn() {
    if (this.lockOn) { this.lockOn = null; $('target-bar').classList.add('hidden'); return }
    let best: Enemy | null = null; let bd = 18
    for (const e of this.enemies) {
      if (!e.alive) continue
      const d = e.pos.distanceTo(this.player.position)
      if (d < bd) { bd = d; best = e }
    }
    this.lockOn = best
    if (best) $('target-bar').classList.remove('hidden')
  }

  // ---------- combat ----------
  private queueAttack(kind: 'light' | 'heavy') {
    if (!this.drawn) { void this.toggleSheathe(); return }
    if (this.rolling || this.parrying) return
    if (this.attackState === 'idle') this.startAttack(kind)
    else if (this.attackTimer < this.attackDur * 0.55) this.buffered = kind // buffer in cancel window
  }
  private startAttack(kind: 'light' | 'heavy') {
    const cost = kind === 'light' ? 8 : 15
    if (this.stamina < cost) return
    this.stamina -= cost
    this.attackState = kind
    this.attackHitDone = false
    this.buffered = null
    const rate = this.weaponDef.speed * (kind === 'light' ? 1.9 : 1.35)
    this.attackDur = 1.0 / rate
    this.attackTimer = this.attackDur
    if (kind === 'light') this.attackIndex = (this.attackIndex + 1) % 3
    const arc: SwingArc = kind === 'heavy' ? 'overhead' : this.attackIndex === 0 ? 'horizontal' : this.attackIndex === 1 ? 'reverse' : 'overhead'
    this.player.playOnce('Sword_Slash', rate)
    this.player.setSwing(arc, 0.2, 1)
    this.fx.trailBegin()
    if (kind === 'light') this.sfx.whoosh(); else this.sfx.swingHeavy()
    // Face lock-on target or movement direction
    const target = this.lockOn && this.lockOn.alive ? this.lockOn.pos : null
    if (target) this.facePoint(target)
  }
  private special() {
    if (this.qi < 50 || this.attackState !== 'idle' || this.rolling) return
    this.qi -= 50
    this.attackState = 'special'
    this.attackHitDone = false
    this.attackDur = 0.85; this.attackTimer = 0.85
    this.player.playOnce('Sword_Slash', 1.1)
    this.player.setSwing('spin', 0.2, 1)
    this.fx.trailBegin()
    this.sfx.special()
  }
  private startParry() {
    if (this.attackState !== 'idle' || this.rolling) return
    this.parrying = true
    this.parryTimer = 0.35
    this.parryPerfectUntil = 0.18
    this.player.play('Idle_Sword', { fade: 0.05 })
  }
  private facePoint(p: THREE.Vector3) {
    const dx = p.x - this.player.position.x, dz = p.z - this.player.position.z
    this.player.setFacing(Math.atan2(dx, dz))
  }

  /** Called by enemies when their swing connects. Parry/block/damage resolved here. */
  damagePlayer(amount: number, from: THREE.Vector3, heavy: boolean) {
    if (this.phase !== 'playing' || this.invulnTimer > 0 || this.dodging) return
    if (this.parrying) {
      if (this.parryPerfectUntil > 0) {
        // PERFECT PARRY — find the attacker, stagger + posture break
        const attacker = this.nearestEnemy(from, 4)
        if (attacker) {
          attacker.takeHit(0, from, this.enemyCtx(), { postureDmg: 55 })
          attacker.state = 'stagger'; (attacker as unknown as { stateTimer: number }).stateTimer = 1.4
        }
        this.qi = Math.min(100, this.qi + 25)
        this.sfx.parry(); this.fx.sparks(this.tmp.copy(this.player.position).setY(1.4))
        this.fx.hitStop(0.14); this.fx.slowMo(0.35, 0.35); this.fx.shake(0.7)
        const el = $('parry-flash'); el.classList.add('show')
        setTimeout(() => el.classList.remove('show'), 500)
        this.parrying = false; this.parryTimer = 0
        return
      }
      // Ordinary block: chip damage, stamina cost
      this.hp -= amount * 0.25; this.stamina = Math.max(0, this.stamina - 18)
      this.sfx.block(); this.fx.sparks(this.tmp.copy(this.player.position).setY(1.4))
      this.invulnTimer = 0.4
      return
    }
    this.hp -= amount
    this.invulnTimer = 0.6
    this.sfx.hurt(); this.fx.shake(heavy ? 1 : 0.5)
    this.fx.blood(this.tmp.copy(this.player.position).setY(1.2))
    this.player.playOnce('HitRecieve', 1.3)
    this.combo = 0
    if (this.hp <= 0) { this.hp = 0; this.die() }
  }
  private nearestEnemy(from: THREE.Vector3, maxDist: number): Enemy | null {
    let best: Enemy | null = null; let bd = maxDist
    for (const e of this.enemies) {
      if (!e.alive) continue
      const d = e.pos.distanceTo(from)
      if (d < bd) { bd = d; best = e }
    }
    return best
  }
  private enemyCtx() {
    return {
      playerPos: this.player.position,
      playerDodging: this.dodging,
      damagePlayer: (a: number, f: THREE.Vector3, h: boolean) => this.damagePlayer(a, f, h),
      sfx: this.sfx, fx: this.fx,
    }
  }

  private resolveAttackHit() {
    // One hit-check per swing, at the strike moment.
    const isSpecial = this.attackState === 'special'
    const dmg = this.attackState === 'heavy' ? this.weaponDef.heavyDamage : isSpecial ? 35 : this.weaponDef.damage
    const range = isSpecial ? 3.4 : this.weaponDef.range
    const origin = this.player.position
    let hitAny = false
    for (const e of this.enemies) {
      if (!e.alive) continue
      const d = e.pos.distanceTo(origin)
      if (d > range) continue
      if (!isSpecial) {
        // Cone check: enemy must be roughly in front
        const toE = this.tmp.copy(e.pos).sub(origin).setY(0).normalize()
        const fwd = this.tmp2.set(Math.sin(this.player.facing), 0, Math.cos(this.player.facing))
        if (toE.dot(fwd) < 0.15) continue
      }
      const finishing = e.hp - dmg <= 0 && e.kind !== 'boss'
      e.takeHit(dmg, origin, this.enemyCtx(), { heavy: this.attackState === 'heavy', postureDmg: this.attackState === 'heavy' ? 26 : 12 })
      this.qi = Math.min(100, this.qi + (this.attackState === 'heavy' ? 16 : 10))
      this.combo++; this.comboTimer = 2.2
      this.fx.blood(this.tmp3.copy(e.pos).setY(e.pos.y + 1.3))
      this.fx.shake(this.attackState === 'heavy' ? 0.7 : 0.35)
      if (this.attackState === 'heavy') { this.fx.hitStop(0.09); this.sfx.hitHeavy() } else this.sfx.hitFlesh()
      if (finishing) { // cinematic killing blow
        this.fx.slowMo(0.3, 0.7); this.fx.soul(this.tmp3.copy(e.pos).setY(e.pos.y + 1))
        this.banner('EXECUTION')
        setTimeout(() => { if (this.phase === 'playing') $('wave-banner').style.opacity = '0' }, 900)
      }
      hitAny = true
    }
    // Destructibles
    for (const pot of this.env.destructibles) {
      if (pot.broken) continue
      if (pot.pos.distanceTo(origin) < range) {
        pot.broken = true; pot.mesh.visible = false
        this.fx.dust(pot.pos); this.sfx.breakPot()
      }
    }
    if (hitAny) this.fx.hitStop(0.05)
  }

  // ---------- per-frame ----------
  private frame() {
    const dtReal = this.clock.getDelta()
    const rawDt = Math.min(0.05, dtReal)
    this.fx.update(rawDt, dtReal)
    const dt = rawDt * this.fx.timeScale
    this.dtReal = dtReal
    this.elapsed += dt
    this.frameCount++
    this.fpsFrames++
    const now = performance.now()
    if (now - this.fpsWallStart >= 1000) { this.fps = this.fpsFrames; this.fpsFrames = 0; this.fpsWallStart = now }
    if (this.phase === 'playing') this.updatePlaying(dt, rawDt)
    else if (this.phase === 'menu' || this.phase === 'victory' || this.phase === 'dead') {
      // Idle menu orbit: slow camera around the courtyard
      const t = this.elapsed * 0.05
      this.camera.position.set(Math.sin(t) * 22, 9, Math.cos(t) * 22)
      this.camera.lookAt(0, 2, -8)
      this.player.update(dt)
      this.env.update(dt, this.camera.position)
    }
    this.renderer.render(this.scene, this.camera)
    if (this.debugMode) this.updateDebug()
  }

  private updatePlaying(dt: number, rawDt: number) {
    // Timers
    this.invulnTimer = Math.max(0, this.invulnTimer - dt)
    this.comboTimer -= dt
    if (this.comboTimer <= 0) this.combo = 0
    this.stamina = Math.min(100, this.stamina + dt * (this.attackState === 'idle' ? 16 : 6))
    if (this.parryTimer > 0) {
      this.parryTimer -= dt; this.parryPerfectUntil -= dt
      if (this.parryTimer <= 0) this.parrying = false
    }
    if (this.dodgeTimer > 0) { this.dodgeTimer -= dt; if (this.dodgeTimer <= 0) this.dodging = false }

    // --- movement (camera-relative) ---
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
    const speed = sprint && this.stamina > 1 ? 7.6 : 4.4
    const fwd = this.tmp.set(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw))
    const right = this.tmp2.set(-fwd.z, 0, fwd.x)
    const move = this.tmp3.set(0, 0, 0)
    if (this.keys.has('KeyW')) move.add(fwd)
    if (this.keys.has('KeyS')) move.sub(fwd)
    if (this.keys.has('KeyD')) move.add(right)
    if (this.keys.has('KeyA')) move.sub(right)
    const moving = move.lengthSq() > 0.01
    if (moving) move.normalize()
    const canMove = this.attackState === 'idle' && !this.rolling && !this.parrying

    if (this.rolling) {
      this.rollTimer -= dt
      this.player.position.addScaledVector(this.rollDir, 9 * dt)
      if (this.rollTimer <= 0) { this.rolling = false; this.player.play('Idle_Sword', { fade: 0.15 }) }
    } else if (canMove && moving) {
      this.player.position.addScaledVector(move, speed * dt)
      const targetFacing = Math.atan2(move.x, move.z)
      let diff = targetFacing - this.player.facing
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      this.player.setFacing(this.player.facing + diff * Math.min(1, 12 * dt))
      this.player.play(sprint ? 'Run' : 'Walk', { rate: sprint ? 1.15 : 1 })
      if (sprint) this.stamina = Math.max(0, this.stamina - dt * 12)
      this.stepTimer -= dt
      if (this.stepTimer <= 0) { this.stepTimer = sprint ? 0.32 : 0.45; this.sfx.step() }
    } else if (canMove) {
      this.player.play(this.drawn ? 'Idle_Sword' : 'Idle')
    }
    // Attack lunge
    if (this.attackState !== 'idle' && this.attackTimer > this.attackDur * 0.55) {
      this.player.forward(this.tmp)
      this.player.position.addScaledVector(this.tmp, 2.2 * dt)
    }
    // Gravity / jump
    this.vy -= 20 * dt
    this.player.position.y += this.vy * dt
    if (this.player.position.y <= 0) {
      if (!this.grounded && this.vy < -6) this.fx.dust(this.player.position)
      this.player.position.y = 0; this.vy = 0; this.grounded = true; this.jumps = 0
    } else this.grounded = false
    // Arena bounds
    this.player.position.x = THREE.MathUtils.clamp(this.player.position.x, -27, 27)
    this.player.position.z = THREE.MathUtils.clamp(this.player.position.z, -26, 26)

    // --- attack state machine ---
    if (this.attackState !== 'idle') {
      this.attackTimer -= dt
      const phase01 = 1 - this.attackTimer / this.attackDur
      const arc: SwingArc = this.attackState === 'special' ? 'spin' : this.attackState === 'heavy' ? 'overhead' : this.attackIndex === 0 ? 'horizontal' : this.attackIndex === 1 ? 'reverse' : 'overhead'
      this.player.setSwing(arc, phase01, 1)
      // Trail follows the blade
      if (this.socket) {
        const tip = this.tmp.copy(this.socket.tip(this.tmp2))
        // tip() reuses tmp2 — recompute carefully with fresh vectors
        const t = new THREE.Vector3(); const b = new THREE.Vector3()
        this.socket.tip(t); this.socket.base(b)
        this.fx.trailPush(t, b)
      }
      if (!this.attackHitDone && phase01 > 0.32 && phase01 < 0.7) {
        this.attackHitDone = true
        this.resolveAttackHit()
      }
      if (this.attackTimer <= 0) {
        this.fx.trailEnd()
        this.player.clearSwing()
        if (this.buffered) { const b = this.buffered; this.buffered = null; this.startAttack(b) }
        else { this.attackState = 'idle'; this.player.play(this.drawn ? 'Idle_Sword' : 'Idle', { fade: 0.12 }) }
      }
    }

    // --- enemies ---
    const ctx = this.enemyCtx()
    for (const e of this.enemies) e.update(dt, ctx)
    // Remove dead enemies after their death clip, check wave clear
    const alive = this.enemies.filter((e) => e.alive)
    if (this.wave > 0 && this.wave < 3 && alive.length === 0 && this.enemies.length > 0) {
      this.waveClearTimer += this.dtReal
      if (this.waveClearTimer > 1.2) {
        this.waveClearTimer = 0
        this.enemies = []
        this.hp = Math.min(this.maxHp, this.hp + 25)
        this.banner(this.wave === 1 ? 'WAVE I CLEARED — +25 HEALTH' : 'WAVE II CLEARED — +25 HEALTH')
        void this.nextWave()
      }
    }
    if (this.boss && !this.boss.alive && this.phase === 'playing') {
      // Boss death cinematic, then victory
      if (!this.finisherSlow) { this.finisherSlow = true; this.fx.slowMo(0.25, 1.8); this.banner('THE FALLEN KING IS BROKEN') }
      this.waveClearTimer += this.dtReal
      if (this.waveClearTimer > 2.2) this.victory()
    }
    // Lock-on target died / cleared
    if (this.lockOn && !this.lockOn.alive) { this.lockOn = null; $('target-bar').classList.add('hidden') }

    // --- camera (third person, lock-on aware) ---
    if (this.lockOn && this.lockOn.alive) {
      const dx = this.lockOn.pos.x - this.player.position.x
      const dz = this.lockOn.pos.z - this.player.position.z
      const targetYaw = Math.atan2(dx, dz) + Math.PI
      let diff = targetYaw - this.camYaw
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      this.camYaw += diff * Math.min(1, 3.5 * dt)
    }
    const head = this.tmp.set(this.player.position.x, this.player.position.y + 1.7, this.player.position.z)
    const camOffset = this.tmp2.set(Math.sin(this.camYaw) * Math.cos(this.camPitch), Math.sin(this.camPitch), Math.cos(this.camYaw) * Math.cos(this.camPitch)).multiplyScalar(this.camDist)
    const desired = this.tmp3.copy(head).add(camOffset)
    desired.y = Math.max(desired.y, 0.5)
    this.camera.position.lerp(desired, 1 - Math.pow(0.0001, dt))
    const shake = this.fx.shakeOffset(new THREE.Vector3())
    this.camera.position.add(shake)
    const look = head.clone().add(shake)
    if (this.lockOn && this.lockOn.alive) look.lerp(this.tmp.set(this.lockOn.pos.x, this.lockOn.pos.y + 1.3, this.lockOn.pos.z), 0.35)
    this.camera.lookAt(look)

    // --- sockets / character / env ---
    this.player.update(dt)
    this.socket?.update()
    this.socketL?.update()
    if (this.dbgHand && this.socket) {
      this.socket.handPos(this.dbgHand.position)
      this.socket.tip(this.dbgTip!.position)
      this.socket.base(this.dbgBase!.position)
    }
    this.env.update(dt, this.camera.position)
    this.updateHud()
    void rawDt
  }

  private updateHud() {
    $('hp-fill').style.width = `${(this.hp / this.maxHp) * 100}%`
    $('st-fill').style.width = `${this.stamina}%`
    $('en-fill').style.width = `${this.qi}%`
    const comboEl = $('combo')
    comboEl.style.opacity = this.combo > 1 ? '1' : '0'
    $('combo-count').textContent = String(this.combo)
    if (this.lockOn && this.lockOn.alive) {
      $('target-name').textContent = this.lockOn.name
      $('target-hp').style.width = `${(this.lockOn.hp / this.lockOn.maxHp) * 100}%`
      $('target-posture').style.width = `${(this.lockOn.posture / this.lockOn.postureMax) * 100}%`
    }
    if (this.boss) {
      $('boss-hp').style.width = `${Math.max(0, this.boss.hp / this.boss.maxHp) * 100}%`
      $('boss-phase').textContent = this.boss.phase === 2 ? 'PHASE II — ENRAGED' : 'PHASE I'
    }
  }

  private updateDebug() {
    const tip = new THREE.Vector3(); const base = new THREE.Vector3(); const hand = new THREE.Vector3()
    let tipStr = 'n/a'
    if (this.socket) {
      this.socket.tip(tip); this.socket.base(base); this.socket.handPos(hand)
      tipStr = `hand=(${hand.x.toFixed(2)},${hand.y.toFixed(2)},${hand.z.toFixed(2)}) tip=(${tip.x.toFixed(2)},${tip.y.toFixed(2)},${tip.z.toFixed(2)}) tip-hand=${tip.distanceTo(hand).toFixed(2)}m base-hand=${base.distanceTo(hand).toFixed(2)}m`
    }
    $('debug').textContent =
      `fps=${this.fps} phase=${this.phase} wave=${this.wave} hp=${this.hp.toFixed(0)} st=${this.stamina.toFixed(0)} qi=${this.qi.toFixed(0)}\n` +
      `player=(${this.player.position.x.toFixed(1)},${this.player.position.y.toFixed(1)},${this.player.position.z.toFixed(1)}) facing=${this.player.facing.toFixed(2)} clip=${this.player.currentClip}\n` +
      `weapon=${this.weaponId} drawn=${this.drawn} attack=${this.attackState} combo=${this.combo}\n` +
      `${tipStr}\n` +
      `enemies alive=${this.enemies.filter((e) => e.alive).length}/${this.enemies.length} lockOn=${this.lockOn ? this.lockOn.name : 'none'} boss=${this.boss ? `${this.boss.hp}/${this.boss.maxHp} p${this.boss.phase}` : 'no'}`
  }

  private debugApi() {
    return {
      start: () => this.start(),
      state: () => ({
        phase: this.phase, wave: this.wave, hp: this.hp, stamina: this.stamina, qi: this.qi,
        player: { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z, clip: this.player.currentClip },
        weapon: this.weaponId, drawn: this.drawn, attack: this.attackState, combo: this.combo,
        parrying: this.parrying, rolling: this.rolling,
        enemies: this.enemies.map((e) => ({ kind: e.kind, hp: e.hp, alive: e.alive, state: e.state, x: e.pos.x, z: e.pos.z })),
        boss: this.boss ? { hp: this.boss.hp, phase: this.boss.phase, alive: this.boss.alive } : null,
        fps: this.fps,
      }),
      weaponTip: () => {
        if (!this.socket) return null
        const tip = new THREE.Vector3(); const hand = new THREE.Vector3(); const base = new THREE.Vector3()
        this.socket.tip(tip); this.socket.handPos(hand); this.socket.base(base)
        return { tip: tip.toArray(), hand: hand.toArray(), base: base.toArray(), tipHandDist: tip.distanceTo(hand), baseHandDist: base.distanceTo(hand) }
      },
      attack: () => this.queueAttack('light'),
      heavy: () => this.queueAttack('heavy'),
      parry: () => this.startParry(),
      roll: () => this.roll(),
      lockOn: () => this.toggleLockOn(),
      sideView: () => { this.lockOn = null; this.camYaw = Math.PI / 2; this.camPitch = 0.12; this.camDist = 6 },
      frontView: () => { this.lockOn = null; this.camYaw = Math.PI; this.camPitch = 0.15; this.camDist = 6 },
      backView: () => { this.lockOn = null; this.camYaw = 0; this.camPitch = 0.25; this.camDist = 5 },
      skipToBoss: async () => {
        this.enemies = []; this.wave = 3; await this.spawnBoss()
        // Wave-1/2 spawns still in flight from autostart can push into the
        // array after the clear — keep only the boss for the debug jump.
        this.enemies = this.enemies.filter((e) => e.kind === 'boss')
      },
      teleportNearBoss: () => {
        if (this.boss) { this.player.position.set(this.boss.pos.x + 1.2, 0, this.boss.pos.z + 1.2); this.facePoint(this.boss.pos) }
      },
      setBossHp: (v: number) => { if (this.boss) this.boss.hp = v },
      setQi: (v: number) => { this.qi = v },
      equip: (id: string) => this.equipWeapon(id),
      teleportNearEnemy: () => {
        const e = this.enemies.find((x) => x.alive)
        if (e) { this.player.position.set(e.pos.x + 1.2, 0, e.pos.z + 1.2); this.facePoint(e.pos) }
      },
      bones: () => {
        const names: string[] = []
        this.player.bones.forEach((_v, k) => names.push(k))
        const wrist = this.player.bone('Wrist.R')
        const wp = new THREE.Vector3()
        if (wrist) wrist.getWorldPosition(wp)
        return { count: names.length, hasWristR: !!wrist, wristWorld: wp.toArray(), sample: names.slice(0, 12), wristNames: names.filter((n) => n.toLowerCase().includes('wrist')) }
      },
      fpsInfo: () => ({ fps: this.fps, frameCount: this.frameCount }),
    }
  }
}
