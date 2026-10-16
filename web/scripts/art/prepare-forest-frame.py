#!/usr/bin/env python3
"""Re-export the reviewed transparent wood frame; never generates new artwork."""

import hashlib
import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[3]
SPEC_PATH = ROOT / "docs/design/forest-adventure-rich-art/frame-export.json"
spec = json.loads(SPEC_PATH.read_text())
source = ROOT / spec["source"]
if hashlib.sha256(source.read_bytes()).hexdigest() != spec["sourceSha256"]:
    raise ValueError("Frame source changed; review its transparent center and slice boundaries")
frame = Image.open(source)
if frame.mode != "RGBA":
    raise ValueError("Frame requires genuine alpha transparency")
frame.putalpha(frame.getchannel("A").point(lambda value: 0 if value < spec["alphaNoiseThreshold"] else value))
frame = frame.resize(tuple(spec["size"]), Image.Resampling.LANCZOS)
width, height = frame.size
if frame.getchannel("A").crop((width // 4, height // 4, width * 3 // 4, height * 3 // 4)).getextrema() != (0, 0):
    raise ValueError("Frame center contains a matte or unexpected artwork")
target = ROOT / spec["file"]
frame.save(target, "WEBP", quality=spec["quality"], method=6, exact=True)
if target.stat().st_size != spec["bytes"]:
    raise ValueError("Frame export changed; review and update the export record")
print(json.dumps({"file": spec["file"], "bytes": target.stat().st_size, "transparentCenter": True}))
