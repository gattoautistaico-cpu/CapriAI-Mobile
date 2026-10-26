#!/usr/bin/env python3
"""Assemble an Android APK without the Android SDK: binary manifest, resources.arsc, dex, assets."""
import struct, sys, os, zipfile

ANDROID_NS = "http://schemas.android.com/apk/res/android"
ATTR_IDS = {
    "theme": 0x01010000, "label": 0x01010001, "icon": 0x01010002, "name": 0x01010003,
    "exported": 0x01010010, "launchMode": 0x0101001d, "configChanges": 0x0101001f,
    "minSdkVersion": 0x0101020c, "versionCode": 0x0101021b, "versionName": 0x0101021c,
    "windowSoftInputMode": 0x0101022b, "targetSdkVersion": 0x01010270, "allowBackup": 0x01010280,
    "hardwareAccelerated": 0x010102d3, "usesCleartextTraffic": 0x010104ec, "roundIcon": 0x0101052c,
    "permission": 0x01010006, "resource": 0x01010025, "description": 0x01010020,
    "accessibilityEventTypes": 0x01010380, "accessibilityFeedbackType": 0x01010382, "notificationTimeout": 0x01010383,
    "accessibilityFlags": 0x01010384, "canRetrieveWindowContent": 0x01010385, "canTakeScreenshot": 0x0101060f,
}
T_REF, T_STR, T_DEC, T_HEX, T_BOOL = 0x01, 0x03, 0x10, 0x11, 0x12


def pad4(b):
    return b + b"\0" * ((4 - len(b) % 4) % 4)


def string_pool(strings):
    offs, data = [], b""
    for s in strings:
        offs.append(len(data))
        u = s.encode("utf-16-le")
        n = len(u) // 2
        assert n < 0x8000
        data += struct.pack("<H", n) + u + b"\0\0"
    data = pad4(data)
    hdr = 28
    strings_start = hdr + 4 * len(strings)
    body = b"".join(struct.pack("<I", o) for o in offs) + data
    size = hdr + len(body)
    return struct.pack("<HHIIIIII", 0x0001, hdr, size, len(strings), 0, 0, strings_start, 0) + body


class Axml:
    def __init__(self):
        self.res_strings = []
        self.strings = []

    def idx(self, s):
        if s in self.res_strings:
            return self.res_strings.index(s)
        if s not in self.strings:
            self.strings.append(s)
        return len(self.res_strings) + self.strings.index(s)

    def build(self, root):
        def collect(el):
            for (ns, name, _t, _v) in el[1]:
                if ns and name not in self.res_strings:
                    self.res_strings.append(name)
            for c in el[2]:
                collect(c)
        collect(root)
        self.res_strings.sort(key=lambda n: ATTR_IDS[n])
        chunks = []
        NONE = 0xFFFFFFFF
        ns_prefix, ns_uri = self.idx("android"), self.idx(ANDROID_NS)
        chunks.append(struct.pack("<HHIIIII", 0x0100, 16, 24, 1, NONE, ns_prefix, ns_uri))

        def emit(el, line=[2]):
            tag, attrs, children = el
            enc = []
            for (ns, name, typ, val) in attrs:
                ns_i = self.idx(ANDROID_NS) if ns else NONE
                name_i = self.idx(name)
                if typ == T_STR:
                    si = self.idx(val)
                    raw, data = si, si
                else:
                    raw, data = NONE, val & 0xFFFFFFFF
                rid = ATTR_IDS.get(name, 0) if ns else 0
                enc.append((rid, name_i, struct.pack("<IIIHBBI", ns_i, name_i, raw, 8, 0, typ, data)))
            enc.sort(key=lambda e: (e[0], e[1]))
            body = struct.pack("<IIHHHHHH", NONE, self.idx(tag), 20, 20, len(enc), 0, 0, 0) + b"".join(e[2] for e in enc)
            chunks.append(struct.pack("<HHIII", 0x0102, 16, 16 + len(body), line[0], NONE) + body)
            line[0] += 1
            for c in children:
                emit(c)
            chunks.append(struct.pack("<HHIIIII", 0x0103, 16, 24, line[0], NONE, NONE, self.idx(tag)))
            line[0] += 1
        emit(root)
        chunks.append(struct.pack("<HHIIIII", 0x0101, 16, 24, 999, NONE, ns_prefix, ns_uri))
        pool = string_pool(self.res_strings + self.strings)
        rmap = struct.pack("<HHI", 0x0180, 8, 8 + 4 * len(self.res_strings)) + \
            b"".join(struct.pack("<I", ATTR_IDS[n]) for n in self.res_strings)
        body = pool + rmap + b"".join(chunks)
        return struct.pack("<HHI", 0x0003, 8, 8 + len(body)) + body


def A(name, typ, val):
    return (True, name, typ, val)


def arsc_multi(pkg_name, entries):
    """entries: [(type_name, key_name, file_path)], un tipo per voce, id 0x7f(tt)0000."""
    gpool = string_pool([e[2] for e in entries])
    tpool = string_pool([e[0] for e in entries])
    kpool = string_pool([e[1] for e in entries])
    chunks = b""
    for i, (tn, kn, fp) in enumerate(entries):
        tid = i + 1
        spec = struct.pack("<HHIBBHI", 0x0202, 16, 16 + 4, tid, 0, 0, 1) + struct.pack("<I", 0)
        config = bytearray(64)
        struct.pack_into("<I", config, 0, 64)
        if tn == "drawable":
            struct.pack_into("<H", config, 14, 0xFFFF)
            struct.pack_into("<H", config, 24, 4)
        hdr_size = 8 + 12 + 64
        entries_start = hdr_size + 4
        entry = struct.pack("<HHI", 8, 0, i) + struct.pack("<HBBI", 8, 0, T_STR, i)
        tsize = entries_start + len(entry)
        typ = struct.pack("<HHIBBHII", 0x0201, hdr_size, tsize, tid, 0, 0, 1, entries_start) + bytes(config) + \
            struct.pack("<I", 0) + entry
        chunks += spec + typ
    name = pkg_name.encode("utf-16-le")[:254].ljust(256, b"\0")
    phdr = 288
    type_off = phdr
    key_off = phdr + len(tpool)
    pbody = tpool + kpool + chunks
    pkg = struct.pack("<HHII", 0x0200, phdr, phdr + len(pbody), 0x7f) + name + \
        struct.pack("<IIIII", type_off, len(entries), key_off, len(entries), 0) + pbody
    body = gpool + pkg
    return struct.pack("<HHII", 0x0002, 12, 12 + len(body), 1) + body


def arsc(pkg_name, type_name, key_name, file_path):
    gpool = string_pool([file_path])
    tpool = string_pool([type_name])
    kpool = string_pool([key_name])
    spec = struct.pack("<HHIBBHI", 0x0202, 16, 16 + 4, 1, 0, 0, 1) + struct.pack("<I", 0)
    config = bytearray(64)
    struct.pack_into("<I", config, 0, 64)
    struct.pack_into("<H", config, 14, 0xFFFF)
    struct.pack_into("<H", config, 24, 4)
    hdr_size = 8 + 12 + 64
    entries_start = hdr_size + 4
    entry = struct.pack("<HHI", 8, 0, 0) + struct.pack("<HBBI", 8, 0, T_STR, 0)
    tsize = entries_start + len(entry)
    typ = struct.pack("<HHIBBHII", 0x0201, hdr_size, tsize, 1, 0, 0, 1, entries_start) + bytes(config) + \
        struct.pack("<I", 0) + entry
    name = pkg_name.encode("utf-16-le")[:254].ljust(256, b"\0")
    phdr = 288
    type_off = phdr
    key_off = phdr + len(tpool)
    pbody = tpool + kpool + spec + typ
    pkg = struct.pack("<HHII", 0x0200, phdr, phdr + len(pbody), 0x7f) + name + \
        struct.pack("<IIIII", type_off, 1, key_off, 1, 0) + pbody
    body = gpool + pkg
    return struct.pack("<HHII", 0x0002, 12, 12 + len(body), 1) + body


def main():
    import argparse
    ap = argparse.ArgumentParser(description="Assemble an unsigned APK without the Android SDK")
    ap.add_argument("out"); ap.add_argument("dex"); ap.add_argument("icon")
    ap.add_argument("--pkg", required=True)
    ap.add_argument("--label", required=True)
    ap.add_argument("--activity", default=".MainActivity")
    ap.add_argument("--assets", default=None)
    ap.add_argument("--version-code", type=int, default=1)
    ap.add_argument("--version-name", default="1.0")
    ap.add_argument("--min-sdk", type=int, default=24)
    ap.add_argument("--target-sdk", type=int, default=29)
    ap.add_argument("--perm", action="append", default=[])
    ap.add_argument("--theme", type=lambda x: int(x, 0), default=16974120)  # Theme.DeviceDefault
    ap.add_argument("--cleartext", action="store_true")
    ap.add_argument("--service", action="append", default=[])
    ap.add_argument("--a11y", default=None, help="classe AccessibilityService (es. .ScreenReader)")
    ap.add_argument("--a11y-desc", default="Legge il testo sullo schermo quando glielo chiedi.")
    a = ap.parse_args()
    pkg = a.pkg
    act = a.activity if not a.activity.startswith(".") else pkg + a.activity
    icon_path = "res/drawable-nodpi-v4/ic_launcher.png"
    ICON_ID = 0x7f010000
    cfg = 0x80 | 0x400 | 0x20 | 0x100 | 0x200 | 0x800 | 0x10 | 0x40 | 0x1000
    app_attrs = [A("label", T_STR, a.label), A("icon", T_REF, ICON_ID), A("roundIcon", T_REF, ICON_ID),
                 A("theme", T_REF, a.theme), A("allowBackup", T_BOOL, -1), A("hardwareAccelerated", T_BOOL, -1)]
    if a.cleartext:
        app_attrs.append(A("usesCleartextTraffic", T_BOOL, -1))
    manifest = ("manifest", [
        (False, "package", T_STR, pkg),
        A("versionCode", T_DEC, a.version_code), A("versionName", T_STR, a.version_name),
    ], [("uses-sdk", [A("minSdkVersion", T_DEC, a.min_sdk), A("targetSdkVersion", T_DEC, a.target_sdk)], [])]
      + [("uses-permission", [A("name", T_STR, p)], []) for p in a.perm]
      + [("application", app_attrs, [
            ("activity", [
                A("name", T_STR, act), A("exported", T_BOOL, -1),
                A("launchMode", T_DEC, 2), A("configChanges", T_HEX, cfg),
                A("windowSoftInputMode", T_HEX, 0x10),
            ], [("intent-filter", [], [
                    ("action", [A("name", T_STR, "android.intent.action.MAIN")], []),
                    ("category", [A("name", T_STR, "android.intent.category.LAUNCHER")], []),
            ])]),
      ] + [("service", [A("name", T_STR, (pkg + s) if s.startswith(".") else s), A("exported", T_BOOL, 0)], []) for s in a.service]
        + ([("service", [
            A("name", T_STR, (pkg + a.a11y) if a.a11y.startswith(".") else a.a11y),
            A("label", T_STR, a.label),
            A("permission", T_STR, "android.permission.BIND_ACCESSIBILITY_SERVICE"),
            A("exported", T_BOOL, -1),
        ], [
            ("intent-filter", [], [("action", [A("name", T_STR, "android.accessibilityservice.AccessibilityService")], [])]),
            ("meta-data", [A("name", T_STR, "android.accessibilityservice"), A("resource", T_REF, 0x7f020000)], []),
        ])] if a.a11y else []))])
    mbytes = Axml().build(manifest)
    xml_path = "res/xml/accessibility.xml"
    if a.a11y:
        a11y_xml = ("accessibility-service", [
            A("description", T_STR, a.a11y_desc),
            A("accessibilityEventTypes", T_HEX, 0x00000020 | 0x00000800),  # windowStateChanged | windowContentChanged
            A("accessibilityFeedbackType", T_HEX, 0x10),  # feedbackGeneric
            A("notificationTimeout", T_DEC, 300),
            A("accessibilityFlags", T_HEX, 0x00000040 | 0x00000002),  # reportViewIds | includeNotImportantViews
            A("canRetrieveWindowContent", T_BOOL, -1),
            A("canTakeScreenshot", T_BOOL, -1),
        ], [])
        xbytes = Axml().build(a11y_xml)
        rbytes = arsc_multi(pkg, [("drawable", "ic_launcher", icon_path), ("xml", "accessibility", xml_path)])
    else:
        rbytes = arsc(pkg, "drawable", "ic_launcher", icon_path)
    with zipfile.ZipFile(a.out, "w") as z:
        def add(name, data, compress):
            zi = zipfile.ZipInfo(name, date_time=(2026, 10, 25, 12, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED if compress else zipfile.ZIP_STORED
            zi.external_attr = 0o644 << 16
            z.writestr(zi, data)
        add("AndroidManifest.xml", mbytes, True)
        add("classes.dex", open(a.dex, "rb").read(), True)
        add("resources.arsc", rbytes, False)
        add(icon_path, open(a.icon, "rb").read(), False)
        if a.a11y:
            add(xml_path, xbytes, True)
        if a.assets:
            for root, _, files in os.walk(a.assets):
                for fn in sorted(files):
                    p = os.path.join(root, fn)
                    rel = os.path.relpath(p, a.assets).replace(os.sep, "/")
                    add("assets/" + rel, open(p, "rb").read(), True)
    print("unsigned apk:", a.out)


if __name__ == "__main__":
    main()
