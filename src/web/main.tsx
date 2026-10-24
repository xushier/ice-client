import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { bootstrap } from './store';

void bootstrap();

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
