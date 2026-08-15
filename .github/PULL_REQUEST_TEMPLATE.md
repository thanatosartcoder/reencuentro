<!--
Gracias por contribuir.

Rellenar esto no es burocracia: la pregunta "¿qué se rompe si esto está mal?"
es la que más errores ha atrapado en este proyecto. Si alguna sección no
aplica, escribe "no aplica" en vez de borrarla.
-->

## Qué cambia

<!-- Una o dos frases. Qué hace este PR desde el punto de vista de quien usa la app. -->

## Por qué

<!--
El código dice qué hace; lo que se pierde con el tiempo es la razón.
Si arregla un issue, enlázalo: "Cierra #12".
-->

## Qué se rompe si esto está mal

<!--
Lo más importante del formulario. Piensa en la consecuencia real, no en la
excepción de JavaScript.

Ejemplos del tipo de respuesta que sirve:
- "Una familia recibiría un aviso de una coincidencia sin verificar."
- "La ubicación exacta de un menor saldría en el listado público."
- "El mapa mostraría como transitable una vía cortada."
- "Nada crítico: solo afecta cómo se ve el pie de página."
-->

## Cómo lo probaste

<!--
Compilar no es probar. Varios bugs de este proyecto solo aparecieron ejecutando
el artefacto: un token que se invalidaba a sí mismo, un contenedor que arrancaba
sin la aplicación, un ST_Y sobre un polígono.

Di qué ejecutaste y qué viste.
-->

- [ ] `npm run typecheck` pasa
- [ ] `npm run api:test` pasa
- [ ] Lo probé ejecutándolo, no solo compilando

---

## Invariantes del dominio

<!--
Marca solo los que tu cambio TOCA. Si marcas alguno, explica abajo por qué el
cambio es correcto. Están detallados en CONTRIBUTING.md.
-->

- [ ] Toca el **motor de coincidencias** o la ruta de notificación a familias
- [ ] Toca la **redacción de datos personales** (listados públicos, exportación, mapa)
- [ ] Toca el **cálculo de confianza** del mapa o su decaimiento
- [ ] Toca la **sincronización offline** o la idempotencia por `clientUuid`
- [ ] Toca la **cobertura de datos** (distinguir "sin daño" de "sin evaluar")
- [ ] Añade o cambia una **fuente de datos externa**
- [ ] Nada de lo anterior

<!-- Si marcaste alguno, explica aquí: -->

## Datos personales

- [ ] No añade campos personales nuevos
- [ ] Añade campos personales, y están **cifrados en reposo** y **fuera de las vistas públicas**
- [ ] Añade un endpoint que expone datos completos, y **queda en la bitácora**

## Fuentes de datos

<!-- Solo si añades o modificas una fuente externa. -->

- [ ] La atribución viaja **en la respuesta de la API**, no solo en la interfaz
- [ ] Se documenta su **fecha de corte** y su **cobertura**
- [ ] Si es una estimación (modelo, satélite), la interfaz dice que **no es una inspección**

---

## Capturas

<!--
Si cambia algo visual, ponlas. La app se lee a pleno sol en teléfonos baratos:
si puedes, muestra cómo se ve en móvil.
-->
