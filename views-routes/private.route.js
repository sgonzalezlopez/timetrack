const path = require('path');
const express = require('express');
const actions = require(path.join(__corePath, '/views-routes/actions'))
const authorization = require(path.join(__corePath, '/middlewares/authorization'))

const router = express.Router();
const viewRoute = 'private/';

router.get('/', function (req, res, next) {
    actions.renderWithApps(req, res, next, viewRoute + 'index')
});

router.get('/:page', async function (req, res, next) {
  var page = req.params.page;
  var data = {title : req.params.page, values : {}}
  actions.renderWithApps(req, res, next, viewRoute + page, data)
});

router.get('/trainingsession/:id/skater-inputs', authorization.isRole('skater'), async function (req, res, next) {
  var page = 'trainingsession-skater-inputs';
  var data = {title : req.params.page, skaterId : req.user.skater}
  actions.renderWithApps(req, res, next, viewRoute + page, data, req.params.id)
});

router.get('/:page/:id',  async function (req, res, next) {
  var page = req.params.page;
  var data = {title : req.params.page, values : {}}
  actions.renderWithApps(req, res, next, viewRoute + page, data, req.params.id)
});

module.exports = router;