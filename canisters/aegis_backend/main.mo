import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Debug "mo:base/Debug";
import Error "mo:base/Error";
import Order "mo:base/Order";
import ExperimentalCycles "mo:base/ExperimentalCycles";
import Float "mo:base/Float";
import HashMap "mo:base/HashMap";
import Int "mo:base/Int";
import Iter "mo:base/Iter";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Nat64 "mo:base/Nat64";
import Principal "mo:base/Principal";
import Result "mo:base/Result";
import Text "mo:base/Text";
import Time "mo:base/Time";
import Timer "mo:base/Timer";

import CertifiedCache "mo:certified-cache";
import HTTP "mo:certified-cache/Http";
import Json "mo:json";
import LLM "mo:llm";

import Ledger "ledger";
import Types "types";

persistent actor AegisBackend {

  // ──────────────────────────────────────
  // ICP Ledger canister reference
  // ──────────────────────────────────────

  let ICP_LEDGER : Ledger.LedgerActor = actor "ryjl3-tyaaa-aaaaa-aaaba-cai";
  let ICP_FEE : Nat = 10_000; // 0.0001 ICP
  let MIN_STAKE : Nat = 100_000; // 0.001 ICP minimum
  let MAX_STAKE : Nat = 100_000_000; // 1.0 ICP maximum
  let VALIDATE_THRESHOLD : Nat = 3; // Validations needed to return stake
  let FLAG_THRESHOLD : Nat = 3; // Flags needed to slash stake
  let DEPOSIT_EXPIRY_NS : Int = 30 * 24 * 60 * 60 * 1_000_000_000; // 30 days in nanoseconds

  // ──────────────────────────────────────
  // Non-custodial: protocol wallet + cycles top-up
  // ──────────────────────────────────────

  let PROTOCOL_WALLET : Principal = Principal.fromText("lg3sn-xvuag-vrcgb-xkhyo-4tlui-dw23v-sgtz3-573c7-obhuo-apcx6-uqe");
  let CMC : Ledger.CMCActor = actor "rkp4c-7iaaa-aaaaa-aaaca-cai";
  let CYCLES_THRESHOLD : Nat = 2_000_000_000_000; // 2T cycles — below this, top up from revenue
  let TPUP_MEMO : Blob = "\54\50\55\50\00\00\00\00"; // "TPUP" as little-endian u64

  // ──────────────────────────────────────
  // Stable storage for upgrades
  // ──────────────────────────────────────

  // Migration: V1 type without validatedAt
  type ContentEvaluationV1 = {
    id : Text;
    owner : Principal;
    author : Text;
    avatar : Text;
    text : Text;
    source : Types.ContentSource;
    sourceUrl : ?Text;
    scores : Types.ScoreBreakdown;
    verdict : Types.Verdict;
    reason : Text;
    createdAt : Int;
    validated : Bool;
    flagged : Bool;
  };
  // Migration: V2 type without imageUrl
  type ContentEvaluationV2 = {
    id : Text;
    owner : Principal;
    author : Text;
    avatar : Text;
    text : Text;
    source : Types.ContentSource;
    sourceUrl : ?Text;
    scores : Types.ScoreBreakdown;
    verdict : Types.Verdict;
    reason : Text;
    createdAt : Int;
    validated : Bool;
    flagged : Bool;
    validatedAt : ?Int;
  };
  var stableEvaluations : [(Text, ContentEvaluationV1)] = [];
  var stableEvaluationsV2 : [(Text, ContentEvaluationV2)] = [];
  var stableEvaluationsV3 : [(Text, Types.ContentEvaluation)] = [];
  var stableProfiles : [(Principal, Types.UserProfile)] = [];
  var stableSourceConfigs : [(Text, Types.SourceConfigEntry)] = [];
  var stableSignals : [(Text, Types.PublishedSignal)] = [];
  var stableStakes : [(Text, Types.StakeRecord)] = [];
  var stableReputations : [(Principal, Types.UserReputation)] = [];
  var stableD2AMatches : [(Text, Types.D2AMatchRecord)] = [];
  var stableSignalVoters : [(Text, [Principal])] = [];

  // ──────────────────────────────────────
  // Runtime state (rebuilt from stable on upgrade)
  // ──────────────────────────────────────

  transient var evaluations = HashMap.HashMap<Text, Types.ContentEvaluation>(64, Text.equal, Text.hash);
  transient var profiles = HashMap.HashMap<Principal, Types.UserProfile>(16, Principal.equal, Principal.hash);
  transient var sourceConfigs = HashMap.HashMap<Text, Types.SourceConfigEntry>(16, Text.equal, Text.hash);

  // Signal storage + owner index
  transient var signals = HashMap.HashMap<Text, Types.PublishedSignal>(16, Text.equal, Text.hash);
  transient var signalOwnerIndex = HashMap.HashMap<Principal, Buffer.Buffer<Text>>(16, Principal.equal, Principal.hash);

  // Staking storage
  transient var stakes = HashMap.HashMap<Text, Types.StakeRecord>(16, Text.equal, Text.hash);
  transient var signalStakeIndex = HashMap.HashMap<Text, Text>(16, Text.equal, Text.hash); // signalId -> stakeId
  transient var reputations = HashMap.HashMap<Principal, Types.UserReputation>(16, Principal.equal, Principal.hash);
  // Track who has already validated/flagged a signal to prevent double-voting
  transient var signalVoters = HashMap.HashMap<Text, Buffer.Buffer<Principal>>(16, Text.equal, Text.hash);

  // D2A match records
  transient var d2aMatches = HashMap.HashMap<Text, Types.D2AMatchRecord>(16, Text.equal, Text.hash);
  transient var d2aOwnerIndex = HashMap.HashMap<Principal, Buffer.Buffer<Text>>(16, Principal.equal, Principal.hash);

  // Push notification subscriptions
  var stablePushSubscriptions : [(Principal, [Types.PushSubscription])] = [];
  transient var pushSubscriptions = HashMap.HashMap<Principal, [Types.PushSubscription]>(16, Principal.equal, Principal.hash);

  // D2A Briefing snapshots (latest per user)
  var stableBriefings : [(Principal, Types.D2ABriefingSnapshot)] = [];
  transient var briefings = HashMap.HashMap<Principal, Types.D2ABriefingSnapshot>(16, Principal.equal, Principal.hash);

  // User settings (cross-device sync)
  var stableUserSettings : [(Principal, Types.UserSettings)] = [];
  transient var userSettings = HashMap.HashMap<Principal, Types.UserSettings>(16, Principal.equal, Principal.hash);

  // User preferences (cross-device preference profile sync, JSON blob)
  var stableUserPreferences : [(Principal, Types.UserPreferences)] = [];
  transient var userPreferences = HashMap.HashMap<Principal, Types.UserPreferences>(16, Principal.equal, Principal.hash);

  // Owner -> evaluation IDs index for fast user queries
  transient var ownerIndex = HashMap.HashMap<Principal, Buffer.Buffer<Text>>(16, Principal.equal, Principal.hash);

  // ──────────────────────────────────────
  // II Alternative Origins (certified HTTP)
  // ──────────────────────────────────────

  let II_ORIGINS_PATH = "/.well-known/ii-alternative-origins";
  let II_ORIGINS_BODY : Blob = Text.encodeUtf8(
    "{\"alternativeOrigins\":[\"https://aegis.dwebxr.xyz\",\"https://aegis-kappa-eight.vercel.app\"]}"
  );

  transient var certCache = CertifiedCache.CertifiedCache<Text, Blob>(
    4, Text.equal, Text.hash,
    Text.encodeUtf8,
    func(b : Blob) : Blob { b },
    365 * 24 * 60 * 60 * 1_000_000_000
  );

  func initCertCache() {
    certCache.put(II_ORIGINS_PATH, II_ORIGINS_BODY, null);
  };

  initCertCache();

  // ──────────────────────────────────────
  // Upgrade hooks
  // ──────────────────────────────────────

  system func preupgrade() {
    stableEvaluations := [];
    stableEvaluationsV2 := [];
    stableEvaluationsV3 := Iter.toArray(evaluations.entries());
    stableProfiles := Iter.toArray(profiles.entries());
    stableSourceConfigs := Iter.toArray(sourceConfigs.entries());
    stableSignals := Iter.toArray(signals.entries());
    stableStakes := Iter.toArray(stakes.entries());
    stableReputations := Iter.toArray(reputations.entries());
    stableD2AMatches := Iter.toArray(d2aMatches.entries());
    let voterBuf = Buffer.Buffer<(Text, [Principal])>(signalVoters.size());
    for ((signalId, voters) in signalVoters.entries()) {
      voterBuf.add((signalId, Buffer.toArray(voters)));
    };
    stableSignalVoters := Buffer.toArray(voterBuf);
    stablePushSubscriptions := Iter.toArray(pushSubscriptions.entries());
    stableBriefings := Iter.toArray(briefings.entries());
    stableUserSettings := Iter.toArray(userSettings.entries());
    stableUserPreferences := Iter.toArray(userPreferences.entries());
  };

  system func postupgrade() {
    // Load evaluations: prefer V3 (with imageUrl), then V2, then V1
    if (stableEvaluationsV3.size() > 0) {
      for ((id, eval) in stableEvaluationsV3.vals()) {
        evaluations.put(id, eval);
        addToPrincipalIndex(ownerIndex, eval.owner, id);
      };
    } else if (stableEvaluationsV2.size() > 0) {
      for ((id, old) in stableEvaluationsV2.vals()) {
        let migrated : Types.ContentEvaluation = {
          id = old.id;
          owner = old.owner;
          author = old.author;
          avatar = old.avatar;
          text = old.text;
          source = old.source;
          sourceUrl = old.sourceUrl;
          imageUrl = null;
          scores = old.scores;
          verdict = old.verdict;
          reason = old.reason;
          createdAt = old.createdAt;
          validated = old.validated;
          flagged = old.flagged;
          validatedAt = old.validatedAt;
        };
        evaluations.put(id, migrated);
        addToPrincipalIndex(ownerIndex, migrated.owner, id);
      };
    } else {
      for ((id, old) in stableEvaluations.vals()) {
        let migrated : Types.ContentEvaluation = {
          id = old.id;
          owner = old.owner;
          author = old.author;
          avatar = old.avatar;
          text = old.text;
          source = old.source;
          sourceUrl = old.sourceUrl;
          imageUrl = null;
          scores = old.scores;
          verdict = old.verdict;
          reason = old.reason;
          createdAt = old.createdAt;
          validated = old.validated;
          flagged = old.flagged;
          validatedAt = null;
        };
        evaluations.put(id, migrated);
        addToPrincipalIndex(ownerIndex, migrated.owner, id);
      };
    };
    stableEvaluations := [];
    stableEvaluationsV2 := [];
    stableEvaluationsV3 := [];
    for ((p, profile) in stableProfiles.vals()) { profiles.put(p, profile) };
    for ((id, config) in stableSourceConfigs.vals()) { sourceConfigs.put(id, config) };
    for ((id, signal) in stableSignals.vals()) {
      signals.put(id, signal);
      addToPrincipalIndex(signalOwnerIndex, signal.owner, id);
    };
    for ((id, stake) in stableStakes.vals()) {
      stakes.put(id, stake);
      signalStakeIndex.put(stake.signalId, id);
    };
    for ((p, rep) in stableReputations.vals()) { reputations.put(p, rep) };
    stableProfiles := [];
    stableSourceConfigs := [];
    stableSignals := [];
    stableStakes := [];
    stableReputations := [];
    for ((id, m) in stableD2AMatches.vals()) {
      d2aMatches.put(id, m);
      for (p in [m.senderPrincipal, m.receiverPrincipal].vals()) {
        addToPrincipalIndex(d2aOwnerIndex, p, id);
      };
    };
    stableD2AMatches := [];
    for ((signalId, voters) in stableSignalVoters.vals()) {
      let buf = Buffer.Buffer<Principal>(voters.size());
      for (v in voters.vals()) { buf.add(v) };
      signalVoters.put(signalId, buf);
    };
    stableSignalVoters := [];
    for ((p, subs) in stablePushSubscriptions.vals()) { pushSubscriptions.put(p, subs) };
    stablePushSubscriptions := [];
    for ((p, b) in stableBriefings.vals()) { briefings.put(p, b) };
    stableBriefings := [];
    for ((p, s) in stableUserSettings.vals()) { userSettings.put(p, s) };
    stableUserSettings := [];
    for ((p, prefs) in stableUserPreferences.vals()) { userPreferences.put(p, prefs) };
    stableUserPreferences := [];
    initCertCache();
  };

  // ──────────────────────────────────────
  // Helper: ensure caller is authenticated
  // ──────────────────────────────────────

  func requireAuth(caller : Principal) : Bool {
    not Principal.isAnonymous(caller);
  };

  // Helper: add an ID to a Principal-keyed Buffer index
  func addToPrincipalIndex(index : HashMap.HashMap<Principal, Buffer.Buffer<Text>>, owner : Principal, id : Text) {
    switch (index.get(owner)) {
      case (?buf) { buf.add(id) };
      case null {
        let buf = Buffer.Buffer<Text>(8);
        buf.add(id);
        index.put(owner, buf);
      };
    };
  };

  // Helper: paginate an index buffer in reverse chronological order
  func paginateReverseIds(indexBuf : Buffer.Buffer<Text>, offset : Nat, limit : Nat) : [Text] {
    let all = Buffer.toArray(indexBuf);
    let total = all.size();
    if (offset >= total) { return [] };
    let end = Nat.min(offset + limit, total);
    let count = end - offset;
    let result = Buffer.Buffer<Text>(count);
    var i = total - 1 - offset;
    var added : Nat = 0;
    label fetchLoop while (added < count) {
      result.add(all[i]);
      added += 1;
      if (i == 0) { break fetchLoop };
      i -= 1;
    };
    Buffer.toArray(result);
  };

  // Helper: update a StakeRecord with new status/counts
  func putStakeUpdate(stakeId : Text, stake : Types.StakeRecord, status : Types.StakeStatus, validCount : Nat, flagCnt : Nat, resolved : ?Int) {
    stakes.put(stakeId, {
      id = stake.id;
      owner = stake.owner;
      signalId = stake.signalId;
      amount = stake.amount;
      status = status;
      validationCount = validCount;
      flagCount = flagCnt;
      createdAt = stake.createdAt;
      resolvedAt = resolved;
    });
  };

  func ensureProfile(caller : Principal) : Types.UserProfile {
    switch (profiles.get(caller)) {
      case (?p) { p };
      case null {
        let newProfile : Types.UserProfile = {
          principal = caller;
          displayName = null;
          createdAt = Time.now();
          totalEvaluations = 0;
          totalQuality = 0;
          totalSlop = 0;
        };
        profiles.put(caller, newProfile);
        newProfile;
      };
    };
  };

  // ──────────────────────────────────────
  // Query methods
  // ──────────────────────────────────────

  public query func getProfile(p : Principal) : async ?Types.UserProfile {
    profiles.get(p);
  };

  public query func getEvaluation(id : Text) : async ?Types.ContentEvaluation {
    evaluations.get(id);
  };

  public query func getUserEvaluations(p : Principal, offset : Nat, limit : Nat) : async [Types.ContentEvaluation] {
    switch (ownerIndex.get(p)) {
      case null { [] };
      case (?buf) {
        let ids = paginateReverseIds(buf, offset, limit);
        let result = Buffer.Buffer<Types.ContentEvaluation>(ids.size());
        for (id in ids.vals()) {
          switch (evaluations.get(id)) { case (?e) { result.add(e) }; case null {} };
        };
        Buffer.toArray(result);
      };
    };
  };

  public query func getUserAnalytics(p : Principal) : async Types.AnalyticsResult {
    let profile = switch (profiles.get(p)) {
      case (?pr) { pr };
      case null {
        return {
          totalEvaluations = 0;
          totalQuality = 0;
          totalSlop = 0;
          averageComposite = 0.0;
          recentCount7d = 0;
        };
      };
    };

    let sevenDaysAgo = Time.now() - 7 * 24 * 3600 * 1_000_000_000;
    var compositeSum : Float = 0.0;
    var count : Nat = 0;
    var recentCount : Nat = 0;

    switch (ownerIndex.get(p)) {
      case null {};
      case (?buf) {
        for (id in buf.vals()) {
          switch (evaluations.get(id)) {
            case (?eval) {
              compositeSum += eval.scores.compositeScore;
              count += 1;
              if (eval.createdAt >= sevenDaysAgo) {
                recentCount += 1;
              };
            };
            case null {};
          };
        };
      };
    };

    let avgComposite = if (count > 0) { compositeSum / Float.fromInt(count) } else { 0.0 };

    {
      totalEvaluations = profile.totalEvaluations;
      totalQuality = profile.totalQuality;
      totalSlop = profile.totalSlop;
      averageComposite = avgComposite;
      recentCount7d = recentCount;
    };
  };

  // ──────────────────────────────────────
  // Update methods
  // ──────────────────────────────────────

  public shared(msg) func saveEvaluation(eval : Types.ContentEvaluation) : async Text {
    let caller = msg.caller;
    assert(requireAuth(caller));

    let isNew = evaluations.get(eval.id) == null;

    let tagged : Types.ContentEvaluation = {
      id = eval.id;
      owner = caller;
      author = eval.author;
      avatar = eval.avatar;
      text = eval.text;
      source = eval.source;
      sourceUrl = eval.sourceUrl;
      imageUrl = eval.imageUrl;
      scores = eval.scores;
      verdict = eval.verdict;
      reason = eval.reason;
      createdAt = if (eval.createdAt == 0) { Time.now() } else { eval.createdAt };
      validated = eval.validated;
      flagged = eval.flagged;
      validatedAt = eval.validatedAt;
    };

    evaluations.put(tagged.id, tagged);

    if (isNew) {
      addToPrincipalIndex(ownerIndex, caller, tagged.id);
    };

    if (isNew) {
      let profile = ensureProfile(caller);
      let updatedProfile : Types.UserProfile = {
        principal = profile.principal;
        displayName = profile.displayName;
        createdAt = profile.createdAt;
        totalEvaluations = profile.totalEvaluations + 1;
        totalQuality = switch (tagged.verdict) {
          case (#quality) { profile.totalQuality + 1 };
          case (#slop) { profile.totalQuality };
        };
        totalSlop = switch (tagged.verdict) {
          case (#slop) { profile.totalSlop + 1 };
          case (#quality) { profile.totalSlop };
        };
      };
      profiles.put(caller, updatedProfile);
    };

    tagged.id;
  };

  public shared(msg) func updateEvaluation(id : Text, validated : Bool, flagged : Bool) : async Bool {
    let caller = msg.caller;
    assert(requireAuth(caller));

    switch (evaluations.get(id)) {
      case null { false };
      case (?existing) {
        if (not Principal.equal(existing.owner, caller)) { return false };

        let newValidatedAt : ?Int = if (validated and not existing.validated) {
          ?Time.now()
        } else if (not validated) {
          null
        } else {
          existing.validatedAt
        };

        let updated : Types.ContentEvaluation = {
          id = existing.id;
          owner = existing.owner;
          author = existing.author;
          avatar = existing.avatar;
          text = existing.text;
          source = existing.source;
          sourceUrl = existing.sourceUrl;
          imageUrl = existing.imageUrl;
          scores = existing.scores;
          verdict = if (flagged and not existing.flagged) {
            #slop
          } else {
            existing.verdict
          };
          reason = existing.reason;
          createdAt = existing.createdAt;
          validated = validated;
          flagged = flagged;
          validatedAt = newValidatedAt;
        };
        evaluations.put(id, updated);
        true;
      };
    };
  };

  public shared(msg) func batchSaveEvaluations(evals : [Types.ContentEvaluation]) : async Nat {
    let caller = msg.caller;
    assert(requireAuth(caller));

    var saved : Nat = 0;
    var newCount : Nat = 0;
    var newQuality : Nat = 0;
    var newSlop : Nat = 0;
    for (eval in evals.vals()) {
      let isNew = evaluations.get(eval.id) == null;

      let tagged : Types.ContentEvaluation = {
        id = eval.id;
        owner = caller;
        author = eval.author;
        avatar = eval.avatar;
        text = eval.text;
        source = eval.source;
        sourceUrl = eval.sourceUrl;
        imageUrl = eval.imageUrl;
        scores = eval.scores;
        verdict = eval.verdict;
        reason = eval.reason;
        createdAt = if (eval.createdAt == 0) { Time.now() } else { eval.createdAt };
        validated = eval.validated;
        flagged = eval.flagged;
        validatedAt = eval.validatedAt;
      };

      evaluations.put(tagged.id, tagged);

      if (isNew) {
        addToPrincipalIndex(ownerIndex, caller, tagged.id);
        newCount += 1;
        switch (eval.verdict) {
          case (#quality) { newQuality += 1 };
          case (#slop) { newSlop += 1 };
        };
      };

      saved += 1;
    };

    if (newCount > 0) {
      let profile = ensureProfile(caller);
      let updatedProfile : Types.UserProfile = {
        principal = profile.principal;
        displayName = profile.displayName;
        createdAt = profile.createdAt;
        totalEvaluations = profile.totalEvaluations + newCount;
        totalQuality = profile.totalQuality + newQuality;
        totalSlop = profile.totalSlop + newSlop;
      };
      profiles.put(caller, updatedProfile);
    };

    saved;
  };

  public shared(msg) func updateDisplayName(name : Text) : async Bool {
    let caller = msg.caller;
    assert(requireAuth(caller));

    let profile = ensureProfile(caller);
    let updated : Types.UserProfile = {
      principal = profile.principal;
      displayName = ?name;
      createdAt = profile.createdAt;
      totalEvaluations = profile.totalEvaluations;
      totalQuality = profile.totalQuality;
      totalSlop = profile.totalSlop;
    };
    profiles.put(caller, updated);
    true;
  };

  // ──────────────────────────────────────
  // Source Config methods
  // ──────────────────────────────────────

  public shared(msg) func saveSourceConfig(config : Types.SourceConfigEntry) : async Text {
    let caller = msg.caller;
    assert(requireAuth(caller));

    let tagged : Types.SourceConfigEntry = {
      id = config.id;
      owner = caller;
      sourceType = config.sourceType;
      configJson = config.configJson;
      enabled = config.enabled;
      createdAt = if (config.createdAt == 0) { Time.now() } else { config.createdAt };
    };
    sourceConfigs.put(tagged.id, tagged);
    tagged.id;
  };

  public query func getUserSourceConfigs(p : Principal) : async [Types.SourceConfigEntry] {
    let result = Buffer.Buffer<Types.SourceConfigEntry>(4);
    for ((_, config) in sourceConfigs.entries()) {
      if (Principal.equal(config.owner, p)) {
        result.add(config);
      };
    };
    Buffer.toArray(result);
  };

  public query func getSourceConfigStats() : async { total: Nat; owners: [Principal] } {
    let ownerSet = HashMap.HashMap<Principal, Bool>(4, Principal.equal, Principal.hash);
    for ((_, config) in sourceConfigs.entries()) {
      ownerSet.put(config.owner, true);
    };
    let ownerBuf = Buffer.Buffer<Principal>(ownerSet.size());
    for ((p, _) in ownerSet.entries()) {
      ownerBuf.add(p);
    };
    { total = sourceConfigs.size(); owners = Buffer.toArray(ownerBuf) };
  };

  public shared(msg) func deleteSourceConfig(id : Text) : async Bool {
    let caller = msg.caller;
    assert(requireAuth(caller));

    switch (sourceConfigs.get(id)) {
      case null { false };
      case (?config) {
        if (not Principal.equal(config.owner, caller)) { return false };
        sourceConfigs.delete(id);
        true;
      };
    };
  };

  // ──────────────────────────────────────
  // Signal Publishing methods
  // ──────────────────────────────────────

  public shared(msg) func saveSignal(signal : Types.PublishedSignal) : async Text {
    let caller = msg.caller;
    assert(requireAuth(caller));

    let tagged : Types.PublishedSignal = {
      id = signal.id;
      owner = caller;
      text = signal.text;
      nostrEventId = signal.nostrEventId;
      nostrPubkey = signal.nostrPubkey;
      scores = signal.scores;
      verdict = signal.verdict;
      topics = signal.topics;
      createdAt = if (signal.createdAt == 0) { Time.now() } else { signal.createdAt };
    };

    signals.put(tagged.id, tagged);
    addToPrincipalIndex(signalOwnerIndex, caller, tagged.id);
    tagged.id;
  };

  public query func getUserSignals(p : Principal, offset : Nat, limit : Nat) : async [Types.PublishedSignal] {
    switch (signalOwnerIndex.get(p)) {
      case null { [] };
      case (?buf) {
        let ids = paginateReverseIds(buf, offset, limit);
        let result = Buffer.Buffer<Types.PublishedSignal>(ids.size());
        for (id in ids.vals()) {
          switch (signals.get(id)) { case (?s) { result.add(s) }; case null {} };
        };
        Buffer.toArray(result);
      };
    };
  };

  // ──────────────────────────────────────
  // Staking / Reputation methods
  // ──────────────────────────────────────

  func ensureReputation(p : Principal) : Types.UserReputation {
    switch (reputations.get(p)) {
      case (?r) { r };
      case null {
        let rep : Types.UserReputation = {
          principal = p;
          trustScore = 5.0; // Start at neutral
          totalStaked = 0;
          totalReturned = 0;
          totalSlashed = 0;
          qualitySignals = 0;
          slopSignals = 0;
        };
        reputations.put(p, rep);
        rep;
      };
    };
  };

  func computeTrustScore(quality : Nat, slop : Nat) : Float {
    let total = quality + slop;
    if (total == 0) { return 5.0 };
    let qualityRatio = Float.fromInt(quality) / Float.fromInt(total);
    let raw = 5.0 + qualityRatio * 5.0;
    if (raw > 10.0) { 10.0 } else if (raw < 0.0) { 0.0 } else { raw };
  };

  // Helper: update reputation after stake resolution
  func resolveReputation(owner : Principal, qualityDelta : Nat, slopDelta : Nat, returnedDelta : Nat, slashedDelta : Nat) {
    let rep = ensureReputation(owner);
    let q = rep.qualitySignals + qualityDelta;
    let s = rep.slopSignals + slopDelta;
    reputations.put(owner, {
      principal = rep.principal;
      trustScore = computeTrustScore(q, s);
      totalStaked = rep.totalStaked;
      totalReturned = rep.totalReturned + returnedDelta;
      totalSlashed = rep.totalSlashed + slashedDelta;
      qualitySignals = q;
      slopSignals = s;
    });
  };

  // ──────────────────────────────────────
  // Non-custodial revenue distribution
  // ──────────────────────────────────────

  /// Convert a Principal to a 32-byte subaccount (for CMC top-up addressing).
  func principalToSubaccount(p : Principal) : Blob {
    let pb = Blob.toArray(Principal.toBlob(p));
    let sub = Array.init<Nat8>(32, 0 : Nat8);
    sub[0] := Nat8.fromNat(pb.size());
    var i = 0;
    while (i < pb.size()) { sub[i + 1] := pb[i]; i += 1 };
    Blob.fromArray(Array.freeze(sub));
  };

  /// Distribute protocol revenue: if cycles are low, convert ICP to cycles via CMC;
  /// otherwise send ICP to the hardcoded PROTOCOL_WALLET.
  func distributeProtocolRevenue(amount : Nat) : async () {
    let net = if (amount > ICP_FEE) { amount - ICP_FEE } else { 0 };
    if (net == 0) return;

    if (ExperimentalCycles.balance() < CYCLES_THRESHOLD) {
      // Cycles low → convert this revenue to cycles via CMC
      try {
        let xferResult = await ICP_LEDGER.icrc1_transfer({
          from_subaccount = null;
          to = { owner = Principal.fromText("rkp4c-7iaaa-aaaaa-aaaca-cai");
                 subaccount = ?principalToSubaccount(Principal.fromActor(AegisBackend)) };
          amount = net;
          fee = ?ICP_FEE;
          memo = ?TPUP_MEMO;
          created_at_time = null;
        });
        switch (xferResult) {
          case (#Ok(blockIdx)) {
            ignore await CMC.notify_top_up({
              block_index = Nat64.fromNat(blockIdx);
              canister_id = Principal.fromActor(AegisBackend);
            });
          };
          case (#Err(_)) {}; // Transfer failed; funds stay for sweepProtocolFees
        };
      } catch (e) {
        Debug.print("[canister] distributeProtocolRevenue cycles top-up failed: " # Error.message(e));
      };
    } else {
      // Cycles sufficient → send to protocol wallet
      try {
        ignore await ICP_LEDGER.icrc1_transfer({
          from_subaccount = null;
          to = { owner = PROTOCOL_WALLET; subaccount = null };
          amount = net;
          fee = ?ICP_FEE;
          memo = null;
          created_at_time = null;
        });
      } catch (e) {
        Debug.print("[canister] distributeProtocolRevenue wallet transfer failed: " # Error.message(e));
      };
    };
  };

  /// Publish a signal with ICP stake attached.
  /// The caller must have previously approved this canister to transfer `stakeAmount` via icrc2_approve.
  public shared(msg) func publishWithStake(signal : Types.PublishedSignal, stakeAmount : Nat) : async Result.Result<Text, Text> {
    let caller = msg.caller;
    assert(requireAuth(caller));

    if (stakeAmount < MIN_STAKE) {
      return #err("Stake too low: minimum is " # Nat.toText(MIN_STAKE) # " e8s (0.001 ICP)");
    };
    if (stakeAmount > MAX_STAKE) {
      return #err("Stake too high: maximum is " # Nat.toText(MAX_STAKE) # " e8s (1.0 ICP)");
    };

    // Pre-debit: create records before async call (reentrancy guard)
    let stakeId = signal.id # "-stake";

    let stakeRecord : Types.StakeRecord = {
      id = stakeId;
      owner = caller;
      signalId = signal.id;
      amount = stakeAmount;
      status = #active;
      validationCount = 0;
      flagCount = 0;
      createdAt = Time.now();
      resolvedAt = null;
    };
    stakes.put(stakeId, stakeRecord);
    signalStakeIndex.put(signal.id, stakeId);

    // Update reputation counters
    let rep = ensureReputation(caller);
    let updatedRep : Types.UserReputation = {
      principal = rep.principal;
      trustScore = rep.trustScore;
      totalStaked = rep.totalStaked + stakeAmount;
      totalReturned = rep.totalReturned;
      totalSlashed = rep.totalSlashed;
      qualitySignals = rep.qualitySignals;
      slopSignals = rep.slopSignals;
    };
    reputations.put(caller, updatedRep);

    // Transfer ICP from caller to this canister via ICRC-2
    let transferResult = try {
      await ICP_LEDGER.icrc2_transfer_from({
        spender_subaccount = null;
        from = { owner = caller; subaccount = null };
        to = { owner = Principal.fromActor(AegisBackend); subaccount = null };
        amount = stakeAmount;
        fee = ?ICP_FEE;
        memo = null;
        created_at_time = null;
      });
    } catch (e) {
      Debug.print("[canister] publishWithStake transfer_from failed: " # Error.message(e));
      // Rollback: remove pre-debited records
      stakes.delete(stakeId);
      signalStakeIndex.delete(signal.id);
      reputations.put(caller, rep); // restore original
      return #err("Ledger transfer_from failed");
    };

    switch (transferResult) {
      case (#Err(err)) {
        // Rollback
        stakes.delete(stakeId);
        signalStakeIndex.delete(signal.id);
        reputations.put(caller, rep);
        let errMsg = switch (err) {
          case (#InsufficientFunds(_)) { "Insufficient ICP balance" };
          case (#InsufficientAllowance(_)) { "Insufficient allowance — approve first" };
          case (#BadFee(_)) { "Bad fee" };
          case (_) { "Transfer failed" };
        };
        return #err(errMsg);
      };
      case (#Ok(_)) {};
    };

    // Save the signal (same logic as saveSignal)
    let tagged : Types.PublishedSignal = {
      id = signal.id;
      owner = caller;
      text = signal.text;
      nostrEventId = signal.nostrEventId;
      nostrPubkey = signal.nostrPubkey;
      scores = signal.scores;
      verdict = signal.verdict;
      topics = signal.topics;
      createdAt = if (signal.createdAt == 0) { Time.now() } else { signal.createdAt };
    };
    signals.put(tagged.id, tagged);
    addToPrincipalIndex(signalOwnerIndex, caller, tagged.id);
    #ok(tagged.id);
  };

  /// Community validate: vote that a staked signal is quality.
  /// When validationCount reaches threshold, stake is returned to owner.
  public shared(msg) func validateSignal(signalId : Text) : async Result.Result<Bool, Text> {
    let caller = msg.caller;
    assert(requireAuth(caller));

    // Find the stake for this signal
    let stakeId = switch (signalStakeIndex.get(signalId)) {
      case (?id) { id };
      case null { return #err("No stake found for this signal") };
    };
    let stake = switch (stakes.get(stakeId)) {
      case (?s) { s };
      case null { return #err("Stake record not found") };
    };

    // Cannot vote on your own signal
    if (Principal.equal(caller, stake.owner)) {
      return #err("Cannot validate your own signal");
    };

    // Check stake is still active
    switch (stake.status) {
      case (#active) {};
      case (_) { return #err("Stake already resolved") };
    };

    // Prevent double-voting
    switch (signalVoters.get(signalId)) {
      case (?voters) {
        for (v in voters.vals()) {
          if (Principal.equal(v, caller)) {
            return #err("Already voted on this signal");
          };
        };
        voters.add(caller);
      };
      case null {
        let buf = Buffer.Buffer<Principal>(4);
        buf.add(caller);
        signalVoters.put(signalId, buf);
      };
    };

    let newCount = stake.validationCount + 1;

    if (newCount < VALIDATE_THRESHOLD) {
      putStakeUpdate(stakeId, stake, #active, newCount, stake.flagCount, null);
      return #ok(false);
    };

    // Threshold reached: return stake to owner (pre-debit pattern)
    putStakeUpdate(stakeId, stake, #returned, newCount, stake.flagCount, ?Time.now());

    let returnAmount = if (stake.amount > ICP_FEE) { stake.amount - ICP_FEE } else { 0 };
    var transferOk = true;
    if (returnAmount > 0) {
      let transferResult = try {
        await ICP_LEDGER.icrc1_transfer({
          from_subaccount = null;
          to = { owner = stake.owner; subaccount = null };
          amount = returnAmount;
          fee = ?ICP_FEE;
          memo = null;
          created_at_time = null;
        });
      } catch (e) {
        Debug.print("[canister] validateSignal stake return failed: " # Error.message(e));
        transferOk := false;
        putStakeUpdate(stakeId, stake, #active, newCount, stake.flagCount, null);
        #Err(#TemporarilyUnavailable);
      };
      switch (transferResult) {
        case (#Err(_)) {
          if (transferOk) {
            transferOk := false;
            putStakeUpdate(stakeId, stake, #active, newCount, stake.flagCount, null);
          };
        };
        case (#Ok(_)) {};
      };
    };

    if (transferOk) {
      resolveReputation(stake.owner, 1, 0, stake.amount, 0);
    };

    #ok(true);
  };

  /// Community flag: vote that a staked signal is low quality.
  /// When flagCount reaches threshold, deposit is forfeited (auto-distributed).
  public shared(msg) func flagSignal(signalId : Text) : async Result.Result<Bool, Text> {
    let caller = msg.caller;
    assert(requireAuth(caller));

    let stakeId = switch (signalStakeIndex.get(signalId)) {
      case (?id) { id };
      case null { return #err("No stake found for this signal") };
    };
    let stake = switch (stakes.get(stakeId)) {
      case (?s) { s };
      case null { return #err("Stake record not found") };
    };

    if (Principal.equal(caller, stake.owner)) {
      return #err("Cannot flag your own signal");
    };

    switch (stake.status) {
      case (#active) {};
      case (_) { return #err("Stake already resolved") };
    };

    // Prevent double-voting
    switch (signalVoters.get(signalId)) {
      case (?voters) {
        for (v in voters.vals()) {
          if (Principal.equal(v, caller)) {
            return #err("Already voted on this signal");
          };
        };
        voters.add(caller);
      };
      case null {
        let buf = Buffer.Buffer<Principal>(4);
        buf.add(caller);
        signalVoters.put(signalId, buf);
      };
    };

    let newCount = stake.flagCount + 1;

    if (newCount < FLAG_THRESHOLD) {
      putStakeUpdate(stakeId, stake, #active, stake.validationCount, newCount, null);
      return #ok(false);
    };

    // Threshold reached: forfeit stake (auto-distribute to protocol wallet or cycles)
    putStakeUpdate(stakeId, stake, #slashed, stake.validationCount, newCount, ?Time.now());
    resolveReputation(stake.owner, 0, 1, 0, stake.amount);

    // Auto-distribute forfeited deposit
    await distributeProtocolRevenue(stake.amount);

    #ok(true);
  };

  /// Get a user's reputation profile (query-safe: no state mutation)
  public query func getUserReputation(p : Principal) : async Types.UserReputation {
    switch (reputations.get(p)) {
      case (?r) { r };
      case null {
        { principal = p; trustScore = 5.0; totalStaked = 0; totalReturned = 0; totalSlashed = 0; qualitySignals = 0; slopSignals = 0 };
      };
    };
  };

  /// Get the stake record for a signal
  public query func getSignalStake(signalId : Text) : async ?Types.StakeRecord {
    switch (signalStakeIndex.get(signalId)) {
      case (?stakeId) { stakes.get(stakeId) };
      case null { null };
    };
  };

  // ──────────────────────────────────────
  // D2A Precision Match Fee
  // ──────────────────────────────────────

  /// Record a D2A match and collect fee from receiver.
  /// Fee split: 80% to content provider, 20% auto-distributed (cycles top-up or protocol wallet).
  /// The receiver must have icrc2_approved this canister before calling.
  public shared(msg) func recordD2AMatch(
    matchId : Text,
    senderPrincipal : Principal,
    contentHash : Text,
    feeAmount : Nat
  ) : async Result.Result<Text, Text> {
    let caller = msg.caller;
    assert(requireAuth(caller));

    if (feeAmount < ICP_FEE * 3) {
      return #err("Fee too low to cover transfer costs");
    };

    // Calculate split: 80% sender, 20% protocol
    let senderPayout = (feeAmount * 80) / 100;
    let protocolPayout = feeAmount - senderPayout;

    // Transfer fee from receiver (caller) to this canister first
    let transferResult = try {
      await ICP_LEDGER.icrc2_transfer_from({
        spender_subaccount = null;
        from = { owner = caller; subaccount = null };
        to = { owner = Principal.fromActor(AegisBackend); subaccount = null };
        amount = feeAmount;
        fee = ?ICP_FEE;
        memo = null;
        created_at_time = null;
      });
    } catch (e) {
      Debug.print("[canister] recordD2AMatch fee collection failed: " # Error.message(e));
      return #err("Fee collection failed");
    };

    switch (transferResult) {
      case (#Err(_)) {
        return #err("Insufficient funds or allowance for D2A fee");
      };
      case (#Ok(_)) {};
    };

    // Transfer succeeded: now create record and index
    let record : Types.D2AMatchRecord = {
      id = matchId;
      senderPrincipal = senderPrincipal;
      receiverPrincipal = caller;
      contentHash = contentHash;
      feeAmount = feeAmount;
      senderPayout = senderPayout;
      protocolPayout = protocolPayout;
      createdAt = Time.now();
    };
    d2aMatches.put(matchId, record);

    for (p in [senderPrincipal, caller].vals()) {
      addToPrincipalIndex(d2aOwnerIndex, p, matchId);
    };

    // Pay sender their 80% share (minus transfer fee)
    let senderNet = if (senderPayout > ICP_FEE) { senderPayout - ICP_FEE } else { 0 };
    if (senderNet > 0) {
      try {
        let _r = await ICP_LEDGER.icrc1_transfer({
          from_subaccount = null;
          to = { owner = senderPrincipal; subaccount = null };
          amount = senderNet;
          fee = ?ICP_FEE;
          memo = null;
          created_at_time = null;
        });
      } catch (e) {
        // Sender payout failed; funds remain in canister for sweepProtocolFees
        Debug.print("[canister] recordD2AMatch sender payout failed: " # Error.message(e));
      };
    };

    // Distribute protocol's 20% share (cycles top-up or protocol wallet)
    await distributeProtocolRevenue(protocolPayout);

    #ok(matchId);
  };

  /// Get D2A match history for a user (as sender or receiver)
  public query func getUserD2AMatches(p : Principal, offset : Nat, limit : Nat) : async [Types.D2AMatchRecord] {
    switch (d2aOwnerIndex.get(p)) {
      case null { [] };
      case (?buf) {
        let ids = paginateReverseIds(buf, offset, limit);
        let result = Buffer.Buffer<Types.D2AMatchRecord>(ids.size());
        for (id in ids.vals()) {
          switch (d2aMatches.get(id)) { case (?m) { result.add(m) }; case null {} };
        };
        Buffer.toArray(result);
      };
    };
  };

  // ──────────────────────────────────────
  // Engagement Index
  // ──────────────────────────────────────

  /// E_index = (Validations / Total_Reach) * Avg_Composite_of_Signals
  /// Measures how effectively a user's signals engage the community.
  public query func getEngagementIndex(p : Principal) : async Float {
    // Count validated signals and total signals with stakes
    var totalSignals : Nat = 0;
    var validatedCount : Nat = 0;
    var compositeSum : Float = 0.0;

    switch (signalOwnerIndex.get(p)) {
      case null { return 0.0 };
      case (?buf) {
        for (signalId in buf.vals()) {
          switch (signals.get(signalId)) {
            case (?signal) {
              totalSignals += 1;
              compositeSum += signal.scores.compositeScore;

              // Check if this signal's stake was returned (= validated)
              switch (signalStakeIndex.get(signalId)) {
                case (?stakeId) {
                  switch (stakes.get(stakeId)) {
                    case (?stake) {
                      switch (stake.status) {
                        case (#returned) { validatedCount += 1 };
                        case (_) {};
                      };
                    };
                    case null {};
                  };
                };
                case null {};
              };
            };
            case null {};
          };
        };
      };
    };

    if (totalSignals == 0) { return 0.0 };

    let validationRatio = Float.fromInt(validatedCount) / Float.fromInt(totalSignals);
    let avgComposite = compositeSum / Float.fromInt(totalSignals);

    // E_index = validationRatio * avgComposite (0-10 scale)
    validationRatio * avgComposite;
  };

  // ──────────────────────────────────────
  // Push Notification Subscriptions
  // ──────────────────────────────────────

  let MAX_PUSH_SUBS_PER_USER : Nat = 5;

  public shared(msg) func registerPushSubscription(
    endpoint : Text, p256dh : Text, auth : Text
  ) : async Bool {
    let caller = msg.caller;
    if (not requireAuth(caller)) { return false };

    let newSub : Types.PushSubscription = {
      endpoint = endpoint;
      keys = { p256dh = p256dh; auth = auth };
      createdAt = Time.now();
    };

    switch (pushSubscriptions.get(caller)) {
      case (?existing) {
        // Deduplicate by endpoint
        let filtered = Array.filter<Types.PushSubscription>(
          existing, func(s) { s.endpoint != endpoint }
        );
        let updated = Array.append<Types.PushSubscription>(filtered, [newSub]);
        // Keep most recent MAX entries
        let limited = if (updated.size() > MAX_PUSH_SUBS_PER_USER) {
          Array.tabulate<Types.PushSubscription>(
            MAX_PUSH_SUBS_PER_USER,
            func(i) { updated[updated.size() - MAX_PUSH_SUBS_PER_USER + i] }
          );
        } else { updated };
        pushSubscriptions.put(caller, limited);
      };
      case null {
        pushSubscriptions.put(caller, [newSub]);
      };
    };
    true;
  };

  public shared(msg) func unregisterPushSubscription(endpoint : Text) : async Bool {
    let caller = msg.caller;
    if (not requireAuth(caller)) { return false };

    switch (pushSubscriptions.get(caller)) {
      case (?existing) {
        let filtered = Array.filter<Types.PushSubscription>(
          existing, func(s) { s.endpoint != endpoint }
        );
        if (filtered.size() == 0) {
          pushSubscriptions.delete(caller);
        } else {
          pushSubscriptions.put(caller, filtered);
        };
        true;
      };
      case null { false };
    };
  };

  public query func getPushSubscriptions(user : Principal) : async [Types.PushSubscription] {
    switch (pushSubscriptions.get(user)) {
      case (?subs) { subs };
      case null { [] };
    };
  };

  // Called from Vercel API route to clean up expired subscriptions (410/404)
  // NOTE: No auth check — server calls with anonymous identity.
  // Risk: push-notification DoS only (no data leak). Proper fix requires
  // server-side identity + controller check.
  public shared func removePushSubscriptions(
    user : Principal, endpoints : [Text]
  ) : async Bool {
    switch (pushSubscriptions.get(user)) {
      case (?existing) {
        let filtered = Array.filter<Types.PushSubscription>(
          existing, func(s) {
            not Array.foldLeft<Text, Bool>(
              endpoints, false, func(found, ep) { found or ep == s.endpoint }
            )
          }
        );
        if (filtered.size() == 0) {
          pushSubscriptions.delete(user);
        } else {
          pushSubscriptions.put(user, filtered);
        };
        true;
      };
      case null { false };
    };
  };

  public query func getPushSubscriptionCount() : async Nat {
    var count : Nat = 0;
    for ((_, subs) in pushSubscriptions.entries()) {
      count += subs.size();
    };
    count;
  };

  // ──────────────────────────────────────
  // Treasury (non-custodial — no operator withdrawal)
  // ──────────────────────────────────────

  /// Sum of all active (pending) deposits — these funds must be reserved
  /// for potential returns and must NOT be distributed.
  func calcActiveStakeTotal() : Nat {
    var total : Nat = 0;
    for ((_, stake) in stakes.entries()) {
      switch (stake.status) {
        case (#active) { total += stake.amount };
        case (_) {};
      };
    };
    total;
  };

  /// Get the canister's total ICP balance (transparency).
  public shared func getTreasuryBalance() : async Nat {
    await ICP_LEDGER.icrc1_balance_of({
      owner = Principal.fromActor(AegisBackend);
      subaccount = null;
    });
  };

  /// Sweep any accumulated surplus to protocol wallet or cycles.
  /// Anyone can call this — no controller restriction.
  public shared func sweepProtocolFees() : async Result.Result<Text, Text> {
    let totalBalance = await ICP_LEDGER.icrc1_balance_of({
      owner = Principal.fromActor(AegisBackend); subaccount = null;
    });
    let reserved = calcActiveStakeTotal();
    let surplus = if (totalBalance > reserved + ICP_FEE) { totalBalance - reserved - ICP_FEE } else { 0 };
    if (surplus == 0) { return #err("No surplus to sweep") };
    await distributeProtocolRevenue(surplus + ICP_FEE);
    #ok("Processed " # Nat.toText(surplus) # " e8s surplus");
  };

  /// Alias for sweepProtocolFees — kept for backward compatibility.
  public shared func topUpCycles() : async Result.Result<Text, Text> {
    await sweepProtocolFees();
  };

  /// Return deposits that have been active for longer than DEPOSIT_EXPIRY_NS (30 days).
  /// "No community verdict = no issue found" — deposit returned automatically.
  func resolveExpiredDeposits() : async () {
    let now = Time.now();
    let expired = Buffer.Buffer<(Text, Types.StakeRecord)>(8);
    for ((stakeId, stake) in stakes.entries()) {
      switch (stake.status) {
        case (#active) {
          if (now - stake.createdAt > DEPOSIT_EXPIRY_NS) {
            expired.add((stakeId, stake));
          };
        };
        case (_) {};
      };
    };
    for ((stakeId, stake) in expired.vals()) {
      putStakeUpdate(stakeId, stake, #returned, stake.validationCount, stake.flagCount, ?now);
      let returnAmount = if (stake.amount > ICP_FEE) { stake.amount - ICP_FEE } else { 0 };
      if (returnAmount > 0) {
        try {
          let result = await ICP_LEDGER.icrc1_transfer({
            from_subaccount = null;
            to = { owner = stake.owner; subaccount = null };
            amount = returnAmount;
            fee = ?ICP_FEE;
            memo = null;
            created_at_time = null;
          });
          switch (result) {
            case (#Ok(_)) {
              resolveReputation(stake.owner, 1, 0, stake.amount, 0);
            };
            case (#Err(_)) {
              // Revert to active so next maintenance cycle retries
              putStakeUpdate(stakeId, stake, #active, stake.validationCount, stake.flagCount, null);
            };
          };
        } catch (e) {
          Debug.print("[canister] resolveExpiredDeposits return failed: " # Error.message(e));
          putStakeUpdate(stakeId, stake, #active, stake.validationCount, stake.flagCount, null);
        };
      };
    };
  };

  // Monthly maintenance timer: sweep surplus, return expired deposits & top-up cycles every 30 days
  func monthlyMaintenance() : async () {
    // 1. Return expired deposits (30+ days without community verdict)
    await resolveExpiredDeposits();

    // 2. Sweep surplus to protocol wallet or cycles
    let totalBalance = await ICP_LEDGER.icrc1_balance_of({
      owner = Principal.fromActor(AegisBackend); subaccount = null;
    });
    let reserved = calcActiveStakeTotal();
    let surplus = if (totalBalance > reserved + ICP_FEE) { totalBalance - reserved - ICP_FEE } else { 0 };
    if (surplus > 0) {
      await distributeProtocolRevenue(surplus + ICP_FEE);
    };
  };

  ignore Timer.recurringTimer<system>(#seconds(30 * 24 * 60 * 60), monthlyMaintenance);

  // ──────────────────────────────────────
  // IC LLM Analysis (on-chain scoring)
  // ──────────────────────────────────────

  func buildScoringPrompt(text : Text, userTopics : [Text]) : Text {
    let contentSlice = if (Text.size(text) > 3000) {
      // Take first 3000 chars (IC LLM has smaller context than Claude)
      var result = "";
      var count = 0;
      label charLoop for (c in text.chars()) {
        if (count >= 3000) break charLoop;
        result #= Text.fromChar(c);
        count += 1;
      };
      result;
    } else { text };

    let topicsStr = if (userTopics.size() > 0) {
      Text.join(", ", userTopics.vals());
    } else { "general" };

    "You are a content quality evaluator. Score this content.\n\n" #
    "User interests: " # topicsStr # "\n\n" #
    "Score each 0-10:\n" #
    "- originality: Novel or rehashed?\n" #
    "- insight: Deep analysis or surface-level?\n" #
    "- credibility: Reliable sourcing?\n" #
    "- vSignal: Information density & novelty\n" #
    "- cContext: Relevance to user interests\n" #
    "- lSlop: Clickbait/engagement farming (higher = more slop)\n\n" #
    "Content: \"" # contentSlice # "\"\n\n" #
    "Respond ONLY in JSON: {\"originality\":N,\"insight\":N,\"credibility\":N,\"vSignal\":N,\"cContext\":N,\"lSlop\":N,\"composite\":N.N,\"verdict\":\"quality\"|\"slop\",\"reason\":\"brief\",\"topics\":[\"tag1\"]}";
  };

  func clampNat8(n : Int) : Nat8 {
    let clamped = if (n < 0) { 0 } else if (n > 10) { 10 } else { Int.abs(n) };
    Nat8.fromNat(clamped);
  };

  func parseAnalysisResponse(raw : Text) : Result.Result<Types.OnChainAnalysis, Text> {
    // Strip markdown code fences if present
    let cleaned = Text.replace(raw, #text "```json", "");
    let cleaned2 = Text.replace(cleaned, #text "```", "");
    let isWhitespace = func(c : Char) : Bool { c == ' ' or c == '\n' or c == '\r' or c == '\t' };
    let trimmed = Text.trimStart(Text.trimEnd(cleaned2, #predicate isWhitespace), #predicate isWhitespace);

    switch (Json.parse(trimmed)) {
      case (#err(e)) { #err("JSON parse failed: " # Json.errToText(e)) };
      case (#ok(json)) {
        let originality = switch (Json.getAsInt(json, "originality")) {
          case (#ok(v)) { clampNat8(v) };
          case (#err(_)) { 5 : Nat8 };
        };
        let insight = switch (Json.getAsInt(json, "insight")) {
          case (#ok(v)) { clampNat8(v) };
          case (#err(_)) { 5 : Nat8 };
        };
        let credibility = switch (Json.getAsInt(json, "credibility")) {
          case (#ok(v)) { clampNat8(v) };
          case (#err(_)) { 5 : Nat8 };
        };
        let compositeScore = switch (Json.getAsFloat(json, "composite")) {
          case (#ok(v)) { v };
          case (#err(_)) {
            // Calculate from sub-scores
            let o = Float.fromInt(Nat8.toNat(originality));
            let i = Float.fromInt(Nat8.toNat(insight));
            let c = Float.fromInt(Nat8.toNat(credibility));
            o * 0.4 + i * 0.35 + c * 0.25;
          };
        };
        let verdictText = switch (Json.getAsText(json, "verdict")) {
          case (#ok(v)) { v };
          case (#err(_)) { if (compositeScore >= 4.0) { "quality" } else { "slop" } };
        };
        let verdict : Types.Verdict = if (verdictText == "quality") { #quality } else { #slop };
        let reason = switch (Json.getAsText(json, "reason")) {
          case (#ok(v)) { v };
          case (#err(_)) { "Scored by IC LLM (Llama 3.1 8B)" };
        };

        // Extract topics array
        let topics = switch (Json.getAsArray(json, "topics")) {
          case (#ok(arr)) {
            let topicBuf = Buffer.Buffer<Text>(arr.size());
            for (item in arr.vals()) {
              switch (item) {
                case (#string(t)) { topicBuf.add(t) };
                case (_) {};
              };
            };
            Buffer.toArray(topicBuf);
          };
          case (#err(_)) { [] : [Text] };
        };

        // V/C/L scores
        let vSignal : ?Nat8 = switch (Json.getAsInt(json, "vSignal")) {
          case (#ok(v)) { ?clampNat8(v) };
          case (#err(_)) { null };
        };
        let cContext : ?Nat8 = switch (Json.getAsInt(json, "cContext")) {
          case (#ok(v)) { ?clampNat8(v) };
          case (#err(_)) { null };
        };
        let lSlop : ?Nat8 = switch (Json.getAsInt(json, "lSlop")) {
          case (#ok(v)) { ?clampNat8(v) };
          case (#err(_)) { null };
        };

        #ok({
          originality = originality;
          insight = insight;
          credibility = credibility;
          compositeScore = compositeScore;
          verdict = verdict;
          reason = reason;
          topics = topics;
          tier = #free;
          vSignal = vSignal;
          cContext = cContext;
          lSlop = lSlop;
        });
      };
    };
  };

  /// Analyze content quality using IC LLM (Llama 3.1 8B).
  /// This is the free-tier scoring endpoint — no API key required.
  public shared(msg) func analyzeOnChain(text : Text, userTopics : [Text]) : async Result.Result<Types.OnChainAnalysis, Text> {
    let caller = msg.caller;
    assert(requireAuth(caller));

    if (Text.size(text) == 0) {
      return #err("Text is required");
    };

    let prompt = buildScoringPrompt(text, userTopics);

    let response = try {
      await LLM.prompt(#Llama3_1_8B, prompt);
    } catch (e) {
      Debug.print("[canister] analyzeOnChain LLM call failed: " # Error.message(e));
      return #err("IC LLM call failed");
    };

    if (Text.size(response) == 0) {
      return #err("IC LLM returned empty response");
    };

    parseAnalysisResponse(response);
  };

  // ──────────────────────────────────────
  // D2A Briefing Snapshots
  // ──────────────────────────────────────

  public shared(msg) func saveLatestBriefing(briefingJson : Text) : async Bool {
    if (not requireAuth(msg.caller)) { return false };
    if (Text.size(briefingJson) > 500_000) { return false }; // 500KB max
    let snapshot : Types.D2ABriefingSnapshot = {
      owner = msg.caller;
      briefingJson = briefingJson;
      generatedAt = Time.now();
    };
    briefings.put(msg.caller, snapshot);
    true;
  };

  public query func getLatestBriefing(p : Principal) : async ?Text {
    switch (briefings.get(p)) {
      case (?snapshot) { ?snapshot.briefingJson };
      case null { null };
    };
  };

  /// Return briefings from all d2aEnabled users, paginated (newest first).
  /// TypeScript caller extracts summary fields from each briefingJson.
  public query func getGlobalBriefingSummaries(offset : Nat, limit : Nat) : async {
    items : [(Principal, Text, Int)];
    total : Nat;
  } {
    let clampedLimit = if (limit > 10) { 10 } else if (limit == 0) { 5 } else { limit };

    let eligible = Buffer.Buffer<(Principal, Types.D2ABriefingSnapshot)>(briefings.size());
    for ((p, snap) in briefings.entries()) {
      switch (userSettings.get(p)) {
        case (?s) { if (s.d2aEnabled) { eligible.add((p, snap)) } };
        case null {};
      };
    };

    let total = eligible.size();

    let sorted = Array.sort<(Principal, Types.D2ABriefingSnapshot)>(
      Buffer.toArray(eligible),
      func(a, b) : Order.Order {
        if (a.1.generatedAt > b.1.generatedAt) { #less }
        else if (a.1.generatedAt < b.1.generatedAt) { #greater }
        else { #equal }
      }
    );

    let start = if (offset >= total) { total } else { offset };
    let end = Nat.min(start + clampedLimit, total);
    let result = Buffer.Buffer<(Principal, Text, Int)>(end - start);
    var i = start;
    while (i < end) {
      let (p, snap) = sorted[i];
      result.add((p, snap.briefingJson, snap.generatedAt));
      i += 1;
    };

    { items = Buffer.toArray(result); total = total };
  };

  // ──────────────────────────────────────
  // User Settings (cross-device sync)
  // ──────────────────────────────────────

  public query func getUserSettings(p : Principal) : async ?Types.UserSettings {
    userSettings.get(p);
  };

  public shared(msg) func saveUserSettings(settings : Types.UserSettings) : async Bool {
    let caller = msg.caller;
    if (not requireAuth(caller)) { return false };
    userSettings.put(caller, {
      linkedNostrNpub = settings.linkedNostrNpub;
      linkedNostrPubkeyHex = settings.linkedNostrPubkeyHex;
      d2aEnabled = settings.d2aEnabled;
      updatedAt = Time.now();
    });
    true;
  };

  // ──────────────────────────────────────
  // User Preferences (cross-device preference profile sync)
  // ──────────────────────────────────────

  public query func getUserPreferences(p : Principal) : async ?Types.UserPreferences {
    userPreferences.get(p);
  };

  public shared(msg) func saveUserPreferences(preferencesJson : Text, lastUpdated : Int) : async Bool {
    let caller = msg.caller;
    if (not requireAuth(caller)) { return false };
    if (Text.size(preferencesJson) > 500_000) { return false };

    switch (userPreferences.get(caller)) {
      case (?existing) {
        if (lastUpdated <= existing.lastUpdated) { return false };
      };
      case null {};
    };

    userPreferences.put(caller, {
      owner = caller;
      preferencesJson = preferencesJson;
      lastUpdated = lastUpdated;
      savedAt = Time.now();
    });
    true;
  };

  // ──────────────────────────────────────
  // HTTP Interface (II alternative origins)
  // ──────────────────────────────────────

  public query func http_request(req : HTTP.HttpRequest) : async HTTP.HttpResponse {
    if (req.url == II_ORIGINS_PATH or Text.startsWith(req.url, #text(II_ORIGINS_PATH # "?"))) {
      switch (certCache.get(II_ORIGINS_PATH)) {
        case (?body) {
          return {
            status_code = 200 : Nat16;
            headers = [
              ("content-type", "application/json"),
              ("access-control-allow-origin", "*"),
              certCache.certificationHeader(II_ORIGINS_PATH),
            ];
            body = body;
            streaming_strategy = null;
            upgrade = null;
          };
        };
        case null {
          return {
            status_code = 500 : Nat16;
            headers = [];
            body = Text.encodeUtf8("Cache not initialized");
            streaming_strategy = null;
            upgrade = null;
          };
        };
      };
    };

    {
      status_code = 404 : Nat16;
      headers = [];
      body = Text.encodeUtf8("Not found");
      streaming_strategy = null;
      upgrade = null;
    };
  };
};
