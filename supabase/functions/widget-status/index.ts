const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { createClient } = await import('npm:@supabase/supabase-js@2');
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (req.method === 'GET') {
      // Récupérer le statut du widget depuis la base de données
      const { data, error } = await supabase
        .from('widget_settings')
        .select('enabled, title, welcome_message')
        .single();

      if (error) {
        console.error('Error fetching widget settings:', error);
        // Valeurs par défaut si pas de données
        return new Response(
          JSON.stringify({
            enabled: true,
            title: 'Assistant Bordet',
            welcome_message: 'Comment puis-je vous aider ?'
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          }
        );
      }

      return new Response(
        JSON.stringify({
          enabled: data?.enabled ?? true,
          title: data?.title ?? 'Assistant Bordet',
          welcome_message: data?.welcome_message ?? 'Comment puis-je vous aider ?'
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        }
      );
    }

    return new Response('Method not allowed', { 
      status: 405,
      headers: corsHeaders,
    });

  } catch (error) {
    console.error('Widget status error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        enabled: true,
        title: 'Assistant Bordet',
        welcome_message: 'Comment puis-je vous aider ?'
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      }
    );
  }
});