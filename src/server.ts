import { app } from './app';
import { sequelize } from './config/database';
import { env } from './config/env';

async function iniciar() {
  try {
    await sequelize.authenticate();
    console.log('Conectado a PostgreSQL (Neon)');
  } catch (error) {
    // La API arranca igual: /health reportará SIN_CONEXION hasta que la BD responda
    console.error('No se pudo conectar a la base de datos:', (error as Error).message);
  }

  const servidor = app.listen(env.PORT, () => {
    console.log(`API escuchando en http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  const apagar = async (senal: string) => {
    console.log(`${senal} recibido, cerrando...`);
    servidor.close();
    await sequelize.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void apagar('SIGINT'));
  process.on('SIGTERM', () => void apagar('SIGTERM'));
}

void iniciar();
