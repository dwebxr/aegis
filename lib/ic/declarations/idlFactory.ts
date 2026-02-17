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
    validatedAt: IDL.Opt(IDL.Int),
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
  const PublishedSignal = IDL.Record({
    id: IDL.Text,
    owner: IDL.Principal,
    text: IDL.Text,
    nostrEventId: IDL.Opt(IDL.Text),
    nostrPubkey: IDL.Opt(IDL.Text),
    scores: ScoreBreakdown,
    verdict: Verdict,
    topics: IDL.Vec(IDL.Text),
    createdAt: IDL.Int,
  });
  const StakeStatus = IDL.Variant({ active: IDL.Null, returned: IDL.Null, slashed: IDL.Null });
  const StakeRecord = IDL.Record({
    id: IDL.Text,
    owner: IDL.Principal,
    signalId: IDL.Text,
    amount: IDL.Nat,
    status: StakeStatus,
    validationCount: IDL.Nat,
    flagCount: IDL.Nat,
    createdAt: IDL.Int,
    resolvedAt: IDL.Opt(IDL.Int),
  });
  const UserReputation = IDL.Record({
    principal: IDL.Principal,
    trustScore: IDL.Float64,
    totalStaked: IDL.Nat,
    totalReturned: IDL.Nat,
    totalSlashed: IDL.Nat,
    qualitySignals: IDL.Nat,
    slopSignals: IDL.Nat,
  });
  const D2AMatchRecord = IDL.Record({
    id: IDL.Text,
    senderPrincipal: IDL.Principal,
    receiverPrincipal: IDL.Principal,
    contentHash: IDL.Text,
    feeAmount: IDL.Nat,
    senderPayout: IDL.Nat,
    protocolPayout: IDL.Nat,
    createdAt: IDL.Int,
  });
  const AnalysisTier = IDL.Variant({ free: IDL.Null, premium: IDL.Null });
  const OnChainAnalysis = IDL.Record({
    originality: IDL.Nat8,
    insight: IDL.Nat8,
    credibility: IDL.Nat8,
    compositeScore: IDL.Float64,
    verdict: Verdict,
    reason: IDL.Text,
    topics: IDL.Vec(IDL.Text),
    tier: AnalysisTier,
    vSignal: IDL.Opt(IDL.Nat8),
    cContext: IDL.Opt(IDL.Nat8),
    lSlop: IDL.Opt(IDL.Nat8),
  });
  const AnalyzeResult = IDL.Variant({ ok: OnChainAnalysis, err: IDL.Text });
  const PushSubscriptionKeys = IDL.Record({
    p256dh: IDL.Text,
    auth: IDL.Text,
  });
  const PushSubscription = IDL.Record({
    endpoint: IDL.Text,
    keys: PushSubscriptionKeys,
    createdAt: IDL.Int,
  });
  const UserSettings = IDL.Record({
    linkedNostrNpub: IDL.Opt(IDL.Text),
    linkedNostrPubkeyHex: IDL.Opt(IDL.Text),
    d2aEnabled: IDL.Bool,
    updatedAt: IDL.Int,
  });
  const GlobalBriefingSummariesResult = IDL.Record({
    items: IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Text, IDL.Int)),
    total: IDL.Nat,
  });
  return IDL.Service({
    getProfile: IDL.Func([IDL.Principal], [IDL.Opt(UserProfile)], ["query"]),
    getEvaluation: IDL.Func([IDL.Text], [IDL.Opt(ContentEvaluation)], ["query"]),
    getUserEvaluations: IDL.Func([IDL.Principal, IDL.Nat, IDL.Nat], [IDL.Vec(ContentEvaluation)], ["query"]),
    getUserAnalytics: IDL.Func([IDL.Principal], [AnalyticsResult], ["query"]),
    getUserSourceConfigs: IDL.Func([IDL.Principal], [IDL.Vec(SourceConfigEntry)], ["query"]),
    getUserSignals: IDL.Func([IDL.Principal, IDL.Nat, IDL.Nat], [IDL.Vec(PublishedSignal)], ["query"]),
    saveEvaluation: IDL.Func([ContentEvaluation], [IDL.Text], []),
    updateEvaluation: IDL.Func([IDL.Text, IDL.Bool, IDL.Bool], [IDL.Bool], []),
    batchSaveEvaluations: IDL.Func([IDL.Vec(ContentEvaluation)], [IDL.Nat], []),
    updateDisplayName: IDL.Func([IDL.Text], [IDL.Bool], []),
    saveSourceConfig: IDL.Func([SourceConfigEntry], [IDL.Text], []),
    deleteSourceConfig: IDL.Func([IDL.Text], [IDL.Bool], []),
    saveSignal: IDL.Func([PublishedSignal], [IDL.Text], []),
    publishWithStake: IDL.Func([PublishedSignal, IDL.Nat], [IDL.Variant({ ok: IDL.Text, err: IDL.Text })], []),
    validateSignal: IDL.Func([IDL.Text], [IDL.Variant({ ok: IDL.Bool, err: IDL.Text })], []),
    flagSignal: IDL.Func([IDL.Text], [IDL.Variant({ ok: IDL.Bool, err: IDL.Text })], []),
    getUserReputation: IDL.Func([IDL.Principal], [UserReputation], ["query"]),
    getSignalStake: IDL.Func([IDL.Text], [IDL.Opt(StakeRecord)], ["query"]),
    recordD2AMatch: IDL.Func([IDL.Text, IDL.Principal, IDL.Text, IDL.Nat], [IDL.Variant({ ok: IDL.Text, err: IDL.Text })], []),
    getUserD2AMatches: IDL.Func([IDL.Principal, IDL.Nat, IDL.Nat], [IDL.Vec(D2AMatchRecord)], ["query"]),
    getEngagementIndex: IDL.Func([IDL.Principal], [IDL.Float64], ["query"]),
    getTreasuryBalance: IDL.Func([], [IDL.Nat], []),
    sweepProtocolFees: IDL.Func([], [IDL.Variant({ ok: IDL.Text, err: IDL.Text })], []),
    topUpCycles: IDL.Func([], [IDL.Variant({ ok: IDL.Text, err: IDL.Text })], []),
    analyzeOnChain: IDL.Func([IDL.Text, IDL.Vec(IDL.Text)], [AnalyzeResult], []),
    registerPushSubscription: IDL.Func([IDL.Text, IDL.Text, IDL.Text], [IDL.Bool], []),
    unregisterPushSubscription: IDL.Func([IDL.Text], [IDL.Bool], []),
    getPushSubscriptions: IDL.Func([IDL.Principal], [IDL.Vec(PushSubscription)], ["query"]),
    removePushSubscriptions: IDL.Func([IDL.Principal, IDL.Vec(IDL.Text)], [IDL.Bool], []),
    getPushSubscriptionCount: IDL.Func([], [IDL.Nat], ["query"]),
    saveLatestBriefing: IDL.Func([IDL.Text], [IDL.Bool], []),
    getLatestBriefing: IDL.Func([IDL.Principal], [IDL.Opt(IDL.Text)], ["query"]),
    getGlobalBriefingSummaries: IDL.Func([IDL.Nat, IDL.Nat], [GlobalBriefingSummariesResult], ["query"]),
    getUserSettings: IDL.Func([IDL.Principal], [IDL.Opt(UserSettings)], ["query"]),
    saveUserSettings: IDL.Func([UserSettings], [IDL.Bool], []),
  });
};
