# Reencuentro

Plataforma para reunir familias y leer el terreno tras el **sismo de magnitud 7,4 del 10 de agosto de 2026** con epicentro cerca de San José del Palmar, Chocó.

Dos módulos que comparten infraestructura:

1. **Personas desaparecidas** — reportes de familias, avistamientos desde el terreno, y un motor que los cruza. Ninguna familia recibe un aviso sin que una persona lo confirme antes.
2. **Mapa colaborativo** — reportes de vías, peligros y recursos, con una confianza que decae con el tiempo y se refresca cuando alguien confirma.

Todo funciona sin conexión. No como plan de contingencia: como flujo normal.

---

## Antes de empezar: dos decisiones que no son técnicas

**Coordínate con el sistema oficial — pero no hay API que consumir.** Se probaron todas las fuentes oficiales colombianas (ver *Fuentes externas* más abajo): ninguna publica datos en vivo de esta emergencia. El catálogo de emergencias de la UNGRD en `datos.gov.co` tiene su último registro en **2022-12-31**; el de desaparecidos se publica por lotes mensuales y va hasta **2026-06-30**; el catálogo sísmico del SGC llega hasta **2020**. Las cifras que citan los medios salen de comunicados, no de un endpoint.

Por eso la integración va en la otra dirección: esta plataforma **exporta en PFIF 1.4**, el estándar internacional de intercambio de datos de desaparecidos. No conecta nada hoy, pero hace que los datos puedan entregarse mañana a la UNGRD, la Cruz Roja o cualquier otro registro sin renegociar el formato. El canal seguirá siendo un archivo acordado; que ese archivo esté en un estándar es lo que separa integrarse de improvisar.

**Los datos personales aquí son de los sensibles.** Fotos, ubicaciones, estado de salud y datos de menores. Cae bajo la Ley 1581 de 2012. Lo implementado: cifrado AES-256-GCM en reposo para documento, teléfono y correo; índices ciegos por HMAC para poder buscar sin descifrar; bitácora de todo acceso a datos completos; redacción por defecto en los listados públicos. Lo que falta antes de producción está más abajo.

---

## Cifras del evento

Corte del 13 de agosto, 22:30 (UNGRD; desaparecidos según Fiscalía).

| | |
|---|---|
| Sismo | 10 ago 2026, 07:34 local · **M 7,4** · prof. 96 km |
| Epicentro | ~12 km de San José del Palmar, Chocó (4,99 N · 76,29 W) |
| Réplicas | 130+ al 12 de agosto |
| Fallecidos / heridos | 284 / 3.977 |
| **Desaparecidos** | **379** — 375 concentrados en 5 capitales |
| Rescatados | 354 |
| Afectados | 102.263 personas · 45.523 familias |
| Cobertura | 15 departamentos · 426 municipios |
| Viviendas | 12.597 destruidas · 71.763 averiadas |
| Alerta roja | Cali, Pereira, Quibdó, Manizales, Armenia |

Corredores viales sembrados en el mapa (Invías: 18 vías dañadas, 13 aún con problemas):

- **Santa Cecilia – Asia** (Pueblo Rico, Risaralda) — daño total de la banca por derrumbe
- **Cali – Loboguerrero / Ruta 40** (Dagua, Valle) — paso restringido
- **Quibdó – Pereira** — trabajos intensificados por orden del Gobierno Nacional

---

## Arranque

Requiere Docker y Node 20+.

```bash
npm run setup       # levanta PostGIS, instala, migra y siembra
npm run api:dev     # API en http://localhost:4000/api
npm run web:dev     # Web en http://localhost:3000

npm run ingest:hdx  # opcional: carga las 575 edificaciones con daño (≈37 MB)
```

Las réplicas del USGS se sincronizan solas cada 5 minutos desde que arranca la API; no requieren clave ni configuración.

`setup` deja `apps/api/.env` a partir del ejemplo. **Genera una clave real de cifrado antes de guardar cualquier dato que importe:**

```bash
openssl rand -hex 32   # -> FIELD_ENCRYPTION_KEY en apps/api/.env
```

Si esa clave se pierde, los campos cifrados son irrecuperables. Si se rota, hay que re-cifrar: no hay versionado de claves todavía.

Usuarios del panel de validación que crea el seed:

| Correo | Contraseña | Rol |
|---|---|---|
| `validador@reencuentro.co` | `Reencuentro2026!` | valida coincidencias |
| `coordinador@reencuentro.co` | `Reencuentro2026!` | además modera el mapa |

---

## Cómo está armado

```
apps/api   NestJS 11 · TypeORM · PostgreSQL 16 + PostGIS 3.5 · Socket.IO
apps/web   Next.js 15 (App Router) · Tailwind 4 · MapLibre GL · IndexedDB
```

### El motor de coincidencias

Tres niveles, en orden de certeza:

1. **Documento de identidad** — coincidencia exacta vía índice ciego. Es la única señal que basta sola.
2. **Biométrico** — enganche listo (`faceDescriptor`, similitud coseno) para Rekognition o un modelo propio. Sin proveedor configurado el sistema funciona sin él.
3. **Heurístico** — nombre, edad, sexo, geografía, tiempo y descripción física, combinados con pesos.

Tres decisiones que sostienen la calidad del resultado:

- **Solo se ponderan las señales presentes.** Los pesos se renormalizan sobre lo que hay. Castigar la ausencia de datos penalizaría justo a los reportes tomados en las peores condiciones, que son los que más importan.
- **Las contradicciones limitan, no restan.** Sexo incompatible topa el score en 0,25; rangos de edad incompatibles en 0,45; documentos distintos en 0,15. Sin esto, un nombre idéntico y un sexo coincidente bastan para colar dos homónimos de generaciones distintas: en un país de 50 millones eso pasa a diario.
- **El nombre se compara con un piso.** Jaro-Winkler reparte generosamente y dos apellidos castellanos sin relación puntúan 0,6. Por debajo de 0,6 el aporte es nulo y por encima se reescala, con reducción fonética para las variantes del español (*Yeison/Jeison*, *González/Gonsales*, *Vallejo/Ballejo*).

**Nada se notifica sin revisión humana.** El motor produce candidatos en `PENDING_REVIEW` y avisa a la cola de validadores, nunca a la familia. La confirmación es el único camino desde el que sale un aviso, y va en la misma transacción que cierra el caso y escribe en el outbox de notificaciones. Cuando el desenlace es un fallecimiento, el mensaje no lo dice: pide contacto con el punto de atención, para que la noticia la dé una persona.

### El mapa

Modelo de eventos, no de estado. Nadie edita "el estado de la vía": cada reporte es una observación independiente con su hora y su autor, y la verdad emerge de cuántos coinciden y de qué tan reciente es lo que vieron. Por eso la sincronización offline es un `append` sin conflictos que resolver.

```
confianza = clamp(base_por_rol + 0,12·min(confirmaciones,8) − 0,25·refutaciones, 0..1)
            × 2^(−minutos_desde_última_confirmación / vida_media)
```

- El clamp va **antes** del decaimiento. Al revés, un reporte oficial con ocho confirmaciones acumula 1,86 de credibilidad bruta y se muestra con confianza 1,0 durante horas, con la antigüedad enmascarada por el techo.
- **Una refutación pesa más que una confirmación** (0,25 vs 0,12). Quien dice "ya está despejada" acaba de pasar por ahí; las confirmaciones se acumulan de gente que repite lo que ya estaba en el mapa. Y los errores no son simétricos: marcar bloqueada una vía abierta desvía una ambulancia; marcar abierta una bloqueada la manda contra un derrumbe.
- **Vida media por tipo.** Un rescate activo, 2 h. Un albergue, 48 h. Una sola vida media para todo caduca la mitad de los reportes antes de tiempo y deja la otra mitad de fantasma.

### Leer el mapa

El mapa cruza cinco fuentes que responden preguntas distintas, y el panel derecho
lleva una **leyenda** que reproduce la forma real de cada marca —círculo relleno
para un reporte, línea para un tramo de vía, anillo hueco para una réplica, área
para el daño— en lugar de una fila de cuadraditos de color que obliga a adivinar
a cuál de las tres cosas rojas se refiere.

Dos reglas se aplican a todo reporte de la comunidad y son las que nadie deduce
mirando: el **tamaño** del punto crece con la gravedad, y lo **desvanecido**
indica que lleva tiempo sin que nadie lo confirme.

**Resumen por municipio.** Un recuadro por municipio cruza personas sin
localizar, vías cortadas, edificaciones dañadas y réplicas cercanas, ordenado por
un puntaje de atención donde las personas dominan y los menores pesan doble. Es
lo que responde *"por dónde empiezo"*, que ninguna cantidad de pines sueltos
responde.

Las personas desaparecidas **se agregan y nunca se dibujan como puntos
individuales**. Un pin por persona expondría la última ubicación conocida de cada
una, incluidos menores, en un mapa público. El listado ya publica el municipio,
así que agregar no oculta nada disponible, pero evita convertir el mapa en un
rastreador de individuos.

Los recuadros se dibujan como elementos del DOM y no como capa de MapLibre: son
decenas, cada uno muestra varias cifras con su etiqueta, y así son enfocables con
teclado y legibles con lector de pantalla. Para lo que hay miles —zonas,
réplicas, edificaciones— se sigue usando la GPU.

**Cada cifra lleva su unidad escrita al lado.** Un número suelto sobre un mapa de
emergencia se malinterpreta, y confundir 266 edificaciones con 266 desaparecidos
no es un detalle.

**Contexto de cercanía.** Al abrir cualquier reporte, `GET /api/mapa/contexto`
responde qué más hay en 5 km: personas sin localizar, avistamientos sin cruzar,
vías cortadas, puntos de ayuda, daño y réplicas. Saber que hay un derrumbe
importa distinto si a dos kilómetros hay cinco personas sin localizar.

### Actualización de las fuentes

| Qué | Cada cuánto |
|---|---|
| Despacho de notificaciones | **10 s** |
| Réplicas del USGS | **5 min** |
| Sincronización del outbox offline | 60 s + al reconectar + al volver la pestaña |
| Páginas de servidor | 30 s de caché |
| Vencimiento de reportes de zona | 30 min |
| **Daño en edificaciones (HDX)** | **03:20 diario** |
| **Red vial (HOT)** | **04:20 diario** |
| Purga de notificaciones e historial de ingestas | Diario, madrugada |

Los horarios diarios se interpretan en la zona del contenedor. Los contenedores
arrancan en UTC salvo que se declare otra, y en UTC esas tareas caerían a las
22:20 y 23:20 hora colombiana — todavía con gente usando el mapa. Como la
ingesta vial bloquea su tabla unos 36 segundos, el despliegue define
`TZ=America/Bogota` para que la madrugada sea la de aquí y no la de Greenwich.

El mapa colaborativo **no hace polling**: carga al abrir y se actualiza por WebSocket cuando alguien reporta o vota. La confianza decae sola porque se calcula en SQL contra `now()` en cada consulta, no en un job.

Las dos ingestas externas corren de madrugada con tres salvaguardas, porque un cron desatendido que descarga cientos de megabytes se rompe de formas caras:

- **Detección de cambios.** Se consulta `metadata_modified` de HDX antes de descargar. Si coincide con lo ya cargado, la ejecución termina en **0,4 s sin bajar un byte**. Sin esto se gastarían 160 MB cada noche —de HDX, que es una plataforma humanitaria sin ánimo de lucro— para reescribir los mismos datos. `--force` la salta cuando hay que recargar tras corregir un error de ingesta.
- **Carga atómica.** El reemplazo va dentro de una transacción. `TRUNCATE` es transaccional en Postgres, así que un fallo a mitad del parseo deja la red vial anterior intacta en lugar de a medias. Verificado: tras un rollback los 161.322 tramos siguen ahí. El precio es un bloqueo de lectura de ~36 s, y por eso corre de madrugada.
- **Bloqueo entre instancias.** Un advisory lock de Postgres evita que dos réplicas de la API hagan la misma descarga a la vez.

Cada ejecución queda en `ingest_runs` con su versión de origen, duración y error. `GET /api/ingesta/estado` la expone, y el panel del mapa muestra **"actualizado hace X"** junto a las capas externas: un dato de terceros sin fecha de carga invita a confiar en él más de lo que merece, y una ingesta que lleva días fallando produciría un mapa que parece al día sin estarlo.

Se apaga con `INGEST_CRON_ENABLED=false` (útil en desarrollo o en réplicas de solo lectura), y un coordinador puede dispararlas a mano desde `POST /api/ingesta/ejecutar` cuando HDX publica una corrección urgente.

### Fuentes externas

Se probó cada API oficial candidata contra la emergencia real. Resultado:

| Fuente | API | Estado verificado |
|---|---|---|
| **USGS FDSN Event** | GeoJSON, sin clave | ✅ **En vivo.** Tiene el evento: M 7,4, 2026-08-10 12:34 UTC, prof. 110,3 km |
| **HDX** (CKAN) | JSON, sin clave | ✅ **Datasets de este sismo**, publicados el 12–13 de agosto |
| datos.gov.co · Emergencias UNGRD | Socrata SODA ✅ | ⚠️ Último registro **2022-12-31**. Cero de agosto 2026 |
| datos.gov.co · Desaparecidos | Socrata SODA ✅ | ⚠️ 205.938 registros, corte **2026-06-30** (RND, lotes mensuales) |
| SGC · ArcGIS `catalogo_sismos` | ArcGIS REST ✅ | ⚠️ 16.290 sismos, cubre **1610 → 2020**. Histórico |
| ReliefWeb | v1 dada de baja | 🔑 v2 exige `appname` aprobado |
| SNIGRD, Invías, RND | — | ❌ Portales web, sin API pública |

**Réplicas — USGS.** `SeismicService` replica el catálogo cada 5 minutos en un radio de 300 km del epicentro. Se replica en vez de consultarse en vivo porque el mapa no puede quedarse en blanco si el servicio externo cae, y porque una réplica sentida a las 3 de la mañana hay que poder consultarla justo cuando el USGS está saturado por ese mismo evento. Se actualiza lo ya traído, no solo lo nuevo: el USGS corrige magnitud y profundidad durante las horas siguientes.

> **Caveat que la interfaz muestra**: la red global del USGS detecta menos réplicas que la red del SGC, más densa dentro de Colombia. El USGS registra 4 eventos M ≥ 2,5; el SGC reportó más de 130 réplicas al 12 de agosto. Y las profundidades no coinciden — USGS 110,3 km, SGC 96 km. No es un error de nadie: son soluciones independientes. Por eso cada evento guarda su `source`.

**Daño en edificaciones — HDX.** `npm run ingest:hdx` descarga las evaluaciones del Microsoft AI for Good Lab y carga **575 edificaciones con daño detectado**: 266 en Cali (imagen Airbus del 10 ago, sobre 97.085 huellas) y 309 en Pereira (imagen Vantor del 12 ago, sobre 35.760).

> **Solo existen esas dos ciudades.** Nadie ha publicado evaluación de daño para Chocó, Manizales, Armenia, Popayán ni el resto del área afectada. La ingesta carga por eso una segunda capa —el **área evaluada**, tomada de los `valid_area_mask` de cada dataset— y la dibuja con borde discontinuo.
>
> Sin esa capa, el mapa hace indistinguibles *"aquí se miró y no hay daño"* y *"aquí nadie ha mirado"*. Y en esta emergencia esas dos lecturas apuntan en direcciones opuestas: lo que no se ha evaluado es lo que quedó aislado, empezando por el Chocó del epicentro, con vías cortadas y fallas de comunicación. El mismo aislamiento que impide medirlo es el que hace probable que esté peor.
>
> Por eso el resumen por municipio muestra **"Sin evaluar"** en naranja en vez de un `0`, y la leyenda advierte que un punto sin marcas no significa que esté bien.

Los datos vienen en GeoPackage, que es SQLite por dentro. En vez de exigir GDAL instalado se lee el archivo directo y se le entrega a PostGIS el WKB tal cual — saltando la cabecera de longitud variable del formato — para que `ST_Transform` haga la reproyección de UTM 18N a WGS 84. Reimplementar una reproyección en JavaScript sería la parte más fácil de equivocar y la más difícil de notar.

Solo se guardan las dañadas. Almacenar las 35.451 restantes de Pereira cargaría la base con la afirmación menos accionable del conjunto: *"esta casa parece estar bien según una foto satelital"*.

> **Caveat que la interfaz muestra**: es una estimación de un modelo, no una inspección. Orienta dónde mirar primero; no declara una casa habitable ni inhabitable.

### Red vial — HOT / OpenStreetMap

`npm run ingest:vias` carga el export que el Humanitarian OpenStreetMap Team publicó para esta emergencia (GLIDE EQ-2026-000146-COL): **161.322 tramos, 70.507 km de red, 73.545 con nombre**. En Chocó son **8.901 km y 551 puentes**, con un 21,5% sin pavimentar.

Esto dice **qué vías existen, no cuáles están transitables** — el estado lo reportan las personas. Y es la diferencia entre un mapa que dibuja carreteras como píxeles y uno que puede razonar sobre ellas.

El archivo son 134 MB de GeoJSON **en un solo renglón** con 238.617 tramos, así que se procesa por streaming: `JSON.parse` sobre eso reservaría cerca de un gigabyte antes de poder filtrar nada. Se descartan andenes, escaleras, senderos y vías de servicio —77.295 tramos que no ayudan a responder "¿puede llegar un vehículo?"— y se conserva todo lo que conecta, desde la troncal hasta la trocha: en Chocó la diferencia entre una `track` y nada es la diferencia entre poder entrar o no.

**Para qué se usa:**

- **Autocompletado del nombre de vía al reportar.** Es el mayor valor. Escribirlo a mano produce "vía Quibdó–Pereira", "via a pereira" y "carretera quibdo pereira" para el mismo corredor, y el sistema los ve como tres derrumbes distintos. Elegir de la lista real hace que coincidan solos. El campo libre se mantiene: OSM no lo tiene todo, y menos en Chocó.
- **Capa de red vial** con el grosor siguiendo la jerarquía y línea discontinua donde no está pavimentada. Sirve sobre todo donde el mapa base está vacío — las teselas vienen de un extracto que puede tener meses; este export es del 13 de agosto e incluye lo mapeado *después* del sismo.
- **Inventario por área**: km de red, porcentaje sin pavimentar y número de puentes. Un puente sobre una vía cortada es un punto único de fallo.

El nivel de detalle lo decide el servidor según el tamaño de la ventana, no el cliente: a escala de país solo bajan las troncales.

> **Licencia ODbL.** Obliga a atribuir a los colaboradores de OpenStreetMap. La atribución viaja en cada respuesta de la API, no solo en el pie de la web: un consumidor de la API nunca ve el pie de página.

### Exportación a registros oficiales (PFIF 1.4)

`GET /api/export/pfif` genera un documento en [People Finder Interchange Format](http://zesty.ca/pfif/1.4/), el estándar creado para el Katrina PeopleFinder Project en 2005 y usado después en Haití 2010 y Japón 2011.

```
MissingPersonReport → <person> + <note status="information_sought">
SightingReport      → <person> + <note status="believed_alive|believed_dead">
```

Decisiones de privacidad, todas verificadas:

- **Alcance `public` por defecto**: solo los casos cuyo autor autorizó la publicación, sin teléfono, correo ni documento. La exportación no puede ser la puerta trasera por la que sale lo que la interfaz protege.
- **Alcance `full` solo para ADMIN**: un COORDINATOR que lo pida recibe `public`. Incluye contacto y solo tiene sentido bajo acuerdo de tratamiento de datos.
- **La coordenada exacta de un menor nunca sale**, igual que en el listado público.
- **Cada exportación queda en bitácora** con quién, con qué alcance y cuántos registros.
- **`believed_dead` solo si el avistamiento lo declara explícitamente.** Propagar un fallecimiento no confirmado a otro registro es un error que no se deshace.

Los avistamientos sin nombre — el caso más frecuente y más importante — se exportan con `full_name` marcador en vez de omitirse: un registro sin nombre pero con descripción física y ubicación es exactamente lo que otro registro necesita para cruzar.

### Offline-first

Cada acción se escribe primero en IndexedDB y se envía después, nunca al revés.

- **UUID generado en el cliente**, que además es el `id` del servidor. El dispositivo conoce la dirección definitiva del reporte antes de tener red, así que puede adjuntarle fotos sin conexión y el backend deduplica los reintentos sin ambigüedad.
- **`POST /sync/push` responde por operación**, no con un éxito global. Un dispositivo que estuvo tres días sin señal envía cincuenta reportes de golpe; que uno malformado invalide los otros cuarenta y nueve sería inaceptable. El cliente borra de su cola solo lo confirmado.
- **`GET /sync/pull` usa la revisión global** como cursor, no una marca de tiempo. Un trigger la asigna desde una secuencia compartida por todas las tablas sincronizables: da orden total y avanza también en las ediciones, así que ningún cambio se pierde por un empate de reloj.
- **Fotos en cola aparte**, ya comprimidas en el navegador (~150 KB). El texto del reporte pesa unos KB y tiene que llegar cuanto antes; la foto se reintenta por su cuenta sin retrasar el registro del caso. Recomprimir además descarta el EXIF, que en una foto de teléfono lleva las coordenadas GPS exactas de dónde se tomó.
- **Service worker**: *cache-first* para el shell y las teselas del mapa, *network-first* para los datos. Un mapa de hace seis horas es peligroso si se presenta como actual, así que siempre se intenta la red primero y la interfaz avisa cuando está mostrando una copia.

### El diseño

Panel de instrumento, no tablero de métricas. Las decisiones salen de una restricción concreta: esto se lee a pleno sol, en un teléfono barato, por alguien con las manos temblando y una conexión de 2G. De ahí el contraste alto, la base tipográfica de 17 px, las áreas de toque de 56 px y el color usado solo para codificar significado — con la paleta del código de alertas que ya usa la gestión de riesgo colombiana, para que signifique aquí lo mismo que en la señalización oficial.

**Sin webfonts.** Una fuente de 200 KB es una petición bloqueante que falla justo en la red que esta app asume. La personalidad la cargan la escala, el peso y las cifras tabulares monoespaciadas.

El elemento firma es el **medidor de decaimiento**: cada dato del sistema muestra su confianza y su edad en el mismo renglón donde se lee. Es de lo que trata el sistema — información que caduca — y el modo de fallo más peligroso es no verlo.

---

## Verificado

```bash
npm run typecheck    # api + web
npm run api:test     # 14 pruebas del motor de coincidencias
```

Probado de punta a punta contra la base real: reporte → avistamiento → coincidencia (0,94 con desglose legible) → validación humana → notificación a la familia; idempotencia en reintentos; lote de sincronización con un payload inválido que no tumba el resto; votación con decaimiento; búsqueda difusa tolerante a errores de tipeo (`mosqera` → *Mosquera*); control de acceso (401/403) y bloqueo de *path traversal* en `/media`; redacción de datos personales en el listado público.

## Lo que falta antes de producción

Nada de esto está a medias: está deliberadamente fuera del alcance de lo construido.

- **Autenticación de operadores endurecida.** JWT sin refresh ni revocación, y sin segundo factor. Un panel que ve datos completos de menores desaparecidos necesita ambas cosas.
- **Rotación de claves de cifrado.** Hoy la clave es única y sin versión. Rotarla exige re-cifrar todo.
- **Push real.** El outbox y el reintento con backoff están; falta conectar credenciales de FCM/APNs. Sin ellas las notificaciones push se marcan como fallidas en lugar de fingir que salieron.
- **Comparación facial.** El enganche y el scoring existen; falta el proveedor. La recomendación es autoalojar (InsightFace) antes que mandar rostros de desaparecidos a un tercero.
- **Moderación del mapa a escala.** Hay voto por dispositivo y cierre automático por refutaciones, pero no hay defensa contra un actor coordinado.
- **Teselas propias.** OpenFreeMap sirve para desarrollo; en producción con volumen real hay que autoalojar las teselas de la región.
- **App móvil.** El navegador no tiene equivalente real a WorkManager o BGTaskScheduler: la web sincroniza mientras la pestaña viva. Para reportar en Chocó con la pantalla apagada hace falta Flutter con `drift` + `connectivity_plus`, contra los mismos endpoints de sincronización.

---

## Sobre los datos de ejemplo

La geografía es **real**: epicentro, capitales en alerta y corredores viales vienen de los reportes de la UNGRD, el SGC e Invías.

Las personas son **sintéticas** y van marcadas `[SINTÉTICO]`. No se siembran personas reales: los 379 desaparecidos son casos con familias esperando respuesta, y publicar sus datos sin consentimiento sería dañino además de ilegal.
