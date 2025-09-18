const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

Deno.serve(async (req: Request) => {
  // Gérer les requêtes OPTIONS (preflight CORS)
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    console.log('🌐 Widget Status API - Démarrage...');
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    
    console.log('🔗 Connexion avec clé anonyme...');
    
    // Import dynamique pour éviter les erreurs
    const { createClient } = await import('npm:@supabase/supabase-js@2');
    
    // Créer le client Supabase avec la clé anonyme (accès public)
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    if (req.method === 'GET') {
      console.log('📡 GET /widget-status - Récupération des paramètres...');
      
      try {
        // Récupérer depuis la table (accès public configuré)
        const { data, error } = await supabase
          .from('widget_settings')
          .select('enabled, title, welcome_message, updated_at')
          .eq('id', 1)
          .single();

        console.log('📊 Résultat DB:', { data, error });

        if (error) {
          console.error('❌ Erreur DB:', error);
          // En cas d'erreur, retourner widget DÉSACTIVÉ pour permettre le contrôle
          return new Response(
            JSON.stringify({
              enabled: false, // DÉSACTIVÉ par défaut en cas d'erreur
              title: 'Assistant Bordet',
              welcome_message: 'Comment puis-je vous aider ?',
              debug: `DB Error: ${error.message}`,
              timestamp: new Date().toISOString(),
              fallback: true
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders,
              },
            }
          );
        }

        // Succès - retourner les vraies données
        const result = {
          enabled: data?.enabled ?? true,
          title: data?.title ?? 'Assistant Bordet',
          welcome_message: data?.welcome_message ?? 'Comment puis-je vous aider ?',
          updated_at: data?.updated_at,
          debug: 'Success - Public access',
          timestamp: new Date().toISOString(),
          fallback: false
        };

        console.log('✅ Réponse envoyée:', result);

        return new Response(
          JSON.stringify(result),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          }
        );

      } catch (dbError) {
        console.error('💥 Erreur lors de l\'accès DB:', dbError);
        
        return new Response(
          JSON.stringify({
            enabled: false, // WIDGET FORCÉ DÉSACTIVÉ
            title: 'Assistant Bordet',
            welcome_message: 'Comment puis-je vous aider ?',
            debug: `WIDGET FORCÉ DÉSACTIVÉ - DB Error: ${error.message}`,
            timestamp: new Date().toISOString(),
            fallback: true
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          }
        );
      }
    }

    // Méthode non supportée
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }), 
      { 
        status: 405,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      }
    );

  } catch (error) {
    console.error('💥 Erreur serveur critique:', error);
    
    // Fallback ultime - DÉSACTIVÉ pour permettre le contrôle
    return new Response(
      JSON.stringify({ 
        enabled: false, // DÉSACTIVÉ en cas d'erreur critique
        title: 'Assistant Bordet',
        welcome_message: 'Comment puis-je vous aider ?',
        debug: `Server Error: ${error.message}`,
        timestamp: new Date().toISOString(),
        fallback: true
      }),
      {
        status: 200, // 200 pour éviter les erreurs côté client
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      }
    );
  }
});