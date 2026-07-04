import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const { payment_id } = await req.json();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );

  const { data, error } = await supabase
    .from("payments")
    .select("*, businesses(name, slug), payers(full_name, phone, email), items(title, total_amount)")
    .eq("id", payment_id)
    .single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const branding =
    data.businesses.slug === "graphics"
      ? {
          primary: "#1C1F26",
          accent: "#1F6E52",
          success: "#C9974C",
          alert: "#B5533C",
          tagline: "Where Creativity Meets Strategy.",
        }
      : {
          primary: "#1F2A44",
          accent: "#3B4E8C",
          success: "#D9A441",
          alert: "#C4665A",
          tagline: "Professional design education.",
        };

  return new Response(JSON.stringify({ payment: data, branding }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
