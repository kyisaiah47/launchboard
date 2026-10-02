// What a job's plist says about when it runs, in words, plus the next time a calendar or interval
// job is due. launchd treats a missing calendar field as a wildcard, so { Hour: 9 } means every
// minute from 09:00 to 09:59, and the words below say so.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n) => String(n).padStart(2, '0');
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** "every 30 seconds", "every 5 minutes", "every hour", "every 6 hours". */
export function intervalWords(seconds) {
  const s = Math.round(seconds);
  if (s <= 0) return 'never (interval is 0)';
  const unit = (n, one, many) => (n === 1 ? `every ${one}` : `every ${n} ${many}`);
  if (s % 86400 === 0) return unit(s / 86400, 'day', 'days');
  if (s % 3600 === 0) return unit(s / 3600, 'hour', 'hours');
  if (s % 60 === 0) return unit(s / 60, 'minute', 'minutes');
  return unit(s, 'second', 'seconds');
}

/** One StartCalendarInterval entry in words. */
export function calendarWords(entry = {}) {
  const { Minute, Hour, Day, Weekday, Month } = entry;
  let time;
  if (isNum(Hour) && isNum(Minute)) time = `at ${pad(Hour)}:${pad(Minute)}`;
  else if (isNum(Hour)) time = `every minute from ${pad(Hour)}:00 to ${pad(Hour)}:59`;
  else if (isNum(Minute)) time = `every hour at :${pad(Minute)}`;
  else time = 'every minute';
  const parts = [];
  if (isNum(Weekday)) parts.push(`on ${DAYS[Weekday % 7]}s`);
  if (isNum(Day)) parts.push(`on day ${Day} of ${isNum(Month) ? MONTHS[Month - 1] || `month ${Month}` : 'each month'}`);
  else if (isNum(Month)) parts.push(`in ${MONTHS[Month - 1] || `month ${Month}`}`);
  if (!parts.length && isNum(Hour) && isNum(Minute)) return `daily ${time}`;
  return [time, ...parts].join(' ');
}

const asList = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : []);

/** The schedule of a parsed plist: { kind, text, interval, calendar }. */
export function describeSchedule(p = {}) {
  const triggers = [];
  let kind = null;
  const keepAlive = p.KeepAlive === true || (p.KeepAlive && typeof p.KeepAlive === 'object' && Object.keys(p.KeepAlive).length > 0);
  if (keepAlive) {
    kind = 'daemon';
    triggers.push(p.KeepAlive === true ? 'kept running by launchd' : 'restarted by launchd when its KeepAlive conditions hold');
  }
  const interval = isNum(p.StartInterval) ? p.StartInterval : null;
  if (interval != null) { kind = kind || 'interval'; triggers.push(intervalWords(interval)); }
  const calendar = asList(p.StartCalendarInterval);
  if (calendar.length) {
    kind = kind || 'calendar';
    const words = calendar.slice(0, 3).map(calendarWords);
    if (calendar.length > 3) words.push(`${calendar.length - 3} more times`);
    triggers.push(words.join('; '));
  }
  if (asList(p.WatchPaths).length || asList(p.QueueDirectories).length) { kind = kind || 'watch'; triggers.push('when a watched path changes'); }
  if (p.StartOnMount === true) { kind = kind || 'watch'; triggers.push('when a volume mounts'); }
  if (p.RunAtLoad === true) { kind = kind || 'load'; triggers.push(triggers.length ? 'once when it loads' : 'once when it loads, then only on demand'); }
  if (!kind) {
    kind = 'demand';
    const served = (p.MachServices && typeof p.MachServices === 'object' && Object.keys(p.MachServices).length) || (p.Sockets && typeof p.Sockets === 'object' && Object.keys(p.Sockets).length);
    triggers.push(served ? 'on demand, when another program connects to it' : 'only when something starts it');
  }
  const text = triggers.length > 1 ? `${triggers.slice(0, -1).join(', ')}, and ${triggers[triggers.length - 1]}` : triggers[0];
  return { kind, text, interval, calendar: calendar.length ? calendar : null };
}

const matches = (entry, d) =>
  (!isNum(entry.Minute) || entry.Minute === d.getMinutes()) &&
  (!isNum(entry.Hour) || entry.Hour === d.getHours()) &&
  (!isNum(entry.Day) || entry.Day === d.getDate()) &&
  (!isNum(entry.Weekday) || entry.Weekday % 7 === d.getDay()) &&
  (!isNum(entry.Month) || entry.Month === d.getMonth() + 1);

/** The next local minute a calendar schedule fires after `from` (ms), looking ahead up to 400 days. */
export function nextCalendarFire(entries, from) {
  const list = asList(entries);
  if (!list.length) return null;
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const end = from + 400 * 86400e3;
  while (d.getTime() <= end) {
    const dayOk = list.some((e) => (!isNum(e.Day) || e.Day === d.getDate()) && (!isNum(e.Weekday) || e.Weekday % 7 === d.getDay()) && (!isNum(e.Month) || e.Month === d.getMonth() + 1));
    if (!dayOk) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue; }
    const hourOk = list.some((e) => (!isNum(e.Hour) || e.Hour === d.getHours()) && (!isNum(e.Day) || e.Day === d.getDate()) && (!isNum(e.Weekday) || e.Weekday % 7 === d.getDay()) && (!isNum(e.Month) || e.Month === d.getMonth() + 1));
    if (!hourOk) { d.setHours(d.getHours() + 1, 0, 0, 0); continue; }
    if (list.some((e) => matches(e, d))) return d.getTime();
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

/** When the job is next due: calendar jobs from the calendar, interval jobs from their last start. */
export function nextRun(schedule, { now, lastStart = null } = {}) {
  if (!schedule) return null;
  if (schedule.calendar) return nextCalendarFire(schedule.calendar, now);
  if (schedule.interval && lastStart) {
    let next = lastStart + schedule.interval * 1000;
    if (next < now) next = now + ((schedule.interval * 1000) - ((now - lastStart) % (schedule.interval * 1000)));
    return next;
  }
  return null;
}
