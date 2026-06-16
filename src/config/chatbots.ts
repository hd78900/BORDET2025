import { ChatBot } from '../types';
import { Brain, BookOpen, Lightbulb } from 'lucide-react';

export const chatbots: ChatBot[] = [
  {
    id: 'bot1',
    name: 'Assistant bordet.fr',
    description: 'Assistant spécialiste de la marque Bordet',
    icon: Brain
  },
  {
    id: 'bot2',
    name: 'Assistant marketing',
    description: 'Spécialisé dans la création de contenus expert',
    icon: BookOpen
  },
  {
    id: 'bot3',
    name: 'Assistant équipes',
    description: 'Focus sur la consultation des connaissances des équipes',
    icon: Lightbulb
  }
];