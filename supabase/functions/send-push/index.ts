import { createClient } from "@supabase/supabase-js";
import { sendNotification } from "web-push-neo";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // -----------------------------
  // CORS
  // -----------------------------
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  try {
    // -----------------------------
    // Request body
    // -----------------------------
    const body = await req.json();

    const {
      targetUserId,
      title,
      message,
      matchId,
    } = body;

    console.log(
      "PUSH DEBUG - targetUserId:",
      targetUserId,
    );

    console.log(
      "PUSH DEBUG - matchId:",
      matchId,
    );

    // -----------------------------
    // Required fields
    // -----------------------------
    if (!targetUserId || !message) {
      return new Response(
        JSON.stringify({
          success: false,
          error:
            "targetUserId and message are required",
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        },
      );
    }

    // -----------------------------
    // Supabase admin client
    // -----------------------------
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get(
        "SUPABASE_SERVICE_ROLE_KEY",
      )!,
    );

    // -----------------------------
    // Receiver subscriptions
    // -----------------------------
    const {
      data: subscriptions,
      error: subscriptionError,
    } = await supabase
      .from("push_subscriptions")
      .select("id, user_id, subscription")
      .eq("user_id", targetUserId);

    if (subscriptionError) {
      console.error(
        "PUSH DEBUG - subscription query error:",
        subscriptionError,
      );

      throw subscriptionError;
    }

    console.log(
      "PUSH DEBUG - subscriptions:",
      subscriptions?.length || 0,
    );

    // -----------------------------
    // No subscription
    // -----------------------------
    if (
      !subscriptions ||
      subscriptions.length === 0
    ) {
      console.log(
        "PUSH DEBUG - NO SUBSCRIPTION FOUND",
      );

      return new Response(
        JSON.stringify({
          success: true,
          sent: 0,
          message:
            "Receiver has no push subscription",
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        },
      );
    }

    // -----------------------------
    // VAPID
    // -----------------------------
    const vapidPrivateKey =
      Deno.env.get(
        "VAPID_PRIVATE_KEY",
      );

    const vapidSubject =
      Deno.env.get("VAPID_SUBJECT");

    const vapidPublicKey =
      "BJcZ_NUj544QBesIh4aDKoQkmzY1faaIZt6kHwwDWLK3sqJpsGOM4qUHracDM9IGKzMscg5dHzBWHSrAkMdgru4";

    if (!vapidPrivateKey) {
      throw new Error(
        "VAPID_PRIVATE_KEY secret is missing",
      );
    }

    if (!vapidSubject) {
      throw new Error(
        "VAPID_SUBJECT secret is missing",
      );
    }

    // -----------------------------
    // Notification payload
    // -----------------------------
    const payload = JSON.stringify({
      title:
        title || "New message 💬",

      body: message,

      matchId:
        matchId || null,

      url: matchId
        ? `/?matchId=${encodeURIComponent(
            matchId,
          )}`
        : "/",
    });

    console.log(
      "PUSH DEBUG - payload created",
    );

    // -----------------------------
    // Send notifications
    // -----------------------------
    let sent = 0;

    const errors: string[] = [];

    for (const row of subscriptions) {
      console.log(
        "PUSH DEBUG - trying subscription:",
        row.id,
      );

      try {
        await sendNotification(
          row.subscription,
          payload,
          {
            vapidDetails: {
              subject:
                vapidSubject,

              publicKey:
                vapidPublicKey,

              privateKey:
                vapidPrivateKey,
            },

            TTL: 60,

            urgency: "high",
          },
        );

        sent++;

        console.log(
          "PUSH DEBUG - SUCCESS subscription:",
          row.id,
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : String(error);

        console.error(
          "PUSH DEBUG - SEND ERROR:",
          errorMessage,
        );

        errors.push(
          `Subscription ${row.id}: ${errorMessage}`,
        );

        // -----------------------------
        // Remove expired/invalid
        // subscription
        // -----------------------------
        const lowerError =
          errorMessage.toLowerCase();

        if (
          lowerError.includes("404") ||
          lowerError.includes("410") ||
          lowerError.includes(
            "not found",
          ) ||
          lowerError.includes(
            "expired",
          ) ||
          lowerError.includes(
            "subscription",
          ) &&
            lowerError.includes(
              "invalid",
            )
        ) {
          console.log(
            "PUSH DEBUG - deleting invalid subscription:",
            row.id,
          );

          const {
            error:
              deleteError,
          } = await supabase
            .from("push_subscriptions")
            .delete()
            .eq("id", row.id);

          if (deleteError) {
            console.error(
              "PUSH DEBUG - delete subscription error:",
              deleteError,
            );
          }
        }
      }
    }

    // -----------------------------
    // Final result
    // -----------------------------
    console.log(
      "PUSH DEBUG - FINAL sent:",
      sent,
    );

    console.log(
      "PUSH DEBUG - FINAL errors:",
      errors,
    );

    return new Response(
      JSON.stringify({
        success: true,
        sent,
        errors,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type":
            "application/json",
        },
      },
    );
  } catch (error) {
    console.error(
      "PUSH DEBUG - FUNCTION ERROR:",
      error,
    );

    return new Response(
      JSON.stringify({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type":
            "application/json",
        },
      },
    );
  }
});
