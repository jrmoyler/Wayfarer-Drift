"""Prepare runtime assets from the untouched masters in source-art/.

Pipeline
--------
* Alpha clean-up: the generated sheets carry a faint colored haze (alpha 1-8)
  across the whole canvas. A linear alpha remap removes it while keeping the
  anti-aliased silhouette edges.
* Ownership by connected component: action frames spill across the nominal
  6x8 grid. Every opaque island is labelled across the whole sheet and handed
  to the cell that holds most of its pixels, so a swing that crosses a border
  stays with its own frame and never bleeds into the neighbour.
* Foot alignment: each frame is re-registered on a stable foot pivot (centroid
  of the lowest opaque rows), so idle/walk loops no longer jitter.
* Rival variants: travelers also ship a "rift-touched" recolour used for
  enemies, so the player is always readable against rivals of the same class.

Outputs go to public/assets/ with a catalog.json describing every frame.
Run with:  python3 -I scripts/assets.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "source-art"
OUT = ROOT / "public" / "assets"

CHARACTERS = {
    "sable": "characters/01_sable_courier.png",
    "rook": "characters/02_rook_cartographer.png",
    "iona": "characters/03_iona_tidekeeper.png",
    "warden": "characters/04_gatewarden_boss.png",
}
ANIMS = {
    # name: (row, first, count, fps, loop)
    "idle": (0, 0, 6, 6, True),
    "walk_s": (1, 0, 6, 10, True),
    "walk_e": (2, 0, 6, 10, True),
    "walk_n": (3, 0, 6, 10, True),
    "walk_w": (4, 0, 6, 10, True),
    "attack": (5, 0, 6, 14, False),
    "special": (6, 0, 6, 12, False),
    "hurt": (7, 0, 3, 14, False),
    "defeat": (7, 3, 3, 6, False),
}
PROPS = [
    "travel_chest", "luggage", "sandstone_barricade", "supply_crate",
    "route_beacon", "expedition_tent", "harbor_bollard", "barrel",
    "solar_charger", "portal_arch", "coliving_bench", "weather_antenna",
    "relay_battery", "boulder", "shrub", "slate_debris",
]
UI = [
    "panel", "button_normal", "button_active", "button_disabled",
    "attack", "dash", "special", "shield",
    "health_frame", "stamina_frame", "health_fill", "stamina_fill",
    "route_coin", "medkit", "battery", "joystick",
]
FX_ROWS = ["slash", "splash", "dash", "impact"]
# World scale per prop, relative to a ~110px-tall traveler.
PROP_SCALE = {
    "expedition_tent": 0.56, "sandstone_barricade": 0.48, "portal_arch": 0.6, "boulder": 0.44,
    "coliving_bench": 0.42, "weather_antenna": 0.44, "solar_charger": 0.4, "slate_debris": 0.4,
    "route_beacon": 0.44, "shrub": 0.36, "travel_chest": 0.32, "luggage": 0.32, "supply_crate": 0.32,
    "barrel": 0.3, "harbor_bollard": 0.32, "relay_battery": 0.3,
}
ARENAS = {
    "desert": "arenas/01_desert_relay.png",
    "tidal": "arenas/02_tidal_port.png",
    "highland": "arenas/03_highland_station.png",
}

# Runtime scale relative to source pixels. Travelers end up ~110 world px tall
# on a 1254 px arena, the Gatewarden ~150 px, per the pack's guidance.
CHAR_SCALE = {"sable": 0.8, "rook": 0.8, "iona": 0.8, "warden": 1.0}


def load(rel: str) -> np.ndarray:
    return np.array(Image.open(SRC / rel).convert("RGBA"))


def remap_alpha(img: np.ndarray, lo: float, hi: float) -> np.ndarray:
    out = img.copy()
    a = img[:, :, 3].astype(np.float32)
    out[:, :, 3] = np.clip((a - lo) / (hi - lo), 0.0, 1.0) * 255.0
    return out


def own_by_cell(img: np.ndarray, cols: int, rows: int, core: int = 40, erode: int = 0):
    """Split a sheet into per-cell RGBA layers using component ownership.

    Returns one full-size RGBA array per cell (row-major) holding only the
    pixels whose component belongs to that cell.
    """
    h, w = img.shape[:2]
    cw, ch = w / cols, h / rows
    alpha = img[:, :, 3]
    # Erode before labelling so semi-transparent trails and dust bridges do
    # not weld two neighbouring poses into one island.
    solid = ndimage.binary_erosion(alpha > core, iterations=erode) if erode else alpha > core
    labels, n = ndimage.label(solid, structure=np.ones((3, 3)))
    # Soft edge pixels adopt the label of the nearest solid pixel.
    _, (iy, ix) = ndimage.distance_transform_edt(labels == 0, return_indices=True)
    full = labels[iy, ix]
    full[alpha == 0] = 0

    ys, xs = np.nonzero(labels)
    cell_of = (np.minimum((ys / ch).astype(int), rows - 1) * cols
               + np.minimum((xs / cw).astype(int), cols - 1))
    counts = np.zeros((n + 1, cols * rows), dtype=np.int64)
    np.add.at(counts, (labels[ys, xs], cell_of), 1)
    owner = counts.argmax(axis=1)
    owner[0] = -1

    owner_map = owner[full]
    # A component that genuinely bridges two sprites (e.g. a swing trail that
    # touches the next pose) is not owned by anyone: split it on the grid.
    total = counts.sum(axis=1)
    shared = counts.max(axis=1) < 0.72 * np.maximum(total, 1)
    shared[0] = False
    if shared.any():
        gy, gx = np.mgrid[0:h, 0:w]
        grid_cell = (np.minimum((gy / ch).astype(int), rows - 1) * cols
                     + np.minimum((gx / cw).astype(int), cols - 1))
        split = shared[full]
        owner_map[split] = grid_cell[split]
        print(f"  split {int(shared.sum())} bridging component(s) on the grid")
    owner_map[full == 0] = -1
    layers = []
    for cell in range(cols * rows):
        layer = img.copy()
        layer[:, :, 3] = np.where(owner_map == cell, alpha, 0)
        layers.append(layer)
    return layers, labels, owner


def own_by_seeds(img: np.ndarray, cols: int, rows: int, core: int = 160, erode: int = 4):
    """Character sheets: poses drift up to a third of a cell off the nominal
    grid, so a fixed grid slices bodies in half. Instead, find the 48 body
    islands, order them into rows/columns, and give every other pixel (trails,
    dropped weapons, soft edges) to the nearest body.
    """
    alpha = img[:, :, 3]
    solid = ndimage.binary_erosion(alpha > core, iterations=erode)
    labels, n = ndimage.label(solid, structure=np.ones((3, 3)))
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    seeds = np.argsort(sizes)[::-1][: cols * rows]
    if sizes[seeds[-1]] < 1000:
        raise SystemExit("could not find a body island for every pose")
    cents = ndimage.center_of_mass(solid, labels, seeds)
    order = sorted(range(len(seeds)), key=lambda i: cents[i][0])
    slot_of_seed = {}
    for r in range(rows):
        band = sorted(order[r * cols:(r + 1) * cols], key=lambda i: cents[i][1])
        for c, i in enumerate(band):
            slot_of_seed[int(seeds[i])] = r * cols + c

    seed_map = np.zeros_like(labels)
    for lab, slot in slot_of_seed.items():
        seed_map[labels == lab] = slot + 1
    _, (iy, ix) = ndimage.distance_transform_edt(seed_map == 0, return_indices=True)
    owner_map = seed_map[iy, ix] - 1
    owner_map[alpha == 0] = -1
    layers = []
    for cell in range(cols * rows):
        layer = img.copy()
        layer[:, :, 3] = np.where(owner_map == cell, alpha, 0)
        layers.append(layer)
    return layers, seed_map


def bbox(alpha: np.ndarray, thresh: int = 8):
    ys, xs = np.nonzero(alpha > thresh)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def foot_pivot(alpha: np.ndarray, body_mask: np.ndarray) -> tuple[float, float]:
    """Centroid of the lowest solid rows of the body: a stable foot anchor."""
    solid = (alpha > 200) & body_mask
    ys, xs = np.nonzero(solid)
    if len(ys) == 0:
        ys, xs = np.nonzero(alpha > 8)
    foot_y = float(np.percentile(ys, 98.5))
    top = float(ys.min())
    band = ys >= foot_y - (foot_y - top) * 0.18
    return float(xs[band].mean()), foot_y


def rift_tint(rgba: np.ndarray) -> np.ndarray:
    """Recolour toward a cold violet/crimson rift palette, keeping value."""
    rgb = rgba[:, :, :3].astype(np.float32) / 255.0
    lum = (rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32))[..., None]
    shadow = np.array([0.16, 0.07, 0.22], dtype=np.float32)
    light = np.array([0.98, 0.55, 0.78], dtype=np.float32)
    ramp = shadow + (light - shadow) * np.clip(lum * 1.08, 0, 1)
    mixed = rgb * 0.38 + ramp * 0.62
    out = rgba.copy()
    out[:, :, :3] = np.clip(mixed * 255.0, 0, 255).astype(np.uint8)
    return out


def save_webp(img: Image.Image, path: Path, quality: int = 86) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "WEBP", quality=quality, method=6, alpha_quality=92)


def process_character(key: str, rel: str) -> dict:
    sheet = remap_alpha(load(rel), 6, 236)
    layers, seed_map = own_by_seeds(sheet, 6, 8)
    scale = CHAR_SCALE[key]
    frames = []
    for cell, layer in enumerate(layers):
        a = layer[:, :, 3]
        box = bbox(a)
        body = seed_map == cell + 1
        if cell < 30 or cell in (42, 43, 44):
            # Locomotion/hurt poses carry no effects: drop debris specks that
            # the nearest-body rule pulled in from neighbouring action poses.
            near = ndimage.binary_dilation(body, iterations=10)
            islands, count = ndimage.label(a > 0, structure=np.ones((3, 3)))
            keep = np.zeros(count + 1, dtype=bool)
            keep[np.unique(islands[near & (islands > 0)])] = True
            keep[0] = False
            a = np.where(keep[islands], a, 0).astype(np.uint8)
            layer[:, :, 3] = a
            box = bbox(a)
        px, py = foot_pivot(a, ndimage.binary_dilation(body, iterations=2))
        if cell < 30:
            # Nothing in a walk/idle pose belongs well below the feet.
            layer[int(py) + 18:, :, 3] = 0
            box = bbox(layer[:, :, 3])
        frames.append({"cell": cell, "box": box, "pivot": (px, py), "layer": layer})

    # Defeat poses lie on the ground: anchor them on the body centre instead.
    for f in frames[45:48]:
        x0, y0, x1, y1 = f["box"]
        f["pivot"] = ((x0 + x1) / 2, f["pivot"][1])

    left = max(f["pivot"][0] - f["box"][0] for f in frames)
    right = max(f["box"][2] - f["pivot"][0] for f in frames)
    up = max(f["pivot"][1] - f["box"][1] for f in frames)
    down = max(f["box"][3] - f["pivot"][1] for f in frames)
    half = math.ceil(max(left, right) * scale) + 2
    fw = half * 2
    top = math.ceil(up * scale) + 2
    fh = top + math.ceil(down * scale) + 2

    normal = Image.new("RGBA", (fw * 6, fh * 8), (0, 0, 0, 0))
    rift = Image.new("RGBA", (fw * 6, fh * 8), (0, 0, 0, 0))
    heights = []
    for f in frames:
        x0, y0, x1, y1 = f["box"]
        crop = Image.fromarray(f["layer"][y0:y1, x0:x1])
        crop = crop.resize((max(1, round((x1 - x0) * scale)), max(1, round((y1 - y0) * scale))),
                           Image.LANCZOS)
        ox = round(half - (f["pivot"][0] - x0) * scale)
        oy = round(top - (f["pivot"][1] - y0) * scale)
        col, row = f["cell"] % 6, f["cell"] // 6
        normal.alpha_composite(crop, (col * fw + ox, row * fh + oy))
        rift.alpha_composite(Image.fromarray(rift_tint(np.array(crop))), (col * fw + ox, row * fh + oy))
        if row == 0:
            heights.append((f["pivot"][1] - y0) * scale)

    save_webp(normal, OUT / "sprites" / f"{key}.webp")
    if key != "warden":
        save_webp(rift, OUT / "sprites" / f"{key}_rift.webp")
    return {
        "image": f"assets/sprites/{key}.webp",
        "rift": f"assets/sprites/{key}_rift.webp" if key != "warden" else None,
        "frameW": fw, "frameH": fh, "pivotX": half, "pivotY": top,
        "standHeight": round(float(np.median(heights)), 1),
        "anims": {k: {"row": r, "start": s, "count": c, "fps": fps, "loop": lp}
                  for k, (r, s, c, fps, lp) in ANIMS.items()},
    }


def pack(images: dict[str, Image.Image], width: int, pad: int = 2):
    """Shelf-pack named images; returns atlas and rect map."""
    order = sorted(images, key=lambda k: -images[k].height)
    x = y = shelf = 0
    rects = {}
    for k in order:
        im = images[k]
        if x + im.width + pad > width:
            x, y, shelf = 0, y + shelf + pad, 0
        rects[k] = (x, y, im.width, im.height)
        x += im.width + pad
        shelf = max(shelf, im.height)
    atlas = Image.new("RGBA", (width, y + shelf), (0, 0, 0, 0))
    for k, (rx, ry, _, _) in rects.items():
        atlas.alpha_composite(images[k], (rx, ry))
    return atlas, rects


def process_props() -> dict:
    sheet = remap_alpha(load("props/world_props_4x4.png"), 6, 230)
    layers, _, _ = own_by_cell(sheet, 4, 4)
    crops, meta = {}, {}
    for name, layer in zip(PROPS, layers):
        x0, y0, x1, y1 = bbox(layer[:, :, 3])
        crop = Image.fromarray(layer[y0:y1, x0:x1])
        scale = PROP_SCALE.get(name, 0.36)
        crop = crop.resize((round(crop.width * scale), round(crop.height * scale)), Image.LANCZOS)
        a = np.array(crop)[:, :, 3]
        ys, xs = np.nonzero(a > 160)
        foot_y = float(np.percentile(ys, 97))
        crops[name] = crop
        meta[name] = {"w": crop.width, "h": crop.height,
                      "pivotX": round(crop.width / 2), "pivotY": round(foot_y),
                      "radius": round(crop.width * 0.34)}
    atlas, rects = pack(crops, 1024)
    save_webp(atlas, OUT / "sprites" / "props.webp")
    for name, (x, y, w, h) in rects.items():
        meta[name].update({"x": x, "y": y, "src": f"assets/props/{name}.webp"})
        # Individual copies feed the DOM field journal.
        save_webp(crops[name], OUT / "props" / f"{name}.webp", quality=82)
    return {"image": "assets/sprites/props.webp", "frames": meta}


def process_fx() -> dict:
    # The FX sheet keeps a diffuse coloured haze; a steeper remap clears it.
    sheet = remap_alpha(load("effects/combat_fx_6x4.png"), 46, 210)
    layers, _, _ = own_by_cell(sheet, 6, 4, core=60)
    cw, ch = 256, 256
    rows = {}
    out_frames = {}
    for r, name in enumerate(FX_ROWS):
        boxes = [bbox(layers[r * 6 + c][:, :, 3]) for c in range(6)]
        # Union box in cell-local coordinates keeps the row registered.
        lx0 = min(b[0] - c * cw for c, b in enumerate(boxes))
        ly0 = min(b[1] - r * ch for b in boxes)
        lx1 = max(b[2] - c * cw for c, b in enumerate(boxes))
        ly1 = max(b[3] - r * ch for b in boxes)
        fw, fh = lx1 - lx0, ly1 - ly0
        for c in range(6):
            layer = layers[r * 6 + c]
            x0, y0 = c * cw + lx0, r * ch + ly0
            out_frames[f"{name}_{c}"] = Image.fromarray(layer[y0:y0 + fh, x0:x0 + fw])
        rows[name] = {"w": fw, "h": fh, "count": 6}
    atlas, rects = pack(out_frames, 1024)
    save_webp(atlas, OUT / "sprites" / "fx.webp", quality=88)
    return {"image": "assets/sprites/fx.webp", "rows": rows,
            "frames": {k: {"x": x, "y": y, "w": w, "h": h} for k, (x, y, w, h) in rects.items()}}


def process_ui() -> dict:
    sheet = remap_alpha(load("ui/interface_4x4.png"), 6, 230)
    layers, _, _ = own_by_cell(sheet, 4, 4)
    meta = {}
    for name, layer in zip(UI, layers):
        x0, y0, x1, y1 = bbox(layer[:, :, 3])
        crop = Image.fromarray(layer[y0:y1, x0:x1])
        if crop.width > 220:
            crop = crop.resize((220, round(crop.height * 220 / crop.width)), Image.LANCZOS)
        save_webp(crop, OUT / "ui" / f"{name}.webp", quality=90)
        meta[name] = {"src": f"assets/ui/{name}.webp", "w": crop.width, "h": crop.height}
    return meta


def process_backgrounds() -> dict:
    meta = {}
    for key, rel in ARENAS.items():
        im = Image.open(SRC / rel).convert("RGB")
        save_webp(im, OUT / "arenas" / f"{key}.webp", quality=84)
        thumb = im.resize((420, 420), Image.LANCZOS)
        save_webp(thumb, OUT / "arenas" / f"{key}_thumb.webp", quality=80)
        meta[key] = {"src": f"assets/arenas/{key}.webp", "thumb": f"assets/arenas/{key}_thumb.webp",
                     "size": im.width}
    title = Image.open(SRC / "branding/title_screen.png").convert("RGB")
    save_webp(title, OUT / "title.webp", quality=84)
    save_webp(title.resize((960, round(960 * title.height / title.width)), Image.LANCZOS),
              OUT / "title_960.webp", quality=80)
    meta["title"] = {"src": "assets/title.webp", "small": "assets/title_960.webp",
                     "w": title.width, "h": title.height}
    return meta


def make_icons() -> None:
    """App icons + social share card, derived from pack art."""
    coin = Image.open(OUT / "ui" / "route_coin.webp").convert("RGBA")
    for size in (192, 512):
        icon = Image.new("RGBA", (size, size), (11, 21, 32, 255))
        glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(glow).ellipse((size * .12, size * .12, size * .88, size * .88), fill=(146, 64, 14, 150))
        icon.alpha_composite(glow.filter(ImageFilter.GaussianBlur(size * .08)))
        c = coin.resize((round(size * .7), round(size * .7)), Image.LANCZOS)
        icon.alpha_composite(c, ((size - c.width) // 2, (size - c.height) // 2))
        icon.convert("RGB").save(ROOT / "public" / f"icon-{size}.png", optimize=True)
    fav = Image.open(ROOT / "public" / "icon-192.png").resize((64, 64), Image.LANCZOS)
    fav.save(ROOT / "public" / "favicon.png", optimize=True)

    title = Image.open(SRC / "branding/title_screen.png").convert("RGB")
    w, h = 1200, 630
    s = max(w / title.width, h / title.height)
    t = title.resize((round(title.width * s), round(title.height * s)), Image.LANCZOS)
    left, top = (t.width - w) // 2, (t.height - h) // 2
    t.crop((left, top, left + w, top + h)).save(ROOT / "public" / "og-image.jpg", quality=86, optimize=True)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    catalog = {
        "version": 2,
        "characters": {k: process_character(k, rel) for k, rel in CHARACTERS.items()},
        "props": process_props(),
        "fx": process_fx(),
        "ui": process_ui(),
        "backgrounds": process_backgrounds(),
    }
    make_icons()
    (OUT / "catalog.json").write_text(json.dumps(catalog, indent=1))
    c = catalog["characters"]
    for k, v in c.items():
        print(f"{k:7s} frame {v['frameW']}x{v['frameH']} pivot ({v['pivotX']},{v['pivotY']}) stand {v['standHeight']}")
    print("fx rows", catalog["fx"]["rows"])


if __name__ == "__main__":
    main()
