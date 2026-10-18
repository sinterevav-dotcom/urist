// Точка входа Worker: только default export (именованные экспорты держим в core.js)
import { handler } from './core.js';

export default handler;
