import './style.css';
import { Game } from './core/Game';

function fail(msg: string): void {
  document.getElementById('loading')?.classList.add('hidden');
  const e = document.getElementById('error')!;
  document.getElementById('error-text')!.textContent = msg;
  e.classList.remove('hidden');
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  if (!webglAvailable()) {
    fail('This game needs WebGL, which is disabled or unsupported in this browser. Enable hardware acceleration or try a current version of Chrome, Edge or Firefox on a desktop computer.');
    return;
  }
  if (!('requestPointerLock' in HTMLElement.prototype)) {
    fail('This browser does not support mouse pointer lock, which is required for first-person controls. Please use a desktop browser.');
    return;
  }
  const fill = document.getElementById('load-fill')!;
  const text = document.getElementById('load-text')!;
  const progress = async (p: number, label: string) => {
    fill.style.width = `${Math.round(p * 100)}%`;
    text.textContent = label;
  };
  // Yield so the loading screen paints before heavy generation begins.
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  let game: Game;
  try {
    game = new Game(document.getElementById('app')!, (p, l) => void progress(p, l));
  } catch (err) {
    console.error(err);
    fail(`The game failed to start: ${(err as Error).message}`);
    return;
  }
  document.getElementById('loading')!.classList.add('hidden');
  game.menus.showScreen('title');
  // Development-only automation hooks. Stripped from production builds.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('dev')) {
    (window as unknown as { __DS: unknown }).__DS = game.devApi();
    console.info('[SURVIVE THE HORRORS] dev hooks available on window.__DS');
  }
}

window.addEventListener('error', (e) => console.error('[SURVIVE THE HORRORS] uncaught', e.error ?? e.message));
void boot();
