const WEEKDAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export function createSlotId(day, time) {
  const normalizedDay = day.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const normalizedTime = time.replace(/[^0-9]+/g, "-").replace(/-$/, "");
  return `${normalizedDay}-${normalizedTime}`;
}

export function nextWeeklyReminder(day, time, now = new Date()) {
  const weekday = WEEKDAY_NAMES.indexOf(day);
  const [startHour, startMinute] = time.split("–")[0].split(":").map(Number);
  const daysUntilMeeting = (weekday - now.getDay() + 7) % 7;
  const meeting = new Date(now);

  meeting.setDate(now.getDate() + daysUntilMeeting);
  meeting.setHours(startHour, startMinute, 0, 0);
  if (meeting <= now) meeting.setDate(meeting.getDate() + 7);

  let reminder = new Date(meeting.getTime() - 60 * 60 * 1000);
  if (reminder < now) {
    meeting.setDate(meeting.getDate() + 7);
    reminder = new Date(meeting.getTime() - 60 * 60 * 1000);
  }

  return { meeting, reminder };
}
