import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Pour l'instant, on retourne toujours enabled: false pour tester
    // Plus tard, on pourra connecter à Supabase pour récupérer la vraie valeur
    const status = {
      enabled: false, // Changez ça pour tester
      timestamp: new Date().toISOString()
    }

    return new Response(
      JSON.stringify(status),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ 
        enabled: true, // Par défaut activé en cas d'erreur
        error: error.message 
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    )
  }
})