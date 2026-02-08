import Buffer "mo:base/Buffer";
import Float "mo:base/Float";
import HashMap "mo:base/HashMap";
import Iter "mo:base/Iter";
import Nat "mo:base/Nat";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Time "mo:base/Time";

import Types "types";

persistent actor AegisBackend {

  // ──────────────────────────────────────
  // Stable storage for upgrades
  // ──────────────────────────────────────

  var stableEvaluations : [(Text, Types.ContentEvaluation)] = [];
  var stableProfiles : [(Principal, Types.UserProfile)] = [];
  var stableSourceConfigs : [(Text, Types.SourceConfigEntry)] = [];
  var stableSignals : [(Text, Types.PublishedSignal)] = [];

  // ──────────────────────────────────────
  // Runtime state (rebuilt from stable on upgrade)
  // ──────────────────────────────────────

  transient var evaluations = HashMap.HashMap<Text, Types.ContentEvaluation>(64, Text.equal, Text.hash);
  transient var profiles = HashMap.HashMap<Principal, Types.UserProfile>(16, Principal.equal, Principal.hash);
  transient var sourceConfigs = HashMap.HashMap<Text, Types.SourceConfigEntry>(16, Text.equal, Text.hash);

  // Signal storage + owner index
  transient var signals = HashMap.HashMap<Text, Types.PublishedSignal>(16, Text.equal, Text.hash);
  transient var signalOwnerIndex = HashMap.HashMap<Principal, Buffer.Buffer<Text>>(16, Principal.equal, Principal.hash);

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
  };

  system func postupgrade() {
    for ((id, eval) in stableEvaluations.vals()) {
      evaluations.put(id, eval);
      switch (ownerIndex.get(eval.owner)) {
        case (?buf) { buf.add(id) };
        case null {
          let buf = Buffer.Buffer<Text>(8);
          buf.add(id);
          ownerIndex.put(eval.owner, buf);
        };
      };
    };
    for ((p, profile) in stableProfiles.vals()) {
      profiles.put(p, profile);
    };
    for ((id, config) in stableSourceConfigs.vals()) {
      sourceConfigs.put(id, config);
    };
    for ((id, signal) in stableSignals.vals()) {
      signals.put(id, signal);
      switch (signalOwnerIndex.get(signal.owner)) {
        case (?buf) { buf.add(id) };
        case null {
          let buf = Buffer.Buffer<Text>(8);
          buf.add(id);
          signalOwnerIndex.put(signal.owner, buf);
        };
      };
    };
    stableEvaluations := [];
    stableProfiles := [];
    stableSourceConfigs := [];
    stableSignals := [];
  };

  // ──────────────────────────────────────
  // Helper: ensure caller is authenticated
  // ──────────────────────────────────────

  func requireAuth(caller : Principal) : Bool {
    not Principal.isAnonymous(caller);
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
        let all = Buffer.toArray(buf);
        let total = all.size();
        if (offset >= total) { return [] };

        let end = Nat.min(offset + limit, total);
        let count = end - offset;

        // Return in reverse chronological order (newest first)
        let result = Buffer.Buffer<Types.ContentEvaluation>(count);
        var i = total - 1 - offset;
        var added : Nat = 0;
        label fetchLoop while (added < count) {
          switch (evaluations.get(all[i])) {
            case (?eval) { result.add(eval) };
            case null {};
          };
          added += 1;
          if (i == 0) { break fetchLoop };
          i -= 1;
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
      switch (ownerIndex.get(caller)) {
        case (?buf) { buf.add(tagged.id) };
        case null {
          let buf = Buffer.Buffer<Text>(8);
          buf.add(tagged.id);
          ownerIndex.put(caller, buf);
        };
      };
    };

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

      // Only add to ownerIndex if this is a new evaluation (not an update)
      if (isNew) {
        switch (ownerIndex.get(caller)) {
          case (?buf) { buf.add(tagged.id) };
          case null {
            let buf = Buffer.Buffer<Text>(8);
            buf.add(tagged.id);
            ownerIndex.put(caller, buf);
          };
        };
      };

      saved += 1;
    };

    let profile = ensureProfile(caller);
    var qualityCount : Nat = 0;
    var slopCount : Nat = 0;
    for (eval in evals.vals()) {
      switch (eval.verdict) {
        case (#quality) { qualityCount += 1 };
        case (#slop) { slopCount += 1 };
      };
    };

    let updatedProfile : Types.UserProfile = {
      principal = profile.principal;
      displayName = profile.displayName;
      createdAt = profile.createdAt;
      totalEvaluations = profile.totalEvaluations + saved;
      totalQuality = profile.totalQuality + qualityCount;
      totalSlop = profile.totalSlop + slopCount;
    };
    profiles.put(caller, updatedProfile);

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

    switch (signalOwnerIndex.get(caller)) {
      case (?buf) { buf.add(tagged.id) };
      case null {
        let buf = Buffer.Buffer<Text>(8);
        buf.add(tagged.id);
        signalOwnerIndex.put(caller, buf);
      };
    };

    tagged.id;
  };

  public query func getUserSignals(p : Principal, offset : Nat, limit : Nat) : async [Types.PublishedSignal] {
    switch (signalOwnerIndex.get(p)) {
      case null { [] };
      case (?buf) {
        let all = Buffer.toArray(buf);
        let total = all.size();
        if (offset >= total) { return [] };

        let end = Nat.min(offset + limit, total);
        let count = end - offset;

        let result = Buffer.Buffer<Types.PublishedSignal>(count);
        var i = total - 1 - offset;
        var added : Nat = 0;
        label fetchLoop while (added < count) {
          switch (signals.get(all[i])) {
            case (?s) { result.add(s) };
            case null {};
          };
          added += 1;
          if (i == 0) { break fetchLoop };
          i -= 1;
        };
        Buffer.toArray(result);
      };
    };
  };
};
