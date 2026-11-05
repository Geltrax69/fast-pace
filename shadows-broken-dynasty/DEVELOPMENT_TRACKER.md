# DEVELOPMENT TRACKER — Shadows of the Broken Dynasty

Third-person cinematic wuxia combat game (three.js 0.186.1 + Vite + TypeScript).
Source: `~/workspace/games/shadows-broken-dynasty/` — run `npm run dev` (5173) / `npm run build` + `npm run preview`.

## Inspection findings (2026-11-06, Phase 0 — DONE)

Engine: **three.js 0.186.1, Vite 8, TypeScript 5, no React** (plain DOM HUD).
No pre-existing game code in `fast-pace` — it is an **assets-only repo** (471 files, 252 MB,
HEAD `4d13990`). No player controller / combat / camera systems existed to reuse; all built new.

Characters — Quaternius "Ultimate Modular Men" GLBs (all same 62-joint rig, same 24 clips):
`Adventurer` (player), `Punk` (assassin), `Swat` (heavy), `Hoodie Character` (dual),
`King` (boss). Clips (durations): Idle 1.67s, Idle_Sword 1.67s, Walk 1.33s, Run 0.79s,
Roll 1.33s, Sword_Slash 1.00s (the ONLY sword attack clip), Punch L/R 0.83s, Kick L/R 0.92s,
HitRecieve / HitRecieve_2 0.54s, Death 1.04s, Interact 1.25s, Wave 1.67s, Gun_* (unused).
Armature node scale = 100, bone translations in cm-scale units — **weapons must NOT be
parented to bones directly** (they would inherit 100x scale). Weapon socket follows the
`Wrist.R` / `Chest` bone world transform each frame instead (see `src/weapons.ts`).

Weapons — "+100 Fantasy Weapons" GLBs, static single-node, no skin/anim:
blade extends along local **-Y**, handle at origin (y≈0), length ≈1.5 m (katana 1.50,
greatsword 1.51, spear 1.85, dagger 0.63). Hold orientation is tuned empirically
(`WEAPON_HOLD` in `src/weapons.ts`) and verified by screenshot + debug readout
(hand world pos vs weapon tip world pos).

Consequence for the spec: combo variety cannot come from distinct sword clips (only one
exists). Combos are built from Sword_Slash at different rates + a procedural torso/arm
swing layer (3 distinct arcs: horizontal, reverse, overhead) + different weapons'
speed/range/damage. This is recorded honestly, not hidden.

## Development plan (spec §15, scaled to what the asset set supports)

| Phase | Scope | Status |
|---|---|---|
| 1 | Player movement + 3rd-person camera, lock-on, jump/double-jump, roll, dash | DONE |
| 2 | Sword attacks + hit detection (arc test during active frames) | DONE |
| 3 | Combo state machine (L→L→L→Heavy, buffering, cancel windows) | DONE |
| 4 | Parry / block / dodge / counter, stamina, posture, hit-stop | DONE (parry loop needs real-player timing pass) |
| 5 | Enemy AI: Assassin / Heavy / Dual (detect, telegraph, recover, stagger, death) | DONE |
| 6 | Weapon switch: Katana / Greatsword / Spear / Twin Daggers, specials | DONE |
| 7 | Boss: King, 2 phases, leap slam, cinematic death | DONE |
| 8 | Cinematic finishers, sword trail, sparks, blood, slow-mo, camera shake | DONE |
| 9 | Fortress environment (temple, gate, lanterns, rain, fog), synth audio | DONE |
| 10 | Polish, testing, optimisation | DONE (headless); real-hardware pass pending |

## Completed features
- Phase 1: WASD camera-relative movement, sprint, jump + double jump, dodge roll
  (i-frames), third-person orbit camera, lock-on (Q/Tab) with camera easing.
- Phase 2: Light/heavy/special attacks, arc hit detection (range + facing cone),
  verified: 2 light hits 55 → 43 → 31 HP, combo counter 2.
- Phase 3: Combo state machine — Light×3 (horizontal/reverse/overhead arcs) →
  Heavy, input buffering in the cancel window, per-weapon speed.
- Phase 4: Parry (F, 0.35 s stance, 0.18 s perfect window) → perfect parry
  staggers attacker + posture break + sparks/slow-mo/ring; block = chip damage;
  stamina + posture meters; hit-stop on heavy hits.
- Phase 5: Enemy AI (patrol/chase/strafe/telegraph/attack/recover/stagger/death)
  for Assassin (Punk), Heavy (Swat), Dual (Hoodie) — telegraphs, recovery
  windows, posture breaks, Death clip.
- Phase 6: Weapon switch 1–4 — Katana / Greatsword / Spear / Twin Daggers, each
  with own damage/speed/range/heavy; draw/sheathe (R) to the back.
- Phase 7: Boss "The Fallen King" (King, 1.18× scale, Crystal Sword) — 420 HP,
  2 phases (phase 2 at ≤50%: enraged, faster, leap slam AoE, 3-hit combos),
  cinematic slow-mo death → victory screen. Verified headless.
- Phase 8: Sword trail ribbon, sparks/blood/dust/soul bursts, slow-mo + hit-stop,
  camera shake, execution slow-mo on killing blows.
- Phase 9: Fortress environment — temple hall, paifang gate, walls, red lanterns
  (flickering point lights), broken pillars, destructible pots, dead trees,
  mountain ring, rain, fog, moonlight; synthesised WebAudio SFX + combat drone.
- Phase 10: HUD (health/stamina/Qi, combo, target + boss bars), title/pause/
  death/victory screens, `scripts/check.mjs` headless verification.

## Bugs found and fixed (2026-11-06)
1. **Bone names**: GLTFLoader strips '.' — `Wrist.R` arrives as `WristR`.
   Weapon socket got no bone, blade sat at world origin. Fixed by normalising
   bone names on load and lookup.
2. **Weapon GLB origins are NOT at the handle**: CurvKatana node translation
   (-0.94, +1.43, -0.01), scale 1.21 — blade rendered ~1.4 m from the origin,
   floating above the head. Fixed by measuring the rendered bbox and shifting
   the mesh so the grip sits at the holder origin (`loadWeaponMesh`).
3. **Pack blades oversized**: katana rendered 1.84 m, tip through the floor.
   Per-weapon render scale about the grip (katana 0.62 → 1.15 m tip distance).
4. **Camera started in front of the player** (camYaw π). Fixed to 0 (behind).
5. **Slow-mo timers used clamped dt**: at ~2 fps headless, slow-mo lasted ~10×
   too long and victory never arrived in 25 s. `Effects.update` now takes real
   dt for the slow timer; wave/boss timers use real dt.
6. **Debug `skipToBoss` race**: in-flight wave-1 spawns pushed into the cleared
   array. Filter keeps only the boss now.
7. **FPS counter used clamped dt** (stuck at 0 in headless). Now wall-clock based.

## Current implementation
- `src/game.ts` (orchestrator), `src/characters.ts` (rig + procedural swing
  layer), `src/weapons.ts` (socket follow + recentre/scale), `src/enemies.ts`
  (AI + boss), `src/environment.ts`, `src/effects.ts`, `src/audio.ts`.
- Weapon hold verified by screenshot (side/front) + debug readout:
  katana base 0.03 m from hand, tip 1.15 m; greatsword tip 1.19 m;
  spear head 0.85 m; daggers tip 0.65 m. Debug markers (green hand / red tip /
  blue base) only with `?debug=1`.
- `?autostart=1` skips the menu; `?debug=1` shows the debug overlay;
  `window.__game` exposes state/weaponTip/attack/skipToBoss for testing.

## Known bugs
- Headless fps is ~2 (SwiftShader software GL) — real-hardware frame rate is
  UNVERIFIED; the scene uses 2048 shadow maps + 1400 rain points.
- In Idle_Sword the katana/greatsword tip sits just at/below floor level
  (tip y ≈ -0.05 m) because the idle pose hangs the arm low — visible only
  from the side at ground level.
- Perfect-parry timing is code-verified (smoke test only); the full
  telegraph → parry → counter loop needs a real-player pass.
- Audio is synthesised; no real music recordings, no voice.

## Pending tasks
- Real-hardware playtest (60 fps, feel, parry timing, boss difficulty).
- Distinct sword clips if a pack with more than the single Sword_Slash clip
  is sourced (see "Consequence" in Inspection findings).
- Push: 2026-11-06, into `Geltrax69/fast-pace` as `shadows-broken-dynasty/` (assets
  repo untouched otherwise; game keeps its own copied GLBs in `public/assets/`).

## Files changed
- `DEVELOPMENT_TRACKER.md`, `README.md`, `CREDITS.md`, `index.html`, `src/*`, `scripts/check.mjs`

## Testing results
- `npm run build`: PASS (tsc + vite, 673 kB JS).
- `node scripts/check.mjs` (Playwright, SwiftShader): PASS, zero console/page
  errors. Load → wave 1 (3 assassins) → 2 light hits 55→43→31, combo 2 →
  greatsword switch (tip 1.19 m) → parry/roll smoke test.
- Boss probe (`/tmp/boss3.mjs`): boss spawns (420 HP), hit at 100 HP → 88 HP
  + phase 2, killing hit → death → victory screen in ~5 s.
- Weapon probes: spear head 0.85 m from hand, daggers tip 0.65 m.
- Screenshots: `screenshots/gameplay.png`, `screenshots/weapon-in-hand.png`,
  `screenshots/boss.png` (also `scripts/check-*.png`).

## Next development task
- User playtest on real hardware; then tune parry window / boss aggression
  from their feel notes.
