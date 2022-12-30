// Carga de valores de entorno locales.
require('dotenv').config({ override: true })
const path = require('path');
if (typeof __corePath === 'undefined') global.__corePath = path.join(__dirname, './core')
if (typeof __modulesPath === 'undefined') global.__modulesPath = path.join(__dirname, './node_modules')
if (typeof __modelsPath === 'undefined') global.__modelsPath = []
__modelsPath.push(path.join(__dirname, "./models"))
if (typeof __initialization === 'undefined') global.__initialization = []
__initialization.push(path.join(__dirname, "./config/initialize"))

const core = require(path.join(__corePath, '/app'))
const express = require("express");
const fs = require('fs')
const initialize = require(path.join(__corePath, "/config/initialize"));
const { config } = require(path.join(__corePath, "/config/config"));
const Users = require(path.join(__corePath, '/models/user.model'))
const Coach = require('./models/coach.model')
const Skater = require('./models/skater.model')

const default_options = {
  staticPaths : [
    path.join(__dirname, './public'),
  ]
}

module.exports.run = async function run(opts) {
  var options = {...default_options, ...opts}
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
  
  options.staticPaths.forEach(element => {
    core.staticPaths.unshift(element)    
  });

  // core.staticPaths.unshift(path.join(__dirname, './public'))

  app.use('/country-list', express.static(path.join(__modulesPath, '/i18n-iso-countries/langs')));
  app.use('/ol', express.static(path.join(__modulesPath, '/ol')));
  app.use('/peity', express.static(path.join(__modulesPath, '/peity')));
  app.use('/chart', express.static(path.join(__modulesPath, '/chart.js')));
  app.use('/moment', express.static(path.join(__modulesPath, '/moment')));
  app = core.configureStatic(app)
  app.use(function (req, res, next) {
    if (req.originalUrl.split('.').length > 1) {
      for (let i = 0; i < options.staticPaths.length; i++) {
        const element = options.staticPaths[i];
        if (fs.existsSync(path.join(element, req.originalUrl))) return next();        
      }
      throw new Error('Not found: ' +  req.originalUrl);
    }
    return next();
  });

  app.set('views', [path.join(__dirname, '/views'), path.join(__corePath, '/views')]);
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