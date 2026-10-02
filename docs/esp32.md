# Integración con el ESP32

Contrato entre el firmware de la estación y la API. Todas las rutas cuelgan de
`/api/v1` y usan JSON. No hay autenticación: el ESP32 se identifica con su
código (`esp32_01`) en cada petición.

| Qué | Cuándo | Endpoint |
|-----|--------|----------|
| Lecturas | Cada 20 s y al vaciar el buffer | `POST /lecturas` |
| Latido | Cada 60 s | `POST /dispositivos/esp32_01/estados-conexion` |
| Menú (títulos del LCD) | Al arrancar | `GET /opciones-menu?activa=true` |
| Consulta del teclado | Al pulsar 1–7 | `GET /analitica/<opción>?dispositivo=esp32_01&solo_lcd=true` |

---

## 1. Envío de lecturas

```http
POST /api/v1/lecturas
Content-Type: application/json

{
  "dispositivo": "esp32_01",
  "origen": "TIEMPO_REAL",
  "intento": 1,
  "enviado_en": 1790000000,
  "lecturas": [
    { "sensor": "temperatura_aire", "valor": 24.6, "medido_en": 1790000000 },
    { "sensor": "humedad_aire",     "valor": 61.3, "medido_en": 1790000000 },
    { "sensor": "temperatura_agua", "valor": 19.8, "medido_en": 1790000000 }
  ]
}
```

| Campo | Obligatorio | Detalle |
|-------|-------------|---------|
| `dispositivo` | sí | Código registrado en `dispositivos` |
| `origen` | no | `TIEMPO_REAL` (por defecto) o `BUFFER` al reenviar lo acumulado sin red |
| `intento` | no | 1 en el primer envío; 2, 3… al reintentar el mismo lote |
| `enviado_en` | no | Hora del ESP32 al enviar (epoch en segundos) |
| `lecturas[].sensor` | sí | Etiqueta del sensor: `temperatura_aire`, `humedad_aire`, `temperatura_agua` |
| `lecturas[].valor` | sí | Número. Si el DHT22 devuelve NaN, envía `null`: la lectura se rechaza con motivo y queda registrada |
| `lecturas[].medido_en` | no | Momento de la medición (epoch en segundos o ISO-8601). **Obligatorio en las lecturas del buffer**; sin él se usa la hora del servidor |

Respuesta `201`:

```json
{
  "data": {
    "lote_id": 123, "recibidas": 3, "aceptadas": 3, "rechazadas": 0, "duplicadas": 0,
    "invalidas": 0, "sospechosas": 0, "anomalias": 0, "alertas_abiertas": 0,
    "hora_servidor": 1790000001, "duracion_ms": 640
  }
}
```

Si hay rechazos llega además `errores: [{ "indice": 1, "sensor": "humedad_aire", "motivo": "..." }]`.

### Qué hace la API con cada lectura

- **Rechaza** (no la guarda):
  - sensor no registrado o inactivo;
  - `valor` nulo o no numérico;
  - `medido_en` más de 5 min en el futuro o de hace más de 30 días, típico de un ESP32 sin NTP que envía 1970;
  - repetida dentro del mismo lote.
- **Calibra**: `valor = crudo * escala_calibracion + offset_calibracion` y guarda también el crudo.
- **Marca la calidad**:
  - `INVALIDA` si el valor queda fuera del rango físico del sensor, por ejemplo humedad de 130 %;
  - `SOSPECHOSA` si el DS18B20 reporta exactamente 0.0.

  Ambas se guardan, pero la analítica solo usa las `OK`.
- **Detecta anomalías y abre alertas** (ver tarea 8 en `tasks.md`).

### Reintentos y buffer (requisito "manejar fallos de conexión")

| Respuesta | Qué hace el ESP32 |
|-----------|-------------------|
| `2xx` | Listo. **No reintentar**, aunque haya rechazos: fallarían igual |
| `4xx` | Descartar el lote y registrar el error en el monitor serie (es un error de datos o de configuración) |
| Error de red, timeout o `5xx` | Reintentar hasta 3 veces con `intento` 2 y 3. Si sigue fallando, guardar las lecturas en el buffer |

**Reintentar es seguro.** Si un envío llegó a guardarse pero la respuesta se
perdió, las lecturas repetidas vuelven como `duplicadas`: el índice único
`(sensor_id, medido_en)` impide que se dupliquen.

Al recuperar la red, vacía el buffer con `origen: "BUFFER"` en lotes de
**hasta 150 lecturas**, cada una con su `medido_en` original. Usa un timeout
HTTP de **15 s**: un lote grande tarda 2–4 s y el primero tras arrancar la
API (o tras despertar Neon) puede tardar más.

`hora_servidor` sirve para corregir el reloj si el NTP no responde.

---

## 2. Latido

```http
POST /api/v1/dispositivos/esp32_01/estados-conexion
Content-Type: application/json

{
  "ntp_sincronizado": true,
  "rssi_dbm": -61,
  "ip": "192.168.1.50",
  "uptime_s": 3600,
  "heap_libre_bytes": 180000,
  "lecturas_en_buffer": 0,
  "reconexiones_wifi": 1,
  "envios_fallidos": 0,
  "version_firmware": "1.0.0"
}
```

Todos los campos son opcionales. Se guarda en la hypertable
`estados_conexion` y actualiza en `dispositivos` la última conexión, la IP
local y la versión de firmware. Es la base de la tecla 7.

Si el ESP32 deja de enviar, la vigilancia de la API abre una alerta
`SENSOR_SIN_DATOS` por sensor a los 5 min. La alerta se cierra sola cuando
vuelven los datos.

---

## 3. Menú del teclado matricial

Tabla que relaciona cada opción del menú con el concepto de analítica que
aplica. Está guardada en la tabla `opciones_menu` (`GET /api/v1/opciones-menu`).

| Tecla | Título en el LCD | Endpoint | Concepto de analítica |
|-------|------------------|----------|-----------------------|
| 1 | Valor actual | `/analitica/valores-actuales` | Dato en tiempo real: último valor registrado por sensor |
| 2 | Promedio 1h | `/analitica/promedio-hora` | Tendencia central: media aritmética en una ventana móvil de 1 hora (y serie en tramos de 10 min con `time_bucket`) |
| 3 | Max/Min hoy | `/analitica/extremos-dia` | Medidas de posición: máximo, mínimo y rango del día, con la hora en que ocurrieron |
| 4 | Desv. y tend. | `/analitica/tendencia` | Dispersión (desviación estándar muestral, coeficiente de variación) y tendencia (pendiente de la regresión lineal por mínimos cuadrados, R²) |
| 5 | Atipicos | `/analitica/outliers` | Valores atípicos: puntuación Z (\|z\| > 3) y rango intercuartílico (fuera de Q1 − 1.5·IQR y Q3 + 1.5·IQR) |
| 6 | Alertas activas | `/analitica/alertas-activas` | Conteo y agregación: alertas abiertas o reconocidas por severidad |
| 7 | Estado conexion | `/analitica/estado-conexion` | Monitoreo de disponibilidad: latencia a la BD, último dato, estado ONLINE/OFFLINE |
| `*` | — | — | Volver al menú |
| `#` | — | — | Confirmar / siguiente página |

### Petición y respuesta

```http
GET /api/v1/analitica/promedio-hora?dispositivo=esp32_01&lcd=16x2&solo_lcd=true
```

```json
{
  "lcd": {
    "columnas": 16,
    "filas": 2,
    "paginas": [
      ["T.aire 22.1C", "prom 60m n=180"],
      ["H.aire 64.8%", "prom 60m n=179"],
      ["T.agua 19.1C", "prom 60m n=181"]
    ]
  }
}
```

- Cada página llena la pantalla y ya viene recortada al ancho, en ASCII (el
  HD44780 no tiene tildes). Con `#` se pasa a la siguiente y con `*` se vuelve.
- `lcd=20x4` agrupa dos sensores por página.
- `solo_lcd=true` omite `data` (unos 150 bytes en vez de ~1 KB). Sin él la
  respuesta trae además el detalle completo, útil desde el navegador.
- Cada consulta queda registrada en `consultas_menu` (opción, dispositivo,
  duración y si falló). Desde el navegador añade `&registrar=false` para no
  mezclar tus pruebas con el uso real del teclado.

Parámetros extra: `minutos` (teclas 2, 4 y 5; por defecto 60), `fecha=YYYY-MM-DD`
(tecla 3), y `z` / `k` (tecla 5).

---

## 4. Sketch de referencia (Arduino / ESP32)

> **Referencia, no probado en hardware.** Muestra el flujo completo contra
> esta API; ajusta los pines, el SSID y la URL a tu montaje.
>
> Librerías: ArduinoJson 7, DHT sensor library (Adafruit), OneWire,
> DallasTemperature, Keypad y LiquidCrystal_I2C.

```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Keypad.h>
#include <LiquidCrystal_I2C.h>
#include <time.h>

// ---------------- Configuración ----------------
const char* WIFI_SSID   = "TU_RED";
const char* WIFI_PASS   = "TU_CLAVE";
const char* API         = "https://tu-api.onrender.com/api/v1";
const char* DISPOSITIVO = "esp32_01";
const char* FIRMWARE    = "1.0.0";

const uint32_t INTERVALO_LECTURA_MS = 20000;   // el taller exige 20 s
const uint32_t INTERVALO_LATIDO_MS  = 60000;
const uint16_t TIMEOUT_HTTP_MS      = 15000;
const int      MAX_POR_LOTE         = 150;     // al vaciar el buffer

DHT dht(4, DHT22);
OneWire oneWire(5);
DallasTemperature ds18b20(&oneWire);
LiquidCrystal_I2C lcd(0x27, 16, 2);

const byte FILAS = 4, COLS = 4;
char teclas[FILAS][COLS] = {
  {'1','2','3','A'}, {'4','5','6','B'}, {'7','8','9','C'}, {'*','0','#','D'}
};
byte pinesFilas[FILAS] = {13, 12, 14, 27};
byte pinesCols[COLS]   = {26, 25, 33, 32};
Keypad teclado = Keypad(makeKeymap(teclas), pinesFilas, pinesCols, FILAS, COLS);

// ---------------- Buffer offline ----------------
struct Lectura { const char* sensor; float valor; time_t medidoEn; };
const int MAX_BUFFER = 450;                    // ~50 min de 3 sensores
Lectura buffer[MAX_BUFFER];
int enBuffer = 0;
uint32_t reconexiones = 0, enviosFallidos = 0;

void guardarEnBuffer(const Lectura* l, int n) {
  for (int i = 0; i < n; i++) {
    if (enBuffer == MAX_BUFFER) {              // lleno: se descarta la más vieja
      memmove(buffer, buffer + 1, sizeof(Lectura) * (MAX_BUFFER - 1));
      enBuffer--;
    }
    buffer[enBuffer++] = l[i];
  }
}

// ---------------- Red y hora ----------------
void conectarWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 20 && WiFi.status() != WL_CONNECTED; i++) delay(500);
  if (WiFi.status() == WL_CONNECTED) reconexiones++;
}

bool horaValida() { return time(nullptr) > 1700000000; }   // NTP ya respondió

// Devuelve el código HTTP (o un negativo si falló la red)
int peticion(const char* metodo, const String& url, const String& cuerpo, String& respuesta) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  HTTPClient http;
  http.setTimeout(TIMEOUT_HTTP_MS);
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  int codigo = strcmp(metodo, "POST") == 0 ? http.POST(cuerpo) : http.GET();
  if (codigo > 0) respuesta = http.getString();
  http.end();
  return codigo;
}

// ---------------- Envío de lecturas ----------------
// true = la API respondió (2xx o 4xx): no hay que reintentar ni guardar
bool enviarLote(const Lectura* l, int n, const char* origen) {
  for (int intento = 1; intento <= 3; intento++) {
    JsonDocument doc;
    doc["dispositivo"] = DISPOSITIVO;
    doc["origen"] = origen;
    doc["intento"] = intento;
    doc["enviado_en"] = (long) time(nullptr);
    JsonArray arr = doc["lecturas"].to<JsonArray>();
    for (int i = 0; i < n; i++) {
      JsonObject o = arr.add<JsonObject>();
      o["sensor"] = l[i].sensor;
      if (isnan(l[i].valor)) o["valor"] = nullptr; else o["valor"] = l[i].valor;
      o["medido_en"] = (long) l[i].medidoEn;
    }
    String cuerpo, respuesta;
    serializeJson(doc, cuerpo);

    int codigo = peticion("POST", String(API) + "/lecturas", cuerpo, respuesta);
    if (codigo >= 200 && codigo < 500) {
      Serial.printf("Lote %s: HTTP %d %s\n", origen, codigo, respuesta.c_str());
      return true;
    }
    Serial.printf("Intento %d falló (%d)\n", intento, codigo);
    delay(1000 * intento);
  }
  enviosFallidos++;
  return false;
}

void vaciarBuffer() {
  while (enBuffer > 0) {
    int n = min(enBuffer, MAX_POR_LOTE);
    if (!enviarLote(buffer, n, "BUFFER")) return;           // sigue sin red
    memmove(buffer, buffer + n, sizeof(Lectura) * (enBuffer - n));
    enBuffer -= n;
  }
}

void medirYEnviar() {
  ds18b20.requestTemperatures();
  time_t ahora = time(nullptr);
  Lectura l[3] = {
    {"temperatura_aire", dht.readTemperature(),        ahora},
    {"humedad_aire",     dht.readHumidity(),           ahora},
    {"temperatura_agua", ds18b20.getTempCByIndex(0),   ahora},
  };
  if (!horaValida()) {             // sin hora no se puede registrar la medición
    Serial.println("Sin NTP: lectura descartada");
    return;
  }
  conectarWifi();
  vaciarBuffer();
  if (!enviarLote(l, 3, "TIEMPO_REAL")) guardarEnBuffer(l, 3);
}

void enviarLatido() {
  JsonDocument doc;
  doc["ntp_sincronizado"] = horaValida();
  doc["rssi_dbm"] = WiFi.RSSI();
  doc["ip"] = WiFi.localIP().toString();
  doc["uptime_s"] = millis() / 1000;
  doc["heap_libre_bytes"] = ESP.getFreeHeap();
  doc["lecturas_en_buffer"] = enBuffer;
  doc["reconexiones_wifi"] = reconexiones;
  doc["envios_fallidos"] = enviosFallidos;
  doc["version_firmware"] = FIRMWARE;
  String cuerpo, respuesta;
  serializeJson(doc, cuerpo);
  peticion("POST", String(API) + "/dispositivos/" + DISPOSITIVO + "/estados-conexion", cuerpo, respuesta);
}

// ---------------- Menú ----------------
String titulos[8], endpoints[8];               // índice = tecla 1..7
JsonDocument paginasDoc;
int paginaActual = 0, totalPaginas = 0;
char opcionElegida = 0;

void cargarMenu() {
  String respuesta;
  if (peticion("GET", String(API) + "/opciones-menu?activa=true", "", respuesta) != 200) return;
  JsonDocument doc;
  deserializeJson(doc, respuesta);
  for (JsonObject o : doc["data"].as<JsonArray>()) {
    int t = String((const char*) o["tecla"]).toInt();
    if (t >= 1 && t <= 7) {
      titulos[t] = (const char*) o["titulo"];
      endpoints[t] = (const char*) o["endpoint"];   // ej. /api/v1/analitica/promedio-hora
    }
  }
}

void mostrar(const char* l1, const char* l2) {
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print(l1);
  lcd.setCursor(0, 1); lcd.print(l2);
}

void mostrarPagina() {
  JsonArray pagina = paginasDoc["lcd"]["paginas"][paginaActual];
  mostrar(pagina[0] | "", pagina[1] | "");
}

void consultarOpcion(int t) {
  mostrar(titulos[t].c_str(), "Consultando...");
  // endpoints[t] ya trae /api/v1: se arma la URL con el host de API
  String base = String(API);
  base.replace("/api/v1", "");
  String url = base + endpoints[t] + "?dispositivo=" + DISPOSITIVO + "&lcd=16x2&solo_lcd=true";
  String respuesta;
  int codigo = peticion("GET", url, "", respuesta);
  if (codigo != 200 || deserializeJson(paginasDoc, respuesta)) {
    mostrar("Sin conexion", "* volver");
    totalPaginas = 0;
    return;
  }
  paginaActual = 0;
  totalPaginas = paginasDoc["lcd"]["paginas"].size();
  mostrarPagina();
}

void atenderTeclado() {
  char k = teclado.getKey();
  if (!k) return;
  if (k >= '1' && k <= '7') {                  // elegir opción
    opcionElegida = k;
    mostrar(titulos[k - '0'].c_str(), "# confirmar");
  } else if (k == '#') {
    if (opcionElegida && totalPaginas == 0) consultarOpcion(opcionElegida - '0');
    else if (totalPaginas > 0) { paginaActual = (paginaActual + 1) % totalPaginas; mostrarPagina(); }
  } else if (k == '*') {                       // volver al menú
    opcionElegida = 0; totalPaginas = 0;
    mostrar("Menu: tecla 1-7", "# conf  * volver");
  }
}

// ---------------- Arduino ----------------
uint32_t ultimaLectura = 0, ultimoLatido = 0;

void setup() {
  Serial.begin(115200);
  dht.begin();
  ds18b20.begin();
  lcd.init(); lcd.backlight();
  mostrar("Conectando...", "");
  conectarWifi();
  configTime(0, 0, "pool.ntp.org", "time.google.com");   // epoch en UTC
  cargarMenu();
  mostrar("Menu: tecla 1-7", "# conf  * volver");
}

void loop() {
  atenderTeclado();
  if (millis() - ultimaLectura >= INTERVALO_LECTURA_MS) { ultimaLectura = millis(); medirYEnviar(); }
  if (millis() - ultimoLatido  >= INTERVALO_LATIDO_MS)  { ultimoLatido  = millis(); enviarLatido(); }
}
```

### Probar sin hardware

`npm run simular` reproduce este mismo flujo contra la API con el dispositivo
`esp32_sim`: lecturas, latidos, cortes con buffer, reintentos y anomalías.
Ver el README.
