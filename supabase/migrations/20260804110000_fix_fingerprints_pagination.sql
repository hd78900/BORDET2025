/*
  # Correctif : `product_feed_fingerprints` était tronquée à 1 000 lignes

  Symptôme : la synchro annonçait 4 493 fiches « modifiées » sur 5 492 alors que le contenu stocké
  était rigoureusement identique à celui du feed (vérifié fiche par fiche). 5 492 − 999 = 4 493 :
  la fonction renvoyant une TABLE, PostgREST appliquait sa limite de lignes par défaut et seules
  ~1 000 empreintes parvenaient à l'Edge Function ; toutes les autres fiches paraissaient nouvelles.

  Conséquence évitée : ~4 500 embeddings inutiles à CHAQUE exécution hebdomadaire, et un indicateur
  « changed » dénué de sens.

  Correctif : renvoyer un unique objet jsonb {source_uid: empreinte} au lieu d'un ensemble de lignes.
  Une seule ligne = aucune pagination possible, quelle que soit la taille du catalogue.
*/

DROP FUNCTION IF EXISTS public.product_feed_fingerprints(text);

CREATE OR REPLACE FUNCTION public.product_feed_fingerprints(p_bot_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    jsonb_object_agg(d.source_uid, encode(extensions.digest(d.content, 'sha256'), 'hex')),
    '{}'::jsonb
  )
  FROM public.documents d
  WHERE d.bot_id = p_bot_id
    AND d.source_uid IS NOT NULL
    AND d.metadata->>'source_type' = 'product';
$$;

REVOKE ALL ON FUNCTION public.product_feed_fingerprints(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_feed_fingerprints(text) TO service_role;
