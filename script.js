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

const CAPACITY = 5;
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getFirestore(app);
const googleProvider = new GoogleAuthProvider();
const googleLogin = document.querySelector("#google-login");
const googleLogout = document.querySelector("#google-logout");
const accountStatus = document.querySelector("#account-status");
const bookingStatus = document.querySelector("#booking-status");
const slots = new Map();
let currentUser = null;
let unsubscribeSlots = null;
let unsubscribeReservations = null;

function createSlotId(day, time) {
  const normalizedDay = day.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const normalizedTime = time.replace(/[^0-9]+/g, "-").replace(/-$/, "");
  return `${normalizedDay}-${normalizedTime}`;
}

function renderSlot(slot) {
  const remaining = Math.max(0, CAPACITY - slot.booked);
  const button = slot.button;
  const state = slot.myReservation
    ? "is-reserved"
    : remaining === 0
      ? "is-full"
      : remaining <= 2
        ? "is-few"
        : "is-open";

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
      ? `Cancelar reserva del ${slot.day} de ${slot.time}`
      : remaining === 0
        ? `${slot.day}, ${slot.time}: horario completo, 5 de 5 personas`
        : `${slot.day}, ${slot.time}: quedan ${remaining} de 5 plazas`
  );
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
    const day = document.querySelectorAll("thead th")[cell.cellIndex].textContent.trim();
    const button = document.createElement("button");
    const slot = {
      id: createSlotId(day, time),
      day,
      time,
      booked: 0,
      ready: false,
      myReservation: false,
      button
    };

    button.type = "button";
    button.addEventListener("click", () => handleSlotClick(slot));
    cell.replaceChildren(button);
    slots.set(slot.id, slot);
    renderSlot(slot);
  }
}

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

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  googleLogin.hidden = Boolean(user);
  googleLogin.disabled = false;
  googleLogout.hidden = !user;

  unsubscribeSlots?.();
  unsubscribeReservations?.();
  unsubscribeSlots = null;
  unsubscribeReservations = null;

  if (!user) {
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
    }, (error) => setStatus(getErrorMessage(error)));

    setStatus("Horarios actualizados. Elige una hora para reservar.");
  } catch (error) {
    setStatus(getErrorMessage(error));
  }
});
