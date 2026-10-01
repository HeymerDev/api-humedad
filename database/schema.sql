-- =====================================================================
--  api-humedad · Esquema de la estación IoT
--  PostgreSQL + TimescaleDB (Neon: PostgreSQL 18, TimescaleDB 2.24 Apache)
-- ---------------------------------------------------------------------
--  Script completo: 12 tablas con sus relaciones, restricciones e índices,
--  2 hypertables (lecturas y estados_conexion) y una vista de análisis.
--  Diagrama entidad-relación: DIAGRAMA_ER.md
--
--  Es IDEMPOTENTE y CONSERVA LOS DATOS:
--    * En una base vacía crea todo desde cero.
--    * En una base con el esquema v1 (8 tablas, proyecto Python/Alembic)
--      agrega solo lo que falta: tablas nuevas, columnas nuevas,
--      restricciones e índices, y ajusta el chunk de `lecturas`.
--  Por eso las columnas nuevas de las tablas v1 se agregan con
--  ALTER TABLE ... ADD COLUMN IF NOT EXISTS justo debajo de cada tabla.
--
--  Ejecutar:  npm run db:schema      (o pegarlo en el SQL Editor de Neon)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;


-- =====================================================================
--  1/12  tipos_sensor · catálogo de tipos de sensor
-- =====================================================================
CREATE TABLE IF NOT EXISTS tipos_sensor (
    id              SERIAL,
    codigo          VARCHAR(40)    NOT NULL,
    nombre          VARCHAR(120)   NOT NULL,
    fabricante      VARCHAR(80),
    descripcion     TEXT,
    magnitud        VARCHAR(60)    NOT NULL,
    unidad          VARCHAR(20)    NOT NULL,
    rango_min       NUMERIC(10, 4) NOT NULL,
    rango_max       NUMERIC(10, 4) NOT NULL,
    precision       NUMERIC(10, 4),
    creado_en       TIMESTAMPTZ    NOT NULL DEFAULT now(),
    actualizado_en  TIMESTAMPTZ    NOT NULL DEFAULT now(),
    CONSTRAINT pk_tipos_sensor PRIMARY KEY (id),
    CONSTRAINT uq_tipos_sensor_codigo UNIQUE (codigo),
    CONSTRAINT ck_tipos_sensor_rango_coherente CHECK (rango_min < rango_max)
);
COMMENT ON TABLE tipos_sensor IS 'Catálogo de tipos de sensor y sus rangos físicos (hoja de datos)';


-- =====================================================================
--  2/12  ubicaciones · lugares donde se instalan los dispositivos
-- =====================================================================
CREATE TABLE IF NOT EXISTS ubicaciones (
    id              SERIAL,
    nombre          VARCHAR(120)  NOT NULL,
    descripcion     TEXT,
    tipo_ambiente   VARCHAR(40),
    latitud         NUMERIC(9, 6),
    longitud        NUMERIC(9, 6),
    altitud_m       NUMERIC(7, 2),
    creado_en       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    actualizado_en  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT pk_ubicaciones PRIMARY KEY (id),
    CONSTRAINT uq_ubicaciones_nombre UNIQUE (nombre),
    CONSTRAINT ck_ubicaciones_latitud_valida CHECK (latitud IS NULL OR latitud BETWEEN -90 AND 90),
    CONSTRAINT ck_ubicaciones_longitud_valida CHECK (longitud IS NULL OR longitud BETWEEN -180 AND 180)
);
COMMENT ON TABLE ubicaciones IS 'Ubicaciones físicas donde se despliegan los dispositivos';


-- =====================================================================
--  3/12  dispositivos · placas ESP32
-- =====================================================================
CREATE TABLE IF NOT EXISTS dispositivos (
    id                SERIAL,
    codigo            VARCHAR(64)   NOT NULL,
    nombre            VARCHAR(120)  NOT NULL,
    descripcion       TEXT,
    modelo            VARCHAR(60)   NOT NULL,
    version_firmware  VARCHAR(30),
    direccion_mac     VARCHAR(17),
    direccion_ip      VARCHAR(45),
    activo            BOOLEAN       NOT NULL DEFAULT true,
    ultima_conexion   TIMESTAMPTZ,
    ubicacion_id      INTEGER,
    creado_en         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    actualizado_en    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT pk_dispositivos PRIMARY KEY (id),
    CONSTRAINT fk_dispositivos_ubicacion_id_ubicaciones
        FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones (id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_dispositivos_codigo ON dispositivos (codigo);
CREATE INDEX IF NOT EXISTS ix_dispositivos_ubicacion_id ON dispositivos (ubicacion_id);
COMMENT ON TABLE dispositivos IS 'Placas ESP32 registradas en el sistema';
COMMENT ON COLUMN dispositivos.codigo IS 'Identificador que el ESP32 envía en cada petición (ej. esp32_01)';
COMMENT ON COLUMN dispositivos.ultima_conexion IS 'Se actualiza con cada lote de lecturas o latido recibido';


-- =====================================================================
--  4/12  sensores · sensores instalados en cada dispositivo
-- =====================================================================
CREATE TABLE IF NOT EXISTS sensores (
    id                  SERIAL,
    etiqueta            VARCHAR(60)    NOT NULL,
    nombre              VARCHAR(120)   NOT NULL,
    descripcion         TEXT,
    pin                 VARCHAR(20),
    activo              BOOLEAN        NOT NULL DEFAULT true,
    offset_calibracion  NUMERIC(10, 4) NOT NULL DEFAULT 0,
    escala_calibracion  NUMERIC(10, 4) NOT NULL DEFAULT 1,
    dispositivo_id      INTEGER        NOT NULL,
    tipo_sensor_id      INTEGER        NOT NULL,
    creado_en           TIMESTAMPTZ    NOT NULL DEFAULT now(),
    actualizado_en      TIMESTAMPTZ    NOT NULL DEFAULT now(),
    CONSTRAINT pk_sensores PRIMARY KEY (id),
    CONSTRAINT etiqueta_por_dispositivo UNIQUE (dispositivo_id, etiqueta),
    CONSTRAINT fk_sensores_dispositivo_id_dispositivos
        FOREIGN KEY (dispositivo_id) REFERENCES dispositivos (id) ON DELETE CASCADE,
    CONSTRAINT fk_sensores_tipo_sensor_id_tipos_sensor
        FOREIGN KEY (tipo_sensor_id) REFERENCES tipos_sensor (id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS ix_sensores_dispositivo_id ON sensores (dispositivo_id);
CREATE INDEX IF NOT EXISTS ix_sensores_etiqueta ON sensores (etiqueta);
CREATE INDEX IF NOT EXISTS ix_sensores_tipo_sensor_id ON sensores (tipo_sensor_id);
COMMENT ON TABLE sensores IS 'Sensores instalados en cada dispositivo';
COMMENT ON COLUMN sensores.etiqueta IS 'Nombre con el que el ESP32 identifica el sensor en el JSON (ej. temperatura_aire)';
COMMENT ON COLUMN sensores.escala_calibracion IS 'valor = valor_crudo * escala_calibracion + offset_calibracion';


-- =====================================================================
--  5/12  lotes_envio · cada envío del ESP32 (NUEVA)
--  Traza el manejo de fallos de conexión: si el envío falla el ESP32
--  reintenta (intento > 1) o guarda las lecturas en un buffer local y
--  las reenvía al recuperar la red (origen = 'BUFFER').
-- =====================================================================
CREATE TABLE IF NOT EXISTS lotes_envio (
    id                   BIGINT GENERATED BY DEFAULT AS IDENTITY,
    dispositivo_id       INTEGER      NOT NULL,
    origen               VARCHAR(20)  NOT NULL DEFAULT 'TIEMPO_REAL',
    intento              INTEGER      NOT NULL DEFAULT 1,
    lecturas_recibidas   INTEGER      NOT NULL DEFAULT 0,
    lecturas_aceptadas   INTEGER      NOT NULL DEFAULT 0,
    lecturas_rechazadas  INTEGER      NOT NULL DEFAULT 0,
    enviado_en           TIMESTAMPTZ,
    recibido_en          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    duracion_ms          INTEGER,
    errores              JSONB,
    CONSTRAINT pk_lotes_envio PRIMARY KEY (id),
    CONSTRAINT ck_lotes_envio_origen_valido CHECK (origen IN ('TIEMPO_REAL', 'BUFFER')),
    CONSTRAINT ck_lotes_envio_intento_positivo CHECK (intento >= 1),
    CONSTRAINT ck_lotes_envio_conteos_coherentes CHECK (
        lecturas_aceptadas >= 0 AND lecturas_rechazadas >= 0
        AND lecturas_aceptadas + lecturas_rechazadas = lecturas_recibidas
    ),
    CONSTRAINT ck_lotes_envio_duracion_no_negativa CHECK (duracion_ms IS NULL OR duracion_ms >= 0),
    CONSTRAINT fk_lotes_envio_dispositivo_id_dispositivos
        FOREIGN KEY (dispositivo_id) REFERENCES dispositivos (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_lotes_envio_dispositivo_recibido ON lotes_envio (dispositivo_id, recibido_en DESC);
COMMENT ON TABLE lotes_envio IS 'Cada envío de lecturas del ESP32, en tiempo real o desde su buffer offline';
COMMENT ON COLUMN lotes_envio.enviado_en IS 'Hora del ESP32 (NTP) al enviar; NULL si no la reporta';
COMMENT ON COLUMN lotes_envio.errores IS 'Detalle de las lecturas rechazadas del lote';


-- =====================================================================
--  6/12  lecturas · serie temporal de mediciones  ->  HYPERTABLE
--  calidad/observacion siguen en VARCHAR por compatibilidad con v1; en
--  una base vacía TimescaleDB avisa que prefiere TEXT (aviso inofensivo).
-- =====================================================================
CREATE TABLE IF NOT EXISTS lecturas (
    id           BIGINT GENERATED BY DEFAULT AS IDENTITY,
    medido_en    TIMESTAMPTZ       NOT NULL DEFAULT now(),
    recibido_en  TIMESTAMPTZ       NOT NULL DEFAULT now(),
    valor        DOUBLE PRECISION  NOT NULL,
    calidad      VARCHAR(20)       NOT NULL DEFAULT 'OK',
    observacion  VARCHAR(200),
    sensor_id    INTEGER           NOT NULL,
    -- La columna de tiempo debe formar parte de la PK para ser hypertable
    CONSTRAINT pk_lecturas PRIMARY KEY (id, medido_en),
    CONSTRAINT ck_lecturas_calidad_valida CHECK (calidad IN ('OK', 'SOSPECHOSA', 'INVALIDA')),
    CONSTRAINT fk_lecturas_sensor_id_sensores
        FOREIGN KEY (sensor_id) REFERENCES sensores (id) ON DELETE CASCADE
);
-- v2: valor sin calibrar y lote de envío al que pertenece la lectura
ALTER TABLE lecturas ADD COLUMN IF NOT EXISTS valor_crudo DOUBLE PRECISION;
ALTER TABLE lecturas ADD COLUMN IF NOT EXISTS lote_id BIGINT;
DO $$ BEGIN
    ALTER TABLE lecturas ADD CONSTRAINT fk_lecturas_lote_id_lotes_envio
        FOREIGN KEY (lote_id) REFERENCES lotes_envio (id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- Índice principal de consulta: "lecturas del sensor X entre t1 y t2"
CREATE INDEX IF NOT EXISTS ix_lecturas_sensor_tiempo ON lecturas (sensor_id, medido_en);
CREATE INDEX IF NOT EXISTS ix_lecturas_lote_id ON lecturas (lote_id);
-- v1 tenía un índice solo por sensor_id: lo cubre ix_lecturas_sensor_tiempo
DROP INDEX IF EXISTS ix_lecturas_sensor_id;
COMMENT ON TABLE lecturas IS 'Serie temporal de mediciones (hypertable de TimescaleDB, chunk de 1 día)';
COMMENT ON COLUMN lecturas.medido_en IS 'Momento de la medición según el ESP32 (dimensión de tiempo de la hypertable)';
COMMENT ON COLUMN lecturas.valor IS 'Valor calibrado: valor_crudo * escala + offset del sensor';
COMMENT ON COLUMN lecturas.valor_crudo IS 'Valor tal como lo envió el ESP32 (NULL en lecturas anteriores a v2)';


-- =====================================================================
--  7/12  estados_conexion · latidos del ESP32 (NUEVA)  ->  HYPERTABLE
-- =====================================================================
CREATE TABLE IF NOT EXISTS estados_conexion (
    id                  BIGINT GENERATED BY DEFAULT AS IDENTITY,
    registrado_en       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    dispositivo_id      INTEGER      NOT NULL,
    ntp_sincronizado    BOOLEAN      NOT NULL DEFAULT true,
    rssi_dbm            INTEGER,
    -- TimescaleDB recomienda TEXT (no VARCHAR) en hypertables; el largo se limita con CHECK
    direccion_ip        TEXT,
    uptime_s            BIGINT,
    heap_libre_bytes    INTEGER,
    lecturas_en_buffer  INTEGER      NOT NULL DEFAULT 0,
    reconexiones_wifi   INTEGER      NOT NULL DEFAULT 0,
    envios_fallidos     INTEGER      NOT NULL DEFAULT 0,
    version_firmware    TEXT,
    CONSTRAINT pk_estados_conexion PRIMARY KEY (id, registrado_en),
    CONSTRAINT ck_estados_conexion_largos CHECK (
        (direccion_ip IS NULL OR char_length(direccion_ip) <= 45)
        AND (version_firmware IS NULL OR char_length(version_firmware) <= 30)
    ),
    CONSTRAINT ck_estados_conexion_rssi_valido CHECK (rssi_dbm IS NULL OR rssi_dbm BETWEEN -127 AND 0),
    CONSTRAINT ck_estados_conexion_contadores_no_negativos CHECK (
        lecturas_en_buffer >= 0 AND reconexiones_wifi >= 0 AND envios_fallidos >= 0
        AND (uptime_s IS NULL OR uptime_s >= 0)
        AND (heap_libre_bytes IS NULL OR heap_libre_bytes >= 0)
    ),
    CONSTRAINT fk_estados_conexion_dispositivo_id_dispositivos
        FOREIGN KEY (dispositivo_id) REFERENCES dispositivos (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_estados_conexion_dispositivo_tiempo ON estados_conexion (dispositivo_id, registrado_en DESC);
COMMENT ON TABLE estados_conexion IS 'Latidos periódicos del ESP32: señal Wi-Fi, memoria, buffer pendiente (hypertable, chunk de 7 días)';
COMMENT ON COLUMN estados_conexion.lecturas_en_buffer IS 'Lecturas guardadas en el ESP32 pendientes de enviar';


-- =====================================================================
--  8/12  reglas_umbral · reglas del detector de anomalías
--  Alcance: un sensor (sensor_id), un tipo de sensor (tipo_sensor_id)
--  o global (ambos NULL).
-- =====================================================================
CREATE TABLE IF NOT EXISTS reglas_umbral (
    id               SERIAL,
    nombre           VARCHAR(120)      NOT NULL,
    descripcion      TEXT,
    metodo           VARCHAR(30)       NOT NULL DEFAULT 'UMBRAL',
    severidad        VARCHAR(20)       NOT NULL DEFAULT 'MEDIA',
    valor_min        DOUBLE PRECISION,
    valor_max        DOUBLE PRECISION,
    delta_max        DOUBLE PRECISION,
    factor           DOUBLE PRECISION,
    ventana_minutos  INTEGER,
    minimo_muestras  INTEGER,
    activa           BOOLEAN           NOT NULL DEFAULT true,
    sensor_id        INTEGER,
    tipo_sensor_id   INTEGER,
    creado_en        TIMESTAMPTZ       NOT NULL DEFAULT now(),
    actualizado_en   TIMESTAMPTZ       NOT NULL DEFAULT now(),
    CONSTRAINT pk_reglas_umbral PRIMARY KEY (id),
    CONSTRAINT nombre_unico UNIQUE (nombre),
    CONSTRAINT ck_reglas_umbral_alcance_exclusivo CHECK (NOT (sensor_id IS NOT NULL AND tipo_sensor_id IS NOT NULL)),
    CONSTRAINT ck_reglas_umbral_metodo_valido CHECK (metodo IN ('UMBRAL', 'ZSCORE', 'IQR', 'MEDIA_MOVIL', 'MANUAL')),
    CONSTRAINT ck_reglas_umbral_severidad_valida CHECK (severidad IN ('BAJA', 'MEDIA', 'ALTA', 'CRITICA')),
    CONSTRAINT ck_reglas_umbral_umbrales_coherentes CHECK (valor_min IS NULL OR valor_max IS NULL OR valor_min < valor_max),
    CONSTRAINT fk_reglas_umbral_sensor_id_sensores
        FOREIGN KEY (sensor_id) REFERENCES sensores (id) ON DELETE CASCADE,
    CONSTRAINT fk_reglas_umbral_tipo_sensor_id_tipos_sensor
        FOREIGN KEY (tipo_sensor_id) REFERENCES tipos_sensor (id) ON DELETE CASCADE
);
-- v2: qué anomalía detecta cada regla. Las reglas v1 se clasifican por su método.
ALTER TABLE reglas_umbral ADD COLUMN IF NOT EXISTS tipo_anomalia VARCHAR(40);
UPDATE reglas_umbral
SET tipo_anomalia = CASE
        WHEN metodo IN ('ZSCORE', 'IQR') THEN 'OUTLIER_ESTADISTICO'
        WHEN delta_max IS NOT NULL       THEN 'SALTO_BRUSCO'
        ELSE 'FUERA_DE_RANGO'
    END
WHERE tipo_anomalia IS NULL;
ALTER TABLE reglas_umbral ALTER COLUMN tipo_anomalia SET NOT NULL;
DO $$ BEGIN
    ALTER TABLE reglas_umbral ADD CONSTRAINT ck_reglas_umbral_tipo_anomalia_valido CHECK (
        tipo_anomalia IN ('FUERA_DE_RANGO', 'VALOR_CONGELADO', 'SALTO_BRUSCO', 'OUTLIER_ESTADISTICO', 'SENSOR_SIN_DATOS')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- Cada tipo de regla exige sus parámetros
DO $$ BEGIN
    ALTER TABLE reglas_umbral ADD CONSTRAINT ck_reglas_umbral_parametros_por_tipo CHECK (
        CASE tipo_anomalia
            WHEN 'FUERA_DE_RANGO'      THEN valor_min IS NOT NULL OR valor_max IS NOT NULL
            WHEN 'SALTO_BRUSCO'        THEN delta_max IS NOT NULL AND delta_max > 0
            WHEN 'OUTLIER_ESTADISTICO' THEN metodo IN ('ZSCORE', 'IQR') AND factor > 0 AND ventana_minutos IS NOT NULL
            WHEN 'VALOR_CONGELADO'     THEN ventana_minutos IS NOT NULL
            WHEN 'SENSOR_SIN_DATOS'    THEN ventana_minutos IS NOT NULL
            ELSE TRUE
        END
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE reglas_umbral ADD CONSTRAINT ck_reglas_umbral_ventana_positiva CHECK (
        (ventana_minutos IS NULL OR ventana_minutos > 0) AND (minimo_muestras IS NULL OR minimo_muestras > 0)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS ix_reglas_umbral_activa ON reglas_umbral (activa);
CREATE INDEX IF NOT EXISTS ix_reglas_umbral_sensor_id ON reglas_umbral (sensor_id);
CREATE INDEX IF NOT EXISTS ix_reglas_umbral_tipo_sensor_id ON reglas_umbral (tipo_sensor_id);
COMMENT ON TABLE reglas_umbral IS 'Reglas parametrizables del detector de anomalías';
COMMENT ON COLUMN reglas_umbral.factor IS 'ZSCORE: |z| máximo. IQR: k de Q1 - k*IQR .. Q3 + k*IQR';


-- =====================================================================
--  9/12  anomalias · valores atípicos detectados
-- =====================================================================
CREATE TABLE IF NOT EXISTS anomalias (
    id                 SERIAL,
    sensor_id          INTEGER           NOT NULL,
    lectura_medido_en  TIMESTAMPTZ       NOT NULL,
    tipo               VARCHAR(40)       NOT NULL,
    metodo             VARCHAR(30)       NOT NULL,
    severidad          VARCHAR(20)       NOT NULL DEFAULT 'MEDIA',
    valor_observado    DOUBLE PRECISION  NOT NULL,
    valor_esperado     DOUBLE PRECISION,
    desviacion         DOUBLE PRECISION,
    score              DOUBLE PRECISION,
    descripcion        TEXT,
    parametros         JSONB,
    revisada           BOOLEAN           NOT NULL DEFAULT false,
    detectado_en       TIMESTAMPTZ       NOT NULL DEFAULT now(),
    CONSTRAINT pk_anomalias PRIMARY KEY (id),
    CONSTRAINT ck_anomalias_tipo_valido CHECK (
        tipo IN ('FUERA_DE_RANGO', 'VALOR_CONGELADO', 'SALTO_BRUSCO', 'OUTLIER_ESTADISTICO', 'SENSOR_SIN_DATOS')
    ),
    CONSTRAINT ck_anomalias_metodo_valido CHECK (metodo IN ('UMBRAL', 'ZSCORE', 'IQR', 'MEDIA_MOVIL', 'MANUAL')),
    CONSTRAINT ck_anomalias_severidad_valida CHECK (severidad IN ('BAJA', 'MEDIA', 'ALTA', 'CRITICA')),
    CONSTRAINT ck_anomalias_score_no_negativo CHECK (score IS NULL OR score >= 0),
    CONSTRAINT fk_anomalias_sensor_id_sensores
        FOREIGN KEY (sensor_id) REFERENCES sensores (id) ON DELETE CASCADE
);
-- v2: regla que la detectó y lectura que la originó.
-- La FK hacia lecturas (hypertable) se crea al final, tras convertirla.
ALTER TABLE anomalias ADD COLUMN IF NOT EXISTS regla_id INTEGER;
ALTER TABLE anomalias ADD COLUMN IF NOT EXISTS lectura_id BIGINT;
DO $$ BEGIN
    ALTER TABLE anomalias ADD CONSTRAINT fk_anomalias_regla_id_reglas_umbral
        FOREIGN KEY (regla_id) REFERENCES reglas_umbral (id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS ix_anomalias_sensor_id ON anomalias (sensor_id);
CREATE INDEX IF NOT EXISTS ix_anomalias_sensor_tiempo ON anomalias (sensor_id, lectura_medido_en);
CREATE INDEX IF NOT EXISTS ix_anomalias_regla_id ON anomalias (regla_id);
CREATE INDEX IF NOT EXISTS ix_anomalias_lectura ON anomalias (lectura_id, lectura_medido_en);
CREATE INDEX IF NOT EXISTS ix_anomalias_detectado_en ON anomalias (detectado_en DESC);
COMMENT ON TABLE anomalias IS 'Valores atípicos detectados sobre las lecturas';
COMMENT ON COLUMN anomalias.lectura_id IS 'Lectura que originó la anomalía; NULL en SENSOR_SIN_DATOS';


-- =====================================================================
--  10/12  alertas · avisos generados a partir de anomalías
-- =====================================================================
CREATE TABLE IF NOT EXISTS alertas (
    id             SERIAL,
    titulo         VARCHAR(160)  NOT NULL,
    mensaje        TEXT          NOT NULL,
    severidad      VARCHAR(20)   NOT NULL DEFAULT 'MEDIA',
    estado         VARCHAR(20)   NOT NULL DEFAULT 'ABIERTA',
    ocurrencias    INTEGER       NOT NULL DEFAULT 1,
    creado_en      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    reconocido_en  TIMESTAMPTZ,
    resuelto_en    TIMESTAMPTZ,
    sensor_id      INTEGER       NOT NULL,
    anomalia_id    INTEGER,
    CONSTRAINT pk_alertas PRIMARY KEY (id),
    CONSTRAINT ck_alertas_estado_valido CHECK (estado IN ('ABIERTA', 'RECONOCIDA', 'RESUELTA')),
    CONSTRAINT ck_alertas_severidad_valida CHECK (severidad IN ('BAJA', 'MEDIA', 'ALTA', 'CRITICA')),
    CONSTRAINT fk_alertas_sensor_id_sensores
        FOREIGN KEY (sensor_id) REFERENCES sensores (id) ON DELETE CASCADE,
    CONSTRAINT fk_alertas_anomalia_id_anomalias
        FOREIGN KEY (anomalia_id) REFERENCES anomalias (id) ON DELETE SET NULL
);
-- v2: tipo de anomalía que agrupa la alerta y última vez que se repitió
ALTER TABLE alertas ADD COLUMN IF NOT EXISTS tipo VARCHAR(40);
ALTER TABLE alertas ADD COLUMN IF NOT EXISTS ultima_ocurrencia_en TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE alertas a
SET tipo = an.tipo
FROM anomalias an
WHERE a.anomalia_id = an.id AND a.tipo IS NULL;
ALTER TABLE alertas ALTER COLUMN tipo SET NOT NULL;
DO $$ BEGIN
    ALTER TABLE alertas ADD CONSTRAINT ck_alertas_tipo_valido CHECK (
        tipo IN ('FUERA_DE_RANGO', 'VALOR_CONGELADO', 'SALTO_BRUSCO', 'OUTLIER_ESTADISTICO', 'SENSOR_SIN_DATOS')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE alertas ADD CONSTRAINT ck_alertas_ocurrencias_positivas CHECK (ocurrencias >= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- Una alerta RECONOCIDA o RESUELTA debe tener la fecha correspondiente
DO $$ BEGIN
    ALTER TABLE alertas ADD CONSTRAINT ck_alertas_fechas_por_estado CHECK (
        (estado <> 'RECONOCIDA' OR reconocido_en IS NOT NULL)
        AND (estado <> 'RESUELTA' OR resuelto_en IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS ix_alertas_anomalia_id ON alertas (anomalia_id);
CREATE INDEX IF NOT EXISTS ix_alertas_estado ON alertas (estado);
CREATE INDEX IF NOT EXISTS ix_alertas_estado_creado ON alertas (estado, creado_en);
CREATE INDEX IF NOT EXISTS ix_alertas_sensor_id ON alertas (sensor_id);
-- Como máximo una alerta activa por sensor y tipo: las repeticiones suman `ocurrencias`
CREATE UNIQUE INDEX IF NOT EXISTS uq_alertas_activa_sensor_tipo ON alertas (sensor_id, tipo) WHERE estado <> 'RESUELTA';
COMMENT ON TABLE alertas IS 'Alertas generadas a partir de anomalías; agrupan las repetidas del mismo sensor y tipo';


-- =====================================================================
--  11/12  opciones_menu · teclas del menú del teclado matricial (NUEVA)
-- =====================================================================
CREATE TABLE IF NOT EXISTS opciones_menu (
    id                  SERIAL,
    tecla               VARCHAR(1)    NOT NULL,
    titulo              VARCHAR(16)   NOT NULL,
    descripcion         TEXT,
    concepto_analitica  TEXT          NOT NULL,
    endpoint            VARCHAR(120)  NOT NULL,
    activa              BOOLEAN       NOT NULL DEFAULT true,
    creado_en           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    actualizado_en      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT pk_opciones_menu PRIMARY KEY (id),
    CONSTRAINT uq_opciones_menu_tecla UNIQUE (tecla),
    -- Teclado 4x4: 0-9 y A-D. '*' y '#' quedan para volver / confirmar.
    CONSTRAINT ck_opciones_menu_tecla_valida CHECK (tecla ~ '^[0-9A-D]$'),
    -- El LCD (HD44780) no muestra tildes: solo ASCII imprimible, 16 columnas
    CONSTRAINT ck_opciones_menu_titulo_lcd CHECK (titulo ~ '^[ -~]{1,16}$'),
    CONSTRAINT ck_opciones_menu_endpoint_api CHECK (endpoint LIKE '/api/%')
);
COMMENT ON TABLE opciones_menu IS 'Opciones del menú del teclado matricial y el concepto de analítica que aplica cada una';


-- =====================================================================
--  12/12  consultas_menu · cada consulta hecha desde el teclado (NUEVA)
-- =====================================================================
CREATE TABLE IF NOT EXISTS consultas_menu (
    id              BIGINT GENERATED BY DEFAULT AS IDENTITY,
    opcion_menu_id  INTEGER      NOT NULL,
    dispositivo_id  INTEGER      NOT NULL,
    consultado_en   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    duracion_ms     INTEGER,
    exitosa         BOOLEAN      NOT NULL DEFAULT true,
    parametros      JSONB,
    error           TEXT,
    CONSTRAINT pk_consultas_menu PRIMARY KEY (id),
    CONSTRAINT ck_consultas_menu_duracion_no_negativa CHECK (duracion_ms IS NULL OR duracion_ms >= 0),
    CONSTRAINT ck_consultas_menu_error_si_falla CHECK (exitosa OR error IS NOT NULL),
    -- RESTRICT: para retirar una opción con historial se marca activa = false
    CONSTRAINT fk_consultas_menu_opcion_menu_id_opciones_menu
        FOREIGN KEY (opcion_menu_id) REFERENCES opciones_menu (id) ON DELETE RESTRICT,
    CONSTRAINT fk_consultas_menu_dispositivo_id_dispositivos
        FOREIGN KEY (dispositivo_id) REFERENCES dispositivos (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_consultas_menu_dispositivo_tiempo ON consultas_menu (dispositivo_id, consultado_en DESC);
CREATE INDEX IF NOT EXISTS ix_consultas_menu_opcion_menu_id ON consultas_menu (opcion_menu_id);
COMMENT ON TABLE consultas_menu IS 'Registro de cada consulta del menú hecha desde el teclado del ESP32';


-- =====================================================================
--  HYPERTABLES Y CHUNKS (TimescaleDB)
-- ---------------------------------------------------------------------
--  lecturas          chunk de 1 día   (≈ 4.320 filas/día por sensor)
--  estados_conexion  chunk de 7 días  (≈ 1.440 latidos/día por ESP32)
--  Justificación completa: docs/timescaledb.md
--
--  create_hypertable(..., if_not_exists) no toca una hypertable existente,
--  por eso set_chunk_time_interval fija el intervalo en ambos casos.
--  El cambio de intervalo solo aplica a los chunks que se creen después.
-- =====================================================================
SELECT create_hypertable('lecturas', by_range('medido_en', INTERVAL '1 day'),
                         if_not_exists => TRUE, migrate_data => TRUE);
SELECT set_chunk_time_interval('lecturas', INTERVAL '1 day');

SELECT create_hypertable('estados_conexion', by_range('registrado_en', INTERVAL '7 days'),
                         if_not_exists => TRUE, migrate_data => TRUE);
SELECT set_chunk_time_interval('estados_conexion', INTERVAL '7 days');

-- FK hacia una hypertable (soportada desde TimescaleDB 2.16).
-- Si se borra la lectura, la anomalía se conserva sin lectura_id.
DO $$ BEGIN
    ALTER TABLE anomalias ADD CONSTRAINT fk_anomalias_lectura_lecturas
        FOREIGN KEY (lectura_id, lectura_medido_en) REFERENCES lecturas (id, medido_en)
        ON DELETE SET NULL (lectura_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- =====================================================================
--  VISTA DE ANÁLISIS
--  Una fila por lectura con todo su contexto. Pensada para FlowiseAI y
--  consultas rápidas. (En KNIME el taller pide hacer la unión con nodos
--  Joiner, así que allí conviene leer las tablas por separado).
-- =====================================================================
CREATE OR REPLACE VIEW v_lecturas_detalle AS
SELECT
    l.id                                    AS lectura_id,
    l.medido_en,
    l.medido_en AT TIME ZONE 'America/Bogota' AS medido_en_local,
    l.recibido_en,
    l.valor,
    l.valor_crudo,
    l.calidad,
    l.observacion,
    l.lote_id,
    s.id                                    AS sensor_id,
    s.etiqueta                              AS sensor_etiqueta,
    s.nombre                                AS sensor_nombre,
    t.codigo                                AS tipo_sensor,
    t.magnitud,
    t.unidad,
    d.id                                    AS dispositivo_id,
    d.codigo                                AS dispositivo_codigo,
    u.nombre                                AS ubicacion,
    u.tipo_ambiente
FROM lecturas l
JOIN sensores s      ON s.id = l.sensor_id
JOIN tipos_sensor t  ON t.id = s.tipo_sensor_id
JOIN dispositivos d  ON d.id = s.dispositivo_id
LEFT JOIN ubicaciones u ON u.id = d.ubicacion_id;
COMMENT ON VIEW v_lecturas_detalle IS 'Lecturas con sensor, tipo, dispositivo y ubicación (hora local America/Bogota)';


-- =====================================================================
--  VERIFICACIÓN: las 12 tablas, cuáles son hypertables y su chunk
-- =====================================================================
SELECT
    t.table_name                       AS tabla,
    (h.hypertable_name IS NOT NULL)    AS hypertable,
    d.time_interval::text              AS chunk_time_interval,
    h.num_chunks                       AS chunks
FROM information_schema.tables t
LEFT JOIN timescaledb_information.hypertables h
       ON h.hypertable_schema = t.table_schema AND h.hypertable_name = t.table_name
LEFT JOIN timescaledb_information.dimensions d
       ON d.hypertable_schema = t.table_schema AND d.hypertable_name = t.table_name
WHERE t.table_schema = current_schema()
  AND t.table_type = 'BASE TABLE'
  AND t.table_name IN (
      'tipos_sensor', 'ubicaciones', 'dispositivos', 'sensores', 'lotes_envio', 'lecturas',
      'estados_conexion', 'reglas_umbral', 'anomalias', 'alertas', 'opciones_menu', 'consultas_menu'
  )
ORDER BY t.table_name;
