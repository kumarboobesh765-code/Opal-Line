import { logger } from '../logger'

/**
 * Shared periodic scheduling.
 *
 * Nine modules used to each carry their own `schedule()` built on `setTimeout`,
 * and one of them had to grow a workaround on its own:
 *
 *   `setTimeout` cannot represent a delay beyond 2^31-1 ms (~24.85 days). A
 *   larger value overflows to 1, the timer fires immediately, and a callback
 *   that re-arms itself and then runs the job spins in a tight loop. The
 *   monthly-statements scheduler hit exactly this and pinned a core.
 *
 * This helper makes the clamp and the re-check the default for everyone, so the
 * next module with a long interval cannot reintroduce the bug by forgetting.
 */

/** The largest delay `setTimeout` can represent. Anything above overflows to 1. */
export const MAX_TIMER_MS = 2 ** 31 - 1

/** How long a single clamped wake-up sleeps before re-checking. */
const CHUNK_MS = 6 * 60 * 60 * 1000 // 6 hours, comfortably inside the ceiling

/**
 * Clamp a requested delay into a range `setTimeout` can actually represent.
 *
 * A non-finite or non-positive delay becomes 0 ("check now"). Passing a negative
 * delay through would also fire immediately, so clamping it to 0 keeps the
 * behaviour explicit rather than accidental.
 */
export function clampDelay(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.min(ms, MAX_TIMER_MS)
}

/**
 * Decide what a single wake-up should do.
 *
 * Pure, so the behaviour can be tested without a real timer.
 *
 * The rule is simply "run only if the job is actually due". Trusting the timer
 * instead is the bug this replaces: a timer that fires while time still
 * remains — because it overflowed, because it was chunked, or because it fired a
 * hair early — would otherwise run the job early and, having re-armed, do it
 * again on every subsequent tick.
 *
 * @param remaining what the job's own clock says is left until it is due
 */
export function planWakeUp(remaining: number): 'run' | 'rearm' {
  return remaining > 0 ? 'rearm' : 'run'
}

/** How long to sleep before the next wake-up, given what is left until due. */
export function nextDelay(remaining: number): number {
  return Math.min(clampDelay(remaining), CHUNK_MS)
}

export interface SchedulerOptions {
  /** Human-readable job name, used in log lines. */
  label: string
  /**
   * How long until this job should next run, in ms. Re-evaluated on every
   * wake-up, so a wall-clock schedule ("next 2am") stays correct across sleeps
   * and clock changes rather than drifting by the last interval's length.
   *
   * This must return time until the *next* occurrence. A function that always
   * returns 0 means the job is permanently due and the scheduler will spin.
   */
  msUntilNextRun: () => number
  /**
   * The work. A rejection is reported; it never stops the schedule.
   *
   * The return value is ignored, so jobs that resolve to a result (these jobs
   * are also callable by hand from routes) can be passed in directly.
   */
  run: () => unknown
  /**
   * `rearm-then-run` (default) re-arms before starting the work, so a slow job
   * cannot push the next tick out. `run-then-rearm` waits for the work to
   * settle, which suits jobs that must not overlap themselves.
   */
  mode?: 'rearm-then-run' | 'run-then-rearm'
  /** Override error reporting. Defaults to the shared logger. */
  onError?: (err: unknown) => void
}

export interface Scheduler {
  /** Arm the timer. Safe to call repeatedly; it replaces any pending timer. */
  schedule(): void
  /** Cancel the pending timer. The job will not run again until scheduled. */
  stop(): void
  /** Whether a timer is currently armed. */
  readonly armed: boolean
  /** Test seam: perform one wake-up immediately instead of waiting. */
  fire(): void
}

export function createScheduler(opts: SchedulerOptions): Scheduler {
  const { label, msUntilNextRun, run, mode = 'rearm-then-run', onError } = opts
  const report = onError ?? ((err: unknown) => logger.error({ err }, `${label} failed`))

  let timer: NodeJS.Timeout | null = null

  const clear = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  const arm = (delay: number): void => {
    clear()
    timer = setTimeout(() => {
      timer = null
      wake()
    }, delay)
    // Never hold the process open just because a job is pending.
    timer.unref?.()
  }

  /** One wake-up: run only if due, otherwise wait out the remainder. */
  function wake(): void {
    const remaining = msUntilNextRun()
    if (planWakeUp(remaining) === 'rearm') {
      arm(nextDelay(remaining))
      return
    }

    if (mode === 'rearm-then-run') {
      // Re-arm first so a slow job cannot push the next tick out.
      schedule()
    }

    try {
      const result = run()
      if (result instanceof Promise) {
        result.catch(report)
        if (mode === 'run-then-rearm') result.then(schedule, () => schedule())
      } else if (mode === 'run-then-rearm') {
        schedule()
      }
    } catch (err) {
      report(err)
      // A synchronous throw must still leave the job scheduled.
      if (mode === 'run-then-rearm') schedule()
    }
  }

  function schedule(): void {
    arm(nextDelay(msUntilNextRun()))
  }

  return {
    schedule,
    stop: clear,
    get armed(): boolean {
      return timer !== null
    },
    fire: () => {
      clear()
      wake()
    },
  }
}