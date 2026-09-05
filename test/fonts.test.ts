import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * 自前配信のフォントは、ページに出る字だけへ絞ってある（scripts/build-fonts.py）。
 * 文言を足したのにフォントを作り直さないと、その字だけ豆腐になる——本番で気付く類の壊れ方なので、
 * ここで収録表と突き合わせて落とす。
 *
 * サブセットは2組ある（LP と法務ページ）。組を取り違えても同じ壊れ方をするので、
 * ページごとに**自分の組**と突き合わせる。
 */
type Face = { family: string; weight: number; script: 'jp' | 'latin'; chars: string; missing: string[] };
type Coverage = { chars: string; faces: Face[] };

const load = (dir: string) => JSON.parse(readFileSync(`${dir}/coverage.json`, 'utf8')) as Coverage;

const GROUPS = [
  {
    name: 'lp',
    dir: 'public/fonts',
    pages: ['index.html', 'index-en.html'],
    // 和文の4フェイスと欧文の4フェイス。欧文には CJK を積まないので、面倒でも並びで持つ。
    faces: [
      'ZenAntique-400',
      'ShipporiMincho-400',
      'ZenKakuGothicNew-400',
      'ZenKakuGothicNew-500',
      'BodoniModa-400',
      'LibreCaslonText-400',
      'Archivo-400',
      'Archivo-500',
    ],
  },
  {
    name: 'legal',
    dir: 'public/fonts/legal',
    pages: ['public/privacy/index.html', 'public/terms/index.html'],
    // 法務の2枚は日本語だけ。public/style.css も和文しか宣言していない。
    faces: ['ZenAntique-400', 'ShipporiMincho-400', 'ZenKakuGothicNew-400', 'ZenKakuGothicNew-500'],
  },
];

const rendered = (file: string) =>
  readFileSync(file, 'utf8')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

describe('self-hosted font subsets', () => {
  for (const group of GROUPS) {
    const coverage = load(group.dir);
    const covered = new Set(coverage.chars);

    it.each(group.pages)('covers every glyph rendered in %s', (file: string) => {
      const chars: string[] = Array.from(new Set<string>(rendered(file).split('')));
      const missing = chars.filter((c) => c.trim() !== '' && c.codePointAt(0)! > 32 && !covered.has(c));
      expect(missing, `run \`npm run fonts:build\` — not in the subset: ${missing.join('')}`).toEqual([]);
    });

    it(`built every face the ${group.name} stylesheet declares, with no dropped glyphs`, () => {
      const families = coverage.faces.map((f) => `${f.family}-${f.weight}`);
      expect(families).toEqual(group.faces);
      // 欧文フェイスに日本語は積まない（CSS の unicode-range が和文フェイスへ渡す）。
      // 落ちた字が無いかは、そのフェイスが積むはずだった分だけを見る。
      for (const face of coverage.faces) {
        expect(face.missing, `${face.family}-${face.weight}`).toEqual([]);
        const cjk = [...face.chars].some((c) => c.codePointAt(0)! >= 0x2e80);
        expect(cjk, `${face.family}-${face.weight} carries CJK`).toBe(face.script === 'jp');
      }
    });
  }

  it('serves the fonts from this origin, never a font CDN', () => {
    const lp = readFileSync('src/styles/lp.css', 'utf8');
    expect(lp).toContain("url('/fonts/ZenAntique-400.woff2')");
    expect(lp).toContain("url('/fonts/BodoniModa-400.woff2')");
    expect(readFileSync('public/style.css', 'utf8')).toContain("url('/fonts/legal/ZenAntique-400.woff2')");
    const pages = [
      'index.html',
      'index-en.html',
      'src/styles/lp.css',
      'public/style.css',
      'public/privacy/index.html',
      'public/terms/index.html',
    ];
    for (const file of pages) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toContain('fonts.googleapis.com');
      expect(text, file).not.toContain('fonts.gstatic.com');
    }
  });
});
