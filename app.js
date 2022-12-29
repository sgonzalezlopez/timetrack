// Carga de valores de entorno locales.
require('dotenv').config({ override: true })

const core = require("./core/app");
const express = require("express");
const fs = require('fs')
const initialize = require("./core/config/initialize");
const path = require('path');
const { config } = require("core/config/config");
const Users = require('./core/models/user.model')
const Coach = require('./models/coach.model')
const Skater = require('./models/skater.model')

async function run() {
  app = await core.setup({deserializeUser : function(id, done) {
    Users.findOne({ _id: id })
      .then(async user => {
        if (!user || user == null) return done(new Error(i18n.__('Invalid session user')))
        delete user.salt;
        delete user.hash;
          if (user.roles.includes('coach')) {
            var c = await Coach.findOne({user : user._id});
            if (c) user.clubs = c.clubs;
          }
          
          if (user.roles.includes('skater')) {
            var s = await Skater.findOne({user : user});
            if (s) user.skater = s.id;
          }
          
          return done(null, user)
      })
  }})
  
  core.staticPaths.unshift(path.join(__dirname, './public'))

  app.use('/country-list', express.static(path.join(__dirname, './node_modules/i18n-iso-countries/langs')));
  app.use('/ol', express.static(path.join(__dirname, './node_modules/ol')));
  app.use('/peity', express.static(path.join(__dirname, './node_modules/peity')));
  app.use('/chart', express.static(path.join(__dirname, './node_modules/chart.js')));
  app.use('/moment', express.static(path.join(__dirname, './node_modules/moment')));
  app = core.configureStatic(app)
  app.use(function (req, res, next) {
    if (req.originalUrl.split('.').length > 1) {
      if (!fs.existsSync(path.join(__dirname, './public', req.originalUrl)) || !fs.existsSync(path.join(__dirname, './core/public', req.originalUrl))) {
        throw new Error('Not found: ' +  req.originalUrl);
      }
    }
    return next();
  });

  app.set('views', [path.join(__dirname, '/views'), path.join(__dirname, '/core/views')]);
  app.use('/api', require('./api/routes'))
  app.use('/', require('./views-routes/routes'));
  app = core.configureRoutes(app)


  app = core.configureErrorHandling(app)

  initialize()

  console.log('Entorno:', config.app.ENV);

  // set port, listen for requests
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}.`);
  });
}

run()