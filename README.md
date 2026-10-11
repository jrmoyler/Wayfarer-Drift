# Wayfarer Drift — The Rift Campaign

**Play:** https://wayfarer-drift.vercel.app

A complete single-player top-down arena adventure built around every image in the supplied Wayfarer // Rift pack. Built for desktop, phone portrait/landscape, and offline PWA installation.

## Play
- Choose Sable (mobility), Rook (beacon control), or Iona (shockwave and recovery).
- Reclaim the Desert Relay, Tidal Port, and Highland Station. Each region has three waves; the last ends with the Gatewarden.
- Strike nearby rivals, dodge telegraphed attacks, use your special, and collect coins and recovery drops.
- Spend route coins on permanent shared health, damage, and cooldown upgrades.
- Campaign checkpoints save at region entry and completion. Arena trials replay unlocked regions. Local progress stays on this browser/device.

### Controls
WASD / arrows: move. J: strike. Space: dodge. K: special. Escape: pause/resume. Touch devices use a captured-pointer thumbstick and three action buttons. Losing focus pauses the game. Settings include sound and reduced motion.

## Screens and features
Title, traveler selection, route map, skippable illustrated opening/inter-region/ending cutscenes, combat HUD, pause, settings, defeat/retry, victory, upgrades, field journal, end credits. Original procedural synth audio requires the first user interaction. All content is bundled locally; no accounts, backend, tracking, or external font requests.

## Development
Node 22+ recommended.

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

`npm run build` typechecks, builds Vite, then creates a content-versioned service worker. The worker caches the entire distributable (~7.6 MB uncompressed) atomically. First load requires internet; offline readiness follows a successful cache install. Updates activate on a later full app restart, avoiding mixed-version assets. Install via the title button or browser menu. iOS uses Share → Add to Home Screen.

## Architecture
- `src/simulation.ts`: engine-independent deterministic combat, AI, collisions, progression, pickups, boss hazards.
- `src/scene.ts`: Phaser renderer, depth sorting, sprites, effects, camera, telegraphs.
- `src/main.ts`: DOM screens, input, campaign persistence, PWA installation.
- `src/data.ts`: roster, narrative, regions, validated versioned saves.
- `src/audio.ts`: original procedural Web Audio score and effects.
- `scripts/assets.py`: Pillow asset preparation; originals remain in `source-art/`.
- `public/assets/`: optimized WebP sprites, backgrounds, UI, props, and extraction catalog.
- `tests/`: combat/progression tests; `scripts/playtest.mjs`: Playwright interaction and screenshot pass.
- `evidence/`: browser screenshots and QA results.

## Asset use and provenance
All 11 supplied PNG master images and their original metadata are preserved byte-for-byte in `source-art/`. All four character sheets are animated in gameplay; all three arena images are playable regions; all 16 props appear across regions and in the journal; all four FX rows animate in combat; all 16 interface elements appear in the journal, with action/status icons used throughout the UI. Title artwork is cropped in CSS to avoid competing baked lettering; the original is unchanged. Runtime sheets normalize visible bounds to stable foot pivots and retain alpha.

The supplied source contains south-facing attack/special artwork, not directional action sets. Combat uses proximity-based strikes in all directions with explicit timing, while action art retains its authored orientation. Movement uses the four provided directions. Large source action effects can cross nominal cell boundaries; originals and extraction notes are retained for future authored-art refinement. Arena walls are painted backgrounds; inset collision bounds keep actors on the combat floor, and placed props have foot collision circles.

## Validation
Seven simulation tests cover movement boundaries, stamina gating, one-hit contact timing, terminal states, all three specials, boss telegraphs, three-region victory, and defeat/reset. Automated browser checks cover title → selection → cutscene → combat, keyboard movement, attacks/special, pause freezing, checkpoint resume, phone layouts, and screenshots. Actual phone hardware is not claimed tested. See `evidence/QA.md` for final deployment/offline verification.

## Credits
Concept and creative direction: John-Ross Moyler (Hataalii), Collective AI Inc. Art: user-supplied AI-generated Wayfarer // Rift collection. Engineering, game design implementation, narrative, and procedural audio: OpenAI Codex. Phaser, TypeScript, Vite, and Playwright retain their respective licenses. No third-party recorded music is bundled.
