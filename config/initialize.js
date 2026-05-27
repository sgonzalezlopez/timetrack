const applications = [
   {
      name: 'Tests',
      link: '/management/tests-list',
      icon: 'fas fa-vial',
      parent: '/management',
      roles: ['coach', 'user']
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