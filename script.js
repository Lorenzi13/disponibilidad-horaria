import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  collection,
  doc,
  getFirestore,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { createSlotId, nextWeeklyReminder } from "./calendar-utils.js";

const CAPACITY = 5;
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getFirestore(app);
const googleProvider = new GoogleAuthProvider();
const googleLogin = document.querySelector("#google-login");
const googleLogout = document.querySelector("#google-logout");
const accountStatus = document.querySelector("#account-status");
const bookingStatus = document.querySelector("#booking-status");
const reminderControls = document.querySelector(".reminder-controls");
const reminderButton = document.querySelector("#enable-reminders");
const reminderStatus = document.querySelector("#reminder-status");
const slots = new Map();
const weekdayNames = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const weekHeaders = [...document.querySelectorAll("thead th[data-day]")];
const viewButtons = [...document.querySelectorAll(".view-button")];
const calendarPeriod = document.querySelector("#calendar-period");
const weekView = document.querySelector("#week-view");
const monthView = document.querySelector("#month-view");
const dayView = document.querySelector("#day-view");
const monthGrid = document.querySelector("#month-grid");
const dayHeading = document.querySelector("#day-heading");
const daySlots = document.querySelector("#day-slots");
let currentView = "week";
let currentDate = new Date();
let currentUser = null;
let unsubscribeSlots = null;
let unsubscribeReservations = null;
let reminderTimers = [];
let userReservedSlotIds = new Set();

function renderSlot(slot) {
  const remaining = Math.max(0, CAPACITY - slot.booked);
  const state = slot.myReservation
    ? "is-reserved"
    : remaining === 0
      ? "is-full"
      : remaining <= 2
        ? "is-few"
        : "is-open";

  for (const button of slot.buttons) {
    button.className = `slot-button ${state}`;
    button.disabled = !currentUser || !slot.ready || (remaining === 0 && !slot.myReservation);
    button.textContent = slot.myReservation
      ? "Cancelar reserva"
      : remaining === 0
        ? "Completo"
        : `Reservar · ${remaining} ${remaining === 1 ? "lugar" : "lugares"}`;
    button.setAttribute(
      "aria-label",
      slot.myReservation
        ? `Cancelar reserva semanal del ${slot.day} de ${slot.time}`
        : remaining === 0
          ? `${slot.day}, ${slot.time}: horario semanal completo, 5 de 5 personas`
          : `${slot.day}, ${slot.time}: quedan ${remaining} de 5 plazas cada semana`
    );
  }
}

function setStatus(message) {
  bookingStatus.textContent = message;
}

function getErrorMessage(error) {
  if (error.code === "auth/unauthorized-domain") {
    return "Añade localhost a los dominios autorizados de Firebase Authentication.";
  }
  if (error.message === "slot-full") {
    return "Ese horario acaba de completarse. Elige otro.";
  }
  if (error.message === "already-booked") {
    return "Ya tienes una reserva en ese horario.";
  }
  if (error.code === "permission-denied") {
    return "Firebase rechazó la operación. Revisa las reglas de Firestore.";
  }
  return "No se pudo completar la operación. Comprueba tu conexión e inténtalo otra vez.";
}

function clearReminderTimers() {
  for (const timer of reminderTimers) clearTimeout(timer);
  reminderTimers = [];
}

function scheduleBrowserReminders() {
  clearReminderTimers();
  if (!currentUser) return;

  if (!("Notification" in window)) {
    reminderStatus.textContent = "Este navegador no admite avisos del navegador.";
    return;
  }

  if (Notification.permission !== "granted") {
    reminderStatus.textContent = "Activa los avisos para recibir el recordatorio una hora antes.";
    return;
  }

  const reservedSlots = [...userReservedSlotIds]
    .map((id) => slots.get(id))
    .filter(Boolean);

  if (!reservedSlots.length) {
    reminderStatus.textContent = "No tienes horarios reservados para recordar.";
    return;
  }

  reminderStatus.textContent = "Avisos activos mientras esta página permanezca abierta.";

  for (const slot of reservedSlots) {
    const { meeting, reminder } = nextWeeklyReminder(slot.day, slot.time);
    const delay = reminder.getTime() - Date.now();
    const timer = setTimeout(() => {
      if (!currentUser || Notification.permission !== "granted") return;

      new Notification("Tu reunión comienza en una hora", {
        body: `${slot.day} a las ${slot.time.split("–")[0]} · participación semanal`,
        tag: `${slot.id}-${meeting.toISOString()}`
      });
      scheduleBrowserReminders();
    }, delay);

    reminderTimers.push(timer);
  }
}

function getWeekStart(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function formatDate(date, options) {
  return new Intl.DateTimeFormat("es-CL", options).format(date);
}

function createSlotButton(slot) {
  const button = document.createElement("button");
  button.type = "button";
  button.addEventListener("click", () => handleSlotClick(slot));
  slot.buttons.add(button);
  renderSlot(slot);
  return button;
}

function renderWeek() {
  const start = getWeekStart(currentDate);
  const end = new Date(start);
  end.setDate(end.getDate() + 4);
  calendarPeriod.textContent = `${formatDate(start, { day: "numeric", month: "short" })} – ${formatDate(end, { day: "numeric", month: "short", year: "numeric" })}`;

  for (const [index, header] of weekHeaders.entries()) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    header.textContent = `${header.dataset.day} ${date.getDate()}`;
  }
}

function renderMonth() {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const leadingDays = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((leadingDays + daysInMonth) / 7) * 7;
  const today = new Date();

  calendarPeriod.textContent = formatDate(currentDate, { month: "long", year: "numeric" });
  monthGrid.replaceChildren();

  for (const name of ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]) {
    const heading = document.createElement("div");
    heading.className = "month-weekday";
    heading.setAttribute("role", "columnheader");
    heading.textContent = name;
    monthGrid.append(heading);
  }

  for (let index = 0; index < cellCount; index += 1) {
    const date = new Date(year, month, index - leadingDays + 1);
    const weekday = weekdayNames[date.getDay()];
    const recurringSlots = [...slots.values()].filter((slot) => slot.day === weekday);
    const isCurrentMonth = date.getMonth() === month;
    const isToday = date.toDateString() === today.toDateString();
    const isSelected = date.toDateString() === currentDate.toDateString();
    const dayButton = document.createElement("button");
    const dateNumber = document.createElement("span");
    const summary = document.createElement("span");

    dayButton.type = "button";
    dayButton.className = "calendar-day";
    if (!isCurrentMonth) dayButton.classList.add("is-outside");
    if (isToday) dayButton.classList.add("is-today");
    if (isSelected) dayButton.classList.add("is-selected");
    dayButton.setAttribute("role", "gridcell");
    dayButton.setAttribute("aria-label", `${formatDate(date, { weekday: "long", day: "numeric", month: "long" })}, ${recurringSlots.length} horarios semanales`);

    dateNumber.className = "calendar-date";
    dateNumber.textContent = String(date.getDate());
    summary.className = "calendar-day-summary";
    summary.textContent = recurringSlots.length
      ? `${recurringSlots.length} horarios · semanal`
      : "Sin horarios";

    dayButton.append(dateNumber, summary);
    dayButton.addEventListener("click", () => {
      currentDate = date;
      currentView = "day";
      renderCalendar();
    });
    monthGrid.append(dayButton);
  }
}

function renderDay() {
  calendarPeriod.textContent = formatDate(currentDate, { day: "numeric", month: "short", year: "numeric" });
  dayHeading.textContent = formatDate(currentDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  for (const slot of slots.values()) {
    for (const button of [...slot.buttons]) {
      if (daySlots.contains(button)) slot.buttons.delete(button);
    }
  }
  daySlots.replaceChildren();

  const day = weekdayNames[currentDate.getDay()];
  const dailySlots = [...slots.values()].filter((slot) => slot.day === day);

  if (!dailySlots.length) {
    const message = document.createElement("p");
    message.className = "no-sessions";
    message.textContent = "No hay horarios disponibles para este día.";
    daySlots.append(message);
    return;
  }

  for (const slot of dailySlots) {
    const row = document.createElement("div");
    const time = document.createElement("span");
    row.className = "day-slot-row";
    time.className = "day-slot-time";
    time.textContent = `${slot.time} · cada semana`;
    row.append(time, createSlotButton(slot));
    daySlots.append(row);
  }
}

function renderCalendar() {
  weekView.hidden = currentView !== "week";
  monthView.hidden = currentView !== "month";
  dayView.hidden = currentView !== "day";

  for (const button of viewButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.view === currentView));
  }

  if (currentView === "week") renderWeek();
  if (currentView === "month") renderMonth();
  if (currentView === "day") renderDay();
}

function moveCalendarPeriod(amount) {
  if (currentView === "week") {
    currentDate.setDate(currentDate.getDate() + amount * 7);
  } else if (currentView === "day") {
    currentDate.setDate(currentDate.getDate() + amount);
  } else {
    const targetMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + amount, 1);
    const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate();
    currentDate = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), Math.min(currentDate.getDate(), lastDay));
  }
  renderCalendar();
}

async function ensureSlotExists(slot) {
  const slotRef = doc(database, "slots", slot.id);

  await runTransaction(database, async (transaction) => {
    const snapshot = await transaction.get(slotRef);
    if (!snapshot.exists()) {
      transaction.set(slotRef, {
        day: slot.day,
        time: slot.time,
        booked: 0,
        capacity: CAPACITY
      });
    }
  });
}

async function reserveSlot(slot) {
  const slotRef = doc(database, "slots", slot.id);
  const reservationId = `${slot.id}_${currentUser.uid}`;
  const reservationRef = doc(database, "reservations", reservationId);

  await runTransaction(database, async (transaction) => {
    const [slotSnapshot, reservationSnapshot] = await Promise.all([
      transaction.get(slotRef),
      transaction.get(reservationRef)
    ]);

    if (reservationSnapshot.exists()) throw new Error("already-booked");
    if (!slotSnapshot.exists()) throw new Error("permission-denied");

    const booked = slotSnapshot.data().booked;
    if (booked >= CAPACITY) throw new Error("slot-full");

    transaction.update(slotRef, { booked: booked + 1 });
    transaction.set(reservationRef, {
      slotId: slot.id,
      uid: currentUser.uid,
      day: slot.day,
      time: slot.time,
      createdAt: serverTimestamp()
    });
  });

  setStatus(`Reserva confirmada: ${slot.day}, ${slot.time}.`);
}

async function cancelReservation(slot) {
  const slotRef = doc(database, "slots", slot.id);
  const reservationRef = doc(database, "reservations", `${slot.id}_${currentUser.uid}`);

  await runTransaction(database, async (transaction) => {
    const [slotSnapshot, reservationSnapshot] = await Promise.all([
      transaction.get(slotRef),
      transaction.get(reservationRef)
    ]);

    if (!slotSnapshot.exists() || !reservationSnapshot.exists()) return;

    const booked = slotSnapshot.data().booked;
    transaction.update(slotRef, { booked: Math.max(0, booked - 1) });
    transaction.delete(reservationRef);
  });

  setStatus(`Reserva cancelada: ${slot.day}, ${slot.time}.`);
}

async function handleSlotClick(slot) {
  if (!currentUser || !slot.ready) return;

  try {
    if (slot.myReservation) {
      await cancelReservation(slot);
    } else {
      await reserveSlot(slot);
    }
  } catch (error) {
    setStatus(getErrorMessage(error));
  }
}

for (const row of document.querySelectorAll("tbody tr")) {
  const time = row.cells[0].textContent.trim();

  for (const cell of [...row.cells].slice(1)) {
    const day = weekHeaders[cell.cellIndex - 1].dataset.day;
    const slot = {
      id: createSlotId(day, time),
      day,
      time,
      booked: 0,
      ready: false,
      myReservation: false,
      buttons: new Set()
    };

    cell.replaceChildren(createSlotButton(slot));
    slots.set(slot.id, slot);
  }
}

for (const button of viewButtons) {
  button.addEventListener("click", () => {
    currentView = button.dataset.view;
    renderCalendar();
  });
}

document.querySelector("#previous-period").addEventListener("click", () => moveCalendarPeriod(-1));
document.querySelector("#next-period").addEventListener("click", () => moveCalendarPeriod(1));
document.querySelector("#today-button").addEventListener("click", () => {
  currentDate = new Date();
  renderCalendar();
});

renderCalendar();

googleLogin.addEventListener("click", async () => {
  googleLogin.disabled = true;
  accountStatus.textContent = "Abriendo acceso de Google...";

  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    accountStatus.textContent = getErrorMessage(error);
    googleLogin.disabled = false;
  }
});

googleLogout.addEventListener("click", () => signOut(auth));

reminderButton.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    scheduleBrowserReminders();
    return;
  }

  const permission = await Notification.requestPermission();
  reminderStatus.textContent = permission === "granted"
    ? "Permiso concedido. Preparando tus avisos semanales."
    : "Permite los avisos en el navegador para recibir recordatorios.";
  scheduleBrowserReminders();
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  googleLogin.hidden = Boolean(user);
  googleLogin.disabled = false;
  googleLogout.hidden = !user;
  reminderControls.hidden = !user;

  unsubscribeSlots?.();
  unsubscribeReservations?.();
  unsubscribeSlots = null;
  unsubscribeReservations = null;

  if (!user) {
    clearReminderTimers();
    userReservedSlotIds = new Set();
    accountStatus.textContent = "Conecta con Google para reservar.";
    setStatus("Inicia sesión para ver y reservar plazas.");
    for (const slot of slots.values()) {
      slot.ready = false;
      slot.myReservation = false;
      renderSlot(slot);
    }
    return;
  }

  accountStatus.textContent = `Sesión iniciada${user.displayName ? `: ${user.displayName}` : ""}.`;
  setStatus("Cargando horarios...");

  try {
    await Promise.all([...slots.values()].map(ensureSlotExists));

    unsubscribeSlots = onSnapshot(collection(database, "slots"), (snapshot) => {
      const slotData = new Map(snapshot.docs.map((item) => [item.id, item.data()]));

      for (const slot of slots.values()) {
        const data = slotData.get(slot.id);
        slot.booked = data?.booked ?? 0;
        slot.ready = Boolean(data);
        renderSlot(slot);
      }
    }, (error) => setStatus(getErrorMessage(error)));

    const userReservations = query(
      collection(database, "reservations"),
      where("uid", "==", user.uid)
    );
    unsubscribeReservations = onSnapshot(userReservations, (snapshot) => {
      const reservedSlotIds = new Set(snapshot.docs.map((item) => item.data().slotId));

      for (const slot of slots.values()) {
        slot.myReservation = reservedSlotIds.has(slot.id);
        renderSlot(slot);
      }
      userReservedSlotIds = reservedSlotIds;
      scheduleBrowserReminders();
    }, (error) => setStatus(getErrorMessage(error)));

    setStatus("Horarios actualizados. Elige una hora para reservar.");
  } catch (error) {
    setStatus(getErrorMessage(error));
  }
});
