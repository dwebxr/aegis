module {
  public type Verdict = { #quality; #slop };

  public type ContentSource = { #manual; #rss; #url; #twitter; #nostr };

  public type ScoreBreakdown = {
    originality : Nat8;
    insight : Nat8;
    credibility : Nat8;
    compositeScore : Float;
  };

  public type ContentEvaluation = {
    id : Text;
    owner : Principal;
    author : Text;
    avatar : Text;
    text : Text;
    source : ContentSource;
    sourceUrl : ?Text;
    imageUrl : ?Text;
    scores : ScoreBreakdown;
    verdict : Verdict;
    reason : Text;
    createdAt : Int;
    validated : Bool;
    flagged : Bool;
    validatedAt : ?Int;
  };

  public type UserProfile = {
    principal : Principal;
    displayName : ?Text;
    createdAt : Int;
    totalEvaluations : Nat;
    totalQuality : Nat;
    totalSlop : Nat;
  };

  public type AnalyticsResult = {
    totalEvaluations : Nat;
    totalQuality : Nat;
    totalSlop : Nat;
    averageComposite : Float;
    recentCount7d : Nat;
  };

  public type SourceConfigEntry = {
    id : Text;
    owner : Principal;
    sourceType : Text;
    configJson : Text;
    enabled : Bool;
    createdAt : Int;
  };

  public type PublishedSignal = {
    id : Text;
    owner : Principal;
    text : Text;
    nostrEventId : ?Text;
    nostrPubkey : ?Text;
    scores : ScoreBreakdown;
    verdict : Verdict;
    topics : [Text];
    createdAt : Int;
  };

  // ── Staking / Reputation types ──

  public type StakeStatus = {
    #active;     // Stake is live, awaiting community review
    #returned;   // Validated — stake returned to owner
    #slashed;    // Flagged — stake sent to protocol treasury
  };

  public type StakeRecord = {
    id : Text;
    owner : Principal;
    signalId : Text;
    amount : Nat;          // e8s (1 ICP = 100_000_000 e8s)
    status : StakeStatus;
    validationCount : Nat;
    flagCount : Nat;
    createdAt : Int;
    resolvedAt : ?Int;
  };

  public type UserReputation = {
    principal : Principal;
    trustScore : Float;       // 0.0 - 10.0
    totalStaked : Nat;        // Cumulative stake amount (e8s)
    totalReturned : Nat;      // Returned amount (e8s)
    totalSlashed : Nat;       // Slashed amount (e8s)
    qualitySignals : Nat;     // Signals validated as quality
    slopSignals : Nat;        // Signals flagged as slop
  };

  // ── D2A Match types ──

  public type D2AMatchRecord = {
    id : Text;
    senderPrincipal : Principal;
    receiverPrincipal : Principal;
    contentHash : Text;          // Hash of matched content
    feeAmount : Nat;             // Total fee (e8s)
    senderPayout : Nat;          // 80% to sender
    protocolPayout : Nat;        // 20% to protocol
    createdAt : Int;
  };

  // ── Push Notification types ──

  public type PushSubscriptionKeys = {
    p256dh : Text;
    auth : Text;
  };

  public type PushSubscription = {
    endpoint : Text;
    keys : PushSubscriptionKeys;
    createdAt : Int;
  };

  // ── D2A Briefing Snapshot ──

  public type D2ABriefingSnapshot = {
    owner : Principal;
    briefingJson : Text;    // Serialized D2ABriefingResponse JSON
    generatedAt : Int;      // Timestamp (nanoseconds)
  };

  // ── User Settings (cross-device sync) ──

  public type UserSettings = {
    linkedNostrNpub : ?Text;
    linkedNostrPubkeyHex : ?Text;
    d2aEnabled : Bool;
    updatedAt : Int;
  };

  // ── User Preferences (cross-device sync, JSON blob) ──

  public type UserPreferences = {
    owner : Principal;
    preferencesJson : Text;   // Serialized UserPreferenceProfile JSON
    lastUpdated : Int;         // Client timestamp (milliseconds)
    savedAt : Int;             // Server timestamp (nanoseconds) via Time.now()
  };

  public type AnalysisTier = { #free; #premium };

  public type OnChainAnalysis = {
    originality : Nat8;
    insight : Nat8;
    credibility : Nat8;
    compositeScore : Float;
    verdict : Verdict;
    reason : Text;
    topics : [Text];
    tier : AnalysisTier;
    vSignal : ?Nat8;
    cContext : ?Nat8;
    lSlop : ?Nat8;
  };
};
