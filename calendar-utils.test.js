import assert from "node:assert/strict";
import test from "node:test";
import { createSlotId, nextWeeklyReminder } from "./calendar-utils.js";

test("createSlotId normalizes Spanish day names and time ranges", () => {
  assert.equal(createSlotId("Miércoles", "10:00–11:00"), "miercoles-10-00-11-00");
});

test("nextWeeklyReminder schedules exactly one hour before this week's meeting", () => {
  const now = new Date(2026, 9, 19, 8, 0, 0);
  const { meeting, reminder } = nextWeeklyReminder("Lunes", "10:00–11:00", now);

  assert.equal(meeting.getTime() - reminder.getTime(), 60 * 60 * 1000);
  assert.equal(meeting.getDate(), 19);
  assert.equal(reminder.getHours(), 9);
});

test("nextWeeklyReminder skips a reminder time that has already passed", () => {
  const now = new Date(2026, 9, 19, 9, 30, 0);
  const { meeting, reminder } = nextWeeklyReminder("Lunes", "10:00–11:00", now);

  assert.equal(meeting.getDate(), 26);
  assert.equal(meeting.getHours(), 10);
  assert.equal(reminder.getHours(), 9);
});

test("nextWeeklyReminder finds the next weekday occurrence", () => {
  const now = new Date(2026, 9, 20, 11, 30, 0);
  const { meeting, reminder } = nextWeeklyReminder("Miércoles", "12:00–13:00", now);

  assert.equal(meeting.getDate(), 21);
  assert.equal(meeting.getHours(), 12);
  assert.equal(reminder.getDate(), 21);
  assert.equal(reminder.getHours(), 11);
});
