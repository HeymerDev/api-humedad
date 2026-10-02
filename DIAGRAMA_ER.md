# Diagrama entidad-relación — Estación IoT (PostgreSQL + TimescaleDB en Neon)

12 tablas: 8 del esquema actual (algunas con columnas nuevas) y 4 nuevas.
Las dos tablas de serie temporal son **hypertables** de TimescaleDB.

```mermaid
erDiagram
    ubicaciones      |o--o{ dispositivos     : "aloja"
    dispositivos     ||--o{ sensores         : "tiene"
    tipos_sensor     ||--o{ sensores         : "clasifica"
    dispositivos     ||--o{ lotes_envio      : "envía"
    lotes_envio      |o--o{ lecturas         : "agrupa"
    sensores         ||--o{ lecturas         : "mide"
    dispositivos     ||--o{ estados_conexion : "reporta"
    tipos_sensor     |o--o{ reglas_umbral    : "regla general"
    sensores         |o--o{ reglas_umbral    : "regla específica"
    reglas_umbral    |o--o{ anomalias        : "detecta"
    lecturas         |o--o{ anomalias        : "dispara"
    sensores         ||--o{ anomalias        : "presenta"
    sensores         ||--o{ alertas          : "genera"
    anomalias        |o--o{ alertas          : "origina"
    opciones_menu    ||--o{ consultas_menu   : "se consulta"
    dispositivos     ||--o{ consultas_menu   : "solicita"

    tipos_sensor {
        int         id                 PK
        varchar     codigo             UK  "ej. DHT22_TEMP"
        varchar     nombre
        varchar     fabricante
        text        descripcion
        varchar     magnitud               "Temperatura, Humedad relativa..."
        varchar     unidad                 "°C, %"
        numeric     rango_min              "límite físico del sensor"
        numeric     rango_max              "CHECK rango_min < rango_max"
        numeric     precision
        timestamptz creado_en
        timestamptz actualizado_en
    }

    ubicaciones {
        int         id                 PK
        varchar     nombre             UK
        text        descripcion
        varchar     tipo_ambiente          "INTERIOR, EXTERIOR..."
        numeric     latitud                "CHECK -90..90"
        numeric     longitud               "CHECK -180..180"
        numeric     altitud_m
        timestamptz creado_en
        timestamptz actualizado_en
    }

    dispositivos {
        int         id                 PK
        varchar     codigo             UK  "ej. esp32_01 (lo envía el ESP32)"
        varchar     nombre
        text        descripcion
        varchar     modelo
        varchar     version_firmware
        varchar     direccion_mac
        varchar     direccion_ip
        boolean     activo
        timestamptz ultima_conexion        "se actualiza en cada envío o latido"
        int         ubicacion_id       FK
        timestamptz creado_en
        timestamptz actualizado_en
    }

    sensores {
        int         id                 PK
        int         dispositivo_id     FK  "UK (dispositivo_id, etiqueta)"
        int         tipo_sensor_id     FK
        varchar     etiqueta               "ej. temperatura_aire (la envía el ESP32)"
        varchar     nombre
        text        descripcion
        varchar     pin
        boolean     activo
        numeric     offset_calibracion     "valor = crudo * escala + offset"
        numeric     escala_calibracion
        timestamptz creado_en
        timestamptz actualizado_en
    }

    lotes_envio {
        bigint      id                 PK  "NUEVA"
        int         dispositivo_id     FK
        varchar     origen                 "TIEMPO_REAL | BUFFER"
        int         intento                "reintento del ESP32 (1 = primero)"
        int         lecturas_recibidas
        int         lecturas_aceptadas
        int         lecturas_rechazadas
        timestamptz enviado_en             "hora del ESP32 (NTP)"
        timestamptz recibido_en            "hora del servidor"
        int         duracion_ms
        jsonb       errores                "detalle de lecturas rechazadas"
    }

    lecturas {
        bigint      id                 PK  "HYPERTABLE - chunk 1 día"
        timestamptz medido_en          PK  "dimensión de tiempo"
        timestamptz recibido_en
        int         sensor_id          FK
        bigint      lote_id            FK  "NUEVA"
        float8      valor                  "valor calibrado"
        float8      valor_crudo            "NUEVA - tal como llega del ESP32"
        varchar     calidad                "OK | SOSPECHOSA | INVALIDA"
        varchar     observacion
    }

    estados_conexion {
        bigint      id                 PK  "NUEVA - HYPERTABLE - chunk 7 días"
        timestamptz registrado_en      PK  "dimensión de tiempo"
        int         dispositivo_id     FK
        boolean     ntp_sincronizado       "reloj del ESP32 sincronizado"
        int         rssi_dbm
        text        direccion_ip
        bigint      uptime_s
        int         heap_libre_bytes
        int         lecturas_en_buffer     "pendientes de enviar en el ESP32"
        int         reconexiones_wifi
        int         envios_fallidos
        text        version_firmware
    }

    reglas_umbral {
        int         id                 PK
        varchar     nombre             UK
        text        descripcion
        varchar     tipo_anomalia          "NUEVA - qué detecta la regla"
        varchar     metodo                 "UMBRAL | ZSCORE | IQR | MEDIA_MOVIL | MANUAL"
        varchar     severidad              "BAJA | MEDIA | ALTA | CRITICA"
        float8      valor_min
        float8      valor_max
        float8      delta_max              "salto máximo entre lecturas"
        float8      factor                 "z máximo o k del IQR"
        int         ventana_minutos
        int         minimo_muestras
        boolean     activa
        int         sensor_id          FK  "alcance: sensor, tipo o global (ambos NULL)"
        int         tipo_sensor_id     FK
        timestamptz creado_en
        timestamptz actualizado_en
    }

    anomalias {
        int         id                 PK
        int         sensor_id          FK
        int         regla_id           FK  "NUEVA"
        bigint      lectura_id         FK  "NUEVA - FK compuesta a lecturas (id, medido_en)"
        timestamptz lectura_medido_en  FK
        varchar     tipo                   "FUERA_DE_RANGO | VALOR_CONGELADO | SALTO_BRUSCO | OUTLIER_ESTADISTICO | SENSOR_SIN_DATOS"
        varchar     metodo
        varchar     severidad
        float8      valor_observado
        float8      valor_esperado
        float8      desviacion
        float8      score
        text        descripcion
        jsonb       parametros
        boolean     revisada
        timestamptz detectado_en
    }

    alertas {
        int         id                 PK
        int         sensor_id          FK
        int         anomalia_id        FK  "anomalía que la abrió"
        varchar     tipo                   "NUEVA - tipo de anomalía agrupada"
        varchar     titulo
        text        mensaje
        varchar     severidad
        varchar     estado                 "ABIERTA | RECONOCIDA | RESUELTA"
        int         ocurrencias            "anomalías repetidas agrupadas"
        timestamptz creado_en
        timestamptz ultima_ocurrencia_en   "NUEVA"
        timestamptz reconocido_en
        timestamptz resuelto_en
    }

    opciones_menu {
        int         id                 PK  "NUEVA"
        varchar     tecla              UK  "0-9 o A-D del teclado 4x4"
        varchar     titulo                 "ASCII, máx. 16 caracteres (LCD)"
        text        descripcion
        text        concepto_analitica     "concepto del Taller 1 que aplica"
        varchar     endpoint               "ruta de la API que la resuelve"
        boolean     activa
        timestamptz creado_en
        timestamptz actualizado_en
    }

    consultas_menu {
        bigint      id                 PK  "NUEVA"
        int         opcion_menu_id     FK
        int         dispositivo_id     FK
        timestamptz consultado_en
        int         duracion_ms
        boolean     exitosa
        jsonb       parametros
        text        error
    }
```

## Para qué se usa cada tabla (todas guardan datos)

| # | Tabla | Estado | Quién escribe | Quién lee |
|---|-------|--------|---------------|-----------|
| 1 | `tipos_sensor` | existente | semilla + CRUD `/tipos-sensor` | ingesta (rango físico), detector |
| 2 | `ubicaciones` | existente | semilla + CRUD `/ubicaciones` | dispositivos, vista para KNIME |
| 3 | `dispositivos` | existente | semilla + CRUD; la ingesta actualiza `ultima_conexion` e IP | todas las consultas por `?dispositivo=` |
| 4 | `sensores` | existente | semilla + CRUD `/sensores` | ingesta (etiqueta → sensor, calibración) |
| 5 | `lotes_envio` | **nueva** | cada `POST /lecturas` del ESP32 (en línea o desde buffer) | `GET /lotes-envio`, estado de conexión |
| 6 | `lecturas` | existente | cada `POST /lecturas` | menú 1–5, KNIME, FlowiseAI |
| 7 | `estados_conexion` | **nueva** | latido del ESP32 `POST /dispositivos/:codigo/estados-conexion` | menú 7 |
| 8 | `reglas_umbral` | existente | semilla + CRUD `/reglas-umbral` | detector de anomalías |
| 9 | `anomalias` | existente (sin uso hasta ahora) | detector, al ingerir cada lote + vigilancia periódica | menú 5, `GET /anomalias` |
| 10 | `alertas` | existente (sin uso hasta ahora) | se abre/acumula desde cada anomalía | menú 6, `GET/PATCH /alertas` |
| 11 | `opciones_menu` | **nueva** | semilla (las 7 teclas) | ESP32 (títulos del LCD), tabla menú ↔ concepto de analítica |
| 12 | `consultas_menu` | **nueva** | cada consulta del teclado (`?dispositivo=`) | `GET /consultas-menu`, análisis de uso en KNIME |

## Notas de diseño

- **Hypertables**: `lecturas` (chunk de 1 día) y `estados_conexion` (chunk de 7 días).
  La justificación completa está en [`docs/timescaledb.md`](docs/timescaledb.md).
- TimescaleDB exige que la columna de tiempo forme parte de la PK; por eso ambas
  usan PK compuesta `(id, <columna de tiempo>)`.
- `lecturas` tiene además un índice único `(sensor_id, medido_en)`: un sensor
  no puede tener dos lecturas en el mismo instante, y así los reintentos del
  ESP32 no duplican datos.
- `anomalias (lectura_id, lectura_medido_en)` es una FK compuesta hacia la
  hypertable `lecturas`, que TimescaleDB 2.24 admite. Si se borra la lectura,
  la anomalía se conserva con `lectura_id = NULL`. En `SENSOR_SIN_DATOS` no hay
  lectura, así que `lectura_id` queda en NULL.
- `reglas_umbral` aplica a un sensor concreto, a todo un tipo de sensor o a
  todos (global, ambos NULL). Un CHECK impide llenar los dos a la vez, y otro
  exige los parámetros que necesita cada `tipo_anomalia`.
- `alertas` agrupa anomalías repetidas del mismo sensor y tipo: en vez de crear
  una alerta por cada lectura incrementa `ocurrencias` y `ultima_ocurrencia_en`.
  Un índice único parcial garantiza una sola alerta activa por sensor y tipo.
- La vista `v_lecturas_detalle` (no es tabla) une lecturas, sensor, tipo,
  dispositivo y ubicación para FlowiseAI.
