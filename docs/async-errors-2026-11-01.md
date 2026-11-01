# Errores as?ncronos de controladores ? 2026-11-01

## Evidencia previa

En main limpio, skater.getAll y otros handlers iniciaban consultas con .then()
sin await ni retorno de la promesa. El try/catch s?ncrono no capturaba los
rechazos. Algunas delegaciones a Registry tampoco pasaban next. Pistas ten?a
promesas de guardado separadas de la cadena principal. En entrenamientos,
getInputs y getRegistries esperaban consultas fuera de un try/catch.

La regresi?n database rejection: skater.getAll se ejecut? antes de corregir:
fall? porque next no recibi? el error (lista de errores vac?a). Despu?s pasa.

## Cambios

- Siete controladores: skater, club, competition, track, coach, category y
  trainingsession. Las operaciones HTTP afectadas esperan consultas/escrituras
  y pasan los errores a Express con next(err).
- Delegaciones de consulta y borrado de marcas pasan next y esperan el handler.
- getInputs/getRegistries de entrenamientos capturan los fallos de sus consultas.
- Actualizaci?n de pistas espera fetch, JSON, geocodificaci?n y save; elimina
  variables globales accidentales del flujo y comprueba el resultado de update.
  Los fallos externos/internos van al manejador de errores, en lugar de responder
  con el objeto Error o dejar rechazos sin capturar.
- Consultas get sin resultados de club, skater y trainingsession terminan tras
  enviar null para evitar una segunda respuesta.
- Los servicios getObject siguen devolviendo sus promesas al llamador; las vistas
  de core ya las esperan dentro de su try/catch. No se modifica core.

## Pruebas

85 pruebas nuevas en tests/controllers-async.test.js:
rechazos de BD, excepciones s?ncronas, delegaci?n, errores anidados de pistas,
consultas de entrenamientos, resultados vac?os y respuestas CRUD correctas.
La prueba HTTP provoca un rechazo real: la petici?n devuelve 500, el error llega
una sola vez al middleware y una petici?n posterior sigue respondiendo 200.

Suite completa con Node 24.22.2:

    TIMETRACK_TEST_MEMORY_MONGO=1 NODE_USE_SYSTEM_CA=1 node --test tests/*.test.js

Resultado: 268 superadas, 0 fallos, 0 omitidas, incluida integraci?n MongoDB
sobre una base temporal. Las variables de entorno del ejemplo usan sintaxis sh;
en PowerShell se asignan con $env antes de ejecutar node.

Sin cambios de dependencias, commits de subm?dulos ni despliegues. Este cambio
controla los errores de consultas; no restaura por s? solo una conexi?n ca?da.
La unificaci?n de Mongoose en el consumidor inlinetimetrack sigue siendo necesaria
para el incidente de instancias desconectadas identificado en aquella auditor?a.
