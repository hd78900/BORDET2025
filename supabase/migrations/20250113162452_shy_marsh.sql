/*
  # Effacer l'historique des conversations

  1. Changements
    - Supprime toutes les données de la table chat_messages
  
  2. Notes
    - Cette opération est irréversible
    - Les conversations futures ne seront pas affectées
*/

DELETE FROM chat_messages;