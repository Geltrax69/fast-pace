// Enemy AI: state machine — patrol / chase / strafe / telegraph / attack /
// recover / stagger / death. Three classes + a two-phase boss.
// Attack telegraphs are explicit (weapon raise + flash) and every attack has
// a recovery window the player can punish.
import * as THREE from 'three'
import { RiggedCharacter } from './characters'
import { WeaponSocket, WEAPONS, type WeaponDef } from './weapons'
import type { Sfx } from './audio'
import type { Effects } from './effects'

export type EnemyKind = 'assassin' | 'heavy' | 'dual' | 'boss'
export type EnemyState = 'patrol' | 'chase' | 'strafe' | 'telegraph' | 'attack' | 'recover' | 'stagger' | 'dead'

export interface EnemyCtx {
  playerPos: THREE.Vector3
  playerDodging: boolean
  damagePlayer(amount: number, from: THREE.Vector3, heavy: boolean): void
  sfx: Sfx
  fx: Effects
}

const KIND_STATS: Record<EnemyKind, { hp: number; speed: number; damage: number; range: number; telegraph: number; attackDur: number; recover: number; postureMax: number; name: string }> = {
  assassin: { hp: 55, speed: 4.6, damage: 9, range: 2.2, telegraph: 0.45, attackDur: 0.55, recover: 0.7, postureMax: 40, name: 'SHADOW ASSASSIN' },
  heavy: { hp: 130, speed: 2.6, damage: 20, range: 2.6, telegraph: 0.8, attackDur: 0.8, recover: 1.1, postureMax: 80, name: 'IRON WARRIOR' },
  dual: { hp: 70, speed: 5.4, damage: 7, range: 2.0, telegraph: 0.35, attackDur: 0.45, recover: 0.5, postureMax: 45, name: 'TWIN-BLADE ASSASSIN' },
  boss: { hp: 420, speed: 3.8, damage: 16, range: 2.8, telegraph: 0.6, attackDur: 0.65, recover: 0.9, postureMax: 120, name: 'THE FALLEN KING' },
}

const KIND_MODEL: Record<EnemyKind, string> = {
  assassin: 'assets/characters/enemy-assassin.glb',
  heavy: 'assets/characters/enemy-heavy.glb',
  dual: 'assets/characters/enemy-dual.glb',
  boss: 'assets/characters/boss-king.glb',
}

export class Enemy {
  kind: EnemyKind
  char = new RiggedCharacter()
  socket: WeaponSocket | null = null
  weaponDef: WeaponDef
  state: EnemyState = 'patrol'
  hp: number; maxHp: number
  posture = 0; postureMax: number
  speed: number; damage: number; range: number
  telegraphTime: number; attackDur: number; recoverTime: number
  name: string
  alive = true
  private timer = 0
  private stateTimer = 0
  private attackHitDone = false
  private strafeDir = 1
  private patrolTarget = new THREE.Vector3()
  private tmp = new THREE.Vector3()
  private tmp2 = new THREE.Vector3()
  phase = 1
  private comboHits = 0
  private leapTarget = new THREE.Vector3()
  private leaping = false
  private vy = 0

  constructor(kind: EnemyKind, scene: THREE.Scene) {
    this.kind = kind
    const s = KIND_STATS[kind]
    this.hp = s.hp; this.maxHp = s.hp
    this.speed = s.speed; this.damage = s.damage; this.range = s.range
    this.telegraphTime = s.telegraph; this.attackDur = s.attackDur; this.recoverTime = s.recover
    this.postureMax = s.postureMax; this.name = s.name
    this.weaponDef = kind === 'boss' ? WEAPONS.bossSword : WEAPONS.enemySword
    this.sceneRef = scene
  }
  private sceneRef: THREE.Scene

  async load(scene: THREE.Scene) {
    await this.char.load(KIND_MODEL[this.kind], scene)
    this.socket = new WeaponSocket(scene, this.weaponDef)
    await this.socket.init()
    const wrist = this.char.bone('Wrist.R')
    if (wrist) this.socket.attachHand(wrist)
    this.char.play('Idle', { fade: 0.2 })
    this.patrolTarget.set((Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30)
    // Boss is larger and more imposing
    if (this.kind === 'boss') this.char.root.scale.setScalar(1.18)
  }

  get pos() { return this.char.position }
  get facing() { return this.char.facing }

  faceTowards(p: THREE.Vector3, dt: number, rate = 8) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z
    const target = Math.atan2(dx, dz)
    let diff = target - this.char.facing
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    this.char.setFacing(this.char.facing + diff * Math.min(1, rate * dt))
  }

  takeHit(dmg: number, from: THREE.Vector3, ctx: EnemyCtx, opts: { heavy?: boolean; postureDmg?: number } = {}) {
    if (!this.alive) return
    this.hp -= dmg
    this.posture += opts.postureDmg ?? (opts.heavy ? 28 : 12)
    ctx.fx.blood(this.tmp.copy(this.pos).setY(this.pos.y + 1.3))
    if (this.kind === 'boss' && this.phase === 1 && this.hp <= this.maxHp * 0.5) {
      this.phase = 2
      this.state = 'stagger'; this.stateTimer = 1.2
      ctx.sfx.roar(); ctx.fx.soul(this.tmp.copy(this.pos).setY(this.pos.y + 1))
      ctx.fx.shake(1.2); ctx.fx.slowMo(0.3, 0.9)
    }
    if (this.hp <= 0) { this.die(ctx); return }
    if (this.posture >= this.postureMax) {
      this.posture = 0
      this.state = 'stagger'; this.stateTimer = 1.4
      this.char.playOnce('HitRecieve', 1)
      ctx.sfx.clash()
      return
    }
    // Light hits interrupt only if not mid-attack (heavy armour for heavy/boss)
    if (this.kind !== 'heavy' && this.kind !== 'boss' && this.state !== 'attack') {
      this.char.playOnce('HitRecieve', 1.2)
      this.state = 'recover'; this.stateTimer = 0.35
    }
  }

  die(ctx: EnemyCtx) {
    this.alive = false
    this.state = 'dead'
    this.char.playOnce('Death', 1)
    this.char.clearSwing()
    ctx.sfx.death()
    ctx.fx.soul(this.tmp.copy(this.pos).setY(this.pos.y + 1))
  }

  private startAttack(ctx: EnemyCtx) {
    this.state = 'telegraph'; this.stateTimer = this.telegraphTime
    this.attackHitDone = false
    this.comboHits = this.kind === 'dual' ? 2 : this.kind === 'boss' && this.phase === 2 ? 3 : 1
    // Telegraph: raise weapon, lean back
    this.char.setSwing('overhead', 0.1, 0.7)
    ctx.sfx.whoosh()
  }

  update(dt: number, ctx: EnemyCtx) {
    if (!this.alive) { this.char.update(dt); this.socket?.update(); return }
    this.timer += dt
    this.stateTimer -= dt
    const toPlayer = this.tmp.copy(ctx.playerPos).sub(this.pos)
    toPlayer.y = 0
    const dist = toPlayer.length()
    const speedMul = this.kind === 'boss' && this.phase === 2 ? 1.35 : 1

    // Leap slam (boss phase 2, long range)
    if (this.leaping) {
      this.vy -= 22 * dt
      this.pos.y += this.vy * dt
      this.pos.add(this.tmp2.copy(this.leapTarget).sub(this.pos).setY(0).normalize().multiplyScalar(14 * dt))
      if (this.pos.y <= 0) {
        this.pos.y = 0; this.leaping = false
        ctx.fx.dust(this.pos); ctx.fx.shake(1.0); ctx.sfx.hitHeavy()
        if (this.pos.distanceTo(ctx.playerPos) < 3.2 && !ctx.playerDodging) ctx.damagePlayer(26, this.pos, true)
        this.state = 'recover'; this.stateTimer = 1.2
        this.char.play('Idle_Sword', { fade: 0.2 })
      }
      this.char.update(dt); this.socket?.update(); return
    }

    switch (this.state) {
      case 'patrol': {
        this.char.play('Walk')
        this.faceTowards(this.patrolTarget, dt, 4)
        this.pos.add(this.tmp2.copy(this.patrolTarget).sub(this.pos).setY(0).normalize().multiplyScalar(1.6 * dt))
        if (this.pos.distanceTo(this.patrolTarget) < 1) this.patrolTarget.set((Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30)
        if (dist < 13) { this.state = 'chase'; this.char.play('Run') }
        break
      }
      case 'chase': {
        this.faceTowards(ctx.playerPos, dt)
        if (dist > this.range) {
          this.char.play('Run')
          this.pos.add(this.tmp2.copy(toPlayer).normalize().multiplyScalar(this.speed * speedMul * dt))
        } else {
          // In range: strafe a little, then telegraph — never attack instantly.
          this.state = 'strafe'; this.stateTimer = 0.25 + Math.random() * 0.5
          this.strafeDir = Math.random() > 0.5 ? 1 : -1
          this.char.play('Idle_Sword')
        }
        if (dist > 22) this.state = 'patrol'
        break
      }
      case 'strafe': {
        this.faceTowards(ctx.playerPos, dt)
        const side = this.tmp2.set(Math.cos(this.char.facing), 0, -Math.sin(this.char.facing)).multiplyScalar(this.strafeDir)
        this.pos.add(side.multiplyScalar(1.8 * dt))
        if (this.stateTimer <= 0) this.startAttack(ctx)
        break
      }
      case 'telegraph': {
        this.faceTowards(ctx.playerPos, dt, 10)
        this.char.setSwing('overhead', 0.15 + (1 - Math.max(0, this.stateTimer) / this.telegraphTime) * 0.2, 0.7)
        // Boss leap decision
        if (this.kind === 'boss' && this.phase === 2 && dist > 7 && Math.random() < 0.02) {
          this.leaping = true; this.vy = 9
          this.leapTarget.copy(ctx.playerPos)
          this.char.play('Run')
          break
        }
        if (this.stateTimer <= 0) {
          this.state = 'attack'; this.stateTimer = this.attackDur
          this.char.playOnce('Sword_Slash', this.kind === 'dual' ? 1.5 : 1.15)
          this.char.setSwing(this.kind === 'heavy' ? 'overhead' : 'horizontal', 0.3, 1)
          ctx.sfx.swingHeavy()
        }
        break
      }
      case 'attack': {
        this.faceTowards(ctx.playerPos, dt, 6)
        const progress = 1 - this.stateTimer / this.attackDur
        this.char.setSwing(this.kind === 'heavy' ? 'overhead' : 'horizontal', 0.3 + progress * 0.6, 1)
        // Active hit window: middle of the swing
        if (!this.attackHitDone && progress > 0.35 && progress < 0.75) {
          this.attackHitDone = true
          if (dist < this.range + 0.4 && !ctx.playerDodging) {
            ctx.damagePlayer(this.damage, this.pos, this.kind === 'heavy')
          }
        }
        if (this.stateTimer <= 0) {
          this.comboHits--
          if (this.comboHits > 0) {
            // Dual / boss phase-2 follow-up hit
            this.state = 'attack'; this.stateTimer = this.attackDur * 0.85
            this.attackHitDone = false
            this.char.playOnce('Sword_Slash', 1.5)
            this.char.setSwing('reverse', 0.3, 1)
          } else {
            this.state = 'recover'; this.stateTimer = this.recoverTime
            this.char.clearSwing()
            this.char.play('Idle_Sword', { fade: 0.15 })
          }
        }
        break
      }
      case 'recover': {
        if (this.stateTimer <= 0) { this.state = dist < 14 ? 'chase' : 'patrol' }
        break
      }
      case 'stagger': {
        if (this.stateTimer <= 0) { this.state = 'chase'; this.char.play('Idle_Sword', { fade: 0.15 }) }
        break
      }
    }
    // Posture slowly recovers when not being hit
    if (this.state !== 'stagger') this.posture = Math.max(0, this.posture - dt * 6)
    this.char.update(dt)
    this.socket?.update()
  }
}
