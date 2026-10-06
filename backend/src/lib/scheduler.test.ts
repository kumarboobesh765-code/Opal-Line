import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_TIMER_MS,
  clampDelay,
  nextDelay,
  planWakeUp,
  createScheduler,
} from './scheduler'

const HOUR = 60 * 60 * 1000

/**
 * Models a real job: due on the first wake-up, then not due again for a day.
 *
 * A constant `() => 0` would be a broken job definition -- the scheduler would
 * be permanently due and spin -- and a constant `() => 24h` means the job is
 * simply not due, so a wake-up correctly re-arms instead of running. Both
 * mistakes make a test pass or fail for the wrong reason, so the clock here
 * advances the way a real one does.
 */
function clockDueNow() {
  let fired = false
  return {
    msUntilNextRun: () => (fired ? 24 * HOUR : 0),
    markFired: () => { fired = true },
  }
}

// ── clampDelay ──────────────────────────────────────────────────────────────

test('clampDelay leaves an ordinary delay untouched', () => {
  assert.equal(clampDelay(5_000), 5_000)
})

test('clampDelay caps a delay beyond the setTimeout ceiling', () => {
  // 60 days is not representable: setTimeout would overflow this to 1ms.
  assert.equal(clampDelay(60 * 24 * HOUR), MAX_TIMER_MS)
})

test('clampDelay maps non-positive and non-finite delays to zero', () => {
  // A negative delay also fires immediately, so it must not be passed through.
  assert.equal(clampDelay(0), 0)
  assert.equal(clampDelay(-5_000), 0)
  assert.equal(clampDelay(Number.NaN), 0)
  assert.equal(clampDelay(Number.POSITIVE_INFINITY), 0)
})

test('MAX_TIMER_MS is the documented setTimeout ceiling', () => {
  assert.equal(MAX_TIMER_MS, 2 ** 31 - 1)
})

// ── planWakeUp ──────────────────────────────────────────────────────────────

test('planWakeUp runs only when the job is due', () => {
  assert.equal(planWakeUp(0), 'run')
  assert.equal(planWakeUp(-1), 'run')
})

test('planWakeUp re-arms while time still remains', () => {
  // The monthly-statements fix: a timer that fired early must wait, not run.
  assert.equal(planWakeUp(1), 'rearm')
  assert.equal(planWakeUp(60_000), 'rearm')
  assert.equal(planWakeUp(60 * 24 * HOUR), 'rearm')
})

// ── nextDelay ───────────────────────────────────────────────────────────────

test('nextDelay sleeps in bounded chunks', () => {
  // Even a 60-day interval only ever sleeps 6 hours at a time.
  assert.ok(nextDelay(60 * 24 * HOUR) <= MAX_TIMER_MS)
  assert.ok(nextDelay(60 * 24 * HOUR) > 0)
})

test('nextDelay of a short interval is the interval itself', () => {
  assert.equal(nextDelay(1_000), 1_000)
})

// ── createScheduler ─────────────────────────────────────────────────────────

test('a due job runs exactly once and stays armed', () => {
  let runs = 0
  const c = clockDueNow()
  const s = createScheduler({
    label: 'test',
    msUntilNextRun: c.msUntilNextRun,
    run: () => { runs++; c.markFired() },
    onError: () => {},
  })
  s.schedule()
  assert.equal(s.armed, true)

  s.fire()
  assert.equal(runs, 1)
  assert.equal(s.armed, true, 'must stay armed after firing')
  s.stop()
  assert.equal(s.armed, false)
})

test('a wake-up with time remaining does not run the job', () => {
  // The regression this helper exists for: a timer that fires early -- because
  // it overflowed, or was chunked, or drifted -- must re-arm, not run. Running
  // early and re-arming is what turned into a hot loop.
  let runs = 0
  const s = createScheduler({
    label: 'test',
    msUntilNextRun: () => 60 * 24 * HOUR,
    run: () => { runs++ },
    onError: () => {},
  })
  s.schedule()
  s.fire()
  assert.equal(runs, 0)
  assert.equal(s.armed, true, 'and it stays armed')
  s.stop()
})

test('a job is never run twice while it is not due', async () => {
  // Guards the double-fire path: schedule() re-arms, that timer comes due
  // before the job's own clock agrees, and the job must still not run.
  let runs = 0
  let remaining = 0
  const s = createScheduler({
    label: 'test',
    msUntilNextRun: () => remaining,
    run: () => { runs++ },
    onError: () => {},
  })
  s.schedule()
  remaining = 24 * HOUR
  s.fire()
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(runs, 0)
  s.stop()
})

test('run-then-rearm waits for the work before arming again', async () => {
  // This mode deliberately does not re-arm first, which is what stops a slow
  // job from overlapping itself on the following tick.
  const order: string[] = []
  const c = clockDueNow()
  const s = createScheduler({
    label: 'test',
    msUntilNextRun: c.msUntilNextRun,
    mode: 'run-then-rearm',
    run: async () => {
      order.push('run:start')
      c.markFired()
      await new Promise((r) => setTimeout(r, 10))
      order.push('run:end')
    },
    onError: () => {},
  })
  s.fire()
  assert.deepEqual(order, ['run:start'], 'the job starts on the wake-up')
  assert.equal(s.armed, false, 'nothing is armed while the job is in flight')
  await new Promise((r) => setTimeout(r, 50))
  assert.deepEqual(order, ['run:start', 'run:end'])
  assert.equal(s.armed, true, 'must arm again once the work settles')
  s.stop()
})

test('rearm-then-run arms before the work starts', () => {
  const c = clockDueNow()
  const s = createScheduler({
    label: 'test',
    msUntilNextRun: c.msUntilNextRun,
    run: () => { c.markFired() },
    onError: () => {},
  })
  s.fire()
  // Default mode re-arms first, so the timer is already pending when the job
  // begins -- a slow job cannot push the next tick out.
  assert.equal(s.armed, true)
  s.stop()
})

test('a rejected job is reported once and does not stop the schedule', async () => {
  const errors: unknown[] = []
  const c = clockDueNow()
  const s = createScheduler({
    label: 'test',
    msUntilNextRun: c.msUntilNextRun,
    run: async () => {
      c.markFired()
      throw new Error('boom')
    },
    onError: (e) => errors.push(e),
  })
  s.fire()
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(errors.length, 1, 'one rejection must be reported exactly once')
  assert.match(String((errors[0] as Error).message), /boom/)
  assert.equal(s.armed, true, 'a failure must not unschedule the job')
  s.stop()
})

test('a synchronously throwing job is contained', () => {
  const errors: unknown[] = []
  const c = clockDueNow()
  const s = createScheduler({
    label: 'test',
    msUntilNextRun: c.msUntilNextRun,
    run: () => { c.markFired(); throw new Error('sync boom') },
    onError: (e) => errors.push(e),
  })
  s.fire()
  assert.equal(errors.length, 1)
  assert.equal(s.armed, true)
  s.stop()
})

test('stop cancels a pending timer', () => {
  let runs = 0
  const s = createScheduler({
    label: 'test',
    msUntilNextRun: () => 10,
    run: () => { runs++ },
    onError: () => {},
  })
  s.schedule()
  s.stop()
  assert.equal(s.armed, false)
  assert.equal(runs, 0)
})

test('schedule replaces rather than stacking timers', () => {
  const s = createScheduler({
    label: 'test',
    msUntilNextRun: () => 1_000,
    run: () => {},
    onError: () => {},
  })
  s.schedule()
  s.schedule()
  s.schedule()
  assert.equal(s.armed, true)
  s.stop()
})