const config = require('../core/config/config')


exports.getFilter = function (entity, filter, user) {
   if (user.roles.includes('admin')) return filter;


   if (config.getConfig('FILTER_COACH_VALUES') && user.roles.includes('coach')) return filterCoach(entity, filter, user);
   else if (config.getConfig('FILTER_SKATER_VALUES') && user.roles.includes('skater')) return filterSkater(entity, filter, user);
   else return filter;

}

function filterCoach (entity, filter, user) {
   fil = { $in : user.clubs || []};

   switch (entity) {
      case 'Club':
         filter._id = fil         
         break;
      case 'Skater':
         filter.currentclub = fil
         break;
      case 'Registry':
         filter.club = fil
         break;

      default:
         break;
   }
   return filter;
}

function filterSkater (entity, filter, user) {
   var skater = user.skater || [];
   fil = skater;

   switch (entity) {
      case 'Skater':
         filter._id = fil
         break;
      case 'Registry':
         filter.skater = fil
         break;
      case 'TrainingSession':
         filter.skaters = { $all: fil}
         break;

      default:
         break;
   }
   return filter;
}