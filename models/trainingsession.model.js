const mongoose = require('mongoose');
const moment = require('moment')
moment.locale('es')

var Schema = mongoose.Schema;

// creating user schema
const TrainingSessionSchema = mongoose.Schema({
    name : {
        type : String,
    },
    date : {
        type : Date,
    },
    race : {
        type : String,
    },
    distance : {
        type : Number,
    },
    heats : {
        type : Number,
    },
    partialsPerLap : {
        type : Number,
        default : 1
    },
    skaters : {
        type : [Schema.Types.ObjectId],
        ref : 'Skater',
        combo : { collection : {name : 'Skater', text : 'fullname'}, multiple : true} 
    },
    competition : {
        type : Schema.Types.ObjectId,
        ref : 'Competition',
        combo : { collection : {name : 'Competition', text : 'fullname'}} 
    }
}, {
    timestamps: true, 
    toObject: {
        virtuals: true
    },
    toJSON: {
        virtuals: true 
    }
});

// exporting module to allow it to be imported in other files
module.exports = mongoose.model('TrainingSession', TrainingSessionSchema);

