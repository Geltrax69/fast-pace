// Headless verification for Shadows of the Broken Dynasty.
// Uses Playwright installed in the 3jsFun2 workspace (chromium already cached).
// Usage: node scripts/check.mjs [url] — server must already be running.
import { createRequire } from 'node:module'
import fs from 'node:fs'
const require = createRequire('/home/hatch/workspace/3jsFun2/package.json')
const { chromium } = require('playwright')

const url = process.argv[2] || 'http://127.0.0.1:5173/?autostart=1&debug=1'
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
const logs = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); else logs.push(m.type() + ': ' + m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
page.on('requestfailed', (r) => errors.push('REQFAIL: ' + r.url() + ' ' + (r.failure()?.errorText || '')))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForFunction(() => window.__game, null, { timeout: 30000 })
await page.waitForTimeout(7000) // let GLBs load + wave 1 spawn
const state1 = await page.evaluate(() => window.__game.state())
const tip1 = await page.evaluate(() => window.__game.weaponTip())
console.log('STATE after load:', JSON.stringify(state1))
console.log('WEAPON TIP:', JSON.stringify(tip1))
await page.screenshot({ path: 'scripts/check-game.png' })
// Combat test: teleport next to an enemy, lock on, light attack x2, check HP drop
await page.evaluate(() => { window.__game.teleportNearEnemy(); window.__game.lockOn() })
await page.waitForTimeout(400)
const before = await page.evaluate(() => window.__game.state())
await page.evaluate(() => { window.__game.teleportNearEnemy(); window.__game.attack() })
// Headless swiftshader runs ~2 fps and dt is clamped, so game time runs slower
// than wall time — wait for the attack to actually finish instead of a fixed delay.
await page.waitForFunction(() => window.__game.state().attack === 'idle', null, { timeout: 20000 })
const mid = await page.evaluate(() => window.__game.state())
await page.evaluate(() => { window.__game.teleportNearEnemy(); window.__game.attack() })
await page.waitForFunction(() => window.__game.state().attack === 'idle', null, { timeout: 20000 })
const after = await page.evaluate(() => window.__game.state())
console.log('ENEMY HP before:', JSON.stringify(before.enemies))
console.log('ENEMY HP after 1st light:', JSON.stringify(mid.enemies), 'combo=', mid.combo)
console.log('ENEMY HP after 2nd light:', JSON.stringify(after.enemies), 'combo=', after.combo)
// Weapon switch test
await page.evaluate(() => window.__game.equip('greatsword'))
await page.waitForTimeout(800)
const tip2 = await page.evaluate(() => window.__game.weaponTip())
const state2 = await page.evaluate(() => window.__game.state())
console.log('GREATSWORD TIP:', JSON.stringify(tip2), 'weapon=', state2.weapon)
await page.screenshot({ path: 'scripts/check-greatsword.png' })
// Parry + roll smoke test (should not throw)
await page.evaluate(() => { window.__game.parry(); window.__game.roll() })
await page.waitForTimeout(800)
console.log('ERRORS:', errors.length ? errors : '(none)')
console.log('CONSOLE (first 10):', logs.slice(0, 10))
const results = { state1, tip1, before, after, tip2, state2, errors }
fs.writeFileSync('scripts/check-results.json', JSON.stringify(results, null, 2))
await browser.close()
if (errors.length) { console.log('CHECK: FAIL — console/page errors'); process.exitCode = 1 }
else console.log('CHECK: PASS — no console errors')
