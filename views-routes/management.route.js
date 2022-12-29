const { getValues } = require('../core/controllers/value.controller');
const express = require('express');
const actions = require('../core/views-routes/actions')

const router = express.Router();
const viewRoute = 'management/';

router.get('/', function (req, res, next) {
    actions.renderWithApps(req, res, next, 'subindex', {parentApp : '/' + viewRoute})
});

router.get('/:page', async function (req, res, next) {
  var page = req.params.page;
  var data = {title : req.params.page, values : {}}
  actions.renderWithApps(req, res, next, viewRoute + page, data)
});

router.get('/:page/:id', async function (req, res, next) {
  var page = req.params.page;
  var data = {title : req.params.page, values : {}}
  actions.renderWithApps(req, res, next, viewRoute + page, data, req.params.id)
});

router.get('/trainingsession/:id/skater-input/:skaterId', async function (req, res, next) {
  var page = 'trainingsession-skater-input';
  // var token = require('../core/middlewares/auth.jwt').verifyToken
  var data = {title : 'trainingsession', skaterId : req.params.skaterId}
  actions.renderWithApps(req, res, next, viewRoute + page, data, req.params.id)
});


router.get('/:page/:id/:subpage', async function (req, res, next) {
  var page = req.params.page + "-" + req.params.subpage;
  var data = {title : req.params.page, values : {}}
  actions.renderWithApps(req, res, next, viewRoute + page, data, req.params.id)
});

module.exports = router;