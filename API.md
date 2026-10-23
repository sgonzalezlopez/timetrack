# API externa de TimeTrack

## Importacion de resultados (interfaz autenticada)

Cada aplicacion registra adaptadores mediante `application.run({ registryImportFormats: [...] })`.
Cada adaptador proporciona `id`, `label`, `extensions` y `async parse(buffer)`, que devuelve filas:
`skaterName`, `gender` (F/M), `country`, `date`, `competitionName`, `trackName`, `trackLocation`, `race`, `distance`,
`rail`, `starting`, `category`, `clubName`, `times` (parciales en milisegundos),
`totalTime` opcional, `status` opcional, `team`, `source` y `externalReference`.
Un adaptador puede incluir `requiredInputs: ['date', 'distance']` (o uno de ellos) cuando
el documento no publica el dia exacto o la distancia. Debe dejar esos campos como `null`.
La revision pide cada valor en cada fila de forma independiente, sin valores heredados.
El cliente envia `date` (YYYY-MM-DD) y `distance` (metros) en la seleccion correspondiente.
El servidor vuelve a validarlos antes de escribir y no permite alterar campos ya publicados.
`dateText` puede mostrar la fecha original como ayuda; `sourceLocation` identifica pagina y dorsal
en la revision y en el informe. Las filas sin tiempo se omiten con el motivo correspondiente.
Si un formato solo proporciona tiempo total, el adaptador lo devuelve como `times: [totalTime]`;
el modelo calcula el total sumando los parciales.
No se utilizan IDs de patinador externos ni puestos. Los formatos especificos pertenecen
a la aplicacion consumidora, no a sus copias de los submodulos.

El boton Importar del evento permite revisar el fichero antes de guardar:

- `GET /api/competition/import-formats`: formatos disponibles.
- `POST /api/competition/:id/import/preview`: multipart (`file`, `format`, `createSkaters`).
- `POST /api/competition/:id/import/commit`: JSON (`token`, `choices`), una seleccion por fila:
  `action` (`skip`, `import`, `replace`), `skaterId` (candidato o `new`) y `category`.

Se requiere lectura del evento y creacion de registros; crear patinadores o el club UNKNOWN
requiere el permiso de creacion correspondiente. Sobrescribir requiere actualizar registros.
Los nombres se normalizan sin tildes, puntuacion ni orden de palabras, y se compara el sexo.
Las coincidencias aproximadas y multiples requieren seleccion manual.
Las categorias desconocidas se eligen entre las existentes; clubes desconocidos usan UNKNOWN.
Las filas de equipos o estados distintos de OK quedan omitidas. Un estado ausente es valido.
Los duplicados con fuente y referencia requieren seleccion expresa para sobrescribir;
los de otro evento no se sobrescriben.

Antes de escribir se comprueban tambien posibles repetidos por patinador, dia UTC,
prueba normalizada, distancia, evento y tiempo total (suma exacta de parciales),
incluso sin fuente/referencia y entre filas del mismo fichero.
Si hay coincidencias, commit responde 409 con `code: IMPORT_DUPLICATE_REVIEW` y `conflicts`.
La interfaz compara nuevo/existente (fecha, prueba, distancia, total, parciales,
categoria, carril, salida, fuente y referencia) y pide una decision sin opcion preseleccionada.
Se vuelve a confirmar con `duplicateReviewToken`, `duplicateAction` (`skip`, `replace`, `keep`)
y `duplicateId` para sobrescribir. No se escribe ninguna fila hasta resolver todos los conflictos.
Sobrescribir exige permiso U y un registro accesible del mismo evento. Guardar ambos
solo se ofrece si no comparten fuente/referencia; para filas anteriores del fichero
se puede omitir o guardar ambas, no sobrescribir una fila aun no guardada.
No se muestran detalles de registros sin acceso. Las decisiones estan ligadas al
contenido revisado; si cambia, se pide revisar otra vez. Si aparece un duplicado
durante el guardado, esa fila falla explicitamente y debe releerse.

La revision caduca a los 30 minutos (o al reiniciar el servidor) y se guarda en memoria:
preview y commit deben llegar al mismo proceso si hay varios servidores.
Limites: 10 MB, 5000 resultados y 50 revisiones pendientes por proceso.
El informe separa importados, omitidos, errores y patinadores creados. El guardado es por fila:
un fallo no revierte filas anteriores, y los patinadores creados se incluyen aunque su resultado falle.
Los nuevos patinadores usan la primera palabra como nombre y el resto como apellidos
(`-` si no hay apellidos); no se inventa fecha de nacimiento. Revisar estos datos manualmente.

### Importar desde Registros

El boton malva Importar, a la derecha de Nuevo, reutiliza la revision y las reglas de
patinadores, categorias y duplicados. No usa el evento de un formulario ni IDs externos:

- `GET /api/registry/import-formats`: formatos registrados en la aplicacion.
- `POST /api/registry/import/preview`: multipart (`file`, `format`, `createSkaters`).
- `POST /api/registry/import/commit`: JSON (`token`, `choices`); las selecciones pueden
  incluir `trackId` cuando la pista falta o su nombre coincide con varias pistas.

Se busca un evento no de entrenamiento por nombre de competicion del fichero, pista y
temporada. Si hay varios, se informa del conflicto sin elegir uno arbitrariamente.
Si no existe, se crea con el nombre completo de la competicion del fichero, `training: false`, temporada inferida
y fecha del primer registro seleccionado que provoque su creacion (no la fecha minima).
Se conserva internamente el nombre normalizado de la competicion original para que
futuros ficheros reutilicen el evento, incluso los creados anteriormente con el nombre de la pista.
Las pistas se buscan primero por nombre normalizado, alias de importacion o nombre
mas localidad. Sin coincidencia exacta, se admite que uno de los nombres sea el
prefijo completo por palabras del otro (al menos dos palabras), por ejemplo
`Max Aicher Arena` y `Max Aicher Arena - Inzell`. Solo se asocia automaticamente
si hay una unica coincidencia; no se comparan fragmentos arbitrarios ni palabras sueltas.
Pistas sin coincidencias se crean; si falta el nombre o es ambiguo se elige una
pista existente en la revision. No se crean eventos ni pistas en preview o para filas omitidas.
El informe incluye tambien eventos y pistas creados, incluso si posteriormente falla un registro.
Se requieren lectura de eventos y pistas y, solo cuando se crean, sus permisos de creacion.
Los tokens de revision no se pueden intercambiar entre Registros y Eventos.

Cada consumidor configura `registryImportSeasonStartMonth` (1 por defecto):
`icetimetrack` usa 7 (julio-junio, 2024-02-02 -> 2023-2024);
`inlinetimetrack` usa 1 (enero-diciembre, 2024-02-02 -> 2024).
Los limites de temporada se calculan en UTC para no desplazar fechas al cambiar de zona horaria.
Excel Hielo lee `competition.name` y, para la pista, `competition.track.name`,
`track.name` o `trackName` (por ese orden); la ubicacion opcional se lee de
`competition.track.location` o `track.location`.
Los formatos actuales de ruedas sin pista pediran seleccionarla, sin inventarla.

### Formatos de Inline TimeTrack

La aplicacion `inlinetimetrack` registra `PRUEBA_FMP` y `GENERAL_FMP` para PDF de texto
de la Federacion Madrilena de Patinaje. Los dos comparten el lector de tablas FMP
(cabeceras de competicion, categoria, fecha y prueba; columnas de nombre, club y tiempos).
Se recorren todas las paginas, con un limite de 100. PDF escaneados sin texto o estructuras
no reconocidas producen un error explicito; no se intenta OCR ni se inventan marcas.

El carril queda vacio. El tiempo total publicado se guarda como unico parcial.
No se utilizan puestos, puntos ni velocidad; errores de calculo en la columna de velocidad
no invalidan un tiempo publicado. DNF/DNS/DQ/DSQ se omiten; FS no es una descalificacion.
Una fecha de varios dias requiere elegir el dia en cada registro. Una prueba sin distancia
numerica requiere introducirla para cada patinador, sin heredar la respuesta anterior.
`source` es FMP y la referencia se deriva del evento, fecha publicada, categoria, prueba,
dorsal y nombre, compartida entre ambos formatos para detectar resultados repetidos.
El lector requiere Node.js 20 o superior (`pdfjs-dist`); los cambios de dependencias
y registro de formatos se hacen en la aplicacion consumidora, no en sus submodulos.

Tambien se registran `PRUEBA_RFEP` y `GENERAL_RFEP` para PDF de texto RFEP con cabeceras
bilingues. PRUEBA_RFEP toma solo la primera clasificacion (incluyendo sus paginas de
continuacion), sin listas de salida ni clasificaciones posteriores. GENERAL_RFEP toma
todas las clasificaciones excepto la ultima tabla. No se importan puntos ni puestos.
Se convierte `APELLIDOS, NOMBRE` a `NOMBRE APELLIDOS`; las fechas como `5-sep.-26`
se leen como 2026-09-05 y los tiempos `h:mm:ss,mil` se guardan como unico parcial.
El carril queda vacio. Resultados sin tiempo y descalificados se detallan como omitidos.
La fuente es RFEP y las referencias son estables entre los dos formatos para detectar
reimportaciones de la misma prueba, fecha, evento, categoria y patinador.

## Consulta externa

Las rutas de esta API son de solo lectura y se exponen desde cada aplicacion que incorpora el modulo:

- Ice TimeTrack: `https://<host-ice>/api/v1`
- Inline TimeTrack: `https://<host-inline>/api/v1`

Cada despliegue consulta su propia base de datos. Configure una clave distinta en la variable de entorno `EXTERNAL_API_KEY` de cada aplicacion. La clave debe enviarse solo desde el servidor consumidor:

```http
Authorization: Bearer <EXTERNAL_API_KEY>
Content-Type: application/json
```

Nunca incluya la clave en JavaScript enviado al navegador ni en parametros de URL.

## Rutas

| Ruta | Campos de filtro opcionales |
| --- | --- |
| `POST /registries/search` | `skater`, `club`, `category`, `competition`, `race`, `distance`, `rail`, `starting`, `trainingHeat`, `trainingPercentage`, `dateFrom`, `dateTo`, `training`, `track`, `season`, `gender`, `country`, `page`, `limit` |
| `POST /skaters/search` | `name`, `lastname`, `currentclub`, `currentcategory`, `gender`, `country`, `active`, `page`, `limit` |
| `POST /records/search` | Filtros de registros, mas `groupBy` (`country`, `track`, `season`), `top` y `bestForSkater` |

Los filtros que no se envien no se aplican. Las rutas de registros y patinadores responden con `{ items, page, limit, total }`. La ruta de mejores registros responde con un array ordenado por tiempo y con los campos calculados `totalTime` y `position`.

Ejemplo:

```http
POST /api/v1/records/search
Authorization: Bearer <EXTERNAL_API_KEY>
Content-Type: application/json

{
  "category": ["Senior"],
  "season": "2025-2026",
  "top": 3,
  "bestForSkater": true
}
```