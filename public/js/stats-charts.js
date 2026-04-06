class StatCharts {

   groupedByYear;
   groupedByCategory;
   groupedByClub;
   bestByRace;
   totalRecords = 0;
   races = [];
   currentSkater = null;
   raceCache = new Map();
   activeRaceRequest = null;

   constructor() {
   }


   refreshData(input, skaterId) {
      this.currentSkater = skaterId || null
      this.groupedByYear = input.groupedByYear || []
      this.groupedByCategory = input.groupedByCategory || []
      this.groupedByClub = input.groupedByClub || []
      this.bestByRace = input.bestByRace || []
      this.races = input.races || []
      this.totalRecords = input.totalRecords || 0
      this.raceCache = new Map()
      this.activeRaceRequest = null

      this.refreshHeader()
      this.refreshYear()
      this.refreshCategory()
      this.refreshClub()
      this.refreshSummary()

      this.refreshRaceOptions()
      this.clearRaceView()
   }

   updateRace() {
      const race = $('#race').val()
      if (!race || !this.currentSkater) {
         this.clearRaceView()
         return
      }

      const cachedData = this.raceCache.get(race)
      if (cachedData) {
         this.renderRace(cachedData)
         return
      }

      this.activeRaceRequest = `${this.currentSkater}:${race}`
      core.api.find('/api/registry/stats/race', { skater: this.currentSkater, race }, data => {
         if (this.activeRaceRequest !== `${this.currentSkater}:${race}`) return
         this.raceCache.set(race, data)
         this.renderRace(data)
      })
   }


   refreshHeader() {
      $('#num-records').text(this.totalRecords)
      const firstYear = this.groupedByYear.length > 0 ? this.groupedByYear[0].year : new Date().getFullYear()
      var lbl = firstYear + "-" + new Date().getFullYear()
      $('#num-kpi').text(this.groupedByYear.map(r => r.num).join(','))
      $('#num-kpi').peity('bar')
      $('#lbl-kpi').text(lbl)
   }

   refreshYear() {
      const chart = Chart.getChart("registry-per-year");
      if (chart) chart.destroy()

      new Chart(document.getElementById('registry-per-year'), {
         type: 'bar',
         data: {
            labels: this.groupedByYear.map(r => r.year),
            datasets: [{
               label: 'Registros',
               data: this.groupedByYear.map(r => r.num),
               borderWidth: 1
            }]
         },
         options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
               legend: {
                  position: 'bottom',
               },
               title: {
                  display: true,
                  text: 'Registros por año'
               }
            }
         }
      })

   }

   refreshCategory() {
      const chart = Chart.getChart("registry-per-category");
      if (chart) chart.destroy()

      new Chart(document.getElementById('registry-per-category'), {
         type: 'pie',
         data: {
            labels: this.groupedByCategory.map(r => r.category),
            datasets: [{
               label: 'Registros',
               data: this.groupedByCategory.map(r => r.num),
               borderWidth: 1
            }]
         },
         options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
               legend: {
                  position: 'bottom',
               },
               title: {
                  display: true,
                  text: 'Registros por categoría'
               }
            }
         }
      })
   }

   refreshClub() {
      const chart = Chart.getChart("registry-per-club");
      if (chart) chart.destroy()

      new Chart(document.getElementById('registry-per-club'), {
         type: 'pie',
         data: {
            labels: this.groupedByClub.map(r => r.clubName),
            datasets: [{
               label: 'Registros',
               data: this.groupedByClub.map(r => r.num),
               borderWidth: 1
            }]
         },
         options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
               legend: {
                  position: 'bottom',
               },
               title: {
                  display: true,
                  text: 'Registros por club'
               }
            }
         }
      })
   }

   refreshRaceEvolution(value) {
      const chart = Chart.getChart("race-evolution");
      if (chart) chart.destroy()

      if (!value || value.length === 0) return

      var evol = [...value].sort((a, b) => { return new Date(a.date) - new Date(b.date) })
      var d = evol.map(r => [new Date(moment.utc(r.date).format('L')), r.totalTime])

      new Chart(document.getElementById('race-evolution'), {
         type: 'line',
         data: {
            datasets: [{
               label: 'Tiempo',
               data: d,
               borderWidth: 2
            }]
         },
         options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
               x: {
                  type: 'time',
                  time: {
                     unit: 'day',
                     tooltipFormat: 'dd/MM/yyyy',
                     displayFormats: {
                        'day': 'dd/MM/yyyy',
                        'month': 'MMM yy',
                        'quarter': 'MMM YY'
                     }
                  },
                  title: {
                     display: true,
                     text: 'Fecha'
                  }
               },
               y: {
                  type: 'linear',
                  position: 'left',
                  ticks: {
                    callback: value => {
                      let date = moment.utc(value);
                      if(date.diff(moment('1970-02-01 23:59:59'), 'minutes') === 0) {
                        return null;
                      }
                      if (value < 60000) return date.format('ss.SSS')
                      else if (value < 1000 * 60 * 60) return date.format('mm:ss.S')
                      else return date.format('HH:mm:ss');
                    }
                  }
                }
            },
            plugins: {
               legend: {
                  position: 'bottom',
               },
               title: {
                  display: false,
                  text: 'Evolución de tiempos'
               }
            }
         }
      })
   }

   refreshSummary() {
      $('#summary_table').bootstrapTable('load', this.bestByRace)
   }

   refreshRaceOptions() {
      const options = [`<option value='' selected></option>`]
      this.races.forEach(race => {
         options.push(`<option value='${race}'>${race}</option>`)
      })
      $('#race').html(options.join(''))
      $('#race').trigger('change.select2')
   }

   clearRaceView() {
      $('#race-table').bootstrapTable('load', [])
      $('#num-records-race').text('--')
      const chart = Chart.getChart("race-evolution")
      if (chart) chart.destroy()
   }

   renderRace(data) {
      $('#num-records-race').text(data.length)
      $('#race-table').bootstrapTable('load', data)
      this.refreshRaceEvolution(data)
   }
}
