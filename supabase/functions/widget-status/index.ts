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
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    console.log('🌐 Widget Status API - Accès public autorisé');
    
    // Utiliser la clé service pour accès public à cette table spécifique
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    if (req.method === 'GET') {
      console.log('📡 Récupération des paramètres widget...');
      
      // Récupérer le statut du widget depuis la base de données
      const { data, error } = await supabase
        .from('widget_settings')
        .select('enabled, title, welcome_message')
        .eq('id', 1)
        .single();

      console.log('📊 Résultat base de données:', { data, error });

      if (error) {
        console.error('❌ Erreur base de données:', error);
        // Valeurs par défaut si pas de données
        return new Response(
          JSON.stringify({
            enabled: false, // Par défaut désactivé si erreur
            title: 'Assistant Bordet',
            welcome_message: 'Comment puis-je vous aider ?',
            debug: 'Database error: ' + error.message,
            timestamp: new Date().toISOString()
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
        debug: 'Success - Accès public autorisé',
        timestamp: new Date().toISOString()
      };

      console.log('✅ Réponse envoyée:', result);

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
    console.error('💥 Erreur serveur:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        enabled: false, // Par défaut désactivé si erreur
        title: 'Assistant Bordet',
        welcome_message: 'Comment puis-je vous aider ?',
        debug: 'Server error: ' + error.message,
        timestamp: new Date().toISOString()
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