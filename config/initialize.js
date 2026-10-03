const applications = [
   {
      name: 'Tests',
      type: ['side', 'action', 'main'],
      link: '/management/tests-list',
      icon: 'fa-solid fa-flag-checkered',
      parentLink: '/management/',
      roles: ['admin', 'coach', 'user']
   },
   {
      name: 'Stats',
      type: ['side', 'main'],
      link: '/private/stats',
      icon: 'fas fa-chart-line',
      roles: ['admin', 'coach', 'user']
   },
   {
      name: 'Skater Registry',
      type: ['side', 'main'],
      link: '/private/skater-registry',
      icon: 'fas fa-stopwatch',
      roles: ['admin', 'coach', 'user']
   }
]

const values = [
   {type: 'role', value: 'coach', text: 'coach', order : 4},
   {type: 'role', value: 'skater', text: 'skater', order : 5},
   {type: 'gender', value: 'M', text: 'MASCULINO', order : 0},
   {type: 'gender', value: 'F', text: 'FEMENINO', order : 1},

]

module.exports.applications = applications
module.exports.values = values

module.exports.features = [

]

module.exports.configs = [

]