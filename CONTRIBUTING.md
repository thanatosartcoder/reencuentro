# Cómo contribuir

Gracias por querer aportar. Antes que nada, algo que conviene tener presente:

**Esto no es una aplicación cualquiera.** Guarda fotos, ubicaciones y datos de salud de personas desaparecidas, incluidos menores de edad. Un error aquí no rompe una pantalla: puede filtrar la ubicación de un niño, decirle a una familia que encontraron a alguien que no era, o mandar a un equipo de rescate por una vía que dejó de estar despejada.

Ese es el listón. No hace falta ser experto en nada — hace falta leer lo que ya existe antes de cambiarlo.

---

## Empezar

```bash
git clone <tu-fork>
cd reencuentro
npm run setup      # PostGIS en Docker, instala, migra y siembra
npm run api:dev    # http://localhost:4000/api
npm run web:dev    # http://localhost:3000
```

Antes de abrir un PR:

```bash
npm run typecheck   # api + web
npm run api:test
```

---

## Los invariantes

Estas reglas no son estilo ni preferencia. Cada una está donde está porque romperla tiene una consecuencia concreta. Si tu cambio toca alguna, explícalo en el PR.

### 1 · Ninguna familia recibe un aviso sin confirmación humana

El motor de coincidencias produce **candidatos**, nunca notificaciones. La única ruta desde la que sale un aviso a una familia es que una persona confirme en el panel.

> Decirle a alguien "encontramos a su hija" y que no sea ella es un daño que no se deshace con una corrección.

No añadas umbrales de confianza que notifiquen solos, por altos que sean.

### 2 · La ausencia de datos no es ausencia de daño

Un mapa vacío se lee como "aquí no pasó nada". En esta emergencia es al revés: lo que no se ha evaluado es lo que quedó aislado, empezando por el Chocó del epicentro.

Por eso existe la capa de **área evaluada** y el estado `sin evaluar` en vez de un `0`. Si añades una fuente de datos parcial, tiene que venir con su cobertura.

### 3 · Los datos personales se redactan por defecto

- La coordenada exacta de un menor **no sale por ningún canal**: ni en el listado, ni en la exportación PFIF, ni en el mapa.
- Teléfono, correo y documento van cifrados en reposo y **nunca** en una vista pública.
- Toda lectura de datos completos queda en la bitácora de auditoría.

Si añades un endpoint que devuelve un reporte, usa las proyecciones de `persons.presenter.ts`. No serialices la entidad: sus columnas cifradas se descifran al leerlas.

### 4 · Las contradicciones limitan, no restan

En el scoring, un sexo incompatible topa el resultado en 0,25 y una edad incompatible en 0,45 — no le restan puntos. Un nombre idéntico y un sexo coincidente bastarían si no, y en un país de 50 millones los homónimos aparecen a diario.

Del mismo modo: **solo se ponderan las señales presentes**. Castigar la ausencia de datos penalizaría a los reportes tomados en las peores condiciones, que son los que más importan.

### 5 · Una refutación pesa más que una confirmación

0,25 contra 0,12, y es deliberado. Quien dice "ya está despejada" acaba de pasar por ahí; las confirmaciones se acumulan de gente repitiendo lo que ya estaba en el mapa.

Y los errores no son simétricos: marcar bloqueada una vía abierta desvía una ambulancia; marcar abierta una bloqueada la manda contra un derrumbe.

### 6 · El clamp va antes del decaimiento

En la fórmula de confianza, la credibilidad se acota a `[0,1]` **antes** de multiplicar por el decaimiento. Al revés, un reporte oficial con ocho confirmaciones se muestra con confianza 1,0 durante horas y la antigüedad queda enmascarada por el techo.

### 7 · Offline-first no es un plan de contingencia

Toda acción se escribe primero en IndexedDB y se envía después. **Nunca al revés.** En Chocó la falta de señal es la condición normal.

Corolarios:
- Los identificadores los genera el cliente (y son el `id` del servidor), para que un reporte tenga identidad sin red.
- Toda creación es **idempotente por `clientUuid`**: reenviar no duplica.
- `/sync/push` responde por operación, no con un éxito global: un payload malformado no puede invalidar los otros cuarenta y nueve de un dispositivo que estuvo días sin señal.

### 8 · Nunca se siembran personas reales

Los datos geográficos del seed son reales y verificados. **Las personas son sintéticas** y van marcadas `[SINTÉTICO]`.

Los 379 desaparecidos del reporte oficial son casos con familias esperando respuesta. No inventes registros con nombres reales ni publiques datos de personas reales sin su consentimiento.

### 9 · Atribución de las fuentes

- Red vial y mapa base: **OpenStreetMap**, licencia **ODbL** — la atribución es obligatoria y viaja en cada respuesta de la API, no solo en el pie de la web.
- Sismos: **USGS**.
- Daño en edificaciones: **Microsoft AI for Good Lab** vía HDX, y siempre con el aviso de que es una estimación de un modelo, no una inspección.

### 10 · Nadie conoce la contraseña de otra persona

Quien invita a un operador **no elige su contraseña**: emite una invitación y la persona establece la suya. Si dos personas conocen una credencial, la bitácora deja de poder responder quién consultó los datos de un menor — y esa respuesta es exactamente lo que exige la Ley 1581.

La invitación va **partida en dos piezas que viajan por canales distintos**: un enlace por escrito y un código de seis caracteres dictado de viva voz. Un enlace suelto es una credencial completa: se reenvía, se filtra en una captura, queda en el historial de un grupo. Quien lo tuviera entraría a ver documentos y teléfonos de familias que están buscando a alguien.

En el código esto significa:

- El código se guarda **hasheado** y se compara en tiempo constante (`invitation-code.ts`).
- Cinco fallos **anulan la invitación**, aunque después llegue el código correcto. Falla cerrado a propósito: así el coordinador se entera de que alguien estuvo probando.
- Aceptar **consume** ambas mitades. Una invitación reutilizable es una credencial permanente.
- Los mensajes de error **no distinguen** entre enlace desconocido y código incorrecto. Quien tenga una mitad no debe poder averiguar si la otra existe.
- Ni el token ni el código entran en la bitácora: quedarían en claro y serían una credencial viva durante siete días.

El alfabeto del código omite `0/O`, `1/I/L`, `5/S` y `8/B`. Esto se dicta por teléfono con mala señal, y un código que hay que repetir tres veces termina mandándose por escrito — deshaciendo justo lo que la partición conseguía.

### 11 · La medición no lleva identificadores

Hay analítica de visitas, y las URLs se **reconstruyen desde cero** antes de salir del navegador (`components/Analytics.tsx`): se toman el origen y la ruta con los UUID redactados, y nada más.

Dos rutas explican por qué:

- `/invitacion?token=…` lleva **media credencial viva** durante siete días.
- `/desaparecidos/<uuid>` identifica a **una persona concreta**. Qué fichas se consultan y cuándo es un dato sobre ella y sobre quien la busca, no una métrica de tráfico.

Un saneador que *borra* la query puede fallar y dejar pasar algo; uno que solo copia lo que nombra explícitamente no tiene por dónde filtrar. Si añades cualquier medición, sigue esa forma.

El service worker tampoco cachea `/_vercel/`: el espacio offline es lo que le queda a alguien sin señal para reportar a una persona, y la telemetría no compite por él.

---

## Cómo trabajamos

**No se hace push a `main`.** Está protegida. Todo entra por pull request con revisión.

```bash
git switch -c arregla/nombre-corto      # o suma/, documenta/, refactoriza/
# ... cambios ...
npm run typecheck && npm run api:test
git push origin arregla/nombre-corto
```

Abre el PR con la plantilla. Rellenarla no es burocracia: la pregunta *"¿qué se rompe si esto está mal?"* es la que más errores ha atrapado en este proyecto.

### Sobre los commits

Escribe **por qué**, no solo qué. El código dice qué hace; lo que se pierde es la razón.

Mal:
```
fix: cambio el peso de refutación
```

Bien:
```
Subir el peso de la refutación sobre la confirmación

Los errores no son simétricos: marcar bloqueada una vía abierta desvía una
ambulancia, pero marcar abierta una bloqueada la manda contra un derrumbe.
```

### Qué revisamos

- ¿Rompe algún invariante de arriba? Si sí, ¿está justificado?
- ¿Funciona sin conexión, o al menos degrada de forma honesta?
- ¿Se probó, o solo compila? En este proyecto varios bugs solo aparecieron **ejecutando** el artefacto, no compilándolo.
- ¿Los mensajes al usuario dicen qué hacer, o solo que algo falló?

---

## Issues

Antes de abrir uno, mira si ya existe. Al abrirlo, elige la plantilla que toque:

- **Error** — algo no funciona. Incluye qué esperabas y qué pasó.
- **Mejora** — una idea. Explica el problema antes que la solución.
- **Fuente de datos** — conoces un origen oficial o abierto que sirva. Estos son especialmente bienvenidos: buena parte del valor del proyecto está en cruzar fuentes.

**Si encuentras un fallo de seguridad o una fuga de datos personales, no abras un issue público.** Lee [SECURITY.md](SECURITY.md).

---

## Dónde hace más falta ayuda

Por orden de impacto, no de dificultad:

1. **App móvil en Flutter.** El navegador no tiene equivalente real a WorkManager ni BGTaskScheduler. Para reportar en Chocó con la pantalla apagada hace falta un cliente nativo contra los mismos endpoints de sincronización.
2. **Comparación facial autoalojada.** El enganche y el scoring existen; falta el proveedor. La recomendación es InsightFace propio antes que mandar rostros de desaparecidos a un tercero.
3. **Integración con el registro oficial.** La exportación PFIF 1.4 está lista. Falta el acuerdo humano con la UNGRD o la Cruz Roja Colombiana — eso no lo resuelve el código.
4. **Más fuentes de cobertura.** Hoy solo Cali y Pereira tienen evaluación de daño. Cualquier fuente que amplíe eso, sobre todo en Chocó, vale mucho.
5. **Accesibilidad y pruebas en teléfonos de gama baja.** La app está pensada para eso pero no se ha probado en dispositivos reales de campo.

---

## Una última cosa

Si te encuentras dudando entre dos opciones, la pregunta que sirve casi siempre es:

> ¿Qué pasa si esto se equivoca a las tres de la mañana, con alguien buscando a un familiar desde un teléfono sin señal?

Suele bastar para decidir.
