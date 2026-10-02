import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { describeSchedule, intervalWords, calendarWords, nextCalendarFire, nextRun } from '../src/schedule.js';
import { readPlist } from '../src/plist.js';
import { EXAMPLES } from './helpers.js';

test('interval words', () => {
  assert.equal(intervalWords(30), 'every 30 seconds');
  assert.equal(intervalWords(60), 'every minute');
  assert.equal(intervalWords(300), 'every 5 minutes');
  assert.equal(intervalWords(3600), 'every hour');
  assert.equal(intervalWords(21600), 'every 6 hours');
  assert.equal(intervalWords(86400), 'every day');
  assert.equal(intervalWords(90), 'every 90 seconds');
});

test('calendar words follow launchd wildcards', () => {
  assert.equal(calendarWords({ Hour: 9, Minute: 0 }), 'daily at 09:00');
  assert.equal(calendarWords({ Minute: 15 }), 'every hour at :15');
  assert.equal(calendarWords({ Hour: 9 }), 'every minute from 09:00 to 09:59');
  assert.equal(calendarWords({}), 'every minute');
  assert.equal(calendarWords({ Weekday: 1, Hour: 8, Minute: 30 }), 'at 08:30 on Mondays');
  assert.equal(calendarWords({ Weekday: 7, Hour: 8, Minute: 30 }), 'at 08:30 on Sundays');
  assert.equal(calendarWords({ Day: 1, Hour: 0, Minute: 0 }), 'at 00:00 on day 1 of each month');
  assert.equal(calendarWords({ Day: 15, Month: 3, Hour: 12, Minute: 5 }), 'at 12:05 on day 15 of March');
  assert.equal(calendarWords({ Month: 12, Hour: 6, Minute: 0 }), 'at 06:00 in December');
});

test('the example plists describe their schedules', () => {
  const hello = describeSchedule(readPlist(path.join(EXAMPLES, 'com.example.launchboard.hello.plist')));
  assert.equal(hello.kind, 'interval');
  assert.equal(hello.text, 'every 5 minutes, and once when it loads');
  const morning = describeSchedule(readPlist(path.join(EXAMPLES, 'com.example.launchboard.morning.plist')));
  assert.equal(morning.kind, 'calendar');
  assert.equal(morning.text, 'daily at 09:00');
});

test('other kinds of trigger', () => {
  assert.equal(describeSchedule({ KeepAlive: true }).kind, 'daemon');
  assert.equal(describeSchedule({ KeepAlive: { SuccessfulExit: false } }).text, 'restarted by launchd when its KeepAlive conditions hold');
  assert.equal(describeSchedule({ KeepAlive: false }).kind, 'demand');
  assert.equal(describeSchedule({ WatchPaths: ['/tmp/x'] }).text, 'when a watched path changes');
  assert.equal(describeSchedule({ RunAtLoad: true }).text, 'once when it loads, then only on demand');
  assert.equal(describeSchedule({}).text, 'only when something starts it');
  assert.equal(describeSchedule({ MachServices: { 'com.example.svc': true } }).text, 'on demand, when another program connects to it');
  const many = describeSchedule({ StartCalendarInterval: [{ Hour: 1, Minute: 0 }, { Hour: 2, Minute: 0 }, { Hour: 3, Minute: 0 }, { Hour: 4, Minute: 0 }, { Hour: 5, Minute: 0 }] });
  assert.equal(many.text, 'daily at 01:00; daily at 02:00; daily at 03:00; 2 more times');
});

test('the next calendar fire is the next matching local minute', () => {
  const from = new Date(2026, 9, 1, 16, 0).getTime();
  assert.equal(nextCalendarFire({ Hour: 9, Minute: 0 }, from), new Date(2026, 9, 2, 9, 0).getTime());
  assert.equal(nextCalendarFire({ Minute: 15 }, from), new Date(2026, 9, 1, 16, 15).getTime());
  // 2026-10-05 is a Monday.
  assert.equal(nextCalendarFire([{ Weekday: 1, Hour: 8, Minute: 30 }], from), new Date(2026, 9, 5, 8, 30).getTime());
  assert.equal(nextCalendarFire({ Day: 31, Month: 2, Hour: 0, Minute: 0 }, from), null);
});

test('the next interval run counts from the last start', () => {
  const now = Date.parse('2026-10-01T20:00:00Z');
  assert.equal(nextRun({ interval: 300 }, { now, lastStart: now - 60e3 }), now + 240e3);
  assert.equal(nextRun({ interval: 300 }, { now, lastStart: now - 1800e3 }), now + 300e3);
  assert.equal(nextRun({ interval: 300 }, { now, lastStart: null }), null);
});
