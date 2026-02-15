export interface OllamaConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
}

export interface OllamaStatus {
  connected: boolean;
  loading: boolean;
  models: string[];
  error?: string;
}

export const DEFAULT_OLLAMA_CONFIG: OllamaConfig = {
  enabled: false,
  endpoint: "http://localhost:11434",
  model: "llama3.2",
};
