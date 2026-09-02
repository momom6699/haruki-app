#!/usr/bin/env python3
"""
ページで実際に使う字だけに絞ったフォントを作る。

Google Fonts から読むのをやめ、自前で配る。理由は3つ:
  - 第三者オリジンへの通信が消える（このサイトは計測タグもCookieも置いていない）
  - CDN が落ちても、遮断されても、組みが崩れない
  - 日本語フォントは丸ごとだと数MB。出す字だけに絞れば数十KBで済む

    python3 scripts/build-fonts.py

**コピーを変えたら必ず流し直すこと。** 収録外の字は豆腐になる。
test/fonts.test.ts が HTML の文字と収録表を突き合わせるので、忘れればテストが落ちる。
"""
import json
import pathlib
import re
import sys

from fontTools.subset import Subsetter, Options
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "fonts"
NODE = ROOT / "node_modules" / "@expo-google-fonts"

# 役割はデザイン（Haruki LP standalone.html）の指定どおり。
FACES = [
    ("ZenAntique", 400, "zen-antique/400Regular/ZenAntique_400Regular.ttf"),
    ("ShipporiMincho", 400, "shippori-mincho/400Regular/ShipporiMincho_400Regular.ttf"),
    ("ZenKakuGothicNew", 400, "zen-kaku-gothic-new/400Regular/ZenKakuGothicNew_400Regular.ttf"),
    ("ZenKakuGothicNew", 500, "zen-kaku-gothic-new/500Medium/ZenKakuGothicNew_500Medium.ttf"),
]

# 画面に出るがマークアップには無い文字。JS が入れるものはここに書き足すこと
# ——テストは HTML しか見ないので、書き忘れると本番でその字だけ豆腐になる。
EXTRA = (
    "©— 〜/()（）:：,、.。0123456789km"
    + "この環境では地図を描けませんでした。"  # src/main.ts: showMapFailure
    + "The map could not be drawn in this browser."
)


# サブセットは**2組**作る。
#
# LP と法務ページを1組にまとめると、法務ページの長い本文ぶんの字が全部入り、
# LP が先読みする表示用フェイスが 44KB → 118KB に膨らむ。あの1枚は最初に出るものなので、
# めったに開かれない規約のためにそこを重くしたくない。両方読む人は2回落とすことになるが、
# 割に合う方を取る。
GROUPS = {
    "": ("index.html", "index-en.html"),
    "legal": ("public/privacy/index.html", "public/terms/index.html"),
}


def rendered_text(html: str) -> str:
    html = re.sub(r"<(script|style)\b.*?</\1>", " ", html, flags=re.S | re.I)
    html = re.sub(r"<[^>]+>", " ", html)
    html = html.replace("&nbsp;", " ").replace("&amp;", "&").replace("&larr;", "←")
    return html


def build(group: str, pages: "tuple[str, ...]") -> int:
    out = OUT / group if group else OUT
    out.mkdir(parents=True, exist_ok=True)
    chars = set(EXTRA)
    for name in pages:
        chars |= set(rendered_text((ROOT / name).read_text(encoding="utf-8")))
    if not group:
        # 地物データの帰属文は JS が差し込む。マークアップには無いので、ここで足す。
        area = json.loads((ROOT / "public" / "data" / "area.geojson").read_text(encoding="utf-8"))
        chars |= set(str(area.get("attribution", ""))) | set(str(area.get("attributionEn", "")))
        chars |= set("© OpenStreetMap contributors")
    chars = {c for c in chars if c.isprintable() and not c.isspace()}

    text = "".join(sorted(chars))
    print(f"[{group or 'lp'}] charset: {len(chars)} glyphs")

    coverage = {"chars": text, "faces": []}
    total = 0
    for family, weight, rel in FACES:
        src = NODE / rel
        if not src.is_file():
            print(f"missing source: {src}", file=sys.stderr)
            return 1
        font = TTFont(str(src))
        options = Options()
        options.flavor = "woff2"
        options.desubroutinize = True
        options.layout_features = ["kern", "liga", "locl", "palt", "vert"]
        options.drop_tables += ["DSIG"]
        options.notdef_outline = True
        sub = Subsetter(options=options)
        sub.populate(text=text)
        sub.subset(font)
        dest = out / f"{family}-{weight}.woff2"
        font.flavor = "woff2"
        font.save(str(dest))
        kb = dest.stat().st_size / 1024
        total += kb
        cmap = set(TTFont(str(dest)).getBestCmap())
        missing = [c for c in text if ord(c) not in cmap]
        coverage["faces"].append({"family": family, "weight": weight, "missing": missing})
        flag = "" if not missing else f"  !! missing {len(missing)}: {''.join(missing[:20])}"
        print(f"  {dest.name:34s} {kb:6.1f} KB{flag}")
    print(f"[{group or 'lp'}] total {total:.1f} KB")

    (out / "coverage.json").write_text(json.dumps(coverage, ensure_ascii=False), encoding="utf-8")
    return 0


def main() -> int:
    for group, pages in GROUPS.items():
        code = build(group, pages)
        if code:
            return code
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
