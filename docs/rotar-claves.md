# Rotar la clave de cifrado

Qué hacer el día que sospeches que `FIELD_ENCRYPTION_KEY` se filtró — o simplemente cuando toque cambiarla por higiene.

Los campos cifrados son el **número de documento** de la persona buscada y el **teléfono y correo** de quien la reporta. Quien tenga la clave y una copia de la base los lee todos.

---

## Dónde vive esta clave

Antes de necesitar rotarla, hay que poder encontrarla. **Dos sitios que no fallen por la misma razón.**

### 1 · Gestor de contraseñas con acceso de emergencia

Bitwarden lo trae en el plan gratuito; 1Password también lo tiene. La función importa más que la marca: designas un contacto de confianza que puede *solicitar* acceso, y si no respondes en los días que fijes, se lo conceden solos.

Sin eso, un gestor resuelve la mitad del problema — protege de que la olvides, no de que no estés.

Guárdala como **nota segura** y escribe al lado qué es:

```
FIELD_ENCRYPTION_KEY · Reencuentro (teestamosbuscando.co)

Descifra el documento de las personas buscadas y el teléfono
de quien las reporta. Sin esto, esos datos son irrecuperables:
las copias de seguridad los guardan cifrados.

Está en Railway → servicio reencuentro-api.
Cómo rotarla: docs/rotar-claves.md en el repositorio.
```

Una cadena hexadecimal sin contexto no le sirve a quien la encuentre dentro de dos años, ni a quien la guardó.

### 2 · Fuera de línea, en otro lugar físico

En papel, en sobre cerrado, en un sitio distinto de donde vives o trabajas. Eso cubre lo que el gestor no: perder acceso a todas las cuentas a la vez.

### Para sacarla sin que quede en ningún registro

```bash
railway variables --service reencuentro-api --kv | grep FIELD_ENCRYPTION_KEY
```

Cópiala directo al gestor y limpia el historial de la terminal. No la mandes por correo ni por chat, tampoco "a ti mismo": ahí se queda.

### Qué NO protege esto

**La copia de seguridad no sustituye a la clave.** El respaldo nocturno guarda el *texto cifrado*: restaurarlo sin la clave devuelve la base entera con el documento y el teléfono convertidos en basura permanente.

Perder la base se arregla con la copia. Perder la clave, con nada.

Y esos datos no son de quien mantiene la plataforma: son de familias que los entregaron para encontrar a alguien.

---

## Antes de empezar

**Guarda la clave actual en un sitio seguro.** No la borres de ningún lado hasta terminar. Si algo sale mal a mitad, es lo único que abre lo que queda sin rotar.

**Haz una copia de seguridad.** Panel → *Copias de seguridad* → *Hacer una copia ahora*.

---

## 1 · Añade la clave nueva sin quitar la vieja

```bash
NUEVA=$(openssl rand -hex 32)
```

En Railway, sobre el servicio `reencuentro-api`:

```bash
railway variables --service reencuentro-api \
  --set "FIELD_ENCRYPTION_KEYS=v1:<clave-actual>,v2:$NUEVA" \
  --set "FIELD_ENCRYPTION_ACTIVE=v2"
```

Deja `FIELD_ENCRYPTION_KEY` como está: es la de respaldo mientras dure la transición.

A partir del despliegue, **lo que se escriba usa v2 y lo que ya estaba se sigue leyendo con v1**. El servicio no se detiene y nadie nota nada.

> Railway no reinicia el contenedor cuando cambia una variable *referenciada*. Si el despliegue no arranca solo, `railway redeploy --service reencuentro-api`.

## 2 · Reescribe lo anterior

Primero en seco, para ver qué haría:

```bash
railway run --service reencuentro-api npm run crypto:rotate
```

```
Llavero:      v1, v2
Clave activa: v2
missing_person_reports: 412 filas, 380 por reescribir
sighting_reports: 96 filas, 91 por reescribir
471 fila(s) se reescribirían. Repite con --aplicar.
```

Y luego de verdad:

```bash
railway run --service reencuentro-api npm run crypto:rotate -- --aplicar
```

Va por lotes de 200, cada uno en su transacción. Si se corta a mitad, ninguna fila queda con unas columnas rotadas y otras no — y se puede volver a lanzar: las que ya están con la clave activa se saltan.

## 3 · Retira la clave vieja

**Solo si el paso 2 terminó sin avisos.** Si dijo que algún valor no se pudo descifrar, para y resuélvelo: retirar la clave que los abre los pierde para siempre.

```bash
railway variables --service reencuentro-api \
  --set "FIELD_ENCRYPTION_KEYS=v2:$NUEVA" \
  --set "FIELD_ENCRYPTION_ACTIVE=v2"
railway variables --service reencuentro-api --set "FIELD_ENCRYPTION_KEY=$NUEVA"
```

Comprueba que todo quedó con la clave nueva:

```bash
railway run --service reencuentro-api npm run crypto:rotate
# → "0 por reescribir" en todas las tablas
```

## 4 · Guarda la nueva donde guardabas la anterior

Gestor de contraseñas con acceso de emergencia, y una copia fuera de línea. Dos sitios que no fallen a la vez.

---

## Lo que esta rotación NO hace

**No toca los índices ciegos**, y es deliberado.

El motor de coincidencias no usa `documentHash` solo para buscar: **compara** el hash del reporte de desaparición con el del avistamiento para decidir si son la misma persona. Si un índice se recalculara con otra clave, dos reportes de la misma persona dejarían de reconocerse.

Eso no sería un fallo de búsqueda. Sería una familia que no recibe el aviso de que encontraron a alguien.

Por eso el índice tiene su propia clave (`FIELD_INDEX_KEY`, que por defecto es la v1) y no se mueve cuando rotas el cifrado.

### Si además necesitas rotar la del índice

Solo tiene sentido si sospechas que **esa** se filtró, y es una operación distinta: hay que recalcular todos los índices **a la vez**, porque un estado mixto rompe el emparejamiento mientras dure. Con la base parada o en ventana de mantenimiento, no en caliente.

No hay comando hecho para esto. Es a propósito: la operación es peligrosa y merece pensarse en el momento, no ejecutarse de memoria.

---

## Si añades una columna cifrada

Va en la lista `CIFRADAS` de `src/scripts/rotate-keys.ts`. Si no está ahí, la rotación la ignora en silencio — y el día que retires la clave vieja, ese dato se pierde sin que nadie se entere.
