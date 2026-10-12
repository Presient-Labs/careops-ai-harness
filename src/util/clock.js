export const systemClock = { now: () => new Date() };
export const fixedClock = (iso) => ({ now: () => new Date(iso) });
const NY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
export const nyDate = (date) => NY.format(date); // 'YYYY-MM-DD'
// The real-browser test's clock: real time plus an offset the test moves forward (CAREOPS_TEST_CLOCK=1, never production).
export function adjustableClock() {
  let offset = 0;
  return { now: () => new Date(Date.now() + offset), advance: (ms) => { offset += ms; } };
}
