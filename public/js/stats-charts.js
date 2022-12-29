const { tidy, groupBy, n, summarize, arrange, fullSeq, complete, min, first } = Tidy;

class StatCharts {

   data = null;

   groupedByYear;
   groupedByCategory;
   groupedByClub;
   groupedByRace;
   bestByRace;

   constructor() {
   }


   refreshData(input) {
      this.data = input;
      this.prepareData()
      this.refreshHeader()
      this.refreshYear()
      this.refreshCategory()
      this.refreshClub()
      this.refreshSummary()

      $('#race').empty()
      $('#race').append(`<option value='' selected></option>`)
      this.groupedByRace.forEach(element => {
         $('#race').append(`<option value='${element[0]}'>${element[0]}</option>`)
      });
      $('#race-table').bootstrapTable('load', [])
      $('#num-records-race').text('--')

      Chart.getChart("race-evolution").destroy()
   }

   updateRace() {
      var d = this.groupedByRace.filter(r => r[0] == $('#race').val())[0][1]

      $('#num-records-race').text(d.length)
      $('#race-table').bootstrapTable('load', d)

      this.refreshRaceEvolution($('#race').val())
   }

   prepareData() {
      this.data.map(m => {
         m.clubName = m.club.name
         m.year = new Date(m.date).getFullYear()
      }
      )

      this.groupedByYear = tidy(
         this.data,
         groupBy('year', [summarize({
            num: n()
         })]),
         arrange('year')
      )

      if (this.groupedByYear.filter(e => e.year == new Date().getFullYear()).length == 0) this.groupedByYear.push({ year: new Date().getFullYear(), num: 0 })

      this.groupedByYear = tidy(
         this.groupedByYear,
         complete({ 'year': fullSeq('year') }, { num: 0 })
      )

      this.groupedByCategory = tidy(
         this.data,
         groupBy('category', [summarize({
            num: n()
         })])
      )

      this.groupedByClub = tidy(
         this.data,
         groupBy('clubName', [summarize({
            num: n()
         })])
      )

      this.groupedByRace = tidy(
         this.data,
         arrange('time'),
         groupBy(['race'], [], groupBy.entries())
      )

      this.bestByRace = this.groupedByRace.map(e => {
         var a = e[1].sort((a, b) => a.totalTime - b.totalTime)
         return a[0]
      })

   }


   refreshHeader() {
      $('#num-records').text(this.data.length)
      var lbl = this.groupedByYear[0].year + "-" + new Date().getFullYear()
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

      var evol = this.groupedByRace.filter(v => v[0] == value)[0][1]
      evol = evol.sort((a, b) => { return new Date(a.date) - new Date(b.date) })
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
}
