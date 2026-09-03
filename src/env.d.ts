/// <reference types="vite/client" />

/**
 * ビルド時に注入する環境変数。
 *
 * `VITE_CARTO_KEY` — CARTO Basemaps の無料キー（アカウント不要・fair use）。
 * ローカルは gitignore 済みの `.env` に、公開ビルドは Cloudflare Pages の環境変数に置く。
 * 未設定でもビルド・表示は通る（地図に CARTO の透かしが乗るだけ）。`.env.example` 参照。
 */
interface ImportMetaEnv {
  readonly VITE_CARTO_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
