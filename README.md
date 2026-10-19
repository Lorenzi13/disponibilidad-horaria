# Agenda de disponibilidad semanal

Demo pública: [lorenzi13.github.io/disponibilidad-horaria](https://lorenzi13.github.io/disponibilidad-horaria/)

Agenda responsive para consultar horarios semanales recurrentes, iniciar sesión con Google y reservar una plaza. Cada franja admite un máximo de cinco participantes.

## Funcionalidades

- Inicio y cierre de sesión con Firebase Authentication y Google.
- Vistas de día, semana y mes para navegar los mismos horarios recurrentes.
- Reservas y cancelaciones sincronizadas con Cloud Firestore.
- Transacciones para actualizar el cupo sin superar cinco reservas.
- Aviso opcional del navegador una hora antes de la próxima ocurrencia semanal.

## Comportamiento de la agenda

Las reservas son recurrentes por día de la semana y hora. Las vistas mensual y diaria muestran esa disponibilidad recurrente; no representan citas puntuales con una fecha independiente.

Los avisos son notificaciones locales del navegador, no correos. El participante debe conceder permiso y mantener la página abierta para que el navegador pueda mostrarlas. No se usa un plan de pago ni un servicio de envío programado.

## Ejecución local

Requiere Node.js 20 o posterior. Desde PowerShell, en la carpeta del proyecto:

```powershell
npm.cmd start
```

Abre `http://localhost:5500`. No abras `index.html` con doble clic: Firebase Authentication requiere un origen HTTP autorizado.

## Pruebas

```powershell
npm.cmd test
```

Las pruebas actuales cubren la normalización de IDs de horario y el cálculo del próximo aviso semanal. No sustituyen pruebas de integración contra Firebase ni una prueba de concurrencia del límite de cupos.

## Archivos principales

- `index.html`, `styles.css`, `script.js`: interfaz, estilos y lógica del calendario.
- `calendar-utils.js`: IDs de horarios y cálculo del aviso semanal.
- `firebase-config.js`: configuración pública del SDK web de Firebase.
- `firestore.rules`: reglas para autenticación, reservas propias y capacidad.
- `server.js`: servidor HTTP local para desarrollo.

La configuración web de Firebase no es una clave privada. No publiques contraseñas, tokens ni claves de cuentas de servicio.
