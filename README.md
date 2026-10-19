# Tiempo Oro

Time tracker gamificado para freelancers, estilo Toggl. Sin base de datos: todo vive en archivos `.md` dentro de este repo, y las estadísticas salen de ahí.

- Cronómetro y temporizador (con alarma y tiempo extra).
- Tarea, cliente, proyecto, etiquetas, tarea corta o larga, facturable o no.
- Tarifa por hora y moneda por cliente, con tarifa propia opcional por proyecto.
- Lluvia de monedas con sonido al terminar cada tarea, XP, niveles, racha diaria y logros.
- Estadísticas por día, cliente, proyecto y etiqueta, separadas por moneda.
- Funciona en la compu y en el celu (se puede instalar como app desde el navegador).

## Cómo se guardan los datos

```
data/
  config.md              moneda por defecto, meta diaria, minutos del temporizador, sonido
  clientes.md            tabla de clientes y tabla de proyectos
  activo.md              la tarea que está corriendo (existe sólo mientras corre)
  registros/2026-10.md   una tabla por mes, una fila por tarea
```

Una fila de `registros/AAAA-MM.md`:

```md
| fecha | inicio | fin | duración | tarea | cliente | proyecto | etiquetas | tipo | facturable | tarifa | moneda | monto |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-18 | 09:10 | 11:40 | 2:30:00 | Fix login | Estudio | CRM | bug, auth | larga | sí | 20 | USD | 50.00 |
```

Reglas que conviene saber:

- **La tarifa y el monto se congelan en cada fila** al terminar la tarea. Si mañana subís la tarifa, lo ya registrado no cambia.
- **Las monedas no se suman entre sí.** Las estadísticas muestran un total por moneda.
- Podés editar los `.md` a mano. Si dejás `monto` vacío, se recalcula con `duración × tarifa`. Los encabezados se leen con o sin tildes.
- La app reescribe la tabla del mes ordenada cuando agrega o borra una fila. Si querés notas, ponelas en otro archivo.

## Dónde se guardan (Ajustes)

| Modo | Para qué | Cómo |
|---|---|---|
| **Tu repo de GitHub** | Usarla desde la compu y el celu | La app lee y escribe `data/` con la API de GitHub. Cada cambio es un commit. |
| **Carpeta de tu compu** | Trabajar sin internet | Chrome o Edge de escritorio. Elegís la carpeta `data` del repo clonado y hacés `git push` cuando quieras. |
| **Este navegador (demo)** | Probarla | Queda en el `localStorage`. Si borrás los datos del navegador, se pierden. |

### Conectar GitHub

1. Entrá a [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new).
2. **Repository access → Only select repositories →** este repo.
3. **Permissions → Contents → Read and write.** Nada más.
4. En la app: Ajustes → Tu repo de GitHub → usuario, repo, rama `main`, carpeta `data`, pegá el token → Conectar.

El token queda guardado sólo en ese navegador. Hacelo una vez en la compu y otra en el celu. Si lo perdés o vence, generás otro.

Si se corta internet, los cambios quedan en cola y se suben solos cuando vuelve la conexión (o tocás **Reintentar**).

## Correrla

No necesita build ni dependencias.

```bash
npm run dev     # http://localhost:5173
npm test        # tests del parser y la lógica
```

### Publicarla en Vercel

1. Importá el repo en Vercel. Framework: **Other**. Sin build command.
2. `vercel.json` ya evita un deploy nuevo cada vez que la app commitea datos en `data/`.

La URL es pública, pero sin tu token no muestra ni toca nada: los datos están en tu repo privado.

## Estadísticas desde la terminal

```bash
npm run stats                         # esta semana
npm run stats -- mes                  # hoy | semana | mes | año | todo
npm run stats -- 2026-10-01 2026-10-31
npm run stats -- mes --md             # escribe data/resumen.md
```

Antes de correrlo, hacé `git pull` para traer lo que cargaste desde la app.

## Gamificación

| Qué | Regla |
|---|---|
| Oro | Lo que facturaste: `duración × tarifa`. Las monedas que suenan crecen con lo ganado. |
| XP | 1 por minuto. ×1.5 si es facturable, ×1.25 si es larga. +5 al terminar (+25 si es larga). |
| Nivel | El nivel *n* pide `150 × n^1.35` XP. Rangos: Aprendiz, Jornalero (5), Artesano (10), Mercenario (15), Maestro del oficio (20), Leyenda freelance (30). |
| Racha | Días seguidos con al menos una tarea. Si hoy todavía no registraste nada, cuenta hasta ayer. |
| Logros | 15 (Madrugador: arrancar entre 5 y 7; Búho: entre 23 y 4), desde "Primera moneda" hasta "Las mil horas". Están en `js/model.js`. |

Todo se calcula desde los `.md`: no hay estado guardado aparte. Si borrás una tarea, el XP baja.

Los sonidos se generan en el navegador con Web Audio (no hay archivos de audio). Se pueden apagar o bajar en Ajustes.

## Código

```
index.html          estructura de la app
css/styles.css      estilos
js/md.js            leer y escribir tablas y frontmatter de markdown
js/model.js         registros, tarifas, estadísticas, XP, niveles y logros (lo usa también Node)
js/storage.js       GitHub, carpeta local y demo, con la misma interfaz
js/audio.js         monedas, alarma, subida de nivel
js/app.js           interfaz
scripts/stats.mjs   estadísticas por terminal
tests/              node --test
```
