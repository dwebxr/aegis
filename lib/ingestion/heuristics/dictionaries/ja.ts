/**
 * Japanese heuristic dictionaries.
 *
 * Conservative initial seed: terms strongly associated with clickbait/slop or
 * with analytical/credible writing in Japanese-language news and social media.
 *
 * Maintenance policy: prefer evergreen vocabulary that remains meaningful for
 * years (e.g. "速報", "研究"). Avoid trend-of-the-month slang. New entries
 * should ideally be backed by a sample that the heuristic was misclassifying.
 */

/** Clickbait / sensationalism / engagement-bait vocabulary. */
export const SLOP_TERMS_JA: ReadonlyArray<string> = [
  // Sensationalism
  "衝撃",
  "衝撃の",
  "驚愕",
  "驚愕の",
  "話題沸騰",
  "炎上",
  "暴露",
  "禁断",
  "禁断の",
  // Engagement bait
  "やばい",
  "やばすぎ",
  "ヤバ",
  "ヤバい",
  "神対応",
  "神回",
  "神レベル",
  // Hyperbole / urgency
  "速報",
  "緊急",
  "完全版",
  "永久保存版",
  "知らないと損",
  "知っておきたい",
  "全部教えます",
  "絶対に",
  // Vague gossip framing
  "ぶっちゃけ",
  "実は",
  "本当の理由",
  "裏側",
];

/** Analytical / cited / data-driven vocabulary. */
export const QUALITY_TERMS_JA: ReadonlyArray<string> = [
  // Research framing
  "研究",
  "論文",
  "調査",
  "実験",
  "検証",
  "分析",
  "考察",
  "解析",
  "計測",
  // Attribution
  "出典",
  "引用",
  "参考文献",
  "によれば",
  "によると",
  "発表した",
  "報告した",
  // Methodology
  "手法",
  "方法論",
  "アルゴリズム",
  "モデル",
  "ベンチマーク",
  "データセット",
  // Quantitative framing
  "統計",
  "有意",
  "相関",
  "比較",
];
