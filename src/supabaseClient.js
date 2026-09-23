import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://wmabfiwrgtfxclueuoiw.supabase.co";
const supabaseAnonKey = "sb_publishable_0vDJor2pCxjI9Y7MbYl86g_Pbzyz8Ci";

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey
);