export type TranslationLanguage = "en" | "ja" | "zh" | "ko" | "es" | "fr" | "de" | "pt" | "it" | "ru";

export type TranslationPolicy = "high_quality" | "all" | "manual";

export type TranslationBackend = "auto" | "browser" | "local" | "cloud" | "ic";

export interface TranslationPrefs {
  targetLanguage: TranslationLanguage;
  policy: TranslationPolicy;
  backend: TranslationBackend;
  /** Minimum composite score for "high_quality" policy auto-translation */
  minScore: number;
}

export interface TranslationResult {
  translatedText: string;
  targetLanguage: string;
  backend: string;
  generatedAt: number;
}

export const LANGUAGES: ReadonlyArray<{ code: TranslationLanguage; label: string; nativeLabel: string }> = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "ja", label: "Japanese", nativeLabel: "日本語" },
  { code: "zh", label: "Chinese", nativeLabel: "中文" },
  { code: "ko", label: "Korean", nativeLabel: "한국어" },
  { code: "es", label: "Spanish", nativeLabel: "Español" },
  { code: "fr", label: "French", nativeLabel: "Français" },
  { code: "de", label: "German", nativeLabel: "Deutsch" },
  { code: "pt", label: "Portuguese", nativeLabel: "Português" },
  { code: "it", label: "Italian", nativeLabel: "Italiano" },
  { code: "ru", label: "Russian", nativeLabel: "Русский" },
];

export const DEFAULT_TRANSLATION_PREFS: TranslationPrefs = {
  targetLanguage: "en",
  policy: "manual",
  backend: "auto",
  minScore: 6,
};
