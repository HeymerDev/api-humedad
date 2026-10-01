/** Error con código HTTP que el manejador global convierte en respuesta JSON. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly codigo = 'ERROR',
    public readonly detalles?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  static badRequest(message: string, detalles?: unknown) {
    return new HttpError(400, message, 'SOLICITUD_INVALIDA', detalles);
  }

  static notFound(message = 'Recurso no encontrado') {
    return new HttpError(404, message, 'NO_ENCONTRADO');
  }

  static conflict(message: string, detalles?: unknown) {
    return new HttpError(409, message, 'CONFLICTO', detalles);
  }
}
