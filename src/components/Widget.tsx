import { useParams } from 'react-router-dom';
import WidgetCore from './WidgetCore';

export default function Widget() {
  const { botId } = useParams();
  if (!botId) return null;
  return <WidgetCore botId={botId} />;
}
