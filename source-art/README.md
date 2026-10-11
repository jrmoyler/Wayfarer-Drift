# WAYFARER // RIFT — image asset pack
An original top-down 2.5D arena brawler about travelers, navigation and life in motion. Working title only; no division name appears in game artwork.

## Contents
11 generated PNG master images: four 48-pose character atlases, three arena backgrounds, a 16-object prop atlas, a 24-frame effects atlas, a 16-element UI atlas and title artwork. Preserve the masters. Atlas frames are regions in these images, not individually supplied PNG files.
manifest.json contains measured image dimensions, alpha statistics, SHA-256 hashes and proposed named extraction rectangles. prompts.json contains the built-in image-generation prompt set.

## Art and animation status
These are generated source atlases for a coding agent, not engine-tested animation exports. Character poses have visible variation, but frame spacing, feet positions, costume detail and effects differ between frames. Large special effects sometimes reach adjacent nominal cells. Proposed grid rectangles are a starting point; inspect each extracted region, adjust bounds and align feet before shipping. Do not blindly present the nominal grid as a verified packed atlas.
Character sheets have real alpha. The FX sheet also has alpha but retains diffuse colored haze; inspect it over both light and dark floors, then prefer normal alpha blending first. Avoid additive blending until readability is checked. Original PNG alpha is preserved without post-processing.
Arena art is a flattened background: walls cannot independently occlude characters, and it is not a seamless tile set. Use inset combat bounds and props for depth. Character attacks and specials are south-facing only; four movement directions are provided. Use a south-facing attack visual for prototype combat or create additional directional action art before claiming full directional attack coverage.
There is no audio, game implementation or runtime validation in this visual pack.

## Character animation rows (zero-based)
0 idle south: frames 0–5, suggested 6 fps, loop.
1 walk south: 0–5, 10 fps, loop.
2 walk east: 0–5, 10 fps, loop.
3 walk north: 0–5, 10 fps, loop.
4 walk west: 0–5, 10 fps, loop.
5 attack south: 0–5, 12 fps, one shot.
6 special south: 0–5, 10 fps, one shot.
7 hurt: 0–2, 12 fps, one shot; defeat: 3–5, 6 fps, hold last.
Timing is a suggested design value, not measured authored timing. Do not derive damage from visible pixel extent.

## Roster
Sable / courier: fast compass-disc melee, short mobility dash.
Rook / cartographer: medium staff reach, beacon control zone.
Iona / tidekeeper: close gauntlet strike, circular knockback pulse.
Gatewarden / boss: slow heavy staff strike, telegraphed route-lock hazard.
For a minimal game, the three travelers also serve as rival combatants. No extra enemy types are assumed.

## Import recipe
1. Load masters and manifest. Frame IDs are globally unique. Coordinates use top-left image origin.
2. Read the supplied grid bounds as candidate regions. Review action rows for overlap, then make a cleaned engine atlas using the agent's preferred art pipeline.
3. Align each character's feet consistently; use bottom center as initial pivot only. Suggested rendered traveler height 84–112 pixels; boss 130–170 pixels at a 1254-pixel arena scale.
4. Sort characters and props by world foot Y; render ground first, then world, then effects, then screen-space UI.
5. Use small foot collision ellipses, separate combat hitboxes and explicit frame events. Suggested attack contact starts at frame 2; verify animation visually.
6. Begin arena collision at normalized inset rectangle [0.20,0.20,0.80,0.75]. This conservative suggestion avoids painted parapets; tune against each background. Do not treat this as an authored navigation mesh.
7. UI text is intentionally absent. Add live text, accessible contrast, pause/settings controls and scalable touch zones in code. Do not use painted assets as the only input hit regions.
8. For mobile, preserve arena aspect ratio, use a camera viewport, and keep thumbstick/action targets at least 48 CSS pixels.
9. Title illustration includes baked lettering. Keep menu labels live. Fit/contain or thoughtfully crop the image; its measured aspect ratio is approximately 16:9.

## Suggested core loop
Choose traveler → choose arena → duel rivals / survive relay rounds → face Gatewarden → earn route coins. Keep health, stamina, dash, one special and readable enemy windups. This is a proposed scope for the agent, not implemented behavior.

## Palette
Ocean black #0A0C10; deep ocean #0B1520; copper #92400E; desert sand #D4A574; restrained teal. Warm northwest lighting. Hand-painted, tactile materials. No existing division logo or product names.

## Coding-agent starter instruction
Build a responsive top-down 2.5D arena brawler called WAYFARER // RIFT using this pack. First inspect and normalize the proposed atlas regions; preserve original masters. Implement Y-sorted sprite rendering, foot collisions, explicit damage timing, stamina/dash/special systems, the three arenas, three selectable travelers, rival AI and Gatewarden boss. Use live UI text and touch controls. Address the source-art limitations documented here, then verify movement, hitboxes, blend modes, performance, restart and pause on desktop and mobile. Report any art requiring regeneration rather than hiding clipped frames.
