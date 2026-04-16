export interface WebLLMStatus {
  available: boolean;
  loaded: boolean;
  loading: boolean;
  progress: number; // 0-100
  error?: string;
}
