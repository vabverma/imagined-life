#!/usr/bin/env python3
"""Assemble index.html from template.html + life-data.json, inlining day images as data URIs.

Usage: python3 build.py
Images referenced in life-data.json use the sentinel "IMAGE_DAY_<n>"; this script
replaces each with a base64 data URI read from day<n>.jpg in this folder.
"""
import base64, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))

def data_uri(path):
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    return "data:image/jpeg;base64," + b64

def sentinel_to_file(sentinel):
    """Map an image sentinel string to its source file, or None if not a sentinel.
    IMAGE_DAY_<n> -> day<n>.jpg ; IMAGE_GENESIS_<n> -> genesis<n>.jpg
    """
    m = re.match(r"^IMAGE_DAY_(\d+)$", sentinel)
    if m:
        return "day{}.jpg".format(m.group(1))
    m = re.match(r"^IMAGE_GENESIS_(\d+)$", sentinel)
    if m:
        return "genesis{}.jpg".format(m.group(1))
    return None

def inline_images(node):
    """Recursively replace any 'image' sentinel string with its base64 data URI."""
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "image" and isinstance(v, str):
                fname = sentinel_to_file(v)
                if fname:
                    path = os.path.join(HERE, fname)
                    if not os.path.exists(path):
                        sys.exit("Missing image file: " + path)
                    node[k] = data_uri(path)
            else:
                inline_images(v)
    elif isinstance(node, list):
        for item in node:
            inline_images(item)

def main():
    with open(os.path.join(HERE, "life-data.json"), encoding="utf-8") as f:
        data = json.load(f)

    inline_images(data)

    with open(os.path.join(HERE, "template.html"), encoding="utf-8") as f:
        template = f.read()

    payload = json.dumps(data, ensure_ascii=False)
    # Guard against </script> breaking out of the JSON script tag.
    payload = payload.replace("</", "<\\/")
    html = template.replace("__LIFE_DATA__", payload)

    out = os.path.join(HERE, "index.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print("Wrote {} ({:,} bytes, {} entr{})".format(
        out, len(html), len(data["entries"]),
        "y" if len(data["entries"]) == 1 else "ies"))

if __name__ == "__main__":
    main()
