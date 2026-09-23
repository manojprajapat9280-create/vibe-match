import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import "./App.css";

const questions = [
  {
    id: 1,
    text: "What do you like doing in your free time?",
    options: [
      "🎬 Movies / Reels",
      "🏋️ Sports / Gym",
      "👥 Hang out with friends",
      "🌙 Chill / Alone time",
    ],
  },
  {
    id: 2,
    text: "If a sudden plan comes up, what do you do?",
    options: [
      "🚀 Join instantly",
      "🤔 Check the plan first",
      "🏠 Chill at home",
      "🌊 Go with the flow",
    ],
  },
  {
    id: 3,
    text: "What kind of conversations do you enjoy?",
    options: [
      "😂 Jokes / Random talks",
      "💡 Ideas / Tech",
      "🫂 Personal talks",
      "🎵 Music / Games / Movies",
    ],
  },
  {
    id: 4,
    text: "What do you do when you're stuck on a problem?",
    options: [
      "🔎 Google / YouTube",
      "🧠 Try figuring it out myself",
      "🤝 Ask a friend",
      "😴 Leave it for later",
    ],
  },
  {
    id: 5,
    text: "What sounds most interesting after college?",
    options: [
      "💼 Job / Industry",
      "🚀 Startup / Business",
      "🔬 Research / Studies",
      "✈️ Travel / Explore",
    ],
  },
  {
    id: 6,
    text: "What would you enjoy most about college life?",
    options: [
      "👋 Meeting new people",
      "🎉 Fests / Events",
      "🏆 Projects / Competitions",
      "📚 Learning new things",
    ],
  },
  {
    id: 7,
    text: "What matters most to you in a friendship?",
    options: [
      "😂 Having fun together",
      "🗣️ Talking openly",
      "🎯 Similar interests",
      "🫶 Understanding each other",
    ],
  },
];

const branches = [
  "Computer Science & Engineering (CSE)",
  "Electrical Engineering (EE)",
  "Mechanical Engineering (ME)",
  "Civil Engineering (CE)",
  "Chemical Engineering (CHE)",
  "Metallurgical & Materials Engineering (MME)",
  "Mathematics & Computing (M&C)",
  "Engineering Physics (EP)",
  "Artificial Intelligence & Data Engineering (AI & DE)",
  "Digital Agriculture (DA)",
  "Integrated Circuit Design & Technology (ICDT)",
];

/*
 * Interesting anonymous names.
 * The number is generated from the user's UUID so
 * the same user gets the same anonymous name.
 */
const anonymousNameParts = [
  "VibeBuddy",
  "ChillMate",
  "CampusBuddy",
  "Mystery",
  "VibeSoul",
  "FunMate",
  "TalkMate",
  "CampusSoul",
  "ChillBuddy",
  "VibeMate",
];

const getAnonymousName = (userId) => {
  if (!userId) return "VibeBuddy_27";

  const cleanId = userId.replace(/-/g, "");

  let number = 0;

  for (let i = 0; i < cleanId.length; i++) {
    number =
      (number * 31 + cleanId.charCodeAt(i)) % 90;
  }

  number += 10;

  const partIndex =
    parseInt(cleanId.substring(0, 4), 16) %
    anonymousNameParts.length;

  return `${anonymousNameParts[partIndex]}_${number}`;
};

function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  // Signup details
  const [fullName, setFullName] = useState("");
  const [branch, setBranch] = useState("");

  // Questionnaire
  const [answers, setAnswers] = useState({});
  const [ideaAnswer, setIdeaAnswer] = useState("");
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [questionnaireDone, setQuestionnaireDone] = useState(false);
  const [savingAnswers, setSavingAnswers] = useState(false);

  // Matches
  const [matches, setMatches] = useState([]);
  const [activeMatch, setActiveMatch] = useState(null);

  // Messages
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Timer
  const [timeLeft, setTimeLeft] = useState("");

  // Notifications
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [loadingNotifications, setLoadingNotifications] = useState(false);

  // Reveal
  const [revealRequest, setRevealRequest] = useState(null);
  const [revealedProfile, setRevealedProfile] = useState(null);
  const [revealLoading, setRevealLoading] = useState(false);

  // Presence / typing
  const [isOtherOnline, setIsOtherOnline] = useState(false);
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const [myTyping, setMyTyping] = useState(false);

  const typingTimeoutRef = useRef(null);
  const presenceChannelRef = useRef(null);
  const messageChannelRef = useRef(null);

  const unreadNotifications = notifications.filter(
    (notification) => !notification.is_read
  ).length;

  /*
   * ====================================================
   * AUTH INITIALIZATION
   * ====================================================
   */

  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession();

      if (!mounted) return;

      setSession(currentSession);

      if (currentSession?.user) {
        await finishUserSetup(currentSession.user);
      }

      setLoading(false);
    };

    initializeAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        if (!mounted) return;

        setSession(newSession);

        if (newSession?.user) {
          await finishUserSetup(newSession.user);
        } else {
          setQuestionnaireDone(false);
          setMatches([]);
          setNotifications([]);
          setActiveMatch(null);
          setMessages([]);
          setRevealedProfile(null);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  /*
   * ====================================================
   * AFTER GOOGLE LOGIN
   * ====================================================
   */

  const finishUserSetup = async (user) => {
    try {
      const savedSignup = localStorage.getItem(
        "vibematch_signup"
      );

      let signupData = null;

      if (savedSignup) {
        try {
          signupData = JSON.parse(savedSignup);
        } catch {
          signupData = null;
        }
      }

      const email = user.email || "";

      if (!email
        .toLowerCase()
        .endsWith("@iitrpr.ac.in")) {
        await supabase.auth.signOut();

        localStorage.removeItem(
          "vibematch_signup"
        );

        alert(
          "Only IIT Ropar @iitrpr.ac.in accounts are allowed."
        );

        return;
      }

      /*
       * Save name / branch
       */

      if (
        signupData?.fullName &&
        signupData?.branch
      ) {
        const { error } = await supabase
          .from("private_profiles")
          .upsert(
            {
              id: user.id,
              email: user.email,
              real_name: signupData.fullName,
              branch: signupData.branch,
              updated_at:
                new Date().toISOString(),
            },
            {
              onConflict: "id",
            }
          );

        if (error) {
          console.error(
            "Profile save error:",
            error
          );
        } else {
          setFullName(
            signupData.fullName
          );

          setBranch(
            signupData.branch
          );

          localStorage.removeItem(
            "vibematch_signup"
          );
        }
      } else {
        const { data, error } =
          await supabase
            .from("private_profiles")
            .select("real_name, branch")
            .eq("id", user.id)
            .maybeSingle();

        if (!error && data) {
          setFullName(
            data.real_name || ""
          );

          setBranch(
            data.branch || ""
          );
        }
      }

      await checkExistingAnswers(user.id);
      await loadNotifications(user.id);
    } catch (error) {
      console.error(
        "User setup error:",
        error
      );
    }
  };

  /*
   * ====================================================
   * EXISTING ANSWERS
   * ====================================================
   */

  const checkExistingAnswers = async (
    userId
  ) => {
    const { data, error } =
      await supabase
        .from("vibe_answers")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

    if (error) {
      console.error(
        "Answer check error:",
        error
      );
      return;
    }

    if (data) {
      setQuestionnaireDone(true);

      setAnswers({
        1: data.q1 - 1,
        2: data.q2 - 1,
        3: data.q3 - 1,
        4: data.q4 - 1,
        5: data.q5 - 1,
        6: data.q6 - 1,
        7: data.q7 - 1,
      });

      setIdeaAnswer(
        data.idea_answer || ""
      );

      await loadMatches(userId);
    }
  };

  /*
   * ====================================================
   * GOOGLE LOGIN
   * ====================================================
   */

  const handleGoogleLogin = async () => {
    const name = fullName.trim();

    if (!name) {
      alert(
        "Please enter your full name."
      );
      return;
    }

    if (!branch) {
      alert(
        "Please select your branch."
      );
      return;
    }

    localStorage.setItem(
      "vibematch_signup",
      JSON.stringify({
        fullName: name,
        branch,
      })
    );

    const { error } =
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo:
            window.location.origin,
        },
      });

    if (error) {
      console.error(
        "Google login error:",
        error
      );

      localStorage.removeItem(
        "vibematch_signup"
      );

      alert(error.message);
    }
  };

  /*
   * ====================================================
   * MATCHES
   * ====================================================
   */

  const loadMatches = async (
    userId = session?.user?.id
  ) => {
    if (!userId) return;

    const { data, error } =
      await supabase
        .from("matches")
        .select("*")
        .or(
          `user1_id.eq.${userId},user2_id.eq.${userId}`
        )
        .order("created_at", {
          ascending: false,
        });

    if (error) {
      console.error(
        "Match load error:",
        error
      );
      return;
    }

    if (!data || data.length === 0) {
      setMatches([]);
      return;
    }

    const otherUserIds = data.map(
      (match) =>
        match.user1_id === userId
          ? match.user2_id
          : match.user1_id
    );

    const {
      data: profiles,
      error: profileError,
    } = await supabase
      .from("profiles")
      .select(
        "id, anonymous_name, avatar_emoji"
      )
      .in("id", otherUserIds);

    if (profileError) {
      console.error(
        "Profile load error:",
        profileError
      );
    }

    const profileMap = {};

    (profiles || []).forEach(
      (profile) => {
        profileMap[profile.id] =
          profile;
      }
    );

    const formattedMatches =
      data.map((match) => {
        const otherUserId =
          match.user1_id === userId
            ? match.user2_id
            : match.user1_id;

        return {
          ...match,
          otherUserId,
          profile:
            profileMap[otherUserId] || {
              anonymous_name:
                "VibeBuddy",
              avatar_emoji: "🤝",
            },
        };
      });

    setMatches(
      formattedMatches
    );
  };

  /*
   * ====================================================
   * SAVE VIBE ANSWERS
   * ====================================================
   */

  const submitAnswers = async () => {
    if (!session?.user) return;

    for (let i = 1; i <= 7; i++) {
      if (answers[i] === undefined) {
        alert(
          "Please answer all 7 questions."
        );
        return;
      }
    }

    setSavingAnswers(true);

    const {
      data: currentUserData,
    } = await supabase.auth.getUser();

    const user =
      currentUserData?.user;

    if (!user) {
      alert(
        "Session expired. Please login again."
      );

      setSavingAnswers(false);
      return;
    }

    const { error } =
      await supabase
        .from("vibe_answers")
        .upsert(
          {
            user_id: user.id,
            q1: answers[1] + 1,
            q2: answers[2] + 1,
            q3: answers[3] + 1,
            q4: answers[4] + 1,
            q5: answers[5] + 1,
            q6: answers[6] + 1,
            q7: answers[7] + 1,
            idea_answer:
              ideaAnswer.trim() || null,
            completed_at:
              new Date().toISOString(),
          },
          {
            onConflict: "user_id",
          }
        );

    if (error) {
      console.error(
        "Save answers error:",
        error
      );

      alert(error.message);
      setSavingAnswers(false);
      return;
    }

    setQuestionnaireDone(true);
    setSavingAnswers(false);

    await loadMatches(user.id);
    await loadNotifications(user.id);
  };

  /*
   * ====================================================
   * NOTIFICATIONS
   * ====================================================
   */

  const loadNotifications = async (
    userId = session?.user?.id
  ) => {
    if (!userId) return;

    setLoadingNotifications(true);

    const { data, error } =
      await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", {
          ascending: false,
        })
        .limit(30);

    if (error) {
      console.error(
        "Notification load error:",
        error
      );
    } else {
      setNotifications(
        data || []
      );
    }

    setLoadingNotifications(false);
  };

  const markNotificationRead =
    async (notificationId) => {
      const { error } =
        await supabase.rpc(
          "mark_notification_read",
          {
            p_notification_id:
              notificationId,
          }
        );

      if (error) {
        console.error(
          "Notification read error:",
          error
        );
        return;
      }

      setNotifications(
        (previous) =>
          previous.map(
            (notification) =>
              notification.id ===
              notificationId
                ? {
                    ...notification,
                    is_read: true,
                  }
                : notification
          )
      );
    };

  const toggleNotifications =
    async () => {
      const nextState =
        !showNotifications;

      setShowNotifications(
        nextState
      );

      if (
        nextState &&
        session?.user
      ) {
        await loadNotifications(
          session.user.id
        );
      }
    };

  /*
   * ====================================================
   * CHAT
   * ====================================================
   */

  const openChat = async (
    match
  ) => {
    setActiveMatch(match);
    setMessages([]);
    setRevealRequest(null);
    setRevealedProfile(null);
    setShowNotifications(false);
    setIsOtherOnline(false);
    setIsOtherTyping(false);

    await loadMessages(match.id);
    await loadRevealStatus(match);
    setupPresence(match);
    setupMessageRealtime(match);
  };

  const closeChat = () => {
    setActiveMatch(null);
    setMessages([]);
    setTimeLeft("");
    setRevealRequest(null);
    setRevealedProfile(null);
    setIsOtherOnline(false);
    setIsOtherTyping(false);
    setMyTyping(false);

    if (
      presenceChannelRef.current
    ) {
      supabase.removeChannel(
        presenceChannelRef.current
      );

      presenceChannelRef.current =
        null;
    }

    if (
      messageChannelRef.current
    ) {
      supabase.removeChannel(
        messageChannelRef.current
      );

      messageChannelRef.current =
        null;
    }
  };

  const setupMessageRealtime = (match) => {
    if (!match?.id) return;

    if (messageChannelRef.current) {
      supabase.removeChannel(
        messageChannelRef.current
      );
      messageChannelRef.current = null;
    }

    const channel = supabase
      .channel(`vibematch-messages-${match.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `match_id=eq.${match.id}`,
        },
        async (payload) => {
          const newMessage = payload.new;

          setMessages((previous) => {
            const alreadyExists = previous.some(
              (message) =>
                message.id === newMessage.id
            );

            if (alreadyExists) {
              return previous;
            }

            return [...previous, newMessage];
          });

          if (
            newMessage.sender_id !==
            session?.user?.id
          ) {
            await supabase.rpc(
              "mark_messages_seen",
              {
                p_match_id: match.id,
              }
            );
          }
        }
      )
      .subscribe();

    messageChannelRef.current = channel;
  };

  const loadMessages = async (
    matchId
  ) => {
    setLoadingMessages(true);

    const { data, error } =
      await supabase
        .from("messages")
        .select("*")
        .eq("match_id", matchId)
        .order("created_at", {
          ascending: true,
        });

    if (error) {
      console.error(
        "Messages load error:",
        error
      );
    } else {
      setMessages(data || []);

      if (data?.length > 0) {
        await supabase.rpc(
          "mark_messages_seen",
          {
            p_match_id: matchId,
          }
        );
      }
    }

    setLoadingMessages(false);
  };

  const sendMessage = async () => {
    const text =
      messageText.trim();

    if (
      !text ||
      !activeMatch ||
      !session?.user
    ) {
      return;
    }

    const {
      data,
      error,
    } = await supabase
      .from("messages")
      .insert({
        match_id:
          activeMatch.id,
        sender_id:
          session.user.id,
        message: text,
      })
      .select()
      .single();

    if (error) {
      console.error(
        "Send message error:",
        error
      );

      alert(
        "Message send nahi hua. Agar 24 hours expire ho gaye hain, pehle profile reveal complete karo."
      );

      return;
    }

    setMessages(
      (previous) => [
        ...previous,
        data,
      ]
    );

    setMessageText("");

    stopTyping();
  };

  /*
   * ====================================================
   * 24 HOUR TIMER
   * ====================================================
   */

  useEffect(() => {
    if (!activeMatch?.expires_at) {
      setTimeLeft("");
      return;
    }

    const updateTimer = () => {
      const difference =
        new Date(
          activeMatch.expires_at
        ).getTime() -
        Date.now();

      if (difference <= 0) {
        setTimeLeft(
          "Time expired"
        );
        return;
      }

      const totalSeconds =
        Math.floor(
          difference / 1000
        );

      const hours =
        Math.floor(
          totalSeconds / 3600
        );

      const minutes =
        Math.floor(
          (totalSeconds % 3600) /
            60
        );

      const seconds =
        totalSeconds % 60;

      setTimeLeft(
        `${hours}h ${minutes}m ${seconds}s remaining`
      );
    };

    updateTimer();

    const timerInterval =
      setInterval(
        updateTimer,
        1000
      );

    return () =>
      clearInterval(
        timerInterval
      );
  }, [activeMatch]);

  /*
   * ====================================================
   * REVEAL
   * ====================================================
   */

  const loadRevealStatus =
    async (match) => {
      if (
        !session?.user ||
        !match
      ) {
        return;
      }

      if (
        match.status ===
        "revealed"
      ) {
        const {
          data,
          error,
        } = await supabase.rpc(
          "get_revealed_profile",
          {
            p_match_id:
              match.id,
          }
        );

        if (error) {
          console.error(
            "Revealed profile error:",
            error
          );
          return;
        }

        if (
          data &&
          data.length > 0
        ) {
          setRevealedProfile(
            data[0]
          );
        }

        return;
      }

      const {
        data,
        error,
      } = await supabase
        .from("reveal_requests")
        .select("*")
        .eq("match_id", match.id)
        .maybeSingle();

      if (error) {
        console.error(
          "Reveal request load error:",
          error
        );
        return;
      }

      setRevealRequest(
        data || null
      );
    };

  const requestReveal =
    async () => {
      if (
        !activeMatch ||
        !session?.user
      ) {
        return;
      }

      setRevealLoading(true);

      const {
        data,
        error,
      } = await supabase.rpc(
        "request_reveal",
        {
          p_match_id:
            activeMatch.id,
        }
      );

      if (error) {
        console.error(
          "Reveal request error:",
          error
        );

        alert(error.message);
        setRevealLoading(false);
        return;
      }

      setRevealRequest(
        data?.[0] ||
          data ||
          null
      );

      alert(
        "Reveal request sent! Ab saamne wala accept ya reject kar sakta hai."
      );

      await loadNotifications(
        session.user.id
      );

      setRevealLoading(false);
    };

  const respondToReveal =
    async (accept) => {
      if (
        !revealRequest?.id
      ) {
        return;
      }

      setRevealLoading(true);

      const { error } =
        await supabase.rpc(
          "respond_reveal",
          {
            p_request_id:
              revealRequest.id,
            p_accept: accept,
          }
        );

      if (error) {
        console.error(
          "Reveal response error:",
          error
        );

        alert(error.message);
        setRevealLoading(false);
        return;
      }

      if (accept) {
        await loadMatches(
          session.user.id
        );

        const updatedMatch = {
          ...activeMatch,
          status: "revealed",
        };

        setActiveMatch(
          updatedMatch
        );

        const {
          data,
          error:
            profileError,
        } = await supabase.rpc(
          "get_revealed_profile",
          {
            p_match_id:
              activeMatch.id,
          }
        );

        if (
          !profileError &&
          data?.length > 0
        ) {
          setRevealedProfile(
            data[0]
          );
        }

        setRevealRequest(
          null
        );
      } else {
        setRevealRequest({
          ...revealRequest,
          status: "rejected",
        });
      }

      await loadNotifications(
        session.user.id
      );

      setRevealLoading(false);
    };

  /*
   * ====================================================
   * ONLINE / OFFLINE + TYPING
   * ====================================================
   */

  const setupPresence =
    async (match) => {
      if (
        !session?.user ||
        !match
      ) {
        return;
      }

      if (
        presenceChannelRef.current
      ) {
        await supabase.removeChannel(
          presenceChannelRef.current
        );

        presenceChannelRef.current =
          null;
      }

      const channel =
        supabase.channel(
          `vibematch-presence-${match.id}`,
          {
            config: {
              presence: {
                key:
                  session.user.id,
              },
            },
          }
        );

      channel
        .on(
          "presence",
          { event: "sync" },
          () => {
            const state =
              channel.presenceState();

            const otherUser =
              Object.keys(
                state
              ).find(
                (key) =>
                  key !==
                  session.user.id
              );

            setIsOtherOnline(
              Boolean(otherUser)
            );
          }
        )
        .on(
          "broadcast",
          { event: "typing" },
          ({ payload }) => {
            if (
              payload?.userId ===
              session.user.id
            ) {
              return;
            }

            setIsOtherTyping(
              Boolean(
                payload?.typing
              )
            );

            if (
              payload?.typing
            ) {
              setTimeout(
                () => {
                  setIsOtherTyping(
                    false
                  );
                },
                3000
              );
            }
          }
        )
        .subscribe(
          async (status) => {
            if (
              status ===
              "SUBSCRIBED"
            ) {
              await channel.track(
                {
                  online_at:
                    new Date().toISOString(),
                }
              );
            }
          }
        );

      presenceChannelRef.current =
        channel;
    };

  const sendTypingStatus =
    async (typing) => {
      const channel =
        presenceChannelRef.current;

      if (
        !channel ||
        !session?.user
      ) {
        return;
      }

      try {
        await channel.send({
          type: "broadcast",
          event: "typing",
          payload: {
            userId:
              session.user.id,
            typing,
          },
        });
      } catch (error) {
        console.error(
          "Typing broadcast error:",
          error
        );
      }
    };

  const handleMessageChange =
    (value) => {
      setMessageText(value);

      if (!value.trim()) {
        stopTyping();
        return;
      }

      if (!myTyping) {
        setMyTyping(true);
        sendTypingStatus(
          true
        );
      }

      if (
        typingTimeoutRef.current
      ) {
        clearTimeout(
          typingTimeoutRef.current
        );
      }

      typingTimeoutRef.current =
        setTimeout(() => {
          stopTyping();
        }, 1500);
    };

  const stopTyping = () => {
    if (
      typingTimeoutRef.current
    ) {
      clearTimeout(
        typingTimeoutRef.current
      );

      typingTimeoutRef.current =
        null;
    }

    if (myTyping) {
      setMyTyping(false);
      sendTypingStatus(
        false
      );
    }
  };

  /*
   * ====================================================
   * POLLING
   * ====================================================
   */

  useEffect(() => {
    if (!session?.user) return;

    const matchInterval =
      setInterval(() => {
        if (
          questionnaireDone &&
          !activeMatch
        ) {
          loadMatches(
            session.user.id
          );
        }
      }, 10000);

    const notificationInterval =
      setInterval(() => {
        loadNotifications(
          session.user.id
        );
      }, 5000);

    return () => {
      clearInterval(
        matchInterval
      );

      clearInterval(
        notificationInterval
      );
    };
  }, [
    session,
    questionnaireDone,
    activeMatch,
  ]);

  useEffect(() => {
    if (!activeMatch) return;

    // Messages are received through Supabase Realtime.
    // Only reveal status is checked periodically, so the chat
    // itself does not keep reloading every few seconds.
    const revealInterval =
      setInterval(() => {
        loadRevealStatus(
          activeMatch
        );
      }, 3000);

    return () =>
      clearInterval(
        revealInterval
      );
  }, [activeMatch]);

  /*
   * ====================================================
   * LOGOUT
   * ====================================================
   */

  const logout = async () => {
    if (
      presenceChannelRef.current
    ) {
      await supabase.removeChannel(
        presenceChannelRef.current
      );

      presenceChannelRef.current =
        null;
    }

    if (
      messageChannelRef.current
    ) {
      await supabase.removeChannel(
        messageChannelRef.current
      );

      messageChannelRef.current =
        null;
    }

    await supabase.auth.signOut();

    setSession(null);
    setQuestionnaireDone(false);
    setMatches([]);
    setNotifications([]);
    setActiveMatch(null);
    setMessages([]);
    setAnswers({});
    setIdeaAnswer("");
    setFullName("");
    setBranch("");
    setCurrentQuestion(0);
    setRevealRequest(null);
    setRevealedProfile(null);
  };

  /*
   * ====================================================
   * LOADING
   * ====================================================
   */

  if (loading) {
    return (
      <div className="app">
        <div className="landing-card">
          <div className="landing-emoji">
            🤝
          </div>

          <h1>Vibe🤝Match</h1>

          <p className="subtitle">
            Loading...
          </p>
        </div>
      </div>
    );
  }

  /*
   * ====================================================
   * LOGIN PAGE
   * ====================================================
   */

  if (!session) {
    return (
      <div className="app">
        <div className="landing-card">
          <div className="landing-emoji">
            🤝
          </div>

          <div className="logo">
            Vibe🤝Match
          </div>

          <p className="subtitle">
            Maybe your next friend is a stranger.
          </p>

          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: "7px",
              marginTop: "14px",
              marginBottom: "20px",
              fontSize: "12px",
              fontWeight: "700",
            }}
          >
            <span
              style={{
                padding: "6px 10px",
                borderRadius: "20px",
                background:
                  "rgba(255,255,255,0.7)",
              }}
            >
              Match.
            </span>

            <span
              style={{
                padding: "6px 10px",
                borderRadius: "20px",
                background:
                  "rgba(255,255,255,0.7)",
              }}
            >
              Chat.
            </span>

            <span
              style={{
                padding: "6px 10px",
                borderRadius: "20px",
                background:
                  "rgba(255,255,255,0.7)",
              }}
            >
              Reveal. ✨
            </span>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              marginTop: "10px",
              marginBottom: "18px",
              textAlign: "left",
            }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  marginBottom: "6px",
                  fontWeight: "600",
                }}
              >
                Full Name
              </label>

              <input
                type="text"
                value={fullName}
                onChange={(e) =>
                  setFullName(
                    e.target.value
                  )
                }
                placeholder="Enter your full name"
                maxLength={100}
                style={{
                  width: "100%",
                  boxSizing:
                    "border-box",
                  padding:
                    "12px 14px",
                  borderRadius:
                    "10px",
                  border:
                    "1px solid #ddd",
                  fontSize: "15px",
                }}
              />
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  marginBottom: "6px",
                  fontWeight: "600",
                }}
              >
                Branch
              </label>

              <select
                value={branch}
                onChange={(e) =>
                  setBranch(
                    e.target.value
                  )
                }
                style={{
                  width: "100%",
                  boxSizing:
                    "border-box",
                  padding:
                    "12px 14px",
                  borderRadius:
                    "10px",
                  border:
                    "1px solid #ddd",
                  fontSize: "15px",
                  background:
                    "white",
                }}
              >
                <option value="">
                  Select your branch
                </option>

                {branches.map(
                  (item) => (
                    <option
                      key={item}
                      value={item}
                    >
                      {item}
                    </option>
                  )
                )}
              </select>
            </div>
          </div>

          <button
            className="google-btn"
            onClick={
              handleGoogleLogin
            }
          >
            <span
              style={{
                display:
                  "inline-flex",
                alignItems:
                  "center",
                justifyContent:
                  "center",
                width: "22px",
                height: "22px",
                marginRight:
                  "8px",
                borderRadius:
                  "50%",
                background:
                  "white",
                color:
                  "#4285f4",
                fontWeight:
                  "800",
              }}
            >
              G
            </span>

            Continue with Google
          </button>

          <p
            className="college-note"
            style={{
              marginTop: "16px",
              fontSize: "11px",
              lineHeight: "1.5",
            }}
          >
            🎓 For IIT Ropar students •
            Your IIT email will be verified
          </p>
        </div>
      </div>
    );
  }

  /*
   * ====================================================
   * CHAT SCREEN
   * ====================================================
   */

  if (activeMatch) {
    const isExpired =
      timeLeft ===
      "Time expired";

    const isRevealed =
      activeMatch.status ===
        "revealed" ||
      revealedProfile;

    const requestWasSentByMe =
      revealRequest &&
      revealRequest.requester_id ===
        session.user.id;

    const requestReceivedFromOther =
      revealRequest &&
      revealRequest.receiver_id ===
        session.user.id;

    const anonymousName =
      getAnonymousName(
        activeMatch.otherUserId
      );

    return (
      <div className="app">
        <div className="chat-container">
          <div className="chat-header">
            <button
              className="back-btn"
              onClick={
                closeChat
              }
            >
              ←
            </button>

            <div className="chat-user-info">
              <div className="chat-avatar">
                {isRevealed
                  ? "👤"
                  : activeMatch
                      .profile
                      ?.avatar_emoji ||
                    "🤝"}
              </div>

              <div>
                <h2>
                  {isRevealed &&
                  revealedProfile?.real_name
                    ? revealedProfile.real_name
                    : anonymousName}
                </h2>

                {isRevealed &&
                revealedProfile ? (
                  <div
                    style={{
                      fontSize:
                        "13px",
                      opacity:
                        0.75,
                    }}
                  >
                    Profile revealed
                  </div>
                ) : (
                  <div
                    style={{
                      display:
                        "flex",
                      alignItems:
                        "center",
                      gap: "6px",
                      fontSize:
                        "13px",
                    }}
                  >
                    <span
                      style={{
                        width:
                          "8px",
                        height:
                          "8px",
                        borderRadius:
                          "50%",
                        background:
                          isOtherOnline
                            ? "#22c55e"
                            : "#9ca3af",
                        display:
                          "inline-block",
                      }}
                    />

                    {isOtherOnline
                      ? "Online"
                      : "Offline"}
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="anonymous-badge">
                {isRevealed
                  ? "Profile Revealed"
                  : "Anonymous"}
              </div>

              {timeLeft &&
                !isRevealed && (
                  <div className="chat-timer">
                    ⏳ {timeLeft}
                  </div>
                )}
            </div>
          </div>

          <div className="chat-match-info">
            🔥{" "}
            {
              activeMatch.match_percentage
            }
            % vibe match
          </div>

          <div className="messages-area">
            {loadingMessages ? (
              <div className="chat-empty">
                Loading messages...
              </div>
            ) : messages.length ===
              0 ? (
              <div className="chat-empty">
                <div
                  style={{
                    fontSize:
                      "40px",
                  }}
                >
                  👋
                </div>

                <h3>
                  Say hello!
                </h3>

                <p>
                  You both have a
                  similar vibe.
                  <br />
                  Start the
                  conversation
                  anonymously.
                </p>
              </div>
            ) : (
              messages.map(
                (message) => {
                  const isMine =
                    message.sender_id ===
                    session.user.id;

                  return (
                    <div
                      key={
                        message.id
                      }
                      className={
                        isMine
                          ? "message-row mine"
                          : "message-row"
                      }
                    >
                      <div
                        className={
                          isMine
                            ? "message-bubble mine"
                            : "message-bubble"
                        }
                      >
                        <div>
                          {
                            message.message
                          }
                        </div>

                        <small>
                          {new Date(
                            message.created_at
                          ).toLocaleTimeString(
                            [],
                            {
                              hour:
                                "2-digit",
                              minute:
                                "2-digit",
                            }
                          )}
                        </small>
                      </div>
                    </div>
                  );
                }
              )
            )}

            {isOtherTyping && (
              <div
                style={{
                  fontSize:
                    "13px",
                  opacity:
                    0.65,
                  padding:
                    "6px 10px",
                  fontStyle:
                    "italic",
                }}
              >
                {anonymousName}{" "}
                is typing...
              </div>
            )}
          </div>

          {/* Reveal area */}
          {isExpired &&
            !isRevealed && (
              <div
                style={{
                  padding:
                    "14px",
                  margin:
                    "10px",
                  borderRadius:
                    "14px",
                  background:
                    "rgba(255,255,255,0.8)",
                  border:
                    "1px solid #eee",
                  textAlign:
                    "center",
                }}
              >
                <div
                  style={{
                    fontSize:
                      "25px",
                  }}
                >
                  ⏰
                </div>

                <strong>
                  Your 24-hour anonymous
                  chat has ended.
                </strong>

                <p
                  style={{
                    fontSize:
                      "13px",
                    opacity:
                      0.7,
                    margin:
                      "6px 0 12px",
                  }}
                >
                  You can request to
                  reveal your profiles.
                </p>

                {!revealRequest && (
                  <button
                    className="primary-btn"
                    onClick={
                      requestReveal
                    }
                    disabled={
                      revealLoading
                    }
                  >
                    {revealLoading
                      ? "Sending..."
                      : "🔓 Request Profile Reveal"}
                  </button>
                )}

                {requestWasSentByMe &&
                  revealRequest.status ===
                    "pending" && (
                    <div
                      style={{
                        fontSize:
                          "13px",
                        opacity:
                          0.7,
                      }}
                    >
                      ⏳ Reveal request
                      sent. Waiting for
                      response...
                    </div>
                  )}

                {requestReceivedFromOther &&
                  revealRequest.status ===
                    "pending" && (
                    <div>
                      <p
                        style={{
                          fontWeight:
                            "600",
                          marginBottom:
                            "10px",
                        }}
                      >
                        🤝{" "}
                        {anonymousName}{" "}
                        wants to reveal
                        profiles.
                      </p>

                      <div
                        style={{
                          display:
                            "flex",
                          gap:
                            "10px",
                          justifyContent:
                            "center",
                        }}
                      >
                        <button
                          className="primary-btn"
                          onClick={() =>
                            respondToReveal(
                              true
                            )
                          }
                          disabled={
                            revealLoading
                          }
                        >
                          ✅ Accept
                        </button>

                        <button
                          className="secondary-btn"
                          onClick={() =>
                            respondToReveal(
                              false
                            )
                          }
                          disabled={
                            revealLoading
                          }
                        >
                          ❌ Reject
                        </button>
                      </div>
                    </div>
                  )}

                {revealRequest?.status ===
                  "rejected" && (
                  <div
                    style={{
                      color:
                        "#777",
                      fontSize:
                        "13px",
                    }}
                  >
                    Reveal request was
                    rejected.
                  </div>
                )}
              </div>
            )}

          {/* Revealed profile */}
          {isRevealed &&
            revealedProfile && (
              <div
                style={{
                  margin:
                    "10px",
                  padding:
                    "14px",
                  borderRadius:
                    "14px",
                  background:
                    "rgba(255,255,255,0.9)",
                  border:
                    "1px solid #eee",
                  textAlign:
                    "center",
                }}
              >
                <div
                  style={{
                    fontSize:
                      "32px",
                  }}
                >
                  🎉
                </div>

                <strong>
                  You both revealed your
                  profiles!
                </strong>

                <div
                  style={{
                    marginTop:
                      "8px",
                    fontSize:
                      "14px",
                    opacity:
                      0.8,
                  }}
                >
                  {revealedProfile.real_name}
                </div>
              </div>
            )}

          <div className="chat-input-area">
            <input
              type="text"
              value={messageText}
              onChange={(e) =>
                handleMessageChange(
                  e.target.value
                )
              }
              onKeyDown={(e) => {
                if (
                  e.key ===
                    "Enter" &&
                  !e.shiftKey
                ) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder={
                isExpired &&
                !isRevealed
                  ? "Chat expired — reveal profile to continue"
                  : "Type a message..."
              }
              disabled={
                isExpired &&
                !isRevealed
              }
              maxLength={2000}
            />

            <button
              onClick={
                sendMessage
              }
              disabled={
                !messageText.trim() ||
                (isExpired &&
                  !isRevealed)
              }
            >
              ➤
            </button>
          </div>
        </div>
      </div>
    );
  }

  /*
   * ====================================================
   * QUESTIONNAIRE
   * ====================================================
   */

  if (!questionnaireDone) {
    const isQuestion8 =
      currentQuestion === 7;

    const question =
      questions[currentQuestion];

    const isLastQuestion =
      currentQuestion === 7;

    return (
      <div className="app">
        <div className="questionnaire-card">
          <div className="logo">
            Vibe🤝Match
          </div>

          <div className="progress-text">
            {isQuestion8
              ? "Final Question"
              : `Question ${
                  currentQuestion + 1
                } / 8`}
          </div>

          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{
                width: `${
                  ((currentQuestion + 1) /
                    8) *
                  100
                }%`,
              }}
            />
          </div>

          {!isQuestion8 ? (
            <>
              <h2>
                {question.text}
              </h2>

              <div className="options">
                {question.options.map(
                  (option, index) => (
                    <button
                      key={option}
                      className={
                        answers[
                          question.id
                        ] === index
                          ? "option selected"
                          : "option"
                      }
                      onClick={() =>
                        setAnswers(
                          (previous) => ({
                            ...previous,
                            [question.id]:
                              index,
                          })
                        )
                      }
                    >
                      {option}
                    </button>
                  )
                )}
              </div>
            </>
          ) : (
            <>
              <h2>
                Tell us something about
                yourself so that we get
                the best vibe. 💭
              </h2>

              <p
                style={{
                  textAlign:
                    "center",
                  color:
                    "#777",
                  fontSize:
                    "14px",
                  lineHeight:
                    "1.5",
                  marginBottom:
                    "18px",
                }}
              >
                This is optional — tell us
                anything that helps us
                understand your vibe better.
              </p>

              <textarea
                value={ideaAnswer}
                onChange={(e) =>
                  setIdeaAnswer(
                    e.target.value
                  )
                }
                maxLength={500}
                placeholder="Anything interesting about you..."
                rows={7}
                style={{
                  width:
                    "100%",
                  boxSizing:
                    "border-box",
                  padding:
                    "14px",
                  borderRadius:
                    "14px",
                  border:
                    "1px solid #ddd",
                  resize:
                    "vertical",
                  fontSize:
                    "14px",
                }}
              />

              <div
                style={{
                  textAlign:
                    "right",
                  fontSize:
                    "12px",
                  opacity:
                    0.6,
                  marginTop:
                    "5px",
                }}
              >
                {
                  ideaAnswer.length
                }
                /500
              </div>
            </>
          )}

          <div
            style={{
              display:
                "flex",
              justifyContent:
                "space-between",
              gap:
                "10px",
              marginTop:
                "25px",
            }}
          >
            {currentQuestion >
            0 ? (
              <button
                className="secondary-btn"
                onClick={() =>
                  setCurrentQuestion(
                    (previous) =>
                      previous - 1
                  )
                }
              >
                ← Back
              </button>
            ) : (
              <div />
            )}

            {!isLastQuestion ? (
              <button
                className="primary-btn"
                disabled={
                  answers[
                    question.id
                  ] === undefined
                }
                onClick={() =>
                  setCurrentQuestion(
                    (previous) =>
                      previous + 1
                  )
                }
              >
                Next →
              </button>
            ) : (
              <button
                className="primary-btn"
                disabled={
                  savingAnswers
                }
                onClick={
                  submitAnswers
                }
              >
                {savingAnswers
                  ? "Finding..."
                  : "Find My Vibe 🤝"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  /*
   * ====================================================
   * DASHBOARD
   * ====================================================
   */

  return (
    <div className="app">
      <div className="dashboard-container">
        <header className="dashboard-header">
          <div>
            <div className="logo">
              Vibe🤝Match
            </div>

            <p className="dashboard-subtitle">
              Your vibe dashboard
            </p>
          </div>

          <div className="header-actions">
            <button
              className="notification-btn"
              onClick={
                toggleNotifications
              }
            >
              🔔

              {unreadNotifications >
                0 && (
                <span className="notification-count">
                  {
                    unreadNotifications
                  }
                </span>
              )}
            </button>

            <button
              className="logout-btn"
              onClick={logout}
            >
              Logout
            </button>
          </div>
        </header>

        {showNotifications && (
          <div className="notification-panel">
            <div className="notification-panel-header">
              <strong>
                Notifications
              </strong>

              <button
                className="notification-close"
                onClick={() =>
                  setShowNotifications(
                    false
                  )
                }
              >
                ✕
              </button>
            </div>

            {loadingNotifications ? (
              <div className="notification-empty">
                Loading...
              </div>
            ) : notifications.length ===
              0 ? (
              <div className="notification-empty">
                No notifications yet.
              </div>
            ) : (
              <div className="notification-list">
                {notifications.map(
                  (
                    notification
                  ) => (
                    <div
                      key={
                        notification.id
                      }
                      className={
                        notification.is_read
                          ? "notification-item"
                          : "notification-item unread"
                      }
                      onClick={() =>
                        markNotificationRead(
                          notification.id
                        )
                      }
                    >
                      <div className="notification-icon">
                        {notification.type ===
                        "new_match"
                          ? "🔥"
                          : notification.type ===
                            "new_message"
                          ? "💬"
                          : notification.type ===
                            "reveal_request"
                          ? "🔓"
                          : "🔔"}
                      </div>

                      <div className="notification-content">
                        <strong>
                          {
                            notification.title
                          }
                        </strong>

                        <p>
                          {
                            notification.body
                          }
                        </p>

                        <small>
                          {new Date(
                            notification.created_at
                          ).toLocaleString()}
                        </small>
                      </div>

                      {!notification.is_read && (
                        <span className="notification-dot" />
                      )}
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        )}

        <div className="welcome-card">
          <h2>
            Hey 👋
          </h2>

          <p>
            Your vibe is ready. We're
            automatically looking for
            students who match your
            answers.
          </p>
        </div>

        <section className="matches-section">
          <div className="section-heading">
            <div>
              <h2>
                Your Vibe Matches
              </h2>

              <p>
                Matching continues even
                when you're offline.
              </p>
            </div>
          </div>

          {matches.length ===
          0 ? (
            <div className="no-match-card">
              <div className="no-match-emoji">
                🔎
              </div>

              <h3>
                Still searching...
              </h3>

              <p>
                Don't worry. When another
                student with a compatible
                vibe joins, we'll create the
                match automatically.
              </p>
            </div>
          ) : (
            <div className="matches-grid">
              {matches.map(
                (match) => {
                  const anonymousName =
                    getAnonymousName(
                      match.otherUserId
                    );

                  return (
                    <div
                      className="match-card"
                      key={match.id}
                    >
                      <div className="match-avatar">
                        {match
                          .profile
                          ?.avatar_emoji ||
                          "🤝"}
                      </div>

                      <h3>
                        {
                          anonymousName
                        }
                      </h3>

                      <div className="match-percentage">
                        🔥{" "}
                        {
                          match.match_percentage
                        }
                        % Match
                      </div>

                      <div className="anonymous-badge">
                        Anonymous
                      </div>

                      <button
                        className="primary-btn"
                        onClick={() =>
                          openChat(
                            match
                          )
                        }
                      >
                        💬 Chat
                      </button>
                    </div>
                  );
                }
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default App;