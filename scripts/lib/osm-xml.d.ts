/** 素の JS で書いたスクリプトを TypeScript のテストから読むための型だけの宣言。 */
export declare function osmXmlToOverpass(xml: string): {
  elements: { type: string; tags: Record<string, string>; lat?: number; lon?: number; geometry?: { lat: number; lon: number }[] }[];
};
