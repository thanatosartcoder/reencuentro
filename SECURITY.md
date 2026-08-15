# Política de seguridad

Esta plataforma guarda fotos, ubicaciones, datos de salud y documentos de identidad de personas desaparecidas, **incluidos menores de edad**. Un fallo aquí no es una vulnerabilidad abstracta: puede exponer dónde estaba un niño por última vez.

Por eso los reportes de seguridad no van a issues públicos.

## Cómo reportar

Usa el [aviso privado de seguridad de GitHub](https://github.com/thanatosartcoder/reencuentro/security/advisories/new). Solo lo ve el mantenedor.

Incluye:

- Qué encontraste y cómo llegaste ahí
- Qué datos quedarían expuestos
- Si ya hay datos reales afectados en algún despliegue que conozcas

**No publiques ejemplos con datos reales**, ni en el reporte. Si necesitas mostrar el problema, usa los registros sintéticos del seed — los que llevan la marca `[SINTÉTICO]`.

## Qué esperar

Respondo en cuanto pueda. Este es un proyecto mantenido por una persona, no una empresa con turnos: no prometo un plazo que no pueda cumplir. Lo que sí:

- Confirmo que lo recibí
- Te digo si lo considero un fallo y qué pienso hacer
- Te acredito en el arreglo, salvo que prefieras lo contrario

## Qué cuenta como fallo de seguridad

Cualquier cosa que permita:

- Ver datos personales sin autorización — teléfono, correo, documento, notas médicas
- Obtener la ubicación exacta de un menor de edad
- Entrar al panel de validación sin credenciales, o escalar de rol
- Confirmar una coincidencia sin ser validador, y con ello disparar un aviso a una familia
- Leer o modificar reportes ajenos con un claim token que no es el tuyo
- Extraer datos en masa por un endpoint que debería estar acotado

También cuenta lo que no parece un ataque: **si un despliegue está filtrando datos por una mala configuración por defecto, eso es un fallo del proyecto**, no del despliegue.

## Lo que ya sabemos que falta

Está en el README, pero se repite aquí para que nadie lo reporte creyendo que es un hallazgo:

- **Las fotos se sirven sin autenticación.** La ruta lleva dos UUID v4 y es imposible de adivinar, pero cualquiera con el enlace la ve. Para adultos es el propósito del listado; para menores es una decisión que cada despliegue debe tomar conscientemente.
- **Sin refresh ni revocación de tokens** más allá de la invalidación por cambio de contraseña, y **sin segundo factor**.
- **La clave de cifrado no se puede rotar.** No hay versionado: cambiarla exige re-cifrar todo.
- **Sin defensa contra un actor coordinado** que inunde el mapa de reportes falsos. Hay voto por dispositivo y cierre automático por refutaciones, nada más.

Si tienes una propuesta para cualquiera de estos, abre un issue normal — no hace falta que sea privado.

## Marco legal

En Colombia el tratamiento de estos datos cae bajo la **Ley 1581 de 2012**. Si operas un despliegue con datos reales, eres responsable del tratamiento: eso incluye contrato con cualquier encargado (por ejemplo, el proveedor de almacenamiento), y la obligación de poder demostrar quién accedió a qué. La bitácora de auditoría existe para eso.
