#!/usr/bin/env python3
"""Slice the reviewed static art sheet; never submits an image-generation job."""

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


ROOT = Path(__file__).resolve().parents[3]
PLAN_PATH = ROOT / "docs/design/forest-adventure-art/manifest.json"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Print the asset plan without writing files")
    args = parser.parse_args()
    plan = json.loads(PLAN_PATH.read_text())
    rows, columns = plan["grid"]["rows"], plan["grid"]["columns"]
    if len(plan["assets"]) != rows * columns:
        raise ValueError("Each cell must have exactly one named asset")
    if args.dry_run:
        print(json.dumps({
            "mode": "dry-run; no generation and no files written",
            "generation": plan["generation"],
            "grid": plan["grid"],
            "normalization": plan.get("normalization"),
            "assets": [dict(asset, row=index // columns + 1, column=index % columns + 1)
                       for index, asset in enumerate(plan["assets"])],
        }, indent=2))
        return

    source_path = ROOT / plan["source"]
    if hashlib.sha256(source_path.read_bytes()).hexdigest() != plan["sourceSha256"]:
        raise ValueError("Source changed; review and update its hash and cut boundaries before slicing")
    source = Image.open(source_path)
    if source.mode != "RGBA" or source.getchannel("A").getextrema() != (0, 255):
        raise ValueError("Source must contain genuine alpha transparency, not a painted background")
    source.load()
    raw_size = list(source.size)
    calibration = []
    normalization = plan.get("normalization")
    if normalization:
        if raw_size != normalization["sourceSize"]:
            raise ValueError("Source changed; review its cut boundaries before slicing")
        # Native generation can leave almost invisible alpha speckles in otherwise empty gutters.
        threshold = normalization["alphaNoiseThreshold"]
        source.putalpha(source.getchannel("A").point(lambda value: 0 if value < threshold else value))
        size = normalization["cellSize"]
        master = Image.new("RGBA", (columns * size, rows * size))
        xs, ys = normalization["columnBoundaries"], normalization["rowBoundaries"]
        for index, asset in enumerate(plan["assets"]):
            row, column = divmod(index, columns)
            box = (xs[column], ys[row], xs[column + 1], ys[row + 1])
            cell = source.crop(box)
            bounds = cell.getchannel("A").getbbox()
            if not bounds:
                raise ValueError(f"Empty source cell: {asset['name']}")
            margins = [bounds[0], bounds[1], cell.width - bounds[2], cell.height - bounds[3]]
            if min(margins) < 3:
                raise ValueError(f"Source silhouette crosses a calibrated gutter: {asset['name']}")
            limit = round(size * normalization["contentFraction"])
            icon = ImageOps.contain(cell.crop(bounds), (limit, limit), Image.Resampling.LANCZOS)
            master.paste(icon, (column * size + (size - icon.width) // 2, row * size + (size - icon.height) // 2))
            calibration.append({"rawCell": list(box), "rawContentBounds": list(bounds), "rawMargins": margins})
        master.save(PLAN_PATH.parent / "normalized-sheet.png")
        source = master
    output = ROOT / plan["outputDirectory"]
    cutouts = PLAN_PATH.parent / "cutouts"
    output.mkdir(parents=True, exist_ok=True)
    cutouts.mkdir(exist_ok=True)
    report = {"rawSourceSize": raw_size, "normalizedSize": list(source.size), "grid": plan["grid"], "assets": []}
    previews = []

    for index, asset in enumerate(plan["assets"]):
        row, column = divmod(index, columns)
        cell_box = (round(column * source.width / columns), round(row * source.height / rows),
                    round((column + 1) * source.width / columns), round((row + 1) * source.height / rows))
        cell = source.crop(cell_box)
        alpha = cell.getchannel("A")
        bbox = alpha.getbbox()
        if bbox is None:
            raise ValueError(f"Empty cell: {asset['name']}")
        margins = [bbox[0], bbox[1], cell.width - bbox[2], cell.height - bbox[3]]
        if min(margins) < 3:
            raise ValueError(f"Art touches a cell boundary: {asset['name']} {margins}")
        cropped = cell.crop(bbox)
        cropped.save(cutouts / f"{asset['name']}.png")
        size = asset["size"]
        # Preserve every alpha pixel; resize the entire silhouette, then add a transparent gutter.
        contained = ImageOps.contain(cropped, (round(size * .88), round(size * .88)), Image.Resampling.LANCZOS)
        runtime = Image.new("RGBA", (size, size))
        runtime.paste(contained, ((size - contained.width) // 2, (size - contained.height) // 2))
        target = output / f"{asset['name']}.webp"
        runtime.save(target, "WEBP", quality=90, method=6, exact=True)
        decoded = Image.open(target).convert("RGBA")
        if decoded.getchannel("A").getextrema() != (0, 255):
            raise ValueError(f"Output lost alpha: {target}")
        corners = [(0, 0), (size - 1, 0), (0, size - 1), (size - 1, size - 1)]
        if any(decoded.getpixel(point)[3] != 0 for point in corners):
            raise ValueError(f"Opaque output corner: {target}")
        report["assets"].append({
            **asset, "cell": list(cell_box), "contentBounds": list(bbox), "sourceMargins": margins,
            **(calibration[index] if calibration else {}),
            "file": str(target.relative_to(ROOT)), "bytes": target.stat().st_size,
            "transparentFraction": round(decoded.getchannel("A").histogram()[0] / (size * size), 4),
            "cornersTransparent": True,
        })
        previews.append((asset["name"], decoded))

    # Review each cutout on both paper and dark green; small samples show actual UI legibility.
    width, height = 960, 900
    contact = Image.new("RGB", (width, height), "#f7f3e8")
    draw = ImageDraw.Draw(contact)
    for index, (name, icon) in enumerate(previews):
        row, column = divmod(index, columns)
        x, y = column * 320, row * 300
        draw.rectangle((x + 160, y, x + 319, y + 299), fill="#15221c")
        large = ImageOps.contain(icon, (136, 192), Image.Resampling.LANCZOS)
        for left in [x + 12, x + 172]:
            contact.paste(large, (left + (136 - large.width) // 2, y + 24 + (192 - large.height) // 2), large)
            small = icon.resize((32, 32), Image.Resampling.LANCZOS)
            contact.paste(small, (left + 52, y + 225), small)
        draw.text((x + 10, y + 274), name, fill="#2b3e30")
        draw.text((x + 170, y + 274), name, fill="#eeeada")
    contact.save(PLAN_PATH.parent / "cutout-review.png")
    report["runtimeBytes"] = sum(asset["bytes"] for asset in report["assets"])
    (PLAN_PATH.parent / "slice-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"assets": len(previews), "runtimeBytes": report["runtimeBytes"],
                      "report": str((PLAN_PATH.parent / "slice-report.json").relative_to(ROOT))}, indent=2))


if __name__ == "__main__":
    main()
