// Horrors.Fun account panel on the title screen and achievement toasts during play. Neither ever blocks input.
import { account, achievementIcon, SIGN_IN_URL, type EarnedAchievement } from '../account/Account';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

function link(text: string, cls: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = SIGN_IN_URL;
  a.target = '_blank';
  a.rel = 'noopener';
  a.className = cls;
  a.textContent = text;
  return a;
}

function span(text: string, cls: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}

/** Title screen: who's playing and whether this mission can earn achievements. */
export class AccountPanel {
  private el = $('account');

  constructor() {
    account.onChange(() => this.render());
    this.render();
  }

  render(): void {
    const s = account.session;
    const rows: HTMLElement[] = [];
    if (!account.checked) {
      rows.push(span('CHECKING HORRORS.FUN SIGN-IN…', 'acct-note'));
    } else if (!s) {
      rows.push(link('Sign in on horrors.fun to earn achievements', 'acct-cta'));
      rows.push(span('Sign in there, then come back to this tab. You can play without signing in.', 'acct-note'));
    } else {
      const ranked = s.games?.survive === true;
      const who = document.createElement('div');
      who.className = 'acct-who';
      who.append(span('PLAYING AS', 'acct-label'), span(s.username, 'acct-name'), span('·', 'acct-sep'),
        span(ranked ? 'RANKED' : 'FREE', ranked ? 'acct-mode ranked' : 'acct-mode'));
      rows.push(who);
      if (!ranked) rows.push(link('Buy Survive on horrors.fun for ranked points', 'acct-link'));
    }
    if (!account.reporting) rows.push(span('DEV HOOKS ON · THIS SESSION IS NOT REPORTED', 'acct-note warn'));
    this.el.replaceChildren(...rows);
  }
}

const TOAST_MS = 4000;
const MAX_VISIBLE = 3;

/** In-game achievement toasts, queued and shown a few at a time. */
export class AchievementToasts {
  private box = $('ach-toasts');
  private queue: EarnedAchievement[] = [];
  private visible = 0;

  show(list: EarnedAchievement[]): void {
    this.queue.push(...list);
    this.pump();
  }

  private pump(): void {
    while (this.visible < MAX_VISIBLE && this.queue.length) this.add(this.queue.shift()!);
  }

  private add(a: EarnedAchievement): void {
    const el = document.createElement('div');
    el.className = 'ach-toast';
    const img = document.createElement('img');
    img.className = 'ach-icon';
    img.alt = '';
    img.addEventListener('error', () => { img.style.display = 'none'; }); // icons go live later
    img.src = achievementIcon(a.id);
    const text = document.createElement('div');
    text.className = 'ach-text';
    text.append(span('ACHIEVEMENT UNLOCKED', 'ach-kicker'), span(a.name, 'ach-name'),
      span(a.status === 'review' ? 'in review' : `+${a.points} pts`, a.status === 'review' ? 'ach-pts review' : 'ach-pts'));
    el.append(img, text);
    this.box.appendChild(el);
    this.visible++;
    window.setTimeout(() => {
      el.classList.add('out');
      window.setTimeout(() => {
        el.remove();
        this.visible--;
        this.pump();
      }, 300);
    }, TOAST_MS);
  }
}
