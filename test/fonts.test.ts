import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * 自前配信のフォントは、ページに出る字だけへ絞ってある（scripts/build-fonts.py）。
 * 文言を足したのにフォントを作り直さないと、その字だけ豆腐になる——本番で気付く類の壊れ方なので、
 * ここで収録表と突き合わせて落とす。
 */
const coverage = JSON.parse(readFileSync('public/fonts/coverage.json', 'utf8')) as {
  chars: string;
  faces: { family: string; weight: number; missing: string[] }[];
};

const rendered = (file: string) =>
  readFileSync(file, 'utf8')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

describe('self-hosted font subsets', () => {
  const covered = new Set(coverage.chars);

  it.each(['index.html', 'index-en.html'])('covers every glyph rendered in %s', (file: string) => {
    const chars: string[] = Array.from(new Set<string>(rendered(file).split('')));
    const missing = chars.filter((c) => c.trim() !== '' && c.codePointAt(0)! > 32 && !covered.has(c));
    expect(missing, `run \`npm run fonts:build\` — not in the subset: ${missing.join('')}`).toEqual([]);
  });

  it('built every face the stylesheet declares, with no dropped glyphs', () => {
    const families = coverage.faces.map((f) => `${f.family}-${f.weight}`);
    expect(families).toEqual(['ZenAntique-400', 'ShipporiMincho-400', 'ZenKakuGothicNew-400', 'ZenKakuGothicNew-500']);
    for (const face of coverage.faces) expect(face.missing, face.family).toEqual([]);
  });

  it('serves the fonts from this origin, never a font CDN', () => {
    const css = readFileSync('src/styles/lp.css', 'utf8');
    expect(css).toContain("url('/fonts/ZenAntique-400.woff2')");
    for (const file of ['index.html', 'index-en.html', 'src/styles/lp.css']) {
      expect(readFileSync(file, 'utf8')).not.toContain('fonts.googleapis.com');
      expect(readFileSync(file, 'utf8')).not.toContain('fonts.gstatic.com');
    }
  });
});
