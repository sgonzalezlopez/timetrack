# API externa de TimeTrack

## Actualizacion del Excel de Mejores registros (interfaz autenticada)

La actualizacion de Excel solo esta disponible para administradores: el boton,
el modal y su script no se incluyen para otros roles, y la API verifica el rol admin.
El boton `Actualizar Excel` utiliza los filtros actuales de Mejores registros,
incluidos Top, Mejor por patinador y Agrupar por. Reutiliza la misma consulta del
servidor y sus restricciones de acceso; no acepta filas de resultados del cliente.

`POST /api/registry/records/excel` requiere rol admin y lectura de registros y recibe multipart:
`file` (libro `.xlsx`, maximo 25 MB) y `filters` (JSON del formulario).
Devuelve el libro actualizado con `X-Records-Count` y `X-Records-Groups`.
Reconoce la hoja `Clas. historica` con o sin tildes/puntuacion, detecta las columnas
por sus cabeceras y reemplaza toda su clasificacion, incluso con cero resultados.
Conserva las otras hojas, formulas, anchos y estilos de las filas modelo. Reconstruye
las secciones por prueba y sexo y, si procede, por la agrupacion seleccionada.
Los tiempos totales siguen en milisegundos y los parciales se escriben formateados.
Las filas de marcas de la temporada vigente al actualizar se escriben enteras en
negrita; las de otras temporadas se escriben sin negrita, conservando el resto de
la fuente de la plantilla. Se compara la fecha de la marca, no la temporada del
evento ni el filtro seleccionado. Se reutiliza `registryImportSeasonStartMonth`:
julio-junio para hielo (7) y ano natural para ruedas (1).
Actualiza la celda junto a `Fecha de actualizacion` en `Indice` y la fecha enlazada
en la clasificacion; fuerza recalculo de formulas al abrir el libro.
Una estructura no reconocida o celdas combinadas en la zona de datos producen un
error explicito, sin sobrescribir el archivo.

Para actualizar el original en el equipo del usuario se necesita Chrome o Edge,
HTTPS (o localhost) y permiso de acceso a la carpeta mediante File System Access API.
El usuario selecciona carpeta y archivo y confirma el reemplazo. El navegador
guarda primero una copia exacta del original con nombre `.backup-<fecha>-<uuid>.xlsx`
en la misma carpeta; solo despues escribe el actualizado. Si falla el respaldo,
no escribe el original. Si el fichero cambia durante el calculo, cancela el guardado.
La subida y el respaldo usan los mismos bytes copiados a memoria antes del calculo,
sin reutilizar un objeto File que pueda quedar invalidado por cambios en disco.
Antes de comprobar y escribir el destino se obtiene de nuevo su acceso desde la
carpeta, tambien despues de crear el respaldo. Los errores de estado del archivo
se notifican sin anunciar exito y, si el respaldo ya se completo, incluyen su nombre.
El servidor no recibe rutas locales ni escribe archivos arbitrarios en disco.
Cerrar el libro en Excel antes de actualizarlo para evitar bloqueos.
Los tres actualizadores conservan la presencia de cabeceras y filtros de las tablas
del libro, incluidos los valores predeterminados de Excel cuando los atributos
no aparecen en el XML. No se generan filtros automaticos sin un rango valido.
El boton principal se denomina `Actualizar ranking historico` (rosa, rojo al pulsar); categorias
es verde y Allround malva. El boton de confirmar del modal usa el mismo color.
El ranking historico conserva los filtros actuales y admite parciales incompletos
con total valido. Si falla la fecha, prueba, patinador, sexo, evento o total,
el error incluye todos los registros afectados y sus motivos concretos; no guarda
un Excel parcial ni omite registros silenciosamente.
La carpeta y el archivo seleccionados se mantienen al abrir cualquiera de los tres
actualizadores durante la misma visita a Mejores registros. Solo se solicita otra
carpeta al pulsar el selector; cancelar ese selector conserva la seleccion anterior.
El ranking historico admite M, F y X (mixto), conservando bloques independientes
por prueba y sexo, incluido el relevo mixto. Allround mantiene sus bloques M/F.
En hielo (temporada configurada desde julio), los bloques de 100 m se colocan al
principio, M/F/X, manteniendo el orden de los demas bloques. La fecha enlazada
de actualizacion permanece en la primera fila de bloques, junto al primero de 100 m.
Al actualizar se respeta el orden y el nombre de los bloques prueba/sexo existentes
en el libro; los bloques nuevos se anaden al final de cada agrupacion de filtros.
Se conserva el formato de tiempo por bloque: milisegundos con separador de miles
en distancias cortas y texto minutos:segundos.milisegundos donde lo usa la plantilla.
Todo tiempo total de 60000 ms o mas se escribe con minutos, tambien en 500 m
(por ejemplo, 65210 ms se muestra como `1:05.210`).
Los estilos de tabla personalizados y sus formatos diferenciales se conservan
al serializar, incluidas las franjas azules alternas. La tabla historica se amplia
o reduce al numero de filas escritas para no dejar marcas nuevas fuera del estilo.

### Actualizacion por categorias

El segundo boton de Mejores registros, `Actualizacion por categorias`, tambien es
exclusivo de administradores. Comparte el selector de carpeta/archivo y el guardado
con respaldo exacto previo junto al original.

`POST /api/registry/records/excel/categories` recibe solo `file` y requiere admin
y lectura de registros. Ignora los filtros de pantalla y cualquier `filters` enviado.
Consulta todos los resultados historicos de deportistas con pais ES o ESP y excluye
entrenamientos. Usa la categoria guardada en cada marca, no la categoria actual.
Actualiza solo `Por Categorias` y la fecha de `Indice`, manteniendo las otras hojas.

Detecta los siete bloques por sus titulos y las columnas de cada uno, conserva
su disposicion en paralelo y desplaza las bandas inferiores cuando necesita espacio:
Cada banda se coloca tres filas vacias despues de la tabla mas alta de la banda
anterior. Los huecos antiguos se compactan y el espacio crece si aumentan las
pruebas o los empates, sin superponer las tablas.
Los valores de categoria como ABSOLUTA o JUNIOR dentro de los resultados no se
interpretan como cabeceras; el titulo debe ir seguido de Distancia/Sexo.

- Absoluta: todas las categorias.
- Junior: A+B+C; no incluye Youth.
- Junior A/B/C: exclusivamente A1/A2, B1/B2 o C1/C2, con prefijo L/M.
- Y+: todos los codigos LY/MY, incluyendo variantes A, B, C, numericas o +.
- Master: codigos L/M seguidos de edad numerica (por ejemplo L30/M30).

En cada prueba y sexo se busca el menor total de parciales.
Las celdas sin marcas elegibles quedan vacias; no se conservan marcas antiguas
que no cumplan la regla. Se incluyen los empates entre deportistas distintos, ordenados por fecha.
Si un deportista repite la mejor marca, se muestra solo su primera fecha; se
identifica por ID, o por nombre normalizado cuando el resultado no dispone de ID.
Las tablas de cada bloque se desplazan y redimensionan junto con sus cabeceras
al anadir distancias o empates. Se mantienen los formatos de fecha y separador de miles
de la plantilla; los tiempos de un minuto o mas se muestran con minutos.
Solo se incluyen las distancias 100, 300, 500, 1000, 1500, 3000, 5000 y 10000 m.
Las demas se excluyen aunque estuvieran en la plantilla. Se anaden las pruebas
masculinas y femeninas que falten en cada bloque cuando existan marcas elegibles.
La categoria usada es la del registro,
no la actual del perfil; por ejemplo, una marca MB1 de 5000 m se incluye en Junior B
aunque esa distancia no estuviera en la plantilla. Las marcas de la
temporada vigente se resaltan en negrita usando la configuracion hielo/ruedas.
Un bloque o cabecera no reconocidos produce un error antes de generar el archivo.
Solo se validan las marcas candidatas de los bloques distancia/sexo/categoria
presentes o anadidos. Un relevo mixto ausente de la plantilla no bloquea la
actualizacion. No se anaden distancias nulas, no numericas o no positivas.
Si existe un bloque X, admite marcas
mixtas. Las marcas candidatas con fecha o total invalidos producen un informe
detallado sin duplicados entre bloques y cancelan el guardado completo.

### Clasificaciones Allround manuales al final del ranking

En `Clas. historica`, desde el encabezado `AR - Sprint, M` (ignorando puntuacion,
mayusculas y espacios) hasta el ultimo dato, el contenido es una zona protegida.
El actualizador historico conserva sus puntuaciones, textos, formatos numericos
y formulas; no la regenera a partir de registros ni incorpora resultados AR de
la aplicacion a esa zona. Se amplia la tabla del ranking hasta incluirla para
aplicar las mismas bandas azul/celeste del estilo original.

Si los resultados caben, la zona mantiene sus filas originales. Si crecen hasta
alcanzarla, se desplaza al final y se ajustan las referencias de formulas a esas
filas, incluidas referencias absolutas y desde otras hojas. Se conservan las
referencias a filas anteriores y a otras hojas. Se solicita recalculo al abrir.
Esta proteccion es compartida por hielo y ruedas.

## Acceso al evento desde un registro

El formulario de registro incluye `Editar evento`, en naranja, entre `Nuevo` e
`Introducir tiempos`. Abre el evento asociado al registro guardado. Permanece
desactivado para registros nuevos o sin evento; se habilita tras guardar y vuelve
a desactivarse con `Guardar y nuevo`. Un cambio de evento aun sin guardar no
modifica el destino del boton.

## Nacionalidad historica de las marcas

`Registry.country` guarda la nacionalidad del deportista al realizar esa marca,
separada de `Skater.country` (nacionalidad actual). Se almacena en ISO alpha2;
se aceptan codigos ISO alpha3 al escribir o filtrar y se normalizan.
Las consultas tambien admiten codigos alpha3 ya almacenados.

- Al crear una marca sin indicar `country`, se copia una vez la nacionalidad de
  la ficha. Puede indicarse otra nacionalidad o `null` para desconocida.
- Al editar marcas existentes no se vuelve a copiar la ficha. Cambiar posteriormente
  la nacionalidad del patinador no cambia ninguna marca anterior.
- Las marcas antiguas sin este dato son desconocidas: no hay relleno automatico
  ni inferencia a partir de la nacionalidad actual. Se corrigen desde el formulario
  del registro. Sin filtro por pais se siguen mostrando; con filtro quedan fuera.
- La importacion usa primero el pais del fichero, despues el de la ficha del
  patinador seleccionado y, si faltan ambos, desconocida. La revision permite
  corregirlo por registro, incluso seleccionar desconocida, sin cambiar la ficha.
  `choices[].country` transmite esa correccion; si se omite se aplica la prioridad
  anterior. Los codigos no validos producen un error explicito.
- Busqueda de registros, Mejores registros, agrupacion por pais, estadisticas,
  exportaciones de tablas y API externa usan o incluyen `Registry.country`.
  Las respuestas de mejores registros mantienen el codigo en `country` y anaden
  `countryName` para su nombre localizado; nunca sustituyen el codigo por el pais
  actual del patinador. El pais anidado en `skater.country` sigue siendo el actual.
- Los tres actualizadores Excel usan la nacionalidad de cada marca. Categorias
  y Allround historicos espanoles solo consideran marcas ES/ESP; un mismo patinador
  puede tener marcas elegibles y no elegibles en distintas fechas o distancias.
  Si un filtro por pais no encuentra ninguna marca, no se genera un Excel vacio:
  se informa del problema y se conserva el original.
  Por Categorias tambien cancela antes de borrar celdas si ninguna marca recibida
  cumple los requisitos de nacionalidad, evento, distancia y sexo de sus bloques
  (`RECORDS_CATEGORIES_EMPTY`), aunque la consulta haya devuelto resultados.

El cambio pertenece al modulo maestro timetrack, compartido por hielo y ruedas;
no necesita modificar core ni las copias de submodulos de los consumidores.

## Importacion de resultados (interfaz autenticada)

### Actualizar Allround historico

El boton `Actualizar Allround` es exclusivo de administradores y utiliza el mismo
modal de carpeta/archivo y respaldo exacto previo junto al original.
`POST /api/registry/records/excel/allround` recibe `file`, exige admin y lectura de
registros e ignora los filtros de pantalla. Consulta marcas historicas espanolas,
sin entrenamientos, y obtiene la mejor suma de parciales de cada patinador (por ID)
en 500, 1000, 1500 y 3000 m.
Acepta tanto ES (codigo utilizado por el selector de pais del patinador) como ESP.
Si no encuentra ninguna marca elegible, devuelve `RECORDS_ALLROUND_EMPTY` y no genera
un archivo de reemplazo: la clasificacion existente no se vacia.
Si hay marcas elegibles con patinador sin identificador, nombre o sexo M/F,
o sin un tiempo total final finito mayor que cero, cancela la actualizacion
completa. No omite estas marcas ni modifica datos de la base de datos.
El error `RECORDS_EXCEL_DATA` incluye `issues` con todos los registros afectados
(ID, patinador, sexo, fecha, distancia, evento, parciales en milisegundos y motivos).
El modal muestra el informe completo como texto, con desplazamiento si es largo.
Los tres actualizadores utilizan `totalTime` para seleccionar, ordenar y escribir
las marcas; no interpretan el ultimo parcial como total. Si no se proporciona
`totalTime`, se utiliza el total calculado por el modelo (suma de parciales,
permitiendo ceros, nulos y huecos). Un total explicito invalido no se sustituye.
Los parciales incompletos no bloquean una marca con total valido. En `Clas. historica`
se deja vacia toda la celda de parciales si alguno falta o no es positivo/finito;
Allround y Por Categorias solo escriben el tiempo total. No se inventan parciales.

Actualiza `Allround Historico`, con hombres arriba y mujeres debajo. Primero coloca
quienes tienen las cuatro distancias, ordenados por la suma en segundos:
500 + 1000/2 + 1500/3 + 3000/6. Para coincidir con las formulas de la plantilla,
las marcas se representan con centesimas y se calcula la puntuacion con esa precision.
Los incompletos van despues, agrupados por primera distancia disponible en ese orden
y ordenados por su tiempo en ella. Los empates se desempatan por nombre e ID.

`Total AR` conserva formulas de Excel (incluidas las compartidas, que se expanden a
formulas individuales), nunca recibe puntuaciones numericas calculadas por el servidor.
Si hacen falta filas, el bloque femenino se desplaza hacia abajo y se extienden las
formulas ajustando referencias relativas. Se eliminan los resultados en cache para
evitar mostrar puntuaciones antiguas y se solicita recalculo al abrir el libro.
Se conservan las otras hojas y las celdas informativas a la derecha de la tabla.
Se actualizan la fecha de `Indice` y su enlace en Allround.

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
- `GET /api/competition/import-options`: clubes existentes accesibles para el filtro opcional.
- `POST /api/competition/:id/import/preview`: multipart (`file`, `format`, `createSkaters`,
  `categorySource` (`file` por defecto o `database`), `clubId` opcional).
- `POST /api/competition/:id/import/commit`: JSON (`token`, `choices`), una seleccion por fila:
  `action` (`skip`, `import`, `replace`), `skaterId` (candidato o `new`), `category`
  y `updateSkaterCategory` (booleano cuando la categoria difiere de la ficha).

Se requiere lectura del evento y creacion de registros; crear patinadores o clubes
requiere el permiso de creacion correspondiente. Sobrescribir requiere actualizar registros.
Los nombres se normalizan sin tildes, puntuacion ni orden de palabras, y se compara el sexo.
Las coincidencias aproximadas y multiples requieren seleccion manual.
El selector general decide si la categoria del registro procede del fichero o de
la ficha del patinador existente. Las categorias ausentes, desconocidas o ambiguas
se eligen manualmente por fila entre las existentes. Para patinadores nuevos se usa
la categoria del fichero o la seleccion manual, tambien en modo `database`.
Si la categoria resuelta difiere de la ficha, se exige responder expresamente si se
actualizan tambien las fichas mediante una unica decision general para toda la
importacion; no se pregunta por cada fila ni hay respuesta preseleccionada.
La interfaz envia esa misma decision en `updateSkaterCategory` de todas las filas.
Elegir no solo cambia
el registro. Elegir si requiere permiso U de patinador, comprobado antes de escribir.
No se admiten distintas categorias para actualizar la ficha del mismo patinador
en una importacion. Si la categoria heredada de la ficha cambia tras la revision,
se solicita una nueva revision. El informe incluye `updatedSkaters`, con las fichas
actualizadas, incluso si despues falla el guardado de su registro.
El club del registro se resuelve tambien para cada candidato antes de confirmar:
- Si el nombre del fichero es muy similar al club de la ficha, se reutiliza este.
  La comparacion ignora tildes, puntuacion, espacios y terminos genericos de club
  o patinaje; admite hasta un 10% de ediciones en nombres de al menos cinco letras.
  Tambien reconoce el nombre corto `shortName` configurado en el club.
- Si el fichero no identifica club (vacio, UNKNOWN, sin club), se usa el de la ficha.
- Si indica otro club distinto, se reutiliza una coincidencia exacta o una unica
  coincidencia muy similar entre clubes accesibles. Si no existe, se crea con el
  nombre del fichero y permiso C de club, sin modificar el club de la ficha existente.
- Si hay varias coincidencias posibles, no se elige arbitrariamente: se usa el de
  la ficha o UNKNOWN si no tiene. Sin club identificable en ninguna fuente, UNKNOWN.
Los nuevos patinadores siguen la misma resolucion sin comparar con una ficha previa.
La revision muestra el club resultante, su origen y si se creara. Cambiar el
patinador seleccionado actualiza esta informacion. Si cambia la resolucion antes
de confirmar, se exige revisar otra vez. El informe incluye `createdClubs`,
tambien si despues falla un registro, y cada importado indica `clubName` y `clubSource`.
El filtro opcional por `clubId` usa exclusivamente `currentclub` de la ficha,
no el club del fichero. El selector de clubes esta ordenado alfabeticamente y
permite escribir para buscar con Select2, tambien dentro del modal.
Solo ofrece candidatos pertenecientes al club seleccionado
y comprueba de nuevo la pertenencia al confirmar. Las filas sin un patinador
identificado de ese club, incluidos los nuevos, se omiten con motivo explicito.
El filtro no fuerza el club del registro: se aplican las reglas anteriores.
Estas opciones se fijan al leer: cambiarlas en el formulario exige otra revision.
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
- `GET /api/registry/import-options`: mismos clubes y filtro que en Eventos.
- `POST /api/registry/import/preview`: mismos campos y opciones de categoria y club que en Eventos.
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
continuacion), sin listas de salida ni clasificaciones posteriores. Si la siguiente
tabla repite categoria y prueba pero reinicia la numeracion de puestos, es otra
clasificacion y no se incorpora a PRUEBA_RFEP. GENERAL_RFEP toma
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