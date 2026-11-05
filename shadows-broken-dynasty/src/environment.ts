// Abandoned Chinese mountain fortress: stone courtyard, temple hall, paifang
// gate, red lanterns, broken pillars, destructible pots, mountains, rain, fog.
import * as THREE from 'three'

export interface Destructible { mesh: THREE.Mesh; pos: THREE.Vector3; broken: boolean; radius: number }

function stoneTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = '#5a564e'; g.fillRect(0, 0, 256, 256)
  // Flagstones
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const shade = 78 + Math.floor(Math.random() * 26)
    g.fillStyle = `rgb(${shade},${shade - 4},${shade - 12})`
    g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60)
    g.fillStyle = 'rgba(0,0,0,0.25)'
    for (let i = 0; i < 40; i++) g.fillRect(x * 64 + Math.random() * 60, y * 64 + Math.random() * 60, 2, 2)
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(14, 14)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function woodTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#4a2f1d'; g.fillRect(0, 0, 128, 128)
  for (let x = 0; x < 128; x += 16) {
    g.fillStyle = x % 32 ? '#54371f' : '#402512'
    g.fillRect(x, 0, 14, 128)
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace
  return t
}

export class Environment {
  destructibles: Destructible[] = []
  lanternLights: THREE.PointLight[] = []
  private rain: THREE.Points
  private rainVel: Float32Array
  private rainPos: Float32Array
  private rainCount = 1400

  constructor(scene: THREE.Scene) {
    const stone = stoneTexture()
    const wood = woodTexture()
    const stoneMat = new THREE.MeshStandardMaterial({ map: stone, roughness: 0.95 })
    const darkStone = new THREE.MeshStandardMaterial({ color: 0x4a463e, roughness: 0.95 })
    const woodMat = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.85 })
    const redWood = new THREE.MeshStandardMaterial({ color: 0x8f1d1d, roughness: 0.7 })
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x1d3a2a, roughness: 0.6, metalness: 0.15 })
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.4, metalness: 0.6 })

    // Courtyard floor (arena ~56 x 56, walls beyond)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), stoneMat)
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true
    scene.add(floor)
    // Blood-stained arena circle at centre
    const stain = new THREE.Mesh(
      new THREE.CircleGeometry(6, 32),
      new THREE.MeshStandardMaterial({ color: 0x3d0d0d, roughness: 1, transparent: true, opacity: 0.55 }),
    )
    stain.rotation.x = -Math.PI / 2; stain.position.y = 0.01
    scene.add(stain)

    const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, ry = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
      mesh.position.set(x, y, z); mesh.rotation.y = ry
      mesh.castShadow = true; mesh.receiveShadow = true
      scene.add(mesh); return mesh
    }
    // Perimeter walls with gaps at the gate (south, z=+26)
    addBox(60, 5, 1.2, 0, 2.5, -28, darkStone)
    addBox(60, 5, 1.2, -22, 2.5, 28, darkStone)
    addBox(60, 5, 1.2, 22, 2.5, 28, darkStone)
    addBox(1.2, 5, 56, -29, 2.5, 0, darkStone)
    addBox(1.2, 5, 56, 29, 2.5, 0, darkStone)
    // Wall crenellations
    for (let x = -28; x <= 28; x += 4) {
      addBox(1.6, 0.9, 1.2, x, 5.4, -28, darkStone)
      addBox(1.6, 0.9, 1.2, x, 5.4, 28, darkStone)
    }

    // Temple hall (north): platform, columns, curved roof
    addBox(20, 1.2, 12, 0, 0.6, -20, stoneMat)
    for (const [x, z] of [[-8, -24], [-8, -16], [8, -24], [8, -16], [-2.7, -24], [-2.7, -16], [2.7, -24], [2.7, -16]] as const) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 7, 10), redWood)
      col.position.set(x, 1.2 + 3.5, z); col.castShadow = true; scene.add(col)
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 1.4), goldMat)
      cap.position.set(x, 1.2 + 7.1, z); scene.add(cap)
    }
    addBox(22, 0.8, 14, 0, 8.6, -20, woodMat)
    // Curved roof: two sloped slabs + ridge
    const roofL = addBox(24, 0.5, 8, 0, 10.6, -23.5, roofMat); roofL.rotation.x = 0.45
    const roofR = addBox(24, 0.5, 8, 0, 10.6, -16.5, roofMat); roofR.rotation.x = -0.45
    addBox(24.5, 0.7, 1, 0, 12.2, -20, goldMat)
    // Broken roof corner (battle damage)
    const broken = addBox(5, 0.5, 4, 9, 10.2, -23, darkStone); broken.rotation.set(0.4, 0.3, 0.5)

    // Paifang gate (south entrance)
    for (const x of [-3.5, 3.5]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 8, 10), redWood)
      pillar.position.set(x, 4, 26); pillar.castShadow = true; scene.add(pillar)
    }
    addBox(10, 0.9, 1.2, 0, 7.6, 26, redWood)
    addBox(11, 0.5, 1.6, 0, 8.6, 26, roofMat)
    addBox(8, 1.1, 0.6, 0, 6.2, 26, woodMat)

    // Broken pillars + rubble scattered in the courtyard
    const pillarSpots: [number, number, number, number][] = [[-14, -8, 1.2, 0.2], [14, 6, 2.0, -0.3], [-10, 12, 0.8, 0.5], [18, -14, 1.5, 0.1], [-20, -18, 2.4, 0]]
    for (const [x, z, h, tilt] of pillarSpots) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, h, 10), darkStone)
      p.position.set(x, h / 2, z); p.rotation.z = tilt; p.castShadow = true; scene.add(p)
      const rub = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5), darkStone)
      rub.position.set(x + 1, 0.25, z + 0.6); rub.castShadow = true; scene.add(rub)
    }

    // Red lanterns on posts (emissive + a few real point lights)
    const lanternMat = new THREE.MeshStandardMaterial({ color: 0xa31616, emissive: 0xff2a18, emissiveIntensity: 1.6, roughness: 0.5 })
    const lanternSpots: [number, number][] = [[-6, -14], [6, -14], [-12, 2], [12, 2], [-6, 16], [6, 16], [-3.5, 24], [3.5, 24]]
    lanternSpots.forEach(([x, z], i) => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 3.2, 8), woodMat)
      post.position.set(x, 1.6, z); post.castShadow = true; scene.add(post)
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), lanternMat)
      lamp.scale.y = 1.25; lamp.position.set(x, 3.5, z); scene.add(lamp)
      const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 0.15, 8), goldMat)
      capTop.position.set(x, 4.05, z); scene.add(capTop)
      if (i % 3 === 0) {
        const light = new THREE.PointLight(0xff4030, 14, 12, 1.8)
        light.position.set(x, 3.5, z); scene.add(light)
        this.lanternLights.push(light)
      }
    })

    // Destructible pots (clay) around the arena
    const potMat = new THREE.MeshStandardMaterial({ color: 0x7a4a26, roughness: 0.9 })
    const potSpots: [number, number][] = [[-8, -6], [-7, -5], [9, 8], [10, 7], [-16, 4], [16, -6], [-4, 20], [5, -18]]
    for (const [x, z] of potSpots) {
      const pot = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), potMat)
      pot.scale.y = 0.85; pot.position.set(x, 0.38, z); pot.castShadow = true
      scene.add(pot)
      this.destructibles.push({ mesh: pot, pos: pot.position.clone(), broken: false, radius: 0.6 })
    }

    // Dead trees
    const treeMat = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 1 })
    for (const [x, z] of [[-22, 10], [22, 14], [-24, -12], [20, -22]] as const) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.4, 4.5, 7), treeMat)
      trunk.position.set(x, 2.25, z); trunk.rotation.z = 0.12; trunk.castShadow = true; scene.add(trunk)
      for (let b = 0; b < 3; b++) {
        const br = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 1.8, 6), treeMat)
        br.position.set(x + (b - 1) * 0.5, 4 + b * 0.3, z); br.rotation.z = (b - 1) * 0.8; scene.add(br)
      }
    }

    // Mountain ring (fog-shrouded silhouettes)
    const mtnMat = new THREE.MeshStandardMaterial({ color: 0x1a2030, roughness: 1, flatShading: true })
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      const r = 95 + Math.random() * 40
      const m = new THREE.Mesh(new THREE.ConeGeometry(28 + Math.random() * 22, 55 + Math.random() * 45, 5), mtnMat)
      m.position.set(Math.cos(a) * r, 18, Math.sin(a) * r)
      scene.add(m)
    }

    // Rain
    this.rainCount = 1400
    this.rainPos = new Float32Array(this.rainCount * 3)
    this.rainVel = new Float32Array(this.rainCount)
    for (let i = 0; i < this.rainCount; i++) {
      this.rainPos[i * 3] = (Math.random() - 0.5) * 70
      this.rainPos[i * 3 + 1] = Math.random() * 30
      this.rainPos[i * 3 + 2] = (Math.random() - 0.5) * 70
      this.rainVel[i] = 14 + Math.random() * 8
    }
    const rainGeo = new THREE.BufferGeometry()
    rainGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3))
    const rainMat = new THREE.PointsMaterial({ color: 0x9fb6cc, size: 0.09, transparent: true, opacity: 0.5 })
    this.rain = new THREE.Points(rainGeo, rainMat)
    this.rain.frustumCulled = false
    scene.add(this.rain)
  }

  update(dt: number, camPos: THREE.Vector3) {
    const attr = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < this.rainCount; i++) {
      let y = attr.getY(i) - this.rainVel[i] * dt
      if (y < 0) {
        y = 28
        attr.setX(i, camPos.x + (Math.random() - 0.5) * 60)
        attr.setZ(i, camPos.z + (Math.random() - 0.5) * 60)
      }
      attr.setY(i, y)
    }
    attr.needsUpdate = true
    // Lantern flicker
    const t = performance.now() * 0.001
    this.lanternLights.forEach((l, i) => { l.intensity = 13 + Math.sin(t * 7 + i * 2.4) * 2.5 })
  }
}
