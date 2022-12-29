const mongoose = require('mongoose');
var Schema = mongoose.Schema;

// creating user schema
const RegistrySchema = mongoose.Schema({
    date : {
        type : Date
    },
    skater: {
        type: Schema.Types.ObjectId,
        ref: 'Skater',
        combo : { collection : {name : 'Skater', text : 'fullname'}}  
    },
    club : {
        type : Schema.Types.ObjectId,
        ref : 'Club',
        combo : { collection : {name : 'Club', text : 'name'}}
    },
    category : {
        type : String,
        combo : { type : 'categories'}
    },
    competition: {
        type: Schema.Types.ObjectId,
        ref: 'Competition',
        combo : { collection : {name : 'Competition', text : 'fullname'}}
    },
    race : {
        type : String
    },
    distance : {
        type : Number
    },
    rail : {
        type : String,
        combo : { type : 'rails'}
    },
    starting : {
        type : String,
        combo : { type : 'starting'}
    },
    trainingHeat : {
        type : Number,
    },
    trainingPercentage : {
        type : String,
    },
    times : [{
        type : Number
    }],
    comments : {
        type : String
    }
} , { 
    timestamps: true,
    toObject: {
        virtuals: true
    },
    toJSON: {
        virtuals: true
    }
});

RegistrySchema.virtual('speed').get(function () {
    if (this.distance) return Math.round(this.distance*3600/this.totalTime*100)/100;
    return "";
});

RegistrySchema.virtual('totalTime').get(function () {
    if (typeof(this.times) == 'undefined' || !this.times) return null;
    else return this.times.reduce((partial, e) => partial + e, 0);
});

// exporting module to allow it to be imported in other files
module.exports = mongoose.model('Registry', RegistrySchema);

