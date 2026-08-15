/**
 * Política de contraseñas para el panel de validación.
 *
 * Se exige longitud y no composición. Obligar a "una mayúscula, un número y un
 * símbolo" produce `Password1!` una y otra vez: es una regla que empuja a la
 * gente hacia patrones predecibles y da una sensación de seguridad que el
 * atacante no comparte. Doce caracteres libres resisten mucho más que ocho con
 * ceremonia, y permiten usar una frase que se recuerde sin apuntarla en un
 * papel pegado al monitor — que es como se filtran de verdad las claves en una
 * sala de crisis con turnos rotando.
 */

export const MIN_PASSWORD_LENGTH = 12;

/** Las que trae la instalación. Nunca pueden quedarse puestas: están en el repositorio. */
const SEED_PASSWORDS = new Set(['Reencuentro2026!', 'reencuentro2026!']);

/**
 * Contraseñas notoriamente comunes.
 *
 * La lista es corta a propósito: no pretende sustituir a un servicio de
 * contraseñas filtradas, solo atajar lo que aparece en el primer intento de
 * cualquier ataque por diccionario.
 */
const COMMON = new Set([
  'contrasena123',
  'password1234',
  '123456789012',
  'qwertyuiop12',
  'administrador',
  'colombia2026',
]);

export interface PasswordCheck {
  ok: boolean;
  reason?: string;
}

export function validatePassword(password: string, email?: string): PasswordCheck {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      reason: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres. Una frase que recuerdes sirve y es más segura que algo corto y complicado.`,
    };
  }

  if (password.length > 200) {
    // Un tope alto evita el coste de hashear entradas absurdas, que sería una
    // vía fácil de saturar la CPU del servidor.
    return { ok: false, reason: 'La contraseña es demasiado larga.' };
  }

  if (SEED_PASSWORDS.has(password)) {
    return {
      ok: false,
      reason: 'Esa es la contraseña que trae la instalación y está publicada en el repositorio.',
    };
  }

  if (COMMON.has(password.toLowerCase())) {
    return { ok: false, reason: 'Esa contraseña es demasiado común.' };
  }

  // Un solo carácter repetido cumple la longitud sin aportar nada.
  if (new Set(password).size < 5) {
    return { ok: false, reason: 'La contraseña repite demasiado los mismos caracteres.' };
  }

  if (email) {
    const localPart = email.split('@')[0]?.toLowerCase();
    if (localPart && localPart.length >= 4 && password.toLowerCase().includes(localPart)) {
      return { ok: false, reason: 'La contraseña no puede contener tu correo.' };
    }
  }

  return { ok: true };
}

/** Si la cuenta sigue con la contraseña de la instalación. */
export function isSeedPassword(password: string): boolean {
  return SEED_PASSWORDS.has(password);
}
