import type { Verdict } from "./content";

export interface AnalyzeResponse {
  originality: number;
  insight: number;
  credibility: number;
  composite: number;
  verdict: Verdict;
  reason: string;
}

export interface FetchURLResponse {
  title: string;
  author: string;
  content: string;
  description?: string;
  publishedDate?: string;
  source: string;
}

export interface FetchRSSResponse {
  feedTitle: string;
  items: Array<{
    title: string;
    content: string;
    link: string;
    author?: string;
    publishedDate?: string;
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
