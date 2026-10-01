import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import "./Communities.css";

const REACTIONS = ["❤️", "😂", "🔥", "👍", "😮"];
const COMMUNITY_CATEGORIES = [
  ["startup_entrepreneurship", "Startups & entrepreneurship"],
  ["coding_technology", "Coding & technology"],
  ["gaming", "Gaming"],
  ["music", "Music"],
  ["study", "Study"],
  ["fitness", "Fitness"],
  ["movies", "Movies"],
  ["art", "Art"],
  ["other", "Other"],
];
const TOPICS = [
  "What’s a small thing that made you happy this week?",
  "What song has been on repeat for you lately?",
  "What’s something you’d love to learn?",
  "What’s your ideal way to spend a free afternoon?",
  "What show, game, or book would you recommend?",
  "What’s a place you hope to visit someday?",
];
const getUtcDay = () => new Date().toISOString().slice(0, 10);
const QUESTION_FIELDS = "id,community_id,anonymous_identity_id,question_text,status,created_at,updated_at";
const ANSWER_FIELDS = "id,question_id,community_id,anonymous_identity_id,answer_text,status,created_at,updated_at";
const REACTION_FIELDS = "id,community_id,question_id,answer_id,anonymous_identity_id,reaction_type,created_at,updated_at";
const POINT_FIELDS = "id,community_id,question_id,answer_id,actor_identity_id,actor_role,action_type,points_awarded,created_at";

function safeError(error, fallback) {
  return error?.message || fallback;
}

function anonymousLabel(identityId, ownIdentityId, ownAlias) {
  if (identityId && identityId === ownIdentityId && ownAlias) return `You · Alias ${ownAlias}`;
  return identityId ? `Community member · ${identityId.slice(-4).toUpperCase()}` : "Community member";
}

function rpcRows(data) {
  return Array.isArray(data) ? data[0] : data;
}

export default function CommunitiesSection() {
  const [communities, setCommunities] = useState([]);
  const [memberships, setMemberships] = useState({});
  const [selectedCommunity, setSelectedCommunity] = useState(null);
  const [identity, setIdentity] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [points, setPoints] = useState([]);
  const [qotd, setQotd] = useState(null);
  const [qotdUtcDay, setQotdUtcDay] = useState(getUtcDay);
  const [loadingCommunities, setLoadingCommunities] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingEngagement, setLoadingEngagement] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [questionDraft, setQuestionDraft] = useState("");
  const [answerDrafts, setAnswerDrafts] = useState({});
  const [questionModalOpen, setQuestionModalOpen] = useState(false);
  const [answerModalQuestion, setAnswerModalQuestion] = useState(null);
  const [editingQuestion, setEditingQuestion] = useState(null);
  const [editingAnswer, setEditingAnswer] = useState(null);
  const [randomTopic, setRandomTopic] = useState("");
  const [moderationReason, setModerationReason] = useState({});
  const [creationRequests, setCreationRequests] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [showCreationForm, setShowCreationForm] = useState(false);
  const [creationForm, setCreationForm] = useState({ name: "", description: "", category: "study", reason: "" });
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [requestSuccess, setRequestSuccess] = useState("");
  const [rejectionReasons, setRejectionReasons] = useState({});
  const detailRequestRef = useRef(0);
  const activeCommunityIdRef = useRef(null);

  const membership = selectedCommunity ? memberships[selectedCommunity.id] : null;
  const isMember = membership?.status === "active";
  const isModerator = isMember && membership?.role === "admin";
  const myCreationRequests = creationRequests.filter((request) => request.requester_id === currentUserId);
  // RLS gives ordinary users only their own rows and platform admins every row.
  // The queue is shown only to platform admins, and includes their own requests too.
  const pendingAdminRequests = isPlatformAdmin ? creationRequests.filter((request) => request.status === "pending") : [];

  const loadCommunities = useCallback(async () => {
    setLoadingCommunities(true);
    setError("");
    const [communityResult, membershipResult] = await Promise.all([
      supabase.from("communities").select("id,name,slug,description,category,status,created_at").eq("status", "active").order("name"),
      supabase.from("community_memberships").select("community_id,role,status"),
    ]);
    if (communityResult.error) {
      setError(safeError(communityResult.error, "Could not load communities."));
      setCommunities([]);
    } else {
      setCommunities(communityResult.data || []);
    }
    if (membershipResult.error) {
      setError((current) => current || safeError(membershipResult.error, "Could not load your memberships."));
    } else {
      setMemberships(Object.fromEntries((membershipResult.data || []).map((item) => [item.community_id, item])));
    }
    setLoadingCommunities(false);
  }, []);

  const loadCreationRequests = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id || null;
    setCurrentUserId(userId);
    const { data: adminFlag } = await supabase.rpc("is_platform_admin");
    setIsPlatformAdmin(adminFlag === true);
    const { data, error: requestLoadError } = await supabase
      .from("community_creation_requests")
      .select("id,requester_id,name,description,category,reason,status,submitted_at,reviewed_at,rejection_note")
      .order("submitted_at", { ascending: false });
    if (requestLoadError) {
      setRequestError(safeError(requestLoadError, "Could not load community requests."));
      return;
    }
    setRequestError("");
    setCreationRequests(data || []);
  }, []);

  const loadDetail = useCallback(async (community) => {
    if (!community) return;
    const requestId = ++detailRequestRef.current;
    const utcDay = getUtcDay();
    setQotdUtcDay(utcDay);
    setLoadingDetail(true);
    setLoadingEngagement(true);
    setError("");
    setQotd(null);
    setIdentity(null);
    const currentMembership = memberships[community.id];
    if (currentMembership?.status !== "active") {
      setQuestions([]); setAnswers([]); setReactions([]); setPoints([]);
      setLoadingDetail(false);
      setLoadingEngagement(false);
      return;
    }
    setAnswers([]); setReactions([]); setPoints([]);
    const [identityResult, questionResult, qotdResult] = await Promise.all([
      supabase.rpc("get_my_community_identity", { p_community_id: community.id }),
      supabase.from("community_questions").select(QUESTION_FIELDS).eq("community_id", community.id).order("created_at", { ascending: false }),
      supabase.rpc("get_community_question_of_day", { p_community_id: community.id, p_utc_day: utcDay }),
    ]);
    if (requestId !== detailRequestRef.current || activeCommunityIdRef.current !== community.id) return;
    if (identityResult.error) setError(safeError(identityResult.error, "Could not load your community identity."));
    else setIdentity(rpcRows(identityResult.data));
    if (questionResult.error) setError((current) => current || safeError(questionResult.error, "Could not load questions."));
    else setQuestions(questionResult.data || []);
    if (qotdResult.error) setError((current) => current || safeError(qotdResult.error, "Could not load Question of the Day."));
    else setQotd(rpcRows(qotdResult.data));
    setLoadingDetail(false);
  }, [memberships]);

  useEffect(() => { loadCommunities(); }, [loadCommunities]);
  useEffect(() => { loadCreationRequests(); }, [loadCreationRequests]);
  useEffect(() => { if (selectedCommunity) loadDetail(selectedCommunity); }, [selectedCommunity, loadDetail]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const currentUtcDay = getUtcDay();
      if (currentUtcDay !== qotdUtcDay) {
        setQotdUtcDay(currentUtcDay);
        if (selectedCommunity) loadDetail(selectedCommunity);
      }
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, [loadDetail, qotdUtcDay, selectedCommunity]);
const loadEngagement = useCallback(async () => {
  if (!selectedCommunity || !isMember || !questions.length) {
    setAnswers([]);
    setReactions([]);
    setPoints([]);
    setLoadingEngagement(false);
    return;
  }

  setLoadingEngagement(true);

  const questionIds = questions.map((question) => question.id);

  const [answerResult, reactionResult, pointResult] = await Promise.all([
    supabase
      .from("community_answers")
      .select(ANSWER_FIELDS)
      .in("question_id", questionIds)
      .order("created_at", { ascending: true }),

    supabase
      .from("community_reactions")
      .select(REACTION_FIELDS)
      .eq("community_id", selectedCommunity.id),

    supabase
      .from("community_point_events")
      .select(POINT_FIELDS)
      .eq("community_id", selectedCommunity.id)
      .eq("action_type", "trophy"),
  ]);

  const failure =
    answerResult.error ||
    reactionResult.error ||
    pointResult.error;

  if (failure) {
    setError(
      (current) =>
        current ||
        safeError(failure, "Some community activity could not be loaded.")
    );
  }

  setAnswers(answerResult.data || []);
  setReactions(reactionResult.data || []);
  setPoints(pointResult.data || []);
  setLoadingEngagement(false);
}, [selectedCommunity, isMember, questions]);

useEffect(() => {
  loadEngagement();
}, [loadEngagement]);
  const leaderboard = useMemo(() => {
    const totals = new Map();
    for (const event of points) {
      if (Number(event.points_awarded) <= 0) continue;
      totals.set(event.actor_identity_id, (totals.get(event.actor_identity_id) || 0) + Number(event.points_awarded));
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [points]);

  async function joinOrLeave(community) {
    setBusy(true); setError("");
    const currentlyActive = memberships[community.id]?.status === "active";
    const { error: rpcError } = await supabase.rpc(currentlyActive ? "leave_community" : "join_community", { p_community_id: community.id });
    if (rpcError) setError(safeError(rpcError, `Could not ${currentlyActive ? "leave" : "join"} this community.`));
    else await loadCommunities();
    setBusy(false);
  }

  async function submitCreationRequest(event) {
    event.preventDefault();
    setRequestBusy(true);
    setRequestError("");
    setRequestSuccess("");
    const payload = {
      name: creationForm.name.trim(),
      description: creationForm.description.trim(),
      category: creationForm.category,
      reason: creationForm.reason.trim(),
    };
    const { error: submitError } = await supabase
      .from("community_creation_requests")
      .insert(payload);
    if (submitError) {
      const duplicateName = submitError.code === "23505" || /community_creation_requests_pending_name_key/i.test(submitError.message || "");
      setRequestError(duplicateName
        ? "A request with this community name is already pending. Check your request status or choose another name."
        : safeError(submitError, "Could not submit your request."));
    } else {
      setCreationForm({ name: "", description: "", category: "study", reason: "" });
      setShowCreationForm(false);
      setRequestSuccess("Your community request was submitted for review.");
      await loadCreationRequests();
    }
    setRequestBusy(false);
  }

  function requestSlug(request) {
    const stem = request.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 69).replace(/-+$/g, "") || "community";
    return `${stem}-${request.id.replace(/-/g, "").slice(0, 8)}`;
  }

  async function approveCreationRequest(request) {
    setRequestBusy(true);
    setRequestError("");
    setRequestSuccess("");
    const { error: approvalError } = await supabase.rpc("approve_community_creation_request", {
      p_request_id: request.id,
      p_slug: requestSlug(request),
    });
    if (approvalError) {
      setRequestError(safeError(approvalError, "Could not approve this request."));
    } else {
      setRequestSuccess(`“${request.name}” was approved and is now active.`);
      await Promise.all([loadCreationRequests(), loadCommunities()]);
    }
    setRequestBusy(false);
  }

  async function rejectCreationRequest(request) {
    setRequestBusy(true);
    setRequestError("");
    setRequestSuccess("");
    const { error: rejectionError } = await supabase.rpc("reject_community_creation_request", {
      p_request_id: request.id,
      p_rejection_note: rejectionReasons[request.id]?.trim() || null,
    });
    if (rejectionError) {
      setRequestError(safeError(rejectionError, "Could not reject this request."));
    } else {
      setRequestSuccess(`“${request.name}” was rejected.`);
      setRejectionReasons((reasons) => ({ ...reasons, [request.id]: "" }));
      await loadCreationRequests();
    }
    setRequestBusy(false);
  }

  async function createQuestion(event) {
    event.preventDefault();
    if (!selectedCommunity || !questionDraft.trim()) return;
    setBusy(true); setError("");
    const { error: rpcError } = await supabase.rpc("create_community_question", { p_community_id: selectedCommunity.id, p_question_text: questionDraft.trim() });
    if (rpcError) setError(safeError(rpcError, "Could not post your question."));
    else { setQuestionDraft(""); setQuestionModalOpen(false); await loadDetail(selectedCommunity); }
    setBusy(false);
  }

  async function createAnswer(questionId) {
    const answerText = (answerDrafts[questionId] || "").trim();
    if (!answerText || !selectedCommunity) return;
    setBusy(true); setError("");
    const { error: rpcError } = await supabase.rpc("create_community_answer", { p_community_id: selectedCommunity.id, p_question_id: questionId, p_answer_text: answerText });
    if (rpcError) setError(safeError(rpcError, "Could not post your answer."));
    else { setAnswerDrafts((drafts) => ({ ...drafts, [questionId]: "" })); setAnswerModalQuestion(null); await loadDetail(selectedCommunity); }
    setBusy(false);
  }

  async function saveEdit(contentType, contentId, text) {
    if (!text.trim()) return;
    setBusy(true); setError("");
    const { error: rpcError } = await supabase.rpc(contentType === "question" ? "update_community_question" : "update_community_answer", contentType === "question" ? { p_question_id: contentId, p_question_text: text.trim() } : { p_answer_id: contentId, p_answer_text: text.trim() });
    if (rpcError) setError(safeError(rpcError, "Could not save your edit."));
    else { setEditingQuestion(null); setEditingAnswer(null); await loadDetail(selectedCommunity); }
    setBusy(false);
  }

  async function moderate(contentType, contentId, status) {
    setBusy(true); setError("");
    const { error: rpcError } = await supabase.rpc("moderate_community_content", { p_content_type: contentType, p_content_id: contentId, p_status: status, p_reason: moderationReason[contentId] || null });
    if (rpcError) setError(safeError(rpcError, "Could not update moderation status."));
    else await loadDetail(selectedCommunity);
    setBusy(false);
  }

  async function setReaction(contentType, contentId, currentReaction, desiredReaction) {
    setBusy(true); setError("");
    let rpcError = null;
    if (currentReaction && currentReaction.reaction_type === desiredReaction) {
      const result = await supabase.rpc("remove_community_reaction", { p_reaction_id: currentReaction.id });
      rpcError = result.error;
    } else {
      const result = await supabase.rpc("set_community_reaction", { p_content_type: contentType, p_content_id: contentId, p_reaction_type: desiredReaction });
      rpcError = result.error;
    }
    if (rpcError) setError(safeError(rpcError, "Could not update your reaction."));
    else await loadDetail(selectedCommunity);
    setBusy(false);
  }

  async function giveTrophy(contentType, contentId) {
    setBusy(true); setError("");
    const { error: rpcError } = await supabase.rpc("award_community_trophy", { p_content_type: contentType, p_content_id: contentId });
    if (rpcError) setError(safeError(rpcError, "Could not award a trophy."));
    else await loadDetail(selectedCommunity);
    setBusy(false);
  }

  function reactionFor(contentType, contentId) {
    return reactions.find((reaction) => reaction.anonymous_identity_id === identity?.identity_id && (contentType === "question" ? reaction.question_id === contentId : reaction.answer_id === contentId));
  }

  function trophyStats(contentType, contentId) {
    const related = points.filter((event) => contentType === "question" ? event.question_id === contentId && !event.answer_id : event.answer_id === contentId);
    return {
      total: related.reduce((sum, event) => sum + Math.max(0, Number(event.points_awarded)), 0),
      memberCount: related.filter((event) => event.actor_role === "member" && Number(event.points_awarded) > 0).length,
      own: related.some((event) => event.actor_identity_id === identity?.identity_id),
      adminAwarded: related.some((event) => event.actor_role === "admin" && Number(event.points_awarded) > 0),
    };
  }

  function renderEngagement(contentType, item) {
    const stats = trophyStats(contentType, item.id);
    const ownContent = item.anonymous_identity_id === identity?.identity_id;
    const isAdminMember = membership?.role === "admin";
    const adminAwardUnavailable = isAdminMember && stats.adminAwarded;
    const memberCapReached = !isAdminMember && stats.memberCount >= 3;
    return <div className="community-engagement">
      <div className="community-reactions" aria-label="Reactions">
        {REACTIONS.map((emoji) => {
          const selected = reactionFor(contentType, item.id);
          const count = reactions.filter((reaction) => reaction.reaction_type === emoji && (contentType === "question" ? reaction.question_id === item.id : reaction.answer_id === item.id)).length;
          return <button key={emoji} disabled={busy || !identity?.identity_id} className={selected?.reaction_type === emoji ? "selected" : ""} onClick={() => setReaction(contentType, item.id, selected, emoji)} aria-label={`${emoji} reaction, ${count} total`}>{emoji} <span>{count || ""}</span></button>;
        })}
      </div>
      <div className="community-trophy-row">
        <span>🏆 {stats.total} points · {stats.memberCount}/3 member awards{stats.adminAwarded ? " · admin +10 included" : ""}{memberCapReached && !stats.own ? " · more member trophies score 0" : ""}</span>
        <button disabled={busy || !identity?.identity_id || ownContent || stats.own || adminAwardUnavailable || !isMember || item.status !== "active"} onClick={() => giveTrophy(contentType, item.id)} title={ownContent ? "You cannot award your own content" : stats.own ? "You have already awarded this content" : adminAwardUnavailable ? "The admin trophy has already been awarded" : memberCapReached ? "This member trophy will add 0 points" : "Give one trophy"}>{stats.own ? "🏆 Awarded" : adminAwardUnavailable ? "🏆 Admin award used" : memberCapReached ? "🏆 Give (0 pts)" : `🏆 Give ${isAdminMember ? "+10" : "+5"}`}</button>
      </div>
    </div>;
  }

  function renderModeration(type, item) {
    if (!isModerator) return null;
    return <div className="community-moderation">
      <input aria-label="Moderation reason" placeholder="Optional moderation reason" value={moderationReason[item.id] || ""} onChange={(event) => setModerationReason((reasons) => ({ ...reasons, [item.id]: event.target.value }))} />
      {item.status !== "hidden" && <button disabled={busy} onClick={() => moderate(type, item.id, "hidden")}>Hide</button>}
      {item.status !== "removed" && <button disabled={busy} onClick={() => moderate(type, item.id, "removed")}>Remove</button>}
      {item.status !== "active" && <button disabled={busy} onClick={() => moderate(type, item.id, "active")}>Restore</button>}
    </div>;
  }

  if (selectedCommunity) {
    const community = selectedCommunity;
    const visibleQuestions = isModerator ? questions : questions.filter((question) => question.status === "active");
    return <section className="communities-page">
      <button className="community-back" onClick={() => { activeCommunityIdRef.current = null; detailRequestRef.current += 1; setSelectedCommunity(null); setError(""); }}>← All communities</button>
      <header className="community-detail-header">
        <div><span className="community-category">{community.category || "Community"}</span><h1>{community.name}</h1><p>{community.description || "A place to connect around a shared vibe."}</p><div className="community-detail-badges"><span className="community-count">Member count is private</span><span className={`community-membership-badge ${isMember ? "joined" : "not-joined"}`}>{isModerator ? "★ Community admin" : isMember ? "✓ Joined" : "Not joined"}</span>{isMember && identity?.alias_number != null && <span className="community-identity-badge">Your community alias · {identity.alias_number}</span>}</div></div>
        <button className="community-join-button" disabled={busy || membership?.role === "admin"} onClick={() => joinOrLeave(community)}>{membership?.role === "admin" ? "Community admin" : isMember ? "Leave community" : "Join community"}</button>
      </header>
      {error && <div className="community-error" role="alert">{error}</div>}
      {loadingDetail ? <div className="community-state">Loading community…</div> : !isMember ? <div className="community-state"><h2>Join to join the conversation</h2><p>Questions and answers are visible to active community members.</p><button className="community-join-button" disabled={busy} onClick={() => joinOrLeave(community)}>Join this community</button></div> : <>
        <section className="community-qotd"><div className="qotd-kicker">☀️ QUESTION OF THE DAY · UTC {qotdUtcDay}</div>{qotd ? <><h2>{qotd.question_text}</h2><p>Asked by {anonymousLabel(qotd.anonymous_identity_id, identity?.identity_id, identity?.alias_number)} · 🏆 {qotd.trophy_points || 0} direct question points today</p></> : <><h2>No Question of the Day yet</h2><p>Questions with direct trophy points will appear here.</p></>}</section>
        <section className="community-composer"><div className="community-composer-heading"><div><h2>Ask the community</h2><p>Your community identity is shown; your real name stays private.</p></div><button className="community-join-button" disabled={!identity?.identity_id} onClick={() => setQuestionModalOpen(true)}>＋ Ask a question</button></div>{randomTopic && <p className="community-topic">Conversation idea: {randomTopic}</p>}<button className="community-topic-button" onClick={() => setRandomTopic(TOPICS[Math.floor(Math.random() * TOPICS.length)])}>🎲 Suggest a conversation topic</button></section>
        <div className="community-feed-layout"><section className="community-feed"><div className="community-section-title"><h2>Community questions</h2><span>{visibleQuestions.length}</span></div>{loadingEngagement ? <div className="community-state" role="status">Loading answers and community activity…</div> : visibleQuestions.length === 0 ? <div className="community-state"><h2>No questions yet</h2><p>Start the conversation with an anonymous question.</p></div> : visibleQuestions.map((question) => {
          const questionAnswers = answers.filter((answer) => answer.question_id === question.id && (isModerator || answer.status === "active"));
          const editable = Boolean(identity?.identity_id) && question.anonymous_identity_id === identity.identity_id;
          return <article className={`community-post ${question.status !== "active" ? "moderated" : ""}`} key={question.id}><div className="community-post-meta"><span>{anonymousLabel(question.anonymous_identity_id, identity?.identity_id, identity?.alias_number)}</span><time>{new Date(question.created_at).toLocaleString()}</time><span className="content-status">{question.status !== "active" ? question.status : ""}</span></div>{editingQuestion?.id === question.id ? <div className="community-edit"><textarea value={editingQuestion.text} onChange={(event) => setEditingQuestion({ ...editingQuestion, text: event.target.value })}/><button disabled={busy} onClick={() => saveEdit("question", question.id, editingQuestion.text)}>Save</button><button onClick={() => setEditingQuestion(null)}>Cancel</button></div> : <p className="community-post-text">{question.question_text}</p>}{editable && question.status === "active" && <button className="community-text-action" onClick={() => setEditingQuestion({ id: question.id, text: question.question_text })}>Edit question</button>}{renderEngagement("question", question)}{renderModeration("question", question)}<div className="community-answers"><h3>Answers <span>{questionAnswers.length}</span></h3>{questionAnswers.map((answer) => {const canEdit = Boolean(identity?.identity_id) && answer.anonymous_identity_id === identity.identity_id; return <div className={`community-answer ${answer.status !== "active" ? "moderated" : ""}`} key={answer.id}><div className="community-post-meta"><span>{anonymousLabel(answer.anonymous_identity_id, identity?.identity_id, identity?.alias_number)}</span><time>{new Date(answer.created_at).toLocaleString()}</time><span className="content-status">{answer.status !== "active" ? answer.status : ""}</span></div>{editingAnswer?.id === answer.id ? <div className="community-edit"><textarea value={editingAnswer.text} onChange={(event) => setEditingAnswer({ ...editingAnswer, text: event.target.value })}/><button disabled={busy} onClick={() => saveEdit("answer", answer.id, editingAnswer.text)}>Save</button><button onClick={() => setEditingAnswer(null)}>Cancel</button></div> : <p>{answer.answer_text}</p>}{canEdit && answer.status === "active" && <button className="community-text-action" onClick={() => setEditingAnswer({ id: answer.id, text: answer.answer_text })}>Edit answer</button>}{renderEngagement("answer", answer)}{renderModeration("answer", answer)}</div>;})}{questionAnswers.length === 0 && <p className="community-empty-answers">No answers yet. Be the first to reply.</p>}{question.status === "active" && <button className="community-answer-open" disabled={busy || !identity?.identity_id} onClick={() => setAnswerModalQuestion(question)}>💬 Answer this question</button>}</div></article>;
        })}</section><aside className="community-leaderboard"><h2>🏆 Contributors</h2><p>Based on positive trophy points. Reactions do not score.</p>{leaderboard.length ? leaderboard.map(([actorId, total], index) => <div className="leaderboard-item" key={actorId}><span>{index + 1}. {anonymousLabel(actorId, identity?.identity_id, identity?.alias_number)}</span><strong>{total} pts</strong></div>) : <div className="leaderboard-empty">No trophy points yet.</div>}<small>Anonymous labels are community-scoped.</small></aside></div>
        {questionModalOpen && <div className="community-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setQuestionModalOpen(false); }}><section className="community-modal" role="dialog" aria-modal="true" aria-labelledby="ask-community-title"><div className="community-modal-head"><div><span className="community-category">Anonymous post</span><h2 id="ask-community-title">Ask the community</h2></div><button className="community-modal-close" aria-label="Close question form" disabled={busy} onClick={() => setQuestionModalOpen(false)}>×</button></div><p>Your community alias will appear with this question. Your real name is not shown.</p><form onSubmit={createQuestion}><label htmlFor="community-question-input">Your question</label><textarea id="community-question-input" autoFocus maxLength={2000} value={questionDraft} onChange={(event) => setQuestionDraft(event.target.value)} placeholder="What’s on your mind?" required /><div className="community-modal-footer"><span>{questionDraft.length}/2000</span><button type="button" className="community-topic-button" disabled={busy} onClick={() => setQuestionDraft(TOPICS[Math.floor(Math.random() * TOPICS.length)])}>🎲 Use an idea</button></div>{error && <div className="community-error" role="alert">{error}</div>}<div className="community-modal-actions"><button type="button" className="community-topic-button" disabled={busy} onClick={() => setQuestionModalOpen(false)}>Cancel</button><button className="community-join-button" disabled={busy || !questionDraft.trim()}>{busy ? "Posting…" : "Post question"}</button></div></form></section></div>}
        {answerModalQuestion && <div className="community-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setAnswerModalQuestion(null); }}><section className="community-modal" role="dialog" aria-modal="true" aria-labelledby="answer-community-title"><div className="community-modal-head"><div><span className="community-category">Anonymous reply</span><h2 id="answer-community-title">Write an answer</h2></div><button className="community-modal-close" aria-label="Close answer form" disabled={busy} onClick={() => setAnswerModalQuestion(null)}>×</button></div><blockquote className="community-modal-question">{answerModalQuestion.question_text}</blockquote><p>Your reply will use your consistent community alias.</p><form onSubmit={(event) => { event.preventDefault(); createAnswer(answerModalQuestion.id); }}><label htmlFor="community-answer-input">Your answer</label><textarea id="community-answer-input" autoFocus maxLength={4000} value={answerDrafts[answerModalQuestion.id] || ""} onChange={(event) => setAnswerDrafts((drafts) => ({ ...drafts, [answerModalQuestion.id]: event.target.value }))} placeholder="Share your thoughts…" required /><div className="community-modal-footer"><span>{(answerDrafts[answerModalQuestion.id] || "").length}/4000</span></div>{error && <div className="community-error" role="alert">{error}</div>}<div className="community-modal-actions"><button type="button" className="community-topic-button" disabled={busy} onClick={() => setAnswerModalQuestion(null)}>Cancel</button><button className="community-join-button" disabled={busy || !(answerDrafts[answerModalQuestion.id] || "").trim()}>{busy ? "Sending…" : "Post answer"}</button></div></form></section></div>}
      </>}
    </section>;
  }

  return <section className="communities-page"><header className="communities-heading"><div><span className="community-category">FIND YOUR PEOPLE</span><h1>Communities</h1><p>Meet people around the things you care about.</p></div><div className="community-heading-actions"><button className="community-topic-button" onClick={() => setRandomTopic(TOPICS[Math.floor(Math.random() * TOPICS.length)])}>🎲 Random conversation idea</button><button className="community-join-button" onClick={() => { setShowCreationForm((shown) => !shown); setRequestError(""); setRequestSuccess(""); }}>{showCreationForm ? "Close form" : "+ Create Community"}</button></div></header>
    {requestError && <div className="community-error" role="alert">{requestError}</div>}{requestSuccess && <div className="community-request-success" role="status">{requestSuccess}</div>}
    {showCreationForm && <section className="community-request-form-card"><h2>Request a community</h2><p>Platform admins review requests. Approved communities are owned by the platform admin; requesters join as regular members.</p><form onSubmit={submitCreationRequest} className="community-request-form"><label>Community name<input required minLength={3} maxLength={80} value={creationForm.name} onChange={(event) => setCreationForm((form) => ({ ...form, name: event.target.value }))} placeholder="e.g. Campus Gaming Circle" /></label><label>Description<textarea required minLength={1} maxLength={2000} value={creationForm.description} onChange={(event) => setCreationForm((form) => ({ ...form, description: event.target.value }))} placeholder="What is this community about?" /></label><label>Category / topic<select required value={creationForm.category} onChange={(event) => setCreationForm((form) => ({ ...form, category: event.target.value }))}>{COMMUNITY_CATEGORIES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Why should this community exist?<textarea required minLength={1} maxLength={2000} value={creationForm.reason} onChange={(event) => setCreationForm((form) => ({ ...form, reason: event.target.value }))} placeholder="The existing request schema requires a short reason for review." /></label><button className="community-join-button" disabled={requestBusy}>{requestBusy ? "Submitting…" : "Submit request"}</button></form></section>}
    <section className="community-request-history"><div className="community-section-title"><h2>Your community requests</h2><button className="community-text-action" disabled={requestBusy} onClick={() => Promise.all([loadCreationRequests(), loadCommunities()])}>Refresh status</button></div>{myCreationRequests.length ? <div className="community-request-list">{myCreationRequests.map((request) => <article className="community-request-card" key={request.id}><div className="community-request-card-head"><strong>{request.name}</strong><span className={`request-status ${request.status}`}>{request.status}</span></div><p>{request.description}</p><small>{COMMUNITY_CATEGORIES.find(([value]) => value === request.category)?.[1] || request.category} · Submitted {new Date(request.submitted_at).toLocaleString()}</small>{request.status === "rejected" && request.rejection_note && <p className="request-review-note"><strong>Review note:</strong> {request.rejection_note}</p>}</article>)}</div> : <p className="community-request-empty">Your submitted requests and their review status will appear here.</p>}</section>
    {isPlatformAdmin && <section className="community-admin-requests"><div className="community-section-title"><div><h2>Platform admin review queue</h2><p>Only requests visible under the existing admin RLS policy appear here.</p></div><button className="community-text-action" disabled={requestBusy} onClick={() => loadCreationRequests()}>Refresh queue</button></div>{pendingAdminRequests.length ? <div className="community-request-list">{pendingAdminRequests.map((request) => <article className="community-request-card admin-request-card" key={request.id}><div className="community-request-card-head"><strong>{request.name}</strong><span className="request-status pending">pending</span></div><p>{request.description}</p><small>{COMMUNITY_CATEGORIES.find(([value]) => value === request.category)?.[1] || request.category} · Submitted {new Date(request.submitted_at).toLocaleString()}</small><p className="request-review-note"><strong>Requester:</strong> {request.requester_id ? "Registered member (account ID hidden)" : "Account no longer available"}</p><p className="request-review-note"><strong>Reason:</strong> {request.reason}</p><label className="rejection-reason-label">Optional rejection reason<textarea maxLength={1000} value={rejectionReasons[request.id] || ""} onChange={(event) => setRejectionReasons((reasons) => ({ ...reasons, [request.id]: event.target.value }))} placeholder="Shown to the requester if rejected" /></label><div className="community-request-actions"><button className="community-join-button" disabled={requestBusy} onClick={() => approveCreationRequest(request)}>Approve and activate</button><button className="community-reject-button" disabled={requestBusy} onClick={() => rejectCreationRequest(request)}>Reject request</button></div></article>)}</div> : <p className="community-request-empty">No pending requests are available in this view.</p>}</section>}
    {randomTopic && <div className="community-topic">💬 {randomTopic}</div>}{error && <div className="community-error" role="alert">{error}</div>}{loadingCommunities ? <div className="community-state" role="status">Loading communities…</div> : communities.length === 0 ? <div className="community-state"><h2>No communities available yet</h2><p>Check back soon to find your people.</p></div> : <div className="community-cards">{communities.map((community) => {const itemMembership = memberships[community.id]; const joined = itemMembership?.status === "active"; return <article className="community-card" key={community.id}><div className="community-card-top"><span className="community-category">{community.category || "Community"}</span><span className="community-count">Member count private</span></div><h2>{community.name}</h2><p>{community.description || "A place to connect around a shared vibe."}</p><div className="community-card-bottom"><span className={`community-membership-badge ${joined ? "joined" : "not-joined"}`}>{itemMembership?.role === "admin" ? "★ Admin" : joined ? "✓ Joined" : "Open to join"}</span><button className="community-text-action" onClick={() => { activeCommunityIdRef.current = community.id; setSelectedCommunity(community); }}>View community →</button><button className="community-join-button small" disabled={busy || itemMembership?.role === "admin"} onClick={() => joinOrLeave(community)}>{itemMembership?.role === "admin" ? "Admin" : joined ? "Leave" : "Join"}</button></div></article>;})}</div>}</section>;
}
