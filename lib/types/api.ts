import type { Verdict } from "./content";

export interface AnalyzeResponse {
  originality: number;
  insight: number;
  credibility: number;
  composite: number;
  verdict: Verdict;
  reason: string;
  // V/C/L scoring (present when personalized)
  vSignal?: number;
  cContext?: number;
  lSlop?: number;
  topics?: string[];
}

export interface FetchURLResponse {
  title: string;
  author: string;
  content: string;
  description?: string;
  publishedDate?: string;
  source: string;
  imageUrl?: string;
}

export interface FetchRSSResponse {
  feedTitle: string;
  notModified?: boolean;
  etag?: string;
  lastModified?: string;
  items: Array<{
    title: string;
    content: string;
    link: string;
    author?: string;
    publishedDate?: string;
    imageUrl?: string;
  }>;
}

export interface FetchTwitterResponse {
  tweets: Array<{
    id: string;
    text: string;
    author: string;
    authorHandle: string;
    createdAt: string;
  }>;
}

export interface FetchNostrResponse {
  events: Array<{
    id: string;
    pubkey: string;
    content: string;
    createdAt: number;
    tags: string[][];
  }>;
}
