import { heuristicScores } from "@/lib/ingestion/quickFilter";
import { scoreJapanese } from "@/lib/ingestion/heuristics/ja";

describe("scoreJapanese — direct unit", () => {
  it("returns neutral signals for plain Japanese sentence", () => {
    const s = scoreJapanese("これは普通の日本語の文章です");
    // Just under 20 chars → very short penalty
    expect(s.originality).toBeLessThanOrEqual(0);
    expect(s.insight).toBeLessThanOrEqual(0);
  });

  it("penalizes 2+ slop terms", () => {
    const s = scoreJapanese("衝撃の速報がついに登場、やばすぎる神回");
    expect(s.originality).toBeLessThan(0);
    expect(s.credibility).toBeLessThan(0);
    expect(s.reasons).toContain("clickbait vocabulary");
  });

  it("does not penalize a single slop term in isolation", () => {
    const s = scoreJapanese("速報。今日の天気は晴れでした。");
    expect(s.reasons).not.toContain("clickbait vocabulary");
  });

  it("penalizes emphatic punctuation runs", () => {
    const s = scoreJapanese("これはテストです！！？？");
    expect(s.reasons).toContain("emphatic punctuation runs");
  });

  it("penalizes excessive fullwidth alphanumerics", () => {
    const s = scoreJapanese("ＡＩとＭＬとＤＬのＰＣ");
    expect(s.reasons).toContain("fullwidth alphanumerics");
  });

  it("penalizes decorative bracket overuse", () => {
    const s = scoreJapanese("【速報】【独占】【完全版】【保存版】a");
    expect(s.reasons).toContain("decorative brackets");
  });

  it("rewards 2+ analytical terms", () => {
    const s = scoreJapanese("研究によれば、データセットの分析から相関が見つかった");
    expect(s.insight).toBeGreaterThan(0);
    expect(s.credibility).toBeGreaterThan(0);
    expect(s.reasons).toContain("analytical vocabulary");
  });

  it("rewards 4+ analytical terms more strongly", () => {
    const s4 = scoreJapanese("研究の論文によれば、調査と実験と検証の結果、データの分析から有意な相関が見つかった");
    expect(s4.insight).toBeGreaterThanOrEqual(2);
  });

  it("rewards long-form Japanese content", () => {
    const text = "あ".repeat(350);
    const s = scoreJapanese(text);
    expect(s.reasons).toContain("long-form content");
  });

  it("rewards detailed Japanese content (>600 chars)", () => {
    const text = "あ".repeat(700);
    const s = scoreJapanese(text);
    expect(s.reasons).toContain("detailed content");
  });

  it("penalizes very short Japanese content", () => {
    const s = scoreJapanese("短い");
    expect(s.reasons).toContain("very short content");
  });

  it("integrates common signals: links increase credibility", () => {
    const s = scoreJapanese("詳細はこちら https://example.com を参照してください");
    expect(s.credibility).toBeGreaterThan(0);
    expect(s.reasons).toContain("contains links");
  });

  it("integrates common signals: numeric data increases insight", () => {
    const s = scoreJapanese("昨年比で 45% 改善し、$100 のコスト削減を達成しました");
    expect(s.insight).toBeGreaterThan(0);
    expect(s.reasons).toContain("contains data/numbers");
  });
});

describe("heuristicScores — Japanese end-to-end", () => {
  it("scores clickbait Japanese text as slop", () => {
    const text = "【衝撃】やばすぎる神回がついに登場！！速報レベルの内容で話題沸騰";
    const result = heuristicScores(text);
    expect(result.detectedLang).toBe("ja");
    expect(result.verdict).toBe("slop");
  });

  it("scores analytical Japanese text as quality", () => {
    const text
      = "最新の研究論文によれば、この手法のベンチマーク結果は従来のアルゴリズムと比較して "
      + "約 32% の改善を示している。著者らは複数のデータセットで検証を行い、統計的に有意な相関を確認した。"
      + "詳細な考察と方法論については出典 https://example.com/paper を参照のこと。";
    const result = heuristicScores(text);
    expect(result.detectedLang).toBe("ja");
    expect(result.verdict).toBe("quality");
    expect(result.composite).toBeGreaterThan(5);
  });

  it("clickbait Japanese with emojis scores even lower", () => {
    const text = "【衝撃】やばすぎ！！速報🔥🔥🔥神回🚀🚀🚀";
    const result = heuristicScores(text);
    expect(result.detectedLang).toBe("ja");
    expect(result.composite).toBeLessThan(4);
  });

  it("composite always within [0, 10] for Japanese", () => {
    const samples = [
      "これは短いテストです",
      "あ".repeat(1000),
      "【衝撃】！！？？やばすぎる神回",
      "研究論文の分析と検証結果について",
    ];
    for (const text of samples) {
      const r = heuristicScores(text);
      expect(r.composite).toBeGreaterThanOrEqual(0);
      expect(r.composite).toBeLessThanOrEqual(10);
    }
  });

  it("ja results carry detectedLang in the response", () => {
    const result = heuristicScores("これは日本語のテストです");
    expect(result.detectedLang).toBe("ja");
  });

  it("explicit lang override forces Japanese scoring", () => {
    // English text with Japanese override → applies Japanese length thresholds
    const text = "This is English but we override to ja";
    const result = heuristicScores(text, { lang: "ja" });
    expect(result.detectedLang).toBe("ja");
  });

  it("explicit lang override forces English scoring on Japanese text", () => {
    const text = "これは日本語ですが英語ルールを強制します";
    const result = heuristicScores(text, { lang: "en" });
    expect(result.detectedLang).toBe("en");
  });
});

describe("heuristicScores — English regression (must be unchanged)", () => {
  // Spot-check the most pinned legacy invariants from quickFilter*.test.ts
  it("empty string → composite 4.3", () => {
    const r = heuristicScores("");
    expect(r.originality).toBe(4);
    expect(r.insight).toBe(4);
    expect(r.credibility).toBe(5);
    expect(r.composite).toBe(4.3);
  });

  it("'WOW!!! 🎉🔥💯🚀🎊 YES!!!' → composite 1.9", () => {
    const r = heuristicScores("WOW!!! 🎉🔥💯🚀🎊 YES!!!");
    expect(r.originality).toBe(0);
    expect(r.insight).toBe(4);
    expect(r.credibility).toBe(2);
    expect(r.composite).toBe(1.9);
  });

  it("plain English baseline → composite 5.0", () => {
    const r = heuristicScores("This is a reasonable piece of content about technology.");
    expect(r.originality).toBe(5);
    expect(r.insight).toBe(5);
    expect(r.credibility).toBe(5);
    expect(r.composite).toBe(5);
    expect(r.detectedLang).toBe("en");
  });

  it("English with attribution → credibility 7", () => {
    const r = heuristicScores("According to the latest report the results are significant here.");
    expect(r.credibility).toBe(7);
  });
});
