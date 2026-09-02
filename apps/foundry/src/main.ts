import { createRouter } from './app/router';
import './styles.css';

const app = document.querySelector('#app');
if (!(app instanceof HTMLElement)) {
  throw new Error('#app missing');
}

createRouter(app);
