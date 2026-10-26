// Title, pause, settings and results screens. Buttons are wired once at construction.
import type { Game } from '../core/Game';
import type { BestRun } from '../core/Settings';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export type Screen = 'title' | 'pause' | 'settings' | 'results' | 'none';

export interface ResultStats { kills: number; headshots: number; contracts: number; salvage: number; caches: number; time: number; accuracy: number }

export class Menus {
  private settingsReturn: Screen = 'title';

  constructor(private game: Game) {
    $('btn-deploy').addEventListener('click', () => void this.game.deploy());
    $('btn-settings').addEventListener('click', () => this.openSettings('title'));
    $('btn-resume').addEventListener('click', () => void this.game.resume());
    $('btn-pause-settings').addEventListener('click', () => this.openSettings('pause'));
    $('btn-restart').addEventListener('click', () => this.game.restart());
    $('btn-quit').addEventListener('click', () => this.game.quitToTitle());
    $('btn-again').addEventListener('click', () => this.game.restart());
    $('btn-menu').addEventListener('click', () => this.game.quitToTitle());
    $('btn-settings-back').addEventListener('click', () => this.showScreen(this.settingsReturn));
    this.bindSettings();
    this.renderBest();
  }

  showScreen(s: Screen, note = ''): void {
    for (const id of ['title', 'pause', 'settings', 'results']) $(id).classList.toggle('hidden', id !== s);
    if (s === 'pause') this.setResumeNote(note);
    if (s === 'title') this.renderBest();
  }

  setResumeNote(t: string): void {
    $('resume-note').textContent = t;
  }

  showMap(open: boolean): void {
    $('tacmap').classList.toggle('hidden', !open);
  }

  private openSettings(from: Screen): void {
    this.settingsReturn = from;
    this.syncSettingsUI();
    this.showScreen('settings');
  }

  private bindSettings(): void {
    const g = this.game;
    const on = (id: string, ev: string, fn: (el: HTMLInputElement) => void) => $(id).addEventListener(ev, (e) => { fn(e.target as HTMLInputElement); g.applySettings(); this.syncSettingsUI(); });
    on('set-sens', 'input', (el) => { g.settings.sensitivity = +el.value; });
    on('set-fov', 'input', (el) => { g.settings.fov = +el.value; });
    on('set-vol', 'input', (el) => { g.settings.volume = +el.value; });
    on('set-quality', 'change', (el) => { g.settings.quality = el.value as never; });
    on('set-scale', 'change', (el) => { g.settings.renderScale = +el.value; });
    on('set-motion', 'change', (el) => { g.settings.reducedMotion = el.checked; });
    on('set-fps', 'change', (el) => { g.settings.showFps = el.checked; });
  }

  private syncSettingsUI(): void {
    const s = this.game.settings;
    $<HTMLInputElement>('set-sens').value = String(s.sensitivity);
    $('out-sens').textContent = s.sensitivity.toFixed(2);
    $<HTMLInputElement>('set-fov').value = String(s.fov);
    $('out-fov').textContent = String(s.fov);
    $<HTMLInputElement>('set-vol').value = String(s.volume);
    $('out-vol').textContent = `${Math.round(s.volume * 100)}%`;
    $<HTMLSelectElement>('set-quality').value = s.quality;
    $<HTMLInputElement>('set-scale').value = String(s.renderScale);
    $('out-scale').textContent = `${Math.round(s.renderScale * 100)}%`;
    $<HTMLInputElement>('set-motion').checked = s.reducedMotion;
    $<HTMLInputElement>('set-fps').checked = s.showFps;
  }

  private renderBest(): void {
    const b = this.game.bestRun;
    $('best-run').textContent = b ? `BEST EXTRACTION  ${fmt(b.time)}  ·  ${b.kills} KILLS  ·  ${b.headshots} HEADSHOTS` : '';
  }

  showResults(outcome: 'victory' | 'dead' | 'timeout', s: ResultStats, record: boolean, best: BestRun | null): void {
    const title = $('result-title');
    title.textContent = outcome === 'victory' ? 'YOU MADE IT OUT' : outcome === 'dead' ? 'SIGNAL LOST' : 'SWALLOWED';
    title.className = outcome === 'victory' ? 'win' : 'lose';
    $('result-kicker').textContent = outcome === 'victory' ? 'MISSION REPORT · SUCCESS' : 'MISSION REPORT · FAILURE';
    $('result-sub').textContent = outcome === 'victory'
      ? 'RAVEN 2-1 lifted off with you aboard, still shaking. The uplink data made it out. So did the proof that WARDEN-9 is finally dead.'
      : outcome === 'dead'
        ? 'Your signal went dark inside the exclusion zone. Nobody is coming for the body. Something already did.'
        : 'The rot swallowed the landing zone before you got out. RAVEN 2-1 didn\'t wait.';
    const cells: [string, string][] = [
      ['OUTCOME', outcome === 'victory' ? 'SUCCESS' : 'FAILED'],
      ['SURVIVAL TIME', fmt(s.time)],
      ['CONTRACTS', `${s.contracts} / 2`],
      ['KILLS', String(s.kills)],
      ['HEADSHOTS', String(s.headshots)],
      ['ACCURACY', `${Math.round(s.accuracy * 100)}%`],
      ['SALVAGE EARNED', `$${s.salvage.toLocaleString('en-US')}`],
      ['CACHES LOOTED', String(s.caches)],
      ['EXTRACTED', outcome === 'victory' ? 'YES' : 'NO'],
    ];
    const grid = $('result-stats');
    grid.replaceChildren(...cells.map(([k, v]) => {
      const d = document.createElement('div');
      d.className = 'stat';
      const vv = document.createElement('div'); vv.className = 'v'; vv.textContent = v;
      const kk = document.createElement('div'); kk.className = 'k2'; kk.textContent = k;
      d.append(vv, kk);
      return d;
    }));
    $('result-best').textContent = record ? 'NEW BEST EXTRACTION TIME' : best ? `BEST EXTRACTION  ${fmt(best.time)}` : '';
    this.showScreen('results');
  }
}

function fmt(t: number): string {
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
