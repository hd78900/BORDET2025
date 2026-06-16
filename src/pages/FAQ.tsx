import React from 'react';
import { HelpCircle } from 'lucide-react';

export default function FAQ() {
  const faqs = [
    {
      question: "Qu'est-ce que Les assistants Bordet ?",
      answer: "L'Assistant bordet.fr est un agent conversationnel spécialisé qui utilise exclusivement la base de connaissance du site bordet.fr."
    },
    {
      question: "Comment utiliser les assistants ?",
      answer: "1. Connectez-vous avec vos identifiants\n2. Sélectionnez l'assistant approprié dans les onglets\n3. Posez vos questions dans la zone de texte\n4. Utilisez le bouton de copie pour sauvegarder les réponses\n5. Sauvegardez vos conversations importantes"
    },
    {
      question: "Comment sauvegarder une conversation ?",
      answer: "Cliquez sur l'icône de sauvegarde (💾) à gauche de la zone de saisie pour enregistrer la conversation en cours. Les conversations sauvegardées sont accessibles dans la barre latérale gauche."
    },
    {
      question: "Comment copier une réponse ?",
      answer: "Chaque réponse de l'assistant dispose d'un bouton de copie (📋) à droite du message. Cliquez dessus pour copier le contenu dans votre presse-papiers."
    },
    {
      question: "Qu'est-ce que le mode test ?",
      answer: "Le mode test, accessible depuis les paramètres, permet d'utiliser l'IA sans la base de connaissances. Cela peut être utile pour tester différentes formulations ou pour des questions générales."
    },
    {
      question: "Comment configurer l'IA ?",
      answer: "Dans les paramètres, vous pouvez ajuster plusieurs aspects de l'IA :\n\n1. Modèle : Choisissez entre Tiny (rapide), Small (équilibré), Medium (avancé) ou Large (performances maximales)\n2. Température : Contrôle la créativité des réponses (0 = factuel, 1 = créatif)\n3. Message système : Définit le comportement général de l'IA\n4. Règles contextuelles : Personnalise les instructions pour chaque assistant"
    },
    {
      question: "Que signifie la température de l'IA ?",
      answer: "La température est un paramètre qui contrôle la créativité et la variabilité des réponses de l'IA :\n\n- Température basse (0-0.3) : Réponses plus cohérentes et factuelles\n- Température moyenne (0.4-0.7) : Bon équilibre entre précision et créativité\n- Température élevée (0.8-1.0) : Réponses plus créatives et variées"
    },
    {
      question: "Comment configurer le widget public ?",
      answer: "Le widget public peut être configuré dans les paramètres :\n\n1. Activation : Utilisez le bouton pour activer/désactiver le widget\n2. Titre : Personnalisez le titre affiché en haut du widget\n3. Message de bienvenue : Modifiez le message initial affiché aux visiteurs\n4. Prévisualisation : Testez l'apparence du widget en temps réel\n\nUne fois configuré, le widget peut être intégré sur n'importe quelle page web en utilisant le code fourni."
    }
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-8">
        <HelpCircle className="h-8 w-8 text-red-950" />
        <h1 className="text-3xl font-bold text-gray-900">Foire aux questions</h1>
      </div>

      <div className="space-y-8">
        {faqs.map((faq, index) => (
          <div key={index} className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              {faq.question}
            </h2>
            <div className="prose prose-red">
              {faq.answer.split('\n').map((line, i) => (
                <p key={i} className="text-gray-600">
                  {line}
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}