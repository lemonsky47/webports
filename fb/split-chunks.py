#!/usr/bin/env python3
"""
Split renpy.wasm and game.zip into 19.9 MB chunks for hosting on platforms
with file size limits (e.g. GitHub's 100MB limit, or 20MB for some CDNs).
"""
import os
import sys

CHUNK_SIZE = int(19.9 * 1024 * 1024)  # 19.9 MB in bytes
FILES = ["renpy.wasm", "game.zip"]


def split_file(path: str) -> list[str]:
    """Split a file into chunks. Returns list of chunk filenames."""
    if not os.path.exists(path):
        print(f"Warning: {path} not found, skipping")
        return []

    size = os.path.getsize(path)
    if size <= CHUNK_SIZE:
        print(f"{path}: {size:,} bytes (under {CHUNK_SIZE:,}), no split needed")
        return []

    chunks = []
    base = os.path.splitext(path)[0]
    with open(path, "rb") as f:
        idx = 0
        while True:
            data = f.read(CHUNK_SIZE)
            if not data:
                break
            chunk_path = f"{base}.chunk{idx}"
            with open(chunk_path, "wb") as cf:
                cf.write(data)
            chunks.append(chunk_path)
            print(f"  {chunk_path}: {len(data):,} bytes")
            idx += 1

    print(f"{path}: split into {len(chunks)} chunks")
    return chunks


def main():
    import json
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)

    all_chunks = []
    manifest = {}
    for name in FILES:
        if os.path.exists(name):
            chunks = split_file(name)
            all_chunks.extend(chunks)
            if chunks:
                base = os.path.splitext(name)[0]
                manifest[base] = len(chunks)
        else:
            print(f"Warning: {name} not found")

    if manifest:
        with open("chunks.json", "w") as mf:
            json.dump(manifest, mf)
        print(f"\nCreated chunks.json: {manifest}")

        # Update pwa_catalog.json to use chunks instead of originals
        catalog_path = "pwa_catalog.json"
        if os.path.exists(catalog_path):
            with open(catalog_path) as f:
                catalog = json.load(f)
            files = catalog.get("files", [])
            # Replace renpy.wasm with renpy.chunk*
            files = [f for f in files if f != "renpy.wasm" and f != "game.zip"]
            for base, count in manifest.items():
                for i in range(count):
                    files.append(f"{base}.chunk{i}")
            files.extend(["chunks.json", "renpy-bootstrap.js"])
            catalog["files"] = sorted(set(files))
            with open(catalog_path, "w") as f:
                json.dump(catalog, f, indent=2)
            print(f"Updated {catalog_path}")
        print("You can remove the original files after verifying chunks work:")
        for f in FILES:
            if os.path.exists(f):
                print(f"  rm {f}")


if __name__ == "__main__":
    main()
