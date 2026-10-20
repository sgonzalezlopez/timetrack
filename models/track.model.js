const mongoose = require('mongoose');

var Schema = mongoose.Schema;

// creating user schema
const TrackSchema = mongoose.Schema({
    name : {
        type : String,
    },
    importName: {
        type: String,
        hideInForm: true,
    },
    location : {
        type : String,
    },
    geolocation : {
        type : Map,
        hideInForms : true,
    },
    distance : {
        type : String,
    },
    type : {
        type : String,
        combo : { type : 'track-type'}
    },
    isHeight : {
        type : Boolean,
    },
}, {
    timestamps: true, 
    toObject: {
        virtuals: true
    },
    toJSON: {
        virtuals: true 
    }
});

TrackSchema.virtual('fullname')
.get(function () {
    return `${this.name} - (${this.location})`;
});

TrackSchema.index({ importName: 1 }, {
    unique: true,
    partialFilterExpression: { importName: { $type: 'string' } }
});

// exporting module to allow it to be imported in other files
module.exports = mongoose.model('Track', TrackSchema);
