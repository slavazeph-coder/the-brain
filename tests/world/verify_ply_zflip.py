#!/usr/bin/env python3
"""Verify PLY z-flip: parse header, read vertices, apply z->-z, emit JSON receipt."""
import json, struct, sys

def read_ply(path):
    with open(path, "rb") as f:
        data = f.read()
    end_h = data.find(b"end_header\n")
    if end_h < 0:
        raise ValueError("no end_header")
    header = data[:end_h].decode("ascii")
    lines = [l.strip() for l in header.splitlines() if l.strip()]
    fmt = None
    for l in lines:
        if l.startswith("format"):
            fmt = l.split()[1]
    vcount = None
    props = []
    in_elem = False
    for l in lines:
        if l.startswith("element vertex"):
            vcount = int(l.split()[2])
            in_elem = True
            continue
        if in_elem:
            if l.startswith("property"):
                parts = l.split()
                # parts = ['property', type, name]
                props.append((parts[1], parts[2]))
            else:
                in_elem = False
    return fmt, vcount, props, data[end_h + len(b"end_header\n"):]

def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "dense-preview.ply"
    fmt, vcount, props, body = read_ply(path)
    prop_names = [p[1] for p in props]
    prop_types = [p[0] for p in props]
    print(f"format={fmt} vcount={vcount} props={prop_names}", file=sys.stderr)

    coords = []
    if fmt == "ascii":
        lines = body.decode("ascii", errors="ignore").splitlines()
        for i, line in enumerate(lines[:vcount]):
            parts = line.split()
            if len(parts) < len(props):
                break
            coords.append([float(parts[j]) for j in range(len(props))])
    elif fmt in ("binary_little_endian", "binary_big_endian"):
        endian = "<" if "little" in fmt else ">"
        type_map = {"float": "f", "double": "d", "int": "i", "uint": "I",
                    "short": "h", "ushort": "H", "char": "b", "uchar": "B"}
        fmt_str = endian + "".join(type_map[t] for t in prop_types)
        sz = struct.calcsize(fmt_str)
        for i in range(vcount):
            vals = struct.unpack_from(fmt_str, body, i * sz)
            coords.append(list(vals))

    x_idx = prop_names.index("x")
    y_idx = prop_names.index("y")
    z_idx = prop_names.index("z")
    xs = [c[x_idx] for c in coords]
    ys = [c[y_idx] for c in coords]
    zs = [c[z_idx] for c in coords]
    zs_flipped = [-z for z in zs]

    def extent(vals):
        mn, mx = min(vals), max(vals)
        return mn, mx, mx - mn

    receipt = {
        "source": path,
        "format": fmt,
        "vcount": len(coords),
        "original": {"x": extent(xs), "y": extent(ys), "z": extent(zs)},
        "after_zflip": {"x": extent(xs), "y": extent(ys), "z": extent(zs_flipped)},
        "y_extent": extent(ys)[2],
        "z_extent": extent(zs)[2],
        "y_up_likely": extent(ys)[2] > extent(zs)[2],
        "z_up_likely": extent(ys)[2] < extent(zs)[2],
    }
    print(json.dumps(receipt, indent=2))
    with open("verify_ply_zflip_receipt.json", "w") as f:
        json.dump(receipt, f, indent=2)
    print(f"\nReceipt: verify_ply_zflip_receipt.json", file=sys.stderr)

if __name__ == "__main__":
    main()
