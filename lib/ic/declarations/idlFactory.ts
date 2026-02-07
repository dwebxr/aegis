/* eslint-disable @typescript-eslint/no-explicit-any */
export const idlFactory = ({ IDL }: { IDL: any }) => {
  const Verdict = IDL.Variant({ quality: IDL.Null, slop: IDL.Null });
  const ContentSource = IDL.Variant({
    manual: IDL.Null,
    rss: IDL.Null,
    url: IDL.Null,
    twitter: IDL.Null,
    nostr: IDL.Null,
  });
  const ScoreBreakdown = IDL.Record({
    originality: IDL.Nat8,
    insight: IDL.Nat8,
    credibility: IDL.Nat8,
    compositeScore: IDL.Float64,
  });
  const ContentEvaluation = IDL.Record({
    id: IDL.Text,
    owner: IDL.Principal,
    author: IDL.Text,
    avatar: IDL.Text,
    text: IDL.Text,
    source: ContentSource,
    sourceUrl: IDL.Opt(IDL.Text),
    scores: ScoreBreakdown,
    verdict: Verdict,
    reason: IDL.Text,
    createdAt: IDL.Int,
    validated: IDL.Bool,
    flagged: IDL.Bool,
  });
  const UserProfile = IDL.Record({
    principal: IDL.Principal,
    displayName: IDL.Opt(IDL.Text),
    createdAt: IDL.Int,
    totalEvaluations: IDL.Nat,
    totalQuality: IDL.Nat,
    totalSlop: IDL.Nat,
  });
  const AnalyticsResult = IDL.Record({
    totalEvaluations: IDL.Nat,
    totalQuality: IDL.Nat,
    totalSlop: IDL.Nat,
    averageComposite: IDL.Float64,
    recentCount7d: IDL.Nat,
  });
  const SourceConfigEntry = IDL.Record({
    id: IDL.Text,
    owner: IDL.Principal,
    sourceType: IDL.Text,
    configJson: IDL.Text,
    enabled: IDL.Bool,
    createdAt: IDL.Int,
  });
  return IDL.Service({
    getProfile: IDL.Func([IDL.Principal], [IDL.Opt(UserProfile)], ["query"]),
    getEvaluation: IDL.Func([IDL.Text], [IDL.Opt(ContentEvaluation)], ["query"]),
    getUserEvaluations: IDL.Func([IDL.Principal, IDL.Nat, IDL.Nat], [IDL.Vec(ContentEvaluation)], ["query"]),
    getUserAnalytics: IDL.Func([IDL.Principal], [AnalyticsResult], ["query"]),
    getUserSourceConfigs: IDL.Func([IDL.Principal], [IDL.Vec(SourceConfigEntry)], ["query"]),
    saveEvaluation: IDL.Func([ContentEvaluation], [IDL.Text], []),
    updateEvaluation: IDL.Func([IDL.Text, IDL.Bool, IDL.Bool], [IDL.Bool], []),
    batchSaveEvaluations: IDL.Func([IDL.Vec(ContentEvaluation)], [IDL.Nat], []),
    updateDisplayName: IDL.Func([IDL.Text], [IDL.Bool], []),
    saveSourceConfig: IDL.Func([SourceConfigEntry], [IDL.Text], []),
    deleteSourceConfig: IDL.Func([IDL.Text], [IDL.Bool], []),
  });
};
