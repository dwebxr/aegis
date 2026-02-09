import Buffer "mo:base/Buffer";
import Float "mo:base/Float";
import HashMap "mo:base/HashMap";
import Int "mo:base/Int";
import Iter "mo:base/Iter";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import Result "mo:base/Result";
import Text "mo:base/Text";
import Time "mo:base/Time";

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

  // ──────────────────────────────────────
  // Stable storage for upgrades
  // ──────────────────────────────────────

  var stableEvaluations : [(Text, Types.ContentEvaluation)] = [];
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

  // Owner -> evaluation IDs index for fast user queries
  transient var ownerIndex = HashMap.HashMap<Principal, Buffer.Buffer<Text>>(16, Principal.equal, Principal.hash);

  // ──────────────────────────────────────
  // Upgrade hooks
  // ──────────────────────────────────────

  system func preupgrade() {
    stableEvaluations := Iter.toArray(evaluations.entries());
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
  };

  system func postupgrade() {
    for ((id, eval) in stableEvaluations.vals()) {
      evaluations.put(id, eval);
      addToPrincipalIndex(ownerIndex, eval.owner, id);
    };
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
    stableEvaluations := [];
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
      scores = eval.scores;
      verdict = eval.verdict;
      reason = eval.reason;
      createdAt = if (eval.createdAt == 0) { Time.now() } else { eval.createdAt };
      validated = eval.validated;
      flagged = eval.flagged;
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

        let updated : Types.ContentEvaluation = {
          id = existing.id;
          owner = existing.owner;
          author = existing.author;
          avatar = existing.avatar;
          text = existing.text;
          source = existing.source;
          sourceUrl = existing.sourceUrl;
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
        scores = eval.scores;
        verdict = eval.verdict;
        reason = eval.reason;
        createdAt = if (eval.createdAt == 0) { Time.now() } else { eval.createdAt };
        validated = eval.validated;
        flagged = eval.flagged;
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
    } catch (_e) {
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
      } catch (_e) {
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

  /// Community flag: vote that a staked signal is slop.
  /// When flagCount reaches threshold, stake is slashed (kept by protocol treasury).
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

    // Threshold reached: slash stake (stays in canister as treasury)
    putStakeUpdate(stakeId, stake, #slashed, stake.validationCount, newCount, ?Time.now());
    resolveReputation(stake.owner, 0, 1, 0, stake.amount);
    #ok(true);
  };

  /// Get a user's reputation profile
  public query func getUserReputation(p : Principal) : async Types.UserReputation {
    ensureReputation(p);
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
  /// Fee split: 80% to sender, 20% to protocol treasury.
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
    } catch (_e) {
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
      } catch (_e) {
        // Sender payout failed; funds remain in canister for manual recovery
      };
    };

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
  // Treasury Management (controller-only)
  // ──────────────────────────────────────

  /// Sum of all active (pending) stakes — these funds must be reserved
  /// for potential returns and must NOT be withdrawn.
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

  /// Get the canister's total ICP balance.
  /// Anyone can call this for transparency.
  public shared func getTreasuryBalance() : async Nat {
    await ICP_LEDGER.icrc1_balance_of({
      owner = Principal.fromActor(AegisBackend);
      subaccount = null;
    });
  };

  /// Get the confirmed revenue that can be safely withdrawn.
  /// = Total ICP balance − active stakes (reserved for returns).
  /// Anyone can call this for transparency.
  public shared func getWithdrawableBalance() : async Nat {
    let totalBalance = await ICP_LEDGER.icrc1_balance_of({
      owner = Principal.fromActor(AegisBackend);
      subaccount = null;
    });
    let reserved = calcActiveStakeTotal();
    if (totalBalance > reserved) { totalBalance - reserved } else { 0 };
  };

  /// Withdraw ICP from the canister treasury.
  /// Only the canister controller can call this.
  /// Amount is capped at withdrawable balance (total − active stakes).
  public shared(msg) func withdrawTreasury(to : Principal, amount : Nat) : async Result.Result<Nat, Text> {
    let caller = msg.caller;
    if (not Principal.isController(caller)) {
      return #err("Only controller can withdraw");
    };
    if (amount == 0) {
      return #err("Amount must be greater than zero");
    };

    // Safety: check amount does not exceed withdrawable balance
    let totalBalance = await ICP_LEDGER.icrc1_balance_of({
      owner = Principal.fromActor(AegisBackend);
      subaccount = null;
    });
    let reserved = calcActiveStakeTotal();
    let withdrawable = if (totalBalance > reserved) { totalBalance - reserved } else { 0 };
    if (amount > withdrawable) {
      return #err("Amount exceeds withdrawable balance (" # Nat.toText(withdrawable) # " e8s). " #
                   Nat.toText(reserved) # " e8s reserved for active stakes.");
    };

    let transferResult = try {
      await ICP_LEDGER.icrc1_transfer({
        from_subaccount = null;
        to = { owner = to; subaccount = null };
        amount = amount;
        fee = ?ICP_FEE;
        memo = null;
        created_at_time = null;
      });
    } catch (_e) {
      return #err("Ledger transfer failed");
    };

    switch (transferResult) {
      case (#Ok(blockIndex)) { #ok(blockIndex) };
      case (#Err(err)) {
        let errMsg = switch (err) {
          case (#InsufficientFunds(_)) { "Insufficient treasury balance" };
          case (#BadFee(_)) { "Bad fee" };
          case (_) { "Transfer rejected" };
        };
        #err(errMsg);
      };
    };
  };

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
    let trimmed = Text.trimStart(Text.trimEnd(cleaned2, #char ' '), #char ' ');

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
    } catch (_e) {
      return #err("IC LLM call failed");
    };

    if (Text.size(response) == 0) {
      return #err("IC LLM returned empty response");
    };

    parseAnalysisResponse(response);
  };
};
