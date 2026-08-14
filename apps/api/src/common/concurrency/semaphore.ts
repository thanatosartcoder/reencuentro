/**
 * Semáforo de concurrencia.
 *
 * Existe por una razón medida: decodificar una foto de 12 megapíxeles reserva
 * unos 35 MB de memoria, y el límite por defecto de sharp admite imágenes de
 * hasta 268 megapíxeles, que son 0,7 GB descomprimidos. Sin un tope de
 * concurrencia, veinte subidas simultáneas —lo normal en una ráfaga durante una
 * emergencia— multiplican eso hasta agotar la memoria del proceso.
 *
 * El proceso muere, y con él se caen también los reportes de personas que no
 * tenían nada que ver con las fotos. Encolar es lento; quedarse sin memoria es
 * terminal.
 */
export class Semaphore {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      // El turno pasa directo al siguiente en cola sin bajar el contador: el
      // cupo no se libera, se cede.
      next();
      return;
    }
    this.active--;
  }

  /** Ejecuta la tarea cuando haya cupo y libera siempre, incluso si falla. */
  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  get stats(): { active: number; queued: number; limit: number } {
    return { active: this.active, queued: this.queue.length, limit: this.limit };
  }
}
