# Generation notes

All image artwork was created with the built-in image_gen tool. Original outputs were copied without alteration. prompts.json records the initial subject prompts; the following shared style preceded each initial call:

Use case: stylized-concept. Production raster game asset for WAYFARER RIFT, original mobility exploration arena brawler. Premium crisp hand-painted sprite art with compact readable shapes and fine tactile material detail, not photoreal, not vector. Orthographic top-down 2.5D at consistent approximately 65 degree overhead angle except background maps as requested. Palette ocean black #0A0C10, deep ocean #0B1520, warm copper #92400E, desert sand #D4A574, sparing teal. Northwest light. 

Props, UI, effects and title prompts also included: Maintain precisely aligned evenly spaced grid when atlas. No overlapping adjacent cells.

The initial effects output and a background-extraction edit retained haze. The final included replacement used this prompt:

Transparent PNG sprite atlas, no backdrop, no colored fog, no gradients outside the objects, alpha zero empty canvas. 6 columns x4 rows precisely aligned separate small game effect sprites with HUGE empty spacing. Each effect at most 60% cell width. Row1 six sequential solid sand colored curved sword slash strokes grow then shrink. Row2 six sequential solid teal water splash ring sprites expand then fade. Row3 six sequential small solid copper compass star dash sprites travel and vanish. Row4 six sequential small amber cracked compass rune impact sprites appear and vanish. Hand-painted 2D game art, sharp contained silhouettes, absolutely no glow haze or ambient light background, no labels, 24 separate objects on transparent canvas.

Despite that request, partial-alpha colored haze remains in the included effects image. The measured alpha statistics are recorded in manifest.json. The source sheet is supplied with this limitation disclosed.
