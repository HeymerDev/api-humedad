-- =====================================================================
--  api-humedad · Datos semilla
-- ---------------------------------------------------------------------
--  Deja la base lista antes de encender el ESP32: catálogo de sensores,
--  la estación esp32_01 con sus 3 sensores, las reglas del detector de
--  anomalías y las 7 opciones del menú del teclado.
--
--  IDEMPOTENTE: usa ON CONFLICT DO NOTHING, así que se puede ejecutar
--  varias veces sin duplicar filas ni pisar cambios hechos desde la API.
--  Requiere haber aplicado antes database/schema.sql.
--
--  Ejecutar:  npm run db:seed
-- =====================================================================


-- ---------------------------------------------------------------------
--  Tipos de sensor (rangos físicos de las hojas de datos)
-- ---------------------------------------------------------------------
INSERT INTO tipos_sensor
    (codigo, nombre, fabricante, descripcion, magnitud, unidad, rango_min, rango_max, precision)
VALUES
    ('DHT22_TEMP', 'DHT22 / AM2302 - Temperatura', 'Aosong',
     'Sensor digital capacitivo de temperatura y humedad',
     'temperatura', '°C', -40, 80, 0.5),
    ('DHT22_HUM', 'DHT22 / AM2302 - Humedad relativa', 'Aosong',
     'Sensor digital capacitivo de temperatura y humedad',
     'humedad_relativa', '%', 0, 100, 2.0),
    ('DS18B20_TEMP', 'DS18B20 - Temperatura sumergible', 'Maxim Integrated',
     'Termómetro digital 1-Wire, encapsulado estanco',
     'temperatura', '°C', -55, 125, 0.5)
ON CONFLICT (codigo) DO NOTHING;


-- ---------------------------------------------------------------------
--  Ubicación y dispositivo
-- ---------------------------------------------------------------------
INSERT INTO ubicaciones (nombre, descripcion, tipo_ambiente)
VALUES ('Estación principal', 'Ubicación de la estación IoT del proyecto integrador', 'INTERIOR')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO dispositivos (codigo, nombre, descripcion, modelo, ubicacion_id)
SELECT 'esp32_01', 'Estación esp32_01',
       'ESP32 con DHT22 (aire) y DS18B20 (agua/tierra) + LCD I2C y teclado matricial',
       'ESP32', u.id
FROM ubicaciones u
WHERE u.nombre = 'Estación principal'
ON CONFLICT (codigo) DO NOTHING;


-- ---------------------------------------------------------------------
--  Sensores de esp32_01
--  La `etiqueta` es el nombre con el que el ESP32 identifica cada valor
--  en el JSON que envía.
-- ---------------------------------------------------------------------
INSERT INTO sensores (etiqueta, nombre, descripcion, pin, dispositivo_id, tipo_sensor_id)
SELECT v.etiqueta, v.nombre, v.descripcion, v.pin, d.id, t.id
FROM (VALUES
    ('temperatura_aire', 'Temperatura del aire',
     'Temperatura ambiente medida por el DHT22', 'GPIO4', 'DHT22_TEMP'),
    ('humedad_aire', 'Humedad relativa del aire',
     'Humedad relativa ambiente medida por el DHT22', 'GPIO4', 'DHT22_HUM'),
    ('temperatura_agua', 'Temperatura del agua / suelo',
     'Temperatura de inmersión medida por el DS18B20. El firmware reporta 0.0 cuando el sensor no responde.',
     'GPIO5', 'DS18B20_TEMP')
) AS v (etiqueta, nombre, descripcion, pin, codigo_tipo)
JOIN dispositivos d ON d.codigo = 'esp32_01'
JOIN tipos_sensor t ON t.codigo = v.codigo_tipo
ON CONFLICT (dispositivo_id, etiqueta) DO NOTHING;


-- ---------------------------------------------------------------------
--  Reglas del detector de anomalías
--  Alcance: tipo_sensor_id = todos los sensores de ese tipo;
--           sin tipo ni sensor = global (todas las magnitudes).
--  Severidad MEDIA o mayor abre una alerta; BAJA solo registra la anomalía.
-- ---------------------------------------------------------------------
INSERT INTO reglas_umbral
    (nombre, descripcion, tipo_anomalia, metodo, severidad,
     valor_min, valor_max, delta_max, factor, ventana_minutos, minimo_muestras, tipo_sensor_id)
SELECT r.nombre, r.descripcion, r.tipo_anomalia, r.metodo, r.severidad,
       r.valor_min, r.valor_max, r.delta_max, r.factor, r.ventana_minutos, r.minimo_muestras, t.id
FROM (VALUES
    -- Rangos operativos (más estrechos que el rango físico del sensor)
    ('Rango operativo - temperatura del aire',
     'Temperatura ambiente fuera del rango esperado',
     'FUERA_DE_RANGO', 'UMBRAL', 'MEDIA',
     0::float8, 45::float8, NULL::float8, NULL::float8, NULL::int, NULL::int, 'DHT22_TEMP'),
    ('Rango operativo - humedad del aire',
     'Humedad relativa fuera del rango esperado',
     'FUERA_DE_RANGO', 'UMBRAL', 'MEDIA',
     15, 95, NULL, NULL, NULL, NULL, 'DHT22_HUM'),

    -- Saltos imposibles entre lecturas consecutivas (20 s): suelen ser fallas del sensor
    ('Salto brusco - temperatura del aire',
     'Variación mayor a 3 °C entre lecturas consecutivas',
     'SALTO_BRUSCO', 'UMBRAL', 'MEDIA',
     NULL, NULL, 3, NULL, NULL, NULL, 'DHT22_TEMP'),
    ('Salto brusco - humedad del aire',
     'Variación mayor a 10 %RH entre lecturas consecutivas',
     'SALTO_BRUSCO', 'UMBRAL', 'MEDIA',
     NULL, NULL, 10, NULL, NULL, NULL, 'DHT22_HUM'),
    ('Salto brusco - temperatura del agua',
     'Variación mayor a 5 °C respecto de la media de los últimos 5 min: normalmente indica falla del DS18B20, no un cambio real',
     'SALTO_BRUSCO', 'MEDIA_MOVIL', 'ALTA',
     NULL, NULL, 5, NULL, 5, 10, 'DS18B20_TEMP'),

    -- Reglas globales
    ('Outlier estadístico - todas las magnitudes',
     'Desviación mayor a 3 sigmas respecto de la ventana móvil de 60 min',
     'OUTLIER_ESTADISTICO', 'ZSCORE', 'BAJA',
     NULL, NULL, NULL, 3, 60, 30, NULL),
    ('Valor congelado - todas las magnitudes',
     'El sensor repite exactamente el mismo valor durante 60 min (180 lecturas): probable sensor bloqueado o desconectado',
     'VALOR_CONGELADO', 'UMBRAL', 'MEDIA',
     NULL, NULL, NULL, NULL, 60, 150, NULL),
    ('Sensor sin datos - todas las magnitudes',
     'No llegan lecturas del sensor en 5 min (15 envíos perdidos)',
     'SENSOR_SIN_DATOS', 'UMBRAL', 'ALTA',
     NULL, NULL, NULL, NULL, 5, NULL, NULL)
) AS r (nombre, descripcion, tipo_anomalia, metodo, severidad,
        valor_min, valor_max, delta_max, factor, ventana_minutos, minimo_muestras, codigo_tipo)
LEFT JOIN tipos_sensor t ON t.codigo = r.codigo_tipo
ON CONFLICT (nombre) DO NOTHING;


-- ---------------------------------------------------------------------
--  Menú del teclado matricial (componente 2, parte B del taller)
--  `titulo` va al LCD: ASCII, máximo 16 caracteres.
-- ---------------------------------------------------------------------
INSERT INTO opciones_menu (tecla, titulo, descripcion, concepto_analitica, endpoint)
VALUES
    ('1', 'Valor actual',
     'Valor actual de cada sensor (tiempo real)',
     'Dato en tiempo real: último valor registrado por sensor (función last() de TimescaleDB)',
     '/api/v1/analitica/valores-actuales'),
    ('2', 'Promedio 1h',
     'Promedio de la última hora',
     'Medida de tendencia central: media aritmética en una ventana móvil de 1 hora',
     '/api/v1/analitica/promedio-hora'),
    ('3', 'Max/Min hoy',
     'Máximo y mínimo del día',
     'Medidas de posición: valor máximo, mínimo y rango del día, con la hora en que ocurrieron',
     '/api/v1/analitica/extremos-dia'),
    ('4', 'Desv. y tend.',
     'Desviación estándar y tendencia',
     'Dispersión (desviación estándar muestral) y tendencia (pendiente de la regresión lineal por mínimos cuadrados)',
     '/api/v1/analitica/tendencia'),
    ('5', 'Atipicos',
     'Detección de valores atípicos (outliers)',
     'Detección de valores atípicos: puntuación Z (|z| > 3) y rango intercuartílico (fuera de Q1 - 1.5*IQR y Q3 + 1.5*IQR)',
     '/api/v1/analitica/outliers'),
    ('6', 'Alertas activas',
     'Conteo de alertas activas',
     'Conteo y agregación: alertas abiertas o reconocidas agrupadas por severidad',
     '/api/v1/analitica/alertas-activas'),
    ('7', 'Estado conexion',
     'Estado de conexión a la nube',
     'Monitoreo de disponibilidad: latencia a la base de datos, último dato recibido y estado ONLINE/OFFLINE',
     '/api/v1/analitica/estado-conexion')
ON CONFLICT (tecla) DO NOTHING;


-- ---------------------------------------------------------------------
--  Verificación
-- ---------------------------------------------------------------------
SELECT 'tipos_sensor' AS tabla, count(*) AS filas FROM tipos_sensor
UNION ALL SELECT 'ubicaciones',   count(*) FROM ubicaciones
UNION ALL SELECT 'dispositivos',  count(*) FROM dispositivos
UNION ALL SELECT 'sensores',      count(*) FROM sensores
UNION ALL SELECT 'reglas_umbral', count(*) FROM reglas_umbral
UNION ALL SELECT 'opciones_menu', count(*) FROM opciones_menu
ORDER BY tabla;
