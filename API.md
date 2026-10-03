# API externa de TimeTrack

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