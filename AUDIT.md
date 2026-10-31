# Auditoría incremental de icetime

Los cambios se realizan en `main`. No se modifican icetimetrack, inlinetimetrack ni sus referencias de submódulos.

## Consultas y compatibilidad

- `/api/v1/registries/search` mantiene `{ items, page, limit, total }`, selección de campos, virtuales y orden `date DESC, _id DESC`. Sin filtros de relaciones usa `skip/limit` y `countDocuments`; con género o filtros de competición aplica `$lookup` y `$facet` antes de hidratar exclusivamente los documentos de la página. El total cuenta todos los resultados del filtro, incluso en páginas vacías. Los filtros de país siguen usando la nacionalidad histórica del registro.
- Las relaciones sin documento siguen apareciendo como `null` cuando no hay filtro sobre esa relación. Con filtro se excluyen antes de paginar. Como antes, modificaciones concurrentes entre lectura y recuento/hidratación pueden alterar una respuesta; no se introduce una transacción de lectura.
- Récords recorre un cursor con lotes de 100, manteniendo hasta `top` documentos por grupo (máximo 500). Conserva grupos por país/pista/temporada, carrera y género, suma de parciales, mejor marca por identidad, primer documento ante marcas iguales y posiciones consecutivas. Conserva el orden de primera aparición del patinador para desempatar mejores marcas. Guarda identificadores/orden por patinador para preservar esa semántica; no guarda todos sus documentos. `top: '*'` conserva el límite anterior de 500 por grupo.
- Las consultas externas tienen un máximo de ejecución de 30 segundos en MongoDB. El índice nuevo `{ date: -1, _id: -1 }` ayuda a paginar sin filtros de relaciones. Revisar su creación con el procedimiento habitual del despliegue si se desactiva `autoIndex`. La agregación requiere MongoDB 3.6 o posterior.

## Cambios de contrato de la API externa

- Datos incorrectos responden **400** con `{ message }`: enteros positivos completos para `page`, `limit`, `top`; booleanos `true/false` o sus cadenas; ObjectId hexadecimal de 24 caracteres; filtros escalares y listas de categoría/país válidas. Se rechazan objetos, listas inesperadas, listas vacías o de más de 100 elementos y cadenas vacías o de más de 256 caracteres. Los filtros desconocidos escalares siguen ignorándose. `groupBy` acepta `none`, `country`, `track` y `season`.
- Los valores omitidos conservan `page=1`, `limit=100`, `top=1`, `bestForSkater=false`. `limit` y `top` positivos superiores a 500 siguen recortándose a 500. Se rechazan desbordamientos del desplazamiento de página. Las fechas aceptan `YYYY-MM-DD` o fecha/hora ISO con segundos y zona explícita; se rechazan días inexistentes y rangos invertidos. `dateTo` sigue siendo un límite inclusivo al instante indicado (una fecha sin hora representa medianoche UTC).
- `active` incorrecto ya no equivale silenciosamente a `false`; `top` negativo/cero y paginación parcial como `2abc` ya no se aceptan ni usan valores por defecto.
- Autenticación conserva `EXTERNAL_API_KEY` y `timingSafeEqual` sobre hashes SHA-256 de longitud fija. Bearer acepta mayúsculas/minúsculas en el esquema y exige un único token sin espacios. Las claves configuradas se recortan; deben carecer de espacios en sus extremos. `EXTERNAL_API_PREVIOUS_KEYS` permite claves anteriores separadas por comas durante una rotación; retirarlas al finalizar la transición. Sin clave principal responde 503 y una credencial incorrecta responde 401.
- Límite nuevo por IP: 120 peticiones/minuto por proceso, incluidas credenciales incorrectas. `EXTERNAL_API_RATE_LIMIT` permite otro entero positivo. Al excederlo responde **429** con `Retry-After`. El almacenamiento tiene un máximo de 10000 IP y caduca entradas. En varios procesos/servidores el límite no es compartido; para un límite distribuido debe aplicarse también en el proxy. `req.ip` depende de la configuración `trust proxy` del consumidor: confiar únicamente en proxies conocidos. La protección de tamaño del cuerpo debe configurarse en el parser/proxy del consumidor, que se ejecuta antes del router de este paquete.
- Los recursos inexistentes con extensión responden **404** tras las rutas, sin comprobaciones síncronas del sistema de archivos ni excepciones que produzcan 500. Las rutas válidas con puntos conservan su funcionamiento.

## Pruebas y revisión asíncrona

`npm test` ejecuta las pruebas de registros, importaciones, libros Excel, récords y API externa. Las dependencias nuevas son de desarrollo: Express para integración HTTP, Mongoose/Moment para modelos reales y mongodb-memory-server para una base temporal. No cambian las dependencias de producción aportadas por los consumidores.

Para ejecutar también MongoDB real en una instancia temporal, en PowerShell:

```powershell
$env:TIMETRACK_TEST_MEMORY_MONGO = '1'
npm test
```

La primera ejecución descarga el binario de MongoDB. Alternativamente, establecer `TIMETRACK_TEST_MONGODB_URI` a un servidor de pruebas. La prueba crea una base con nombre aleatorio `timetrack_audit_test_*` y elimina únicamente esa base al finalizar; nunca usa la base configurada por el consumidor. Sin estas variables, esa prueba se omite explícitamente.

Se prueban peticiones HTTP reales, agregación con filtros relacionados y página vacía, recuento, cursor, errores 400, rotación y límites, y se compara el ranking optimizado con el algoritmo previo usando marcas repetidas y empatadas. Las pruebas existentes de importación ejercitan permisos, revisión por usuario, duplicados, decisiones invalidadas y confirmación antes de escrituras.

Se elimina la variable global implícita `app` y las temporales globales del ranking compartido. Se conservan las globales explícitas `__corePath`, `__modulesPath`, `__modelsPath` y `__initialization`, requeridas por la integración con core. Las lecturas/borrados/búsquedas de registros ahora esperan sus promesas y envían rechazos a `next`; la deserialización de sesión captura sus rechazos y la consulta individual vacía envía una sola respuesta.

## Resultado de validación

31 de octubre de 2026: **183 pruebas correctas, 0 fallos y 0 omisiones**, incluyendo HTTP con Express 4, modelos con Mongoose 8 e instancia temporal de MongoDB 7.0.24. Se ejecutó la suite completa con `TIMETRACK_TEST_MEMORY_MONGO=1`; la base temporal fue eliminada al finalizar. Las comprobaciones de sintaxis y `git diff --check` también finalizaron sin errores. No se han ejecutado los servidores completos de icetimetrack e inlinetimetrack; la compatibilidad se ha revisado en el contrato del módulo y en las pruebas de temporadas de hielo y de inline.
