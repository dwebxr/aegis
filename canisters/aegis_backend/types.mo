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
    scores : ScoreBreakdown;
    verdict : Verdict;
    reason : Text;
    createdAt : Int;
    validated : Bool;
    flagged : Bool;
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
};
