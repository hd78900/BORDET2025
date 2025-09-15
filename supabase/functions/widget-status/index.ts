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
    
    console.log('Widget Status API called');
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (req.method === 'GET') {
      // Récupérer le statut du widget depuis la base de données
      const { data, error } = await supabase
        .from('widget_settings')
        .select('enabled, title, welcome_message')
        .eq('id', 1)
        .single();

      console.log('Database query result:', { data, error });

      if (error) {
        console.error('Error fetching widget settings:', error);
        // Valeurs par défaut si pas de données
        return new Response(
          JSON.stringify({
            enabled: false, // Par défaut désactivé si erreur
            title: 'Assistant Bordet',
            welcome_message: 'Comment puis-je vous aider ?',
            debug: 'Database error: ' + error.message
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          }
        );
      }

      const result = {
        enabled: data?.enabled ?? false,
        title: data?.title ?? 'Assistant Bordet',
        welcome_message: data?.welcome_message ?? 'Comment puis-je vous aider ?',
        debug: 'Success from database'
      };

      console.log('Returning result:', result);

      return new Response(
        JSON.stringify(result),
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
        enabled: false, // Par défaut désactivé si erreur
        title: 'Assistant Bordet',
        welcome_message: 'Comment puis-je vous aider ?',
        debug: 'Server error: ' + error.message
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