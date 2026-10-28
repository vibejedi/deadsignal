// Horrors.Fun accounts and achievements, backed by api.horrors.fun.
//
// Players sign up, sign in and burn $HORRORS on horrors.fun, never here. That sets a session cookie for all of
// horrors.fun; this game swaps it for a bearer token (POST /v1/auth/session). Signed-in players report each mission as a
// "run": the game streams what happens (kills, contracts, the mission clock, the result) and the server, which checks
// it against its own clock, decides which achievements it earned. This file only reports; it never awards anything.
// Signed-out players play exactly the same game, with nothing reported.

const API: string = import.meta.env.VITE_HORRORS_API ?? 'https://api.horrors.fun';
export const SIGN_IN_URL = 'https://horrors.fun/#play';
export const achievementIcon = (id: string) => `https://horrors.fun/achievements/${encodeURIComponent(id)}.webp`;
const FLUSH_MS = 3000;
const MAX_BATCH = 200; // the server takes up to 500 events per batch
// The mission clock starts at DEPLOY, before the server stamps the run's start. The server allows the mission clock 5 s
// ahead of its own; if starting the run took longer than this, the run would be rejected, so it isn't reported.
const MAX_START_LAG_S = 3;

export interface Session {
  token: string;
  expiresAt: number;
  username: string;
  wallet: string;
  walletVerified: boolean;
  ranked: boolean;
  games: { cleaning: boolean; survive: boolean; fiend: boolean };
}

export interface EarnedAchievement {
  id: string;
  name: string;
  points: number;
  status: 'ok' | 'review';
}

export type Outcome = 'victory' | 'dead' | 'timeout';
export type RunEvent =
  | { type: 'tick'; missionTime: number }
  | { type: 'kill'; headshot: boolean; elite: boolean }
  | { type: 'contract'; which: 'defense' | 'hunt' }
  | { type: 'end'; outcome: Outcome; missionTime: number };
type Stamped = RunEvent & { t: number };

class ApiError extends Error {
  constructor(public status: number, public data: Record<string, unknown>) {
    super(String(data.error ?? `http_${status}`));
  }
}

async function api<T>(path: string, opts: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const res = await fetch(API + path, {
    method: opts.method ?? 'GET',
    credentials: 'include', // the horrors.fun session cookie
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

/**
 * Dev hooks (`?dev`, dev server only) can speed up or skip the mission clock, which the server would reject as a
 * speed hack, so nothing is reported while they're on, unless `?devreport` asks for it (for testing the reporting).
 */
function reportingAllowed(): boolean {
  const q = new URLSearchParams(location.search);
  const devHooks = import.meta.env.DEV && q.has('dev');
  return !devHooks || q.has('devreport');
}

// ---------------------------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------------------------
type Listener = () => void;

class AccountState {
  session: Session | null = null;
  checked = false; // the first session check has finished
  readonly reporting = reportingAllowed();
  private listeners = new Set<Listener>();
  private checking: Promise<void> | null = null;

  onChange(fn: Listener): void {
    this.listeners.add(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** Picks up the sign-in from horrors.fun. Safe to call any time; overlapping calls share one request. */
  check(): Promise<void> {
    if (!this.checking) {
      this.checking = (async () => {
        try {
          this.session = await api<Session>('/v1/auth/session', { method: 'POST' });
        } catch (err) {
          // Signed out (or banned). Network trouble keeps whatever we had.
          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) this.session = null;
        } finally {
          this.checked = true;
          this.checking = null;
          this.emit();
        }
      })();
    }
    return this.checking;
  }

  /** Check now, and again whenever the player comes back to this tab (e.g. after signing in or burning). */
  watch(): void {
    void this.check();
    const recheck = () => { if (document.visibilityState === 'visible') void this.check(); };
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
  }

  /** Waits for a check already in flight, so a DEPLOY right after page load still reports. */
  async settled(): Promise<Session | null> {
    if (this.checking) await this.checking;
    return this.session;
  }
}

export const account = new AccountState();

// ---------------------------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------------------------

/** Returns the mission clock in seconds, or null if it can't be trusted (dev time scale), which ends reporting. */
export type MissionClock = () => number | null;

/** One mission's event stream: seq-numbered batches every few seconds, retried until the server takes them. */
class RunStream {
  private seq = 0;
  private queue: Stamped[] = [];
  private batch: { seq: number; events: Stamped[] } | null = null;
  private inFlight = false;
  private lastT = 0;
  private timer: number;
  ended = false; // the end event is queued; nothing more is added
  closed = false; // nothing more is sent

  constructor(
    readonly id: string,
    readonly mode: 'ranked' | 'free',
    private token: string,
    private t0: number,
    private clock: MissionClock,
    private onEarned: (a: EarnedAchievement[]) => void,
  ) {
    this.timer = window.setInterval(() => this.beat(), FLUSH_MS);
  }

  /** ms since this run started here, after the server stamped its start, so it can never run ahead of the server. */
  private now(): number {
    this.lastT = Math.max(this.lastT, Math.round(performance.now() - this.t0));
    return this.lastT;
  }

  push(e: RunEvent): void {
    if (this.closed || this.ended) return;
    this.queue.push({ ...e, t: this.now() });
    if (e.type === 'end') {
      this.ended = true;
      void this.flush();
    }
  }

  /** Every few seconds: report the mission clock (also while paused, which keeps the run alive) and send. */
  private beat(): void {
    if (!this.ended) {
      const m = this.clock();
      if (m === null) { this.close(); return; }
      this.push({ type: 'tick', missionTime: round(m) });
    }
    void this.flush();
  }

  async flush(): Promise<void> {
    if (this.closed || this.inFlight) return;
    if (!this.batch && this.queue.length) this.batch = { seq: this.seq, events: this.queue.splice(0, MAX_BATCH) };
    if (!this.batch) return;
    this.inFlight = true;
    let again = false; // sent fine (or renumbered): anything still queued can go straight away
    try {
      const res = await api<{ ok: boolean; ended?: boolean; duplicate?: boolean; achievements?: EarnedAchievement[] }>(
        `/v1/survive/runs/${this.id}/events`, { method: 'POST', token: this.token, body: this.batch });
      this.seq = this.batch.seq + 1;
      this.batch = null;
      if (res.achievements?.length) this.onEarned(res.achievements);
      if (res.ended) this.close();
      again = true;
    } catch (err) {
      if (!(err instanceof ApiError)) return; // network trouble: resend the same batch next beat (repeats are harmless)
      const { status, data } = err;
      if (status === 409 && err.message === 'bad_seq' && typeof data.expected === 'number') {
        // Out of step with the server. If it already has this batch, move past it; otherwise renumber and resend.
        if (data.expected > this.batch!.seq) { this.seq = data.expected; this.batch = null; }
        else { this.seq = data.expected; this.batch!.seq = data.expected; }
        again = true;
      } else if (status === 401) {
        // Token expired: pick up a fresh one from horrors.fun (same account) and carry on.
        await account.check();
        if (account.session) this.token = account.session.token;
        else this.close();
      } else if (status === 429 || status >= 500) {
        // Busy: try again next beat.
      } else {
        // 409 run_rejected / run_over, 404 no_such_run, 403 banned, 400: this run is finished as far as the server goes.
        console.info(`[horrors.fun] run ${this.id} stopped: ${err.message}${data.reason ? ` (${data.reason})` : ''}`);
        this.close();
      }
    } finally {
      this.inFlight = false;
    }
    // The end batch goes out straight away, including anything that queued up behind an earlier batch.
    if (again && this.ended && !this.closed && (this.batch || this.queue.length)) void this.flush();
  }

  close(): void {
    this.closed = true;
    clearInterval(this.timer);
  }
}

const round = (s: number) => Math.round(s * 100) / 100;

class Reporter {
  private current: RunStream | null = null;
  private pending: RunEvent[] | null = null; // events while the run is starting
  private generation = 0;
  /** Shown as achievement toasts. */
  onEarned: (a: EarnedAchievement[]) => void = () => {};

  /** A new mission started (DEPLOY, REDEPLOY or RESTART). Starts a run if the player is signed in. */
  async startRun(clock: MissionClock): Promise<void> {
    this.abandon();
    const gen = ++this.generation;
    if (!account.reporting) return;
    this.pending = [];
    try {
      const session = await account.settled();
      if (!session || gen !== this.generation) return;
      const { runId, mode } = await api<{ runId: string; mode: 'ranked' | 'free'; startedAt: number }>(
        '/v1/survive/runs', { method: 'POST', token: session.token });
      if (gen !== this.generation) return; // quit or restarted meanwhile; the server drops it on the next start
      const lag = clock();
      if (lag === null || lag > MAX_START_LAG_S) return;
      const run = new RunStream(runId, mode, session.token, performance.now(), clock, (a) => this.onEarned(a));
      this.current = run;
      for (const e of this.pending ?? []) run.push(e);
      void run.flush();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) void account.check();
      console.info(`[horrors.fun] not reporting this mission: ${(err as Error).message}`);
    } finally {
      if (gen === this.generation) this.pending = null;
    }
  }

  event(e: RunEvent): void {
    if (this.pending) this.pending.push(e);
    else this.current?.push(e);
  }

  /** The mission ended with a result: report it and send it now. */
  end(outcome: Outcome, missionTime: number): void {
    this.event({ type: 'end', outcome, missionTime: round(missionTime) });
  }

  /** Left the mission without a result (main menu or restart). A run whose end is still being sent finishes sending. */
  abandon(): void {
    this.generation++;
    this.pending = null;
    if (this.current && !this.current.ended) this.current.close();
    this.current = null;
  }

  get mode(): 'ranked' | 'free' | null {
    return this.current && !this.current.closed ? this.current.mode : null;
  }
}

export const reporter = new Reporter();
