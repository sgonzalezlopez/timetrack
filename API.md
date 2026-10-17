# API externa de TimeTrack

## Importacion de resultados (interfaz autenticada)

Cada aplicacion registra adaptadores mediante `application.run({ registryImportFormats: [...] })`.
Cada adaptador proporciona `id`, `label`, `extensions` y `async parse(buffer)`, que devuelve filas:
`skaterName`, `gender` (F/M), `country`, `date`, `competitionName`, `race`, `distance`,
`rail`, `starting`, `category`, `clubName`, `times` (parciales en milisegundos),
`totalTime` opcional, `status` opcional, `team`, `source` y `externalReference`.
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
los de otro evento no se sobrescriben. Sin referencia se advierte que no hay deduplicacion.

La revision caduca a los 30 minutos (o al reiniciar el servidor) y se guarda en memoria:
preview y commit deben llegar al mismo proceso si hay varios servidores.
Limites: 10 MB, 5000 resultados y 50 revisiones pendientes por proceso.
El informe separa importados, omitidos, errores y patinadores creados. El guardado es por fila:
un fallo no revierte filas anteriores, y los patinadores creados se incluyen aunque su resultado falle.
Los nuevos patinadores usan la primera palabra como nombre y el resto como apellidos
(`-` si no hay apellidos); no se inventa fecha de nacimiento. Revisar estos datos manualmente.

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